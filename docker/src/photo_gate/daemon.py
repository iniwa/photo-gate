"""Long-running sync daemon lifecycle."""
from __future__ import annotations

import argparse
import asyncio
import dataclasses
import logging
import os
import signal
import sys
from datetime import datetime, timezone
from typing import Callable

from .catalog_publisher import _best_effort_publish_catalog
from .cli import _validate_daemon_args
from .daemon_utils import _safe_photo_counts, _sleep_with_request_polling
from .request_consumer import (
    _best_effort_delete_request,
    _poll_catalog_refresh_request,
    _poll_sync_request,
)
from .runtime import _configure_daemon_logging, _utc_now_iso
from .status_publisher import _publish_sync_result, _publish_sync_status
from .sync_once import run_sync_once
from .target_sync import _read_sync_targets_from_store, _run_multi_target_attempt

async def run_sync_daemon(
    args: argparse.Namespace,
    *,
    config_loader: Callable | None = None,
    client_factory: Callable | None = None,
    store_factory: Callable | None = None,
    sync_fn: Callable | None = None,
    catalog_publish_fn: Callable[[], object] | None = None,
    clock: Callable[[], datetime] | None = None,
    sleep_fn: Callable[[float], object] | None = None,
    heartbeat_period: float = 60.0,
    status_store=None,
) -> int:
    """
    Async composition function for sync-daemon.

    Validates args, then loops: run sync -> write health -> sleep -> repeat.
    Injectable for tests: sleep_fn, clock, heartbeat_period, catalog_publish_fn.
    Returns exit code:
      0 -- normal shutdown (SIGTERM/SIGINT or max-runs reached)
      2 -- argument/config validation error
    """
    # --- Validate args before any factory or network call ---
    error = _validate_daemon_args(args)
    if error:
        print(f"Error: {error}", file=sys.stderr)
        return 2

    _configure_daemon_logging()
    log = logging.getLogger(__name__)

    if clock is None:
        clock = lambda: datetime.now(tz=timezone.utc)
    if sleep_fn is None:
        sleep_fn = asyncio.sleep

    # Resolve status store for best-effort remote status publishing.
    _status_store = status_store
    if _status_store is None:
        try:
            _cl = config_loader
            if _cl is None:
                from .config import load_config
                _cl = load_config
            _sf = store_factory
            if _sf is None:
                from .r2_store import R2ObjectStore
                def _sf(cfg):
                    return R2ObjectStore(cfg.r2)
            _cfg = _cl()
            _status_store = _sf(_cfg)
        except Exception:
            pass  # Best-effort; remote status unavailable if config fails

    from .health import HealthState, write_health

    started_at = _utc_now_iso(clock)
    health_path = args.health_file
    album_id = args.album_id

    # Try to get version string
    try:
        import importlib.metadata as _meta
        _version = _meta.version("photo-gate-sync")
    except Exception:
        _version = "unknown"

    log.info(
        "photo-gate-sync %s starting: album_id=%s interval=%ds "
        "preview_size=%s concurrency=%d",
        _version,
        album_id,
        args.interval_seconds,
        args.photoprism_preview_size,
        args.concurrency,
    )

    state = HealthState(
        schema=1,
        pid=os.getpid(),
        album_id=album_id,
        interval_seconds=args.interval_seconds,
        started_at=started_at,
        heartbeat_at=_utc_now_iso(clock),
        last_attempt_started_at=None,
        last_attempt_completed_at=None,
        last_result=None,
        last_error=None,
        consecutive_failures=0,
        runs_completed=0,
    )
    try:
        write_health(state, health_path)
    except OSError:
        pass  # Non-fatal; health is best-effort
    await _publish_sync_status(state, _status_store, clock)

    shutdown_event = asyncio.Event()
    loop = asyncio.get_running_loop()

    def _handle_signal():
        shutdown_event.set()

    try:
        loop.add_signal_handler(signal.SIGTERM, _handle_signal)
        loop.add_signal_handler(signal.SIGINT, _handle_signal)
    except NotImplementedError:
        pass  # Windows: signal handling not supported

    # Heartbeat background task. No asyncio.shield here: wait_for cancels
    # the inner event.wait() on timeout, which is harmless and avoids
    # leaking one pending waiter per period for the daemon's lifetime.
    async def _heartbeat_task():
        nonlocal state
        while not shutdown_event.is_set():
            state = dataclasses.replace(state, heartbeat_at=_utc_now_iso(clock))
            try:
                write_health(state, health_path)
            except OSError:
                pass
            try:
                await asyncio.wait_for(shutdown_event.wait(), timeout=heartbeat_period)
            except asyncio.TimeoutError:
                pass

    heartbeat_bg = asyncio.create_task(_heartbeat_task())

    # Keep the browser-owned album picker fresh without requiring an operator
    # to open a Pi shell. Catalog failure is intentionally isolated from sync
    # and health semantics.
    await _best_effort_publish_catalog(catalog_publish_fn, log)

    runs = 0
    exit_code = 0
    _last_handled_request_id: str | None = None
    _last_handled_catalog_request_id: str | None = None
    _last_trigger_kind: str | None = None
    # run_sync_once reports the sanitized failure description here so the
    # health file can show why the last attempt failed.
    last_error_box: list[str | None] = [None]

    from .sync_request import REQUEST_POLL_INTERVAL
    from .sync_result import SyncRunSummary
    from .catalog_refresh_request import CATALOG_REFRESH_REQUEST_KEY

    try:
        while not shutdown_event.is_set():
            if args.max_runs > 0 and runs >= args.max_runs:
                break

            # Prefer an existing normal sync request when both fixed keys are
            # present. This also lets old test/dummy stores that return one
            # object for every key retain their normal sync behavior.
            _pending_req = await _poll_sync_request(
                _status_store, clock, _last_handled_request_id, log
            )
            _catalog_req = None
            if _pending_req is None:
                # A catalog-only request is intentionally handled as a complete
                # daemon cycle without entering the image-sync path. This keeps
                # a browser-driven catalog refresh from downloading, processing,
                # or uploading any derivative image.
                _catalog_req = await _poll_catalog_refresh_request(
                    _status_store, clock, _last_handled_catalog_request_id, log
                )
            if _catalog_req is not None:
                catalog_started_at = _utc_now_iso(clock)
                catalog_refreshed = await _best_effort_publish_catalog(catalog_publish_fn, log)
                catalog_completed_at = _utc_now_iso(clock)
                _last_handled_catalog_request_id = _catalog_req["requestId"]
                await _best_effort_delete_request(
                    _status_store,
                    log,
                    CATALOG_REFRESH_REQUEST_KEY,
                )
                await _publish_sync_result(
                    SyncRunSummary(),
                    _status_store,
                    clock,
                    operation="catalog-refresh",
                    trigger_kind="manual",
                    result="ok" if catalog_refreshed else "failed",
                    started_at=catalog_started_at,
                    completed_at=catalog_completed_at,
                    catalog_refreshed=catalog_refreshed,
                )
                runs += 1
                if args.max_runs > 0 and runs >= args.max_runs:
                    break

                async def _catalog_sleep_has_pending_request() -> bool:
                    if await _poll_sync_request(
                        _status_store, clock, _last_handled_request_id, log
                    ) is not None:
                        return True
                    return await _poll_catalog_refresh_request(
                        _status_store, clock, _last_handled_catalog_request_id, log
                    ) is not None

                await _sleep_with_request_polling(
                    shutdown_event,
                    sleep_fn,
                    args.interval_seconds,
                    REQUEST_POLL_INTERVAL,
                    _catalog_sleep_has_pending_request,
                )
                continue

            # Determine trigger kind for this attempt.
            _last_trigger_kind = "manual" if _pending_req is not None else "scheduled"

            # Record attempt start
            state = dataclasses.replace(
                state,
                last_attempt_started_at=_utc_now_iso(clock),
                heartbeat_at=_utc_now_iso(clock),
            )
            try:
                write_health(state, health_path)
            except OSError:
                pass
            await _publish_sync_status(
                state,
                _status_store,
                clock,
                last_trigger_kind=_last_trigger_kind,
                last_handled_request_id=_last_handled_request_id,
            )

            log.info("starting sync attempt %d for album %s", runs + 1, album_id)
            t_start = clock()

            summary = SyncRunSummary()

            def _record_single_success(sync_result: object) -> None:
                nonlocal summary
                total, uploaded, skipped = _safe_photo_counts(sync_result)
                summary = dataclasses.replace(
                    summary,
                    targets_attempted=summary.targets_attempted + 1,
                    targets_succeeded=summary.targets_succeeded + 1,
                    photos_total=summary.photos_total + total,
                    photos_uploaded=summary.photos_uploaded + uploaded,
                    photos_skipped=summary.photos_skipped + skipped,
                )

            def _record_multi_result(succeeded: bool, sync_result: object | None) -> None:
                nonlocal summary
                if not succeeded:
                    summary = dataclasses.replace(
                        summary,
                        targets_attempted=summary.targets_attempted + 1,
                        targets_failed=summary.targets_failed + 1,
                    )
                    return
                _record_single_success(sync_result)

            # Try multi-target sync from R2; fall back to single-album on
            # missing/empty/malformed object or unresolvable catalogIds.
            last_error_box[0] = None
            raw_targets = await _read_sync_targets_from_store(_status_store, log)
            if raw_targets:
                multi_code = await _run_multi_target_attempt(
                    args,
                    raw_targets,
                    config_loader=config_loader,
                    client_factory=client_factory,
                    store_factory=store_factory,
                    sync_fn=sync_fn,
                    clock=clock,
                    error_sink=lambda described: last_error_box.__setitem__(0, described),
                    summary_sink=_record_multi_result,
                    log=log,
                )
                if multi_code == -1:
                    log.warning("sync-targets: no catalogIds resolved, using configured album")
                    fallback_used = True
                    attempt_code = await run_sync_once(
                        args,
                        config_loader=config_loader,
                        client_factory=client_factory,
                        store_factory=store_factory,
                        sync_fn=sync_fn,
                        clock=clock,
                        error_sink=lambda described: last_error_box.__setitem__(0, described),
                        summary_sink=_record_single_success,
                    )
                else:
                    fallback_used = False
                    attempt_code = multi_code
            else:
                fallback_used = True
                attempt_code = await run_sync_once(
                    args,
                    config_loader=config_loader,
                    client_factory=client_factory,
                    store_factory=store_factory,
                    sync_fn=sync_fn,
                    clock=clock,
                    error_sink=lambda described: last_error_box.__setitem__(0, described),
                    summary_sink=_record_single_success,
                )

            duration = (clock() - t_start).total_seconds()
            runs += 1

            if fallback_used and attempt_code != 0 and summary.targets_attempted == 0:
                summary = dataclasses.replace(
                    summary,
                    targets_attempted=1,
                    targets_failed=1,
                )

            # Post-sync: if this run was triggered by a manual request,
            # best-effort delete the request object and record the handled ID.
            if _pending_req is not None:
                _last_handled_request_id = _pending_req["requestId"]
                await _best_effort_delete_request(_status_store, log)

            catalog_refreshed = False
            if attempt_code == 0:
                catalog_refreshed = await _best_effort_publish_catalog(catalog_publish_fn, log)
            operation_result = "ok" if attempt_code == 0 else (
                "partial" if summary.targets_succeeded > 0 else "failed"
            )
            await _publish_sync_result(
                summary,
                _status_store,
                clock,
                operation="sync",
                trigger_kind=_last_trigger_kind,
                result=operation_result,
                started_at=_utc_now_iso(lambda: t_start),
                completed_at=_utc_now_iso(clock),
                catalog_refreshed=catalog_refreshed,
            )

            if attempt_code == 2:
                # Config/arg error -- will never fix itself; exit immediately
                log.error(
                    "sync attempt %d for album %s failed with config error (exit 2); "
                    "stopping daemon",
                    runs,
                    album_id,
                )
                exit_code = 2
                break
            elif attempt_code == 0:
                log.info(
                    "sync attempt %d for album %s succeeded in %.1fs",
                    runs,
                    album_id,
                    duration,
                )
                state = dataclasses.replace(
                    state,
                    last_attempt_completed_at=_utc_now_iso(clock),
                    last_result="ok",
                    last_error=None,
                    consecutive_failures=0,
                    runs_completed=runs,
                    heartbeat_at=_utc_now_iso(clock),
                )
            else:
                # attempt_code == 1: runtime failure; continue
                log.warning(
                    "sync attempt %d for album %s failed in %.1fs",
                    runs,
                    album_id,
                    duration,
                )
                new_consecutive = state.consecutive_failures + 1
                state = dataclasses.replace(
                    state,
                    last_attempt_completed_at=_utc_now_iso(clock),
                    last_result="failed",
                    # Sanitized by _describe_error in run_sync_once; the same
                    # text already goes to stderr, so recording it here adds
                    # no new exposure.
                    last_error=last_error_box[0],
                    consecutive_failures=new_consecutive,
                    runs_completed=runs,
                    heartbeat_at=_utc_now_iso(clock),
                )

            try:
                write_health(state, health_path)
            except OSError:
                pass
            await _publish_sync_status(
                state,
                _status_store,
                clock,
                last_trigger_kind=_last_trigger_kind,
                last_handled_request_id=_last_handled_request_id,
            )

            if shutdown_event.is_set():
                break
            if args.max_runs > 0 and runs >= args.max_runs:
                break

            async def _sleep_has_pending_request() -> bool:
                if await _poll_sync_request(
                    _status_store, clock, _last_handled_request_id, log
                ) is not None:
                    return True
                return await _poll_catalog_refresh_request(
                    _status_store, clock, _last_handled_catalog_request_id, log
                ) is not None

            await _sleep_with_request_polling(
                shutdown_event,
                sleep_fn,
                args.interval_seconds,
                REQUEST_POLL_INTERVAL,
                _sleep_has_pending_request,
            )

    except asyncio.CancelledError:
        pass
    finally:
        heartbeat_bg.cancel()
        try:
            await heartbeat_bg
        except asyncio.CancelledError:
            pass

    log.info("photo-gate-sync shutting down")
    return exit_code
