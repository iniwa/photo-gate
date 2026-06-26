"""
photo-gate-sync CLI entrypoint.

Usage:
    photo-gate-sync sync-once --album-id ID --album-title TITLE
        --photoprism-album-uid UID --confirm-upload [options]

All photo_gate imports are deferred inside functions so the module is
importable (and --help works) without libvips or real credentials.
"""

from __future__ import annotations

import argparse
import asyncio
import dataclasses
import logging
import os
import signal
import sys
import time
from datetime import datetime, timezone
from typing import Callable

_UTC = timezone.utc


# Exception types whose messages are sanitized at the raise site (no
# tokens, credentials, or preview tokens) and are therefore safe to print.
# Matching is by class name so this module stays importable without
# libvips (image_processor) or network dependencies.
#   - photo_gate types: ConfigError, MetadataValidationError,
#     ObjectStoreError, PhotoPrismError, and validation ValueErrors.
#   - botocore ClientError: messages contain only operation and error code.
# httpx exceptions are intentionally NOT listed: their messages can embed
# request URLs, which include the PhotoPrism preview token.
_SANITIZED_ERROR_TYPES = frozenset({
    "ClientError",
    "ConfigError",
    "MetadataValidationError",
    "ObjectStoreError",
    "PhotoPrismError",
    "ValueError",
})


def _describe_error(exc: BaseException, depth: int = 0) -> str:
    """
    Operator-readable failure description that never prints messages of
    unknown exception types (class name only). Unwraps exception groups
    and causes a few levels deep so the root cause is visible in logs.
    """
    if depth >= 4:
        return "..."
    name = type(exc).__name__
    if isinstance(exc, BaseExceptionGroup):
        parts = [_describe_error(sub, depth + 1) for sub in exc.exceptions[:3]]
        remaining = len(exc.exceptions) - 3
        if remaining > 0:
            parts.append(f"+{remaining} more")
        return f"{name}[{'; '.join(parts)}]"
    if name in _SANITIZED_ERROR_TYPES:
        described = f"{name}: {exc}"
    else:
        described = name
    if exc.__cause__ is not None:
        described = f"{described} (caused by {_describe_error(exc.__cause__, depth + 1)})"
    return described


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="photo-gate-sync",
        description="photo-gate sync tool",
    )
    sub = parser.add_subparsers(dest="command")

    sync = sub.add_parser(
        "sync-once",
        help="Sync one album to R2 (requires --confirm-upload)",
    )
    sync.add_argument("--album-id", required=True, metavar="ID")
    sync.add_argument("--album-title", required=True, metavar="TITLE")
    sync.add_argument("--photoprism-album-uid", required=True, metavar="UID")
    sync.add_argument(
        "--confirm-upload",
        action="store_true",
        help="Required to prevent accidental uploads",
    )
    sync.add_argument("--concurrency", type=int, default=2, metavar="N")
    # Keep in sync with _SOURCE_SIZE_PX in sync.py (not imported here so the
    # module stays importable without libvips).
    sync.add_argument(
        "--photoprism-preview-size",
        choices=["fit_720", "fit_1280", "fit_1920", "fit_2048", "fit_2560", "fit_3840"],
        default="fit_3840",
        help="PhotoPrism size used as the preview source; pick one the "
        "instance's thumbnail settings can actually serve",
    )
    sync.add_argument("--thumb-long-edge", type=int, default=640, metavar="PX")
    sync.add_argument("--thumb-quality", type=int, default=80, metavar="Q")
    sync.add_argument("--preview-long-edge", type=int, default=3840, metavar="PX")
    sync.add_argument("--preview-quality", type=int, default=88, metavar="Q")

    # sync-daemon subcommand
    daemon = sub.add_parser(
        "sync-daemon",
        help="Run sync repeatedly on a schedule (requires --confirm-upload)",
    )
    # Same positional args as sync-once
    daemon.add_argument("--album-id", required=True, metavar="ID")
    daemon.add_argument("--album-title", required=True, metavar="TITLE")
    daemon.add_argument("--photoprism-album-uid", required=True, metavar="UID")
    daemon.add_argument("--confirm-upload", action="store_true",
                        help="Required to prevent accidental uploads")
    daemon.add_argument("--concurrency", type=int, default=2, metavar="N")
    daemon.add_argument(
        "--photoprism-preview-size",
        choices=["fit_720", "fit_1280", "fit_1920", "fit_2048", "fit_2560", "fit_3840"],
        default="fit_3840",
    )
    daemon.add_argument("--thumb-long-edge", type=int, default=640, metavar="PX")
    daemon.add_argument("--thumb-quality", type=int, default=80, metavar="Q")
    daemon.add_argument("--preview-long-edge", type=int, default=3840, metavar="PX")
    daemon.add_argument("--preview-quality", type=int, default=88, metavar="Q")
    daemon.add_argument("--interval-seconds", type=int, default=86400, metavar="N")
    daemon.add_argument("--health-file", default="/tmp/photo-gate-health.json", metavar="PATH")
    daemon.add_argument("--max-runs", type=int, default=0, metavar="N")

    # healthcheck subcommand
    hc = sub.add_parser("healthcheck", help="Check daemon health file (for Docker HEALTHCHECK)")
    hc.add_argument("--health-file", default="/tmp/photo-gate-health.json", metavar="PATH")
    hc.add_argument("--max-consecutive-failures", type=int, default=3, metavar="N")
    hc.add_argument("--heartbeat-stale-seconds", type=int, default=300, metavar="N")

    return parser


def _validate_sync_once_args(args: argparse.Namespace) -> str | None:
    """Return an error message, or None if args are valid."""
    if not args.confirm_upload:
        return "--confirm-upload is required to prevent accidental uploads"
    if args.concurrency < 1:
        return "--concurrency must be a positive integer"
    return None


def _validate_daemon_args(args: argparse.Namespace) -> str | None:
    """Return an error message, or None if args are valid."""
    if not args.confirm_upload:
        return "--confirm-upload is required to prevent accidental uploads"
    if args.interval_seconds < 60:
        return "--interval-seconds must be >= 60"
    if args.concurrency < 1:
        return "--concurrency must be a positive integer"
    return None


def _utc_now_iso(clock: Callable[[], datetime]) -> str:
    return clock().strftime("%Y-%m-%dT%H:%M:%SZ")


async def _poll_sync_request(
    store: object,
    clock: "Callable[[], datetime]",
    last_handled_id: "str | None",
    log: "logging.Logger",
) -> "dict | None":
    """
    Poll R2 for a pending sync request object.

    Returns the parsed request dict when a valid, non-stale, non-duplicate
    request is found. Returns None for missing, invalid, stale, or duplicate
    requests, deleting them best-effort in those cases. Never raises.
    """
    if store is None:
        return None
    from .sync_request import (
        SYNC_REQUEST_KEY,
        validate_sync_request,
        check_request_timing,
    )
    try:
        data = await store.get(SYNC_REQUEST_KEY)
    except Exception:
        log.warning("request poll failed")
        return None
    if data is None:
        return None
    req, reason = validate_sync_request(data)
    if reason is not None:
        log.warning("request ignored: %s", reason)
        await _best_effort_delete_request(store, log)
        return None
    timing_reason = check_request_timing(req, clock())
    if timing_reason is not None:
        log.warning("request ignored: %s", timing_reason)
        await _best_effort_delete_request(store, log)
        return None
    if req["requestId"] == last_handled_id:
        log.warning("request ignored: duplicate")
        await _best_effort_delete_request(store, log)
        return None
    return req


async def _best_effort_delete_request(store: object, log: "logging.Logger") -> None:
    """Best-effort delete of the sync request object. Never raises."""
    if store is None:
        return
    from .sync_request import SYNC_REQUEST_KEY
    try:
        await store.delete(SYNC_REQUEST_KEY)
    except Exception:
        log.warning("request delete failed")


async def _publish_sync_status(
    state: "HealthState",
    store: object,
    clock: "Callable[[], datetime]",
) -> None:
    """Best-effort R2 publish of sanitized sync status. Never propagates."""
    if store is None:
        return
    try:
        from .sync_status import build_sync_status, SYNC_STATUS_KEY
        published_at = _utc_now_iso(clock)
        data = build_sync_status(state, published_at)
        await store.put(SYNC_STATUS_KEY, data, "application/json")
    except Exception:
        pass


# Third-party loggers that emit request URLs or other untrusted text at
# INFO. httpx/httpcore log every request line as
# "HTTP Request: GET <full url>" — and that URL embeds the PhotoPrism
# preview token (see _SANITIZED_ERROR_TYPES, which excludes httpx for the
# same reason). They must never reach stdout, so the root logger stays at
# WARNING and only our own package logs at INFO.
_NOISY_LOGGER_NAMES = ("httpx", "httpcore", "botocore", "boto3", "urllib3", "pyvips")


def _configure_daemon_logging() -> None:
    # Root stays at WARNING so third-party INFO logs (which can contain the
    # PhotoPrism preview token in request URLs) never reach stdout.
    logging.basicConfig(
        stream=sys.stdout,
        format="%(asctime)sZ %(levelname)s %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
        level=logging.WARNING,
        force=True,
    )
    # Only photo_gate.* logs at INFO; its records propagate to the root
    # handler installed above. Children (photo_gate.main, photo_gate.sync)
    # inherit this level.
    logging.getLogger("photo_gate").setLevel(logging.INFO)
    # Defense in depth: pin known-chatty libraries to WARNING even if some
    # future caller raises the root level back to INFO.
    for name in _NOISY_LOGGER_NAMES:
        logging.getLogger(name).setLevel(logging.WARNING)
    # Make logging use UTC
    logging.Formatter.converter = time.gmtime


async def run_sync_once(
    args: argparse.Namespace,
    *,
    config_loader: Callable | None = None,
    client_factory: Callable | None = None,
    store_factory: Callable | None = None,
    sync_fn: Callable | None = None,
    clock: Callable[[], datetime] | None = None,
    error_sink: Callable[[str], None] | None = None,
) -> int:
    """
    Async composition function for sync-once.

    Factories are injectable for testing. Returns exit code:
      0 — success
      1 — runtime sync failure
      2 — argument / configuration / confirmation error
    """
    # Check CLI flags before any factory or network call.
    error = _validate_sync_once_args(args)
    if error:
        print(f"Error: {error}", file=sys.stderr)
        return 2

    # Defer all photo_gate imports so the module stays importable without libvips.
    from .models import AlbumIdentity, ImageSettings, PreviewSettings, ThumbSettings
    from .config import ConfigError

    try:
        album = AlbumIdentity(
            album_id=args.album_id,
            title=args.album_title,
            photoprism_album_uid=args.photoprism_album_uid,
        )
    except ValueError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2

    try:
        settings = ImageSettings(
            thumb=ThumbSettings(
                long_edge=args.thumb_long_edge,
                quality=args.thumb_quality,
            ),
            preview=PreviewSettings(
                long_edge=args.preview_long_edge,
                quality=args.preview_quality,
            ),
        )
    except ValueError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2

    if config_loader is None:
        from .config import load_config
        config_loader = load_config

    try:
        config = config_loader()
    except ConfigError as exc:
        print(f"Configuration error: {exc}", file=sys.stderr)
        return 2

    if client_factory is None:
        from .photoprism_client import PhotoPrismClient

        def client_factory(cfg):
            return PhotoPrismClient(
                base_url=cfg.photoprism_url,
                token=cfg.photoprism_token,
                cf_client_id=cfg.cf_client_id,
                cf_client_secret=cfg.cf_client_secret,
            )

    if store_factory is None:
        from .r2_store import R2ObjectStore

        def store_factory(cfg):
            return R2ObjectStore(cfg.r2)

    if sync_fn is None:
        from .sync import sync_album
        sync_fn = sync_album

    if clock is None:
        clock = lambda: datetime.now(tz=timezone.utc)

    try:
        generated_at = clock()
        client = client_factory(config)
        async with client:
            store = store_factory(config)
            await sync_fn(
                client,
                album,
                store,
                settings,
                generated_at,
                args.concurrency,
                preview_source_size=args.photoprism_preview_size,
            )
    except Exception as exc:
        described = _describe_error(exc)
        print(
            f"Sync failed for album {args.album_id!r}: {described}",
            file=sys.stderr,
        )
        if error_sink is not None:
            # described is already sanitized; safe to record elsewhere.
            error_sink(described)
        return 1

    print(f"Sync complete: album={args.album_id!r}")
    return 0


async def run_sync_daemon(
    args: argparse.Namespace,
    *,
    config_loader: Callable | None = None,
    client_factory: Callable | None = None,
    store_factory: Callable | None = None,
    sync_fn: Callable | None = None,
    clock: Callable[[], datetime] | None = None,
    sleep_fn: Callable[[float], object] | None = None,
    heartbeat_period: float = 60.0,
    status_store=None,
) -> int:
    """
    Async composition function for sync-daemon.

    Validates args, then loops: run sync -> write health -> sleep -> repeat.
    Injectable for tests: sleep_fn, clock, heartbeat_period.
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

    runs = 0
    exit_code = 0
    _last_handled_request_id: str | None = None
    # run_sync_once reports the sanitized failure description here so the
    # health file can show why the last attempt failed.
    last_error_box: list[str | None] = [None]

    from .sync_request import REQUEST_POLL_INTERVAL

    try:
        while not shutdown_event.is_set():
            if args.max_runs > 0 and runs >= args.max_runs:
                break

            # Poll for a pending manual sync request before each sync attempt.
            _pending_req = await _poll_sync_request(
                _status_store, clock, _last_handled_request_id, log
            )

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
            await _publish_sync_status(state, _status_store, clock)

            log.info("starting sync attempt %d for album %s", runs + 1, album_id)
            t_start = clock()

            # Run a single sync attempt
            last_error_box[0] = None
            attempt_code = await run_sync_once(
                args,
                config_loader=config_loader,
                client_factory=client_factory,
                store_factory=store_factory,
                sync_fn=sync_fn,
                clock=clock,
                error_sink=lambda described: last_error_box.__setitem__(0, described),
            )

            duration = (clock() - t_start).total_seconds()
            runs += 1

            # Post-sync: if this run was triggered by a manual request,
            # best-effort delete the request object and record the handled ID.
            if _pending_req is not None:
                _last_handled_request_id = _pending_req["requestId"]
                await _best_effort_delete_request(_status_store, log)

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
            await _publish_sync_status(state, _status_store, clock)

            if shutdown_event.is_set():
                break
            if args.max_runs > 0 and runs >= args.max_runs:
                break

            # Interruptible polling sleep: sleep for interval_seconds total but
            # wake every REQUEST_POLL_INTERVAL seconds to check for manual
            # sync requests. Breaks early when a valid request is found or
            # shutdown is signalled.
            _sleep_elapsed = 0.0
            _sleep_total = float(args.interval_seconds)
            while _sleep_elapsed < _sleep_total and not shutdown_event.is_set():
                _chunk = min(float(REQUEST_POLL_INTERVAL), _sleep_total - _sleep_elapsed)
                waiter = asyncio.create_task(shutdown_event.wait())
                sleeper = asyncio.create_task(sleep_fn(_chunk))
                try:
                    await asyncio.wait(
                        {waiter, sleeper}, return_when=asyncio.FIRST_COMPLETED
                    )
                finally:
                    for task in (waiter, sleeper):
                        task.cancel()
                    await asyncio.gather(waiter, sleeper, return_exceptions=True)
                if shutdown_event.is_set():
                    break
                _sleep_elapsed += _chunk
                # Poll mid-sleep only when there is still time remaining;
                # the loop-start poll handles the case where sleep completes.
                if _sleep_elapsed < _sleep_total:
                    _mid_req = await _poll_sync_request(
                        _status_store, clock, _last_handled_request_id, log
                    )
                    if _mid_req is not None:
                        # Valid request found; break out early. The request
                        # object is NOT deleted here — it will be consumed at
                        # the next loop-start poll.
                        break

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


def _run_healthcheck(args: argparse.Namespace) -> int:
    """
    Check daemon health file. Exit 0 if healthy, 1 if not.
    Prints a single sanitized line to stderr on failure; no stack traces.
    No network or libvips required.
    """
    import json

    path = args.health_file
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        print(f"healthcheck: health file not found: {path}", file=sys.stderr)
        return 1
    except (json.JSONDecodeError, OSError):
        print("healthcheck: health file is missing or unparseable", file=sys.stderr)
        return 1

    if not isinstance(data, dict) or data.get("schema") != 1:
        print("healthcheck: unknown health file schema", file=sys.stderr)
        return 1

    consecutive = data.get("consecutive_failures")
    if not isinstance(consecutive, int):
        # Fail closed: a schema-1 file must carry this field.
        print("healthcheck: consecutive_failures missing or invalid", file=sys.stderr)
        return 1
    if consecutive >= args.max_consecutive_failures:
        print(
            f"healthcheck: consecutive_failures={consecutive} >= "
            f"threshold={args.max_consecutive_failures}",
            file=sys.stderr,
        )
        return 1

    heartbeat_str = data.get("heartbeat_at")
    if not heartbeat_str:
        print("healthcheck: heartbeat_at missing", file=sys.stderr)
        return 1

    try:
        heartbeat_dt = datetime.fromisoformat(heartbeat_str.replace("Z", "+00:00"))
        now = datetime.now(tz=timezone.utc)
        age = (now - heartbeat_dt).total_seconds()
    except (ValueError, TypeError):
        print("healthcheck: heartbeat_at unparseable", file=sys.stderr)
        return 1

    if age > args.heartbeat_stale_seconds:
        print(
            f"healthcheck: heartbeat stale ({age:.0f}s > "
            f"{args.heartbeat_stale_seconds}s threshold)",
            file=sys.stderr,
        )
        return 1

    return 0


def main() -> None:
    parser = _build_parser()
    args = parser.parse_args()

    if args.command == "sync-once":
        sys.exit(asyncio.run(run_sync_once(args)))
    elif args.command == "sync-daemon":
        sys.exit(asyncio.run(run_sync_daemon(args)))
    elif args.command == "healthcheck":
        sys.exit(_run_healthcheck(args))
    else:
        parser.print_help()
        sys.exit(2)
