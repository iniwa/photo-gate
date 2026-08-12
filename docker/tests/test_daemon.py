"""
Tests for sync-daemon, healthcheck subcommand, and health file.

No network access, real credentials, PhotoPrism, R2, or libvips required.
All service dependencies are injected via factories.
"""
from __future__ import annotations

import asyncio
import json
import os
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pytest

import io
import logging

from photo_gate.main import (
    _build_parser,
    _configure_daemon_logging,
    _publish_sync_status,
    run_sync_daemon,
    _run_healthcheck,
    _poll_sync_request,
    _best_effort_delete_request,
)
from photo_gate.health import HealthState, write_health


# ---------------------------------------------------------------------------
# Shared constants and fakes (match test_main.py style)
# ---------------------------------------------------------------------------

_FIXED_TS = datetime(2026, 6, 12, 0, 0, 0, tzinfo=timezone.utc)

_VALID_DAEMON_ARGS = [
    "sync-daemon",
    "--album-id", "my-album",
    "--album-title", "My Album",
    "--photoprism-album-uid", "uid123abc",
    "--confirm-upload",
    "--max-runs", "1",
]


class _FakeClient:
    def __init__(self):
        self.closed = False

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        self.closed = True


class _FakeConfig:
    photoprism_url = "https://photos.example.com"
    photoprism_token = "tok"
    cf_client_id = None
    cf_client_secret = None
    r2 = None


async def _noop_sync(*args, **kwargs):
    pass


# ---------------------------------------------------------------------------
# Logging configuration: third-party loggers must not leak request URLs
# ---------------------------------------------------------------------------


def test_daemon_logging_suppresses_httpx_request_urls():
    """
    httpx logs every request as "HTTP Request: GET <url>" at INFO, and that
    URL embeds the PhotoPrism preview token. After _configure_daemon_logging,
    the root logger is WARNING so those lines never reach stdout, while our
    own photo_gate.* INFO lines still do.
    """
    fake_token = "FAKE-PREVIEW-TOKEN-98765"
    try:
        _configure_daemon_logging()
        # Redirect the root handler's stream to a buffer we can inspect.
        buf = io.StringIO()
        root = logging.getLogger()
        assert root.handlers, "basicConfig should have installed a handler"
        original_streams = [getattr(h, "stream", None) for h in root.handlers]
        for h in root.handlers:
            if hasattr(h, "stream"):
                h.stream = buf

        try:
            logging.getLogger("httpx").info(
                "HTTP Request: GET https://photos.example.com/api/v1/t/"
                f"{fake_token}/hash/fit_720 \"HTTP/1.1 200 OK\""
            )
            logging.getLogger("photo_gate.sync").info("album my-album: 234 photos to sync")
        finally:
            for h, s in zip(root.handlers, original_streams):
                if hasattr(h, "stream") and s is not None:
                    h.stream = s

        output = buf.getvalue()
        assert fake_token not in output, "preview token must not reach stdout"
        assert "HTTP Request" not in output, "httpx request line must be suppressed"
        assert "234 photos to sync" in output, "our own INFO logs must still appear"
    finally:
        # Reset logging so this test does not affect others.
        logging.getLogger().handlers.clear()
        logging.getLogger("photo_gate").setLevel(logging.NOTSET)


# ---------------------------------------------------------------------------
# Argument validation
# ---------------------------------------------------------------------------


def test_daemon_interval_below_60_returns_2():
    parser = _build_parser()
    args = parser.parse_args(_VALID_DAEMON_ARGS + ["--interval-seconds", "59"])

    code = asyncio.run(run_sync_daemon(
        args,
        config_loader=lambda: pytest.fail("must not be called"),
        client_factory=lambda cfg: pytest.fail("must not be called"),
        store_factory=lambda cfg: pytest.fail("must not be called"),
        sync_fn=None,
        sleep_fn=asyncio.sleep,
    ))

    assert code == 2


def test_daemon_without_confirm_upload_returns_2():
    parser = _build_parser()
    args = parser.parse_args([
        "sync-daemon",
        "--album-id", "my-album",
        "--album-title", "My Album",
        "--photoprism-album-uid", "uid123abc",
        # no --confirm-upload
        "--max-runs", "1",
    ])

    code = asyncio.run(run_sync_daemon(
        args,
        config_loader=lambda: pytest.fail("must not be called"),
        client_factory=lambda cfg: pytest.fail("must not be called"),
        store_factory=lambda cfg: pytest.fail("must not be called"),
        sync_fn=None,
        sleep_fn=asyncio.sleep,
    ))

    assert code == 2


# ---------------------------------------------------------------------------
# Normal run: max-runs then exit 0
# ---------------------------------------------------------------------------


def test_daemon_runs_n_times_and_exits_0(tmp_path):
    parser = _build_parser()
    args = parser.parse_args(_VALID_DAEMON_ARGS + [
        "--max-runs", "3",
        "--health-file", str(tmp_path / "health.json"),
        "--interval-seconds", "60",
    ])

    sync_calls = []

    async def counting_sync(*a, **kw):
        sync_calls.append(1)

    async def instant_sleep(seconds):
        pass  # skip actual sleep

    code = asyncio.run(run_sync_daemon(
        args,
        config_loader=_FakeConfig,
        client_factory=lambda cfg: _FakeClient(),
        store_factory=lambda cfg: object(),
        sync_fn=counting_sync,
        clock=lambda: _FIXED_TS,
        sleep_fn=instant_sleep,
    ))

    assert code == 0
    assert len(sync_calls) == 3


def test_daemon_publishes_catalog_on_startup_and_after_successful_attempts(tmp_path):
    parser = _build_parser()
    args = parser.parse_args(_VALID_DAEMON_ARGS + [
        "--max-runs", "2",
        "--health-file", str(tmp_path / "health.json"),
        "--interval-seconds", "60",
    ])

    sync_calls = []
    catalog_calls = []
    events = []

    async def counting_sync(*args, **kwargs):
        sync_calls.append(1)
        events.append("sync")

    async def publish_catalog():
        catalog_calls.append(1)
        events.append("catalog")
        return 0

    async def instant_sleep(seconds):
        pass

    code = asyncio.run(run_sync_daemon(
        args,
        config_loader=_FakeConfig,
        client_factory=lambda cfg: _FakeClient(),
        store_factory=lambda cfg: object(),
        sync_fn=counting_sync,
        catalog_publish_fn=publish_catalog,
        clock=lambda: _FIXED_TS,
        sleep_fn=instant_sleep,
    ))

    assert code == 0
    assert len(sync_calls) == 2
    assert len(catalog_calls) == 3  # startup + one per successful sync
    assert events == ["catalog", "sync", "catalog", "sync", "catalog"]


def test_daemon_catalog_failure_does_not_change_successful_sync_state(tmp_path, capsys):
    parser = _build_parser()
    health_path = str(tmp_path / "health.json")
    args = parser.parse_args(_VALID_DAEMON_ARGS + [
        "--max-runs", "1",
        "--health-file", health_path,
        "--interval-seconds", "60",
    ])

    catalog_calls = []
    fake_secret = "FAKE-PHOTOPRISM-TOKEN-12345"

    async def failed_catalog_publish():
        catalog_calls.append(1)
        raise RuntimeError(fake_secret)

    async def instant_sleep(seconds):
        pass

    code = asyncio.run(run_sync_daemon(
        args,
        config_loader=_FakeConfig,
        client_factory=lambda cfg: _FakeClient(),
        store_factory=lambda cfg: object(),
        sync_fn=_noop_sync,
        catalog_publish_fn=failed_catalog_publish,
        clock=lambda: _FIXED_TS,
        sleep_fn=instant_sleep,
    ))

    with open(health_path) as f:
        health = json.load(f)
    output = capsys.readouterr().out

    assert code == 0
    assert len(catalog_calls) == 2  # startup + successful sync
    assert health["last_result"] == "ok"
    assert health["last_error"] is None
    assert health["runs_completed"] == 1
    assert "album catalog publication failed; continuing sync daemon" in output
    assert fake_secret not in output


def test_daemon_catalog_nonzero_return_does_not_change_successful_sync_state(tmp_path):
    parser = _build_parser()
    health_path = str(tmp_path / "health.json")
    args = parser.parse_args(_VALID_DAEMON_ARGS + [
        "--max-runs", "1",
        "--health-file", health_path,
        "--interval-seconds", "60",
    ])

    catalog_calls = []

    async def unavailable_catalog_publish():
        catalog_calls.append(1)
        return 1

    async def instant_sleep(seconds):
        pass

    code = asyncio.run(run_sync_daemon(
        args,
        config_loader=_FakeConfig,
        client_factory=lambda cfg: _FakeClient(),
        store_factory=lambda cfg: object(),
        sync_fn=_noop_sync,
        catalog_publish_fn=unavailable_catalog_publish,
        clock=lambda: _FIXED_TS,
        sleep_fn=instant_sleep,
    ))

    with open(health_path) as f:
        health = json.load(f)

    assert code == 0
    assert len(catalog_calls) == 2  # startup + successful sync
    assert health["last_result"] == "ok"
    assert health["last_error"] is None
    assert health["runs_completed"] == 1


def test_daemon_does_not_publish_catalog_after_failed_sync(tmp_path):
    parser = _build_parser()
    args = parser.parse_args(_VALID_DAEMON_ARGS + [
        "--max-runs", "1",
        "--health-file", str(tmp_path / "health.json"),
        "--interval-seconds", "60",
    ])

    catalog_calls = []

    async def failed_sync(*args, **kwargs):
        raise RuntimeError("injected failure")

    async def publish_catalog():
        catalog_calls.append(1)
        return 0

    async def instant_sleep(seconds):
        pass

    code = asyncio.run(run_sync_daemon(
        args,
        config_loader=_FakeConfig,
        client_factory=lambda cfg: _FakeClient(),
        store_factory=lambda cfg: object(),
        sync_fn=failed_sync,
        catalog_publish_fn=publish_catalog,
        clock=lambda: _FIXED_TS,
        sleep_fn=instant_sleep,
    ))

    assert code == 0
    assert len(catalog_calls) == 1  # startup only


# ---------------------------------------------------------------------------
# Failed sync: continues, increments consecutive_failures, resets on success
# ---------------------------------------------------------------------------


def test_daemon_continues_after_failed_sync(tmp_path):
    parser = _build_parser()
    health_path = str(tmp_path / "health.json")
    args = parser.parse_args(_VALID_DAEMON_ARGS + [
        "--max-runs", "3",
        "--health-file", health_path,
        "--interval-seconds", "60",
    ])

    call_count = [0]

    async def sometimes_failing_sync(*a, **kw):
        call_count[0] += 1
        if call_count[0] == 2:  # fail on second call
            raise RuntimeError("injected failure")

    async def instant_sleep(seconds):
        pass

    code = asyncio.run(run_sync_daemon(
        args,
        config_loader=_FakeConfig,
        client_factory=lambda cfg: _FakeClient(),
        store_factory=lambda cfg: object(),
        sync_fn=sometimes_failing_sync,
        clock=lambda: _FIXED_TS,
        sleep_fn=instant_sleep,
    ))

    assert code == 0
    assert call_count[0] == 3

    with open(health_path) as f:
        data = json.load(f)
    # Third run succeeded, so consecutive_failures should be 0
    assert data["consecutive_failures"] == 0
    assert data["runs_completed"] == 3


def test_consecutive_failures_increments(tmp_path):
    parser = _build_parser()
    health_path = str(tmp_path / "health.json")
    args = parser.parse_args(_VALID_DAEMON_ARGS + [
        "--max-runs", "2",
        "--health-file", health_path,
        "--interval-seconds", "60",
    ])

    async def always_failing_sync(*a, **kw):
        raise RuntimeError("injected failure")

    async def instant_sleep(seconds):
        pass

    code = asyncio.run(run_sync_daemon(
        args,
        config_loader=_FakeConfig,
        client_factory=lambda cfg: _FakeClient(),
        store_factory=lambda cfg: object(),
        sync_fn=always_failing_sync,
        clock=lambda: _FIXED_TS,
        sleep_fn=instant_sleep,
    ))

    assert code == 0

    with open(health_path) as f:
        data = json.load(f)
    assert data["consecutive_failures"] == 2
    assert data["last_result"] == "failed"
    assert data["runs_completed"] == 2


# ---------------------------------------------------------------------------
# Config error (exit code 2) stops daemon immediately
# ---------------------------------------------------------------------------


def test_daemon_stops_on_config_error(tmp_path):
    from photo_gate.config import ConfigError

    parser = _build_parser()
    args = parser.parse_args(_VALID_DAEMON_ARGS + [
        "--max-runs", "5",
        "--health-file", str(tmp_path / "health.json"),
        "--interval-seconds", "60",
    ])

    async def instant_sleep(seconds):
        pass

    def failing_config():
        raise ConfigError("R2_BUCKET not set")

    code = asyncio.run(run_sync_daemon(
        args,
        config_loader=failing_config,
        client_factory=lambda cfg: _FakeClient(),
        store_factory=lambda cfg: object(),
        sync_fn=_noop_sync,
        clock=lambda: _FIXED_TS,
        sleep_fn=instant_sleep,
    ))

    assert code == 2


# ---------------------------------------------------------------------------
# Health file content after success and after failure
# ---------------------------------------------------------------------------


def test_health_file_after_success(tmp_path):
    health_path = str(tmp_path / "health.json")
    parser = _build_parser()
    args = parser.parse_args(_VALID_DAEMON_ARGS + [
        "--max-runs", "1",
        "--health-file", health_path,
        "--interval-seconds", "60",
    ])

    async def instant_sleep(seconds):
        pass

    asyncio.run(run_sync_daemon(
        args,
        config_loader=_FakeConfig,
        client_factory=lambda cfg: _FakeClient(),
        store_factory=lambda cfg: object(),
        sync_fn=_noop_sync,
        clock=lambda: _FIXED_TS,
        sleep_fn=instant_sleep,
    ))

    with open(health_path) as f:
        data = json.load(f)

    assert data["schema"] == 1
    assert data["album_id"] == "my-album"
    assert data["last_result"] == "ok"
    assert data["consecutive_failures"] == 0
    assert data["runs_completed"] == 1
    assert data["last_error"] is None
    assert data["last_attempt_started_at"] is not None
    assert data["last_attempt_completed_at"] is not None


def test_health_file_no_tmp_left_behind(tmp_path):
    health_path = str(tmp_path / "health.json")
    parser = _build_parser()
    args = parser.parse_args(_VALID_DAEMON_ARGS + [
        "--max-runs", "1",
        "--health-file", health_path,
        "--interval-seconds", "60",
    ])

    async def instant_sleep(seconds):
        pass

    asyncio.run(run_sync_daemon(
        args,
        config_loader=_FakeConfig,
        client_factory=lambda cfg: _FakeClient(),
        store_factory=lambda cfg: object(),
        sync_fn=_noop_sync,
        clock=lambda: _FIXED_TS,
        sleep_fn=instant_sleep,
    ))

    assert not os.path.exists(health_path + ".tmp"), ".tmp file must not be left behind"


def test_health_file_after_failure_no_forbidden_strings(tmp_path):
    health_path = str(tmp_path / "health.json")
    parser = _build_parser()
    args = parser.parse_args(_VALID_DAEMON_ARGS + [
        "--max-runs", "1",
        "--health-file", health_path,
        "--interval-seconds", "60",
    ])

    fake_token = "FAKE-PREVIEW-TOKEN-12345"

    async def failing_sync_with_token(*a, **kw):
        import httpx
        exc = httpx.HTTPStatusError(
            f"400 Bad Request url=https://photos.example.com/api/v1/t/abc/{fake_token}/fit_3840",
            request=httpx.Request("GET", "https://photos.example.com/"),
            response=httpx.Response(400),
        )
        raise exc

    async def instant_sleep(seconds):
        pass

    asyncio.run(run_sync_daemon(
        args,
        config_loader=_FakeConfig,
        client_factory=lambda cfg: _FakeClient(),
        store_factory=lambda cfg: object(),
        sync_fn=failing_sync_with_token,
        clock=lambda: _FIXED_TS,
        sleep_fn=instant_sleep,
    ))

    with open(health_path) as f:
        content = f.read()

    assert fake_token not in content, "Health file must not contain token from httpx exception"

    data = json.loads(content)
    # httpx exception types are not in _SANITIZED_ERROR_TYPES, so the
    # recorded error must be the class name only -- never the message,
    # which embeds the preview-token URL.
    assert data["last_result"] == "failed"
    assert data["last_error"] == "HTTPStatusError"
    assert data["consecutive_failures"] == 1


# ---------------------------------------------------------------------------
# Heartbeat advances while sync is in flight
# ---------------------------------------------------------------------------


def test_heartbeat_advances_during_slow_sync(tmp_path):
    health_path = str(tmp_path / "health.json")
    parser = _build_parser()
    args = parser.parse_args(_VALID_DAEMON_ARGS + [
        "--max-runs", "1",
        "--health-file", health_path,
        "--interval-seconds", "60",
    ])

    tick = [0]

    def advancing_clock():
        t = datetime(2026, 6, 12, 0, 0, tick[0], tzinfo=timezone.utc)
        tick[0] += 1
        return t

    async def slow_sync(*a, **kw):
        # Wait long enough for the heartbeat to fire at least once
        await asyncio.sleep(0.2)

    async def instant_sleep(seconds):
        pass

    # Use real asyncio.sleep so the heartbeat can fire during the 0.2s sync
    asyncio.run(run_sync_daemon(
        args,
        config_loader=_FakeConfig,
        client_factory=lambda cfg: _FakeClient(),
        store_factory=lambda cfg: object(),
        sync_fn=slow_sync,
        clock=advancing_clock,
        sleep_fn=instant_sleep,
        heartbeat_period=0.05,  # fire every 50ms
    ))

    with open(health_path) as f:
        data = json.load(f)

    # heartbeat_at should be later than started_at (multiple clock ticks advanced)
    started = data["started_at"]
    heartbeat = data["heartbeat_at"]
    assert heartbeat >= started, "heartbeat_at should advance during sync"


# ---------------------------------------------------------------------------
# healthcheck subcommand
# ---------------------------------------------------------------------------


def _make_healthy_health_file(tmp_path: Path, **overrides: Any) -> str:
    now_iso = datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    data = {
        "schema": 1,
        "pid": os.getpid(),
        "album_id": "my-album",
        "interval_seconds": 86400,
        "started_at": now_iso,
        "heartbeat_at": now_iso,
        "last_attempt_started_at": now_iso,
        "last_attempt_completed_at": now_iso,
        "last_result": "ok",
        "last_error": None,
        "consecutive_failures": 0,
        "runs_completed": 1,
    }
    data.update(overrides)
    path = str(tmp_path / "health.json")
    with open(path, "w") as f:
        json.dump(data, f)
    return path


def _parse_hc_args(health_path: str, **extra) -> Any:
    parser = _build_parser()
    argv = ["healthcheck", "--health-file", health_path]
    for k, v in extra.items():
        argv += [f"--{k.replace('_', '-')}", str(v)]
    return parser.parse_args(argv)


def test_healthcheck_exits_0_healthy(tmp_path):
    health_path = _make_healthy_health_file(tmp_path)
    args = _parse_hc_args(health_path)
    assert _run_healthcheck(args) == 0


def test_healthcheck_exits_1_missing_file(tmp_path, capsys):
    args = _parse_hc_args(str(tmp_path / "nonexistent.json"))
    code = _run_healthcheck(args)
    captured = capsys.readouterr()
    assert code == 1
    assert captured.err.count("\n") == 1  # single line


def test_healthcheck_exits_1_corrupt_json(tmp_path, capsys):
    path = str(tmp_path / "health.json")
    with open(path, "w") as f:
        f.write("not valid json {{{")
    args = _parse_hc_args(path)
    code = _run_healthcheck(args)
    captured = capsys.readouterr()
    assert code == 1
    assert captured.err.count("\n") == 1


def test_healthcheck_exits_1_unknown_schema(tmp_path, capsys):
    path = _make_healthy_health_file(tmp_path, schema=99)
    args = _parse_hc_args(path)
    code = _run_healthcheck(args)
    captured = capsys.readouterr()
    assert code == 1
    assert captured.err.count("\n") == 1


def test_healthcheck_exits_1_stale_heartbeat(tmp_path, capsys):
    old_iso = "2020-01-01T00:00:00Z"
    path = _make_healthy_health_file(tmp_path, heartbeat_at=old_iso)
    args = _parse_hc_args(path, heartbeat_stale_seconds=300)
    code = _run_healthcheck(args)
    captured = capsys.readouterr()
    assert code == 1
    assert captured.err.count("\n") == 1


def test_healthcheck_exits_1_missing_consecutive_failures(tmp_path, capsys):
    """Fail closed when a schema-1 file lacks the failure counter."""
    now_iso = datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    path = str(tmp_path / "health.json")
    with open(path, "w") as f:
        json.dump({"schema": 1, "heartbeat_at": now_iso}, f)
    args = _parse_hc_args(path)
    code = _run_healthcheck(args)
    captured = capsys.readouterr()
    assert code == 1
    assert captured.err.count("\n") == 1


def test_healthcheck_exits_1_consecutive_failures(tmp_path, capsys):
    path = _make_healthy_health_file(tmp_path, consecutive_failures=3)
    args = _parse_hc_args(path, max_consecutive_failures=3)
    code = _run_healthcheck(args)
    captured = capsys.readouterr()
    assert code == 1
    assert captured.err.count("\n") == 1


def test_healthcheck_stderr_is_single_sanitized_line(tmp_path, capsys):
    """Ensure stderr output is always exactly one line with no stack trace."""
    args = _parse_hc_args(str(tmp_path / "missing.json"))
    _run_healthcheck(args)
    captured = capsys.readouterr()
    lines = [l for l in captured.err.splitlines() if l.strip()]
    assert len(lines) == 1
    # Must not contain file paths or exception class names in a stack trace
    assert "Traceback" not in captured.err


# ---------------------------------------------------------------------------
# _publish_sync_status — best-effort publish helper
# ---------------------------------------------------------------------------


class _FakeStore:
    def __init__(self, fail: bool = False, request_bytes: bytes | None = None):
        self.calls: list[tuple[str, bytes, str]] = []
        self.get_calls: list[str] = []
        self.delete_calls: list[str] = []
        self._fail = fail
        self._objects: dict[str, bytes] = {}
        if request_bytes is not None:
            self._objects["ops/sync-request.json"] = request_bytes

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        if self._fail:
            raise RuntimeError("simulated put failure")
        self.calls.append((key, data, content_type))

    async def get(self, key: str) -> bytes | None:
        self.get_calls.append(key)
        return self._objects.get(key)

    async def delete(self, key: str) -> None:
        self.delete_calls.append(key)
        self._objects.pop(key, None)


_HEALTH = HealthState(
    schema=1,
    pid=1,
    album_id="album-x",
    interval_seconds=3600,
    started_at="2026-06-25T00:00:00Z",
    heartbeat_at="2026-06-25T00:00:00Z",
    last_attempt_started_at=None,
    last_attempt_completed_at=None,
    last_result=None,
    last_error=None,
    consecutive_failures=0,
    runs_completed=0,
)

_FIXED_CLOCK = lambda: datetime(2026, 6, 25, 0, 2, 5, tzinfo=timezone.utc)


def test_publish_sync_status_calls_store():
    store = _FakeStore()
    asyncio.run(_publish_sync_status(_HEALTH, store, _FIXED_CLOCK))
    assert len(store.calls) == 1
    key, data, content_type = store.calls[0]
    assert key == "ops/sync-status.json"
    assert content_type == "application/json"
    assert isinstance(data, bytes)


def test_publish_sync_status_store_none_is_noop():
    # Must not raise when store is None
    asyncio.run(_publish_sync_status(_HEALTH, None, _FIXED_CLOCK))


def test_publish_sync_status_store_failure_is_noop(caplog):
    store = _FakeStore(fail=True)
    # Must not propagate the store failure
    asyncio.run(_publish_sync_status(_HEALTH, store, _FIXED_CLOCK))
    assert "sync status publish failed" in caplog.text
    assert "simulated put failure" not in caplog.text


def test_daemon_publishes_status_on_lifecycle():
    parser = _build_parser()
    args = parser.parse_args(_VALID_DAEMON_ARGS)
    store = _FakeStore()
    code = asyncio.run(
        run_sync_daemon(
            args,
            config_loader=lambda: _FakeConfig(),
            client_factory=lambda cfg: _FakeClient(),
            store_factory=lambda cfg: object(),
            sync_fn=_noop_sync,
            clock=lambda: _FIXED_TS,
            status_store=store,
        )
    )
    assert code == 0
    # At minimum: initial status + lifecycle status plus the new aggregate
    # result publication. Both private ops keys use application/json.
    assert len(store.calls) >= 2
    for key, data, ct in store.calls:
        assert key in {"ops/sync-status.json", "ops/sync-result.json"}
        assert ct == "application/json"


def test_daemon_status_store_none_does_not_raise():
    parser = _build_parser()
    args = parser.parse_args(_VALID_DAEMON_ARGS)
    code = asyncio.run(
        run_sync_daemon(
            args,
            config_loader=lambda: _FakeConfig(),
            client_factory=lambda cfg: _FakeClient(),
            store_factory=lambda cfg: object(),
            sync_fn=_noop_sync,
            clock=lambda: _FIXED_TS,
            status_store=None,
        )
    )
    assert code == 0


# ---------------------------------------------------------------------------
# Sync request polling: shared helpers
# ---------------------------------------------------------------------------

import json as _json

# requestedAt matches _FIXED_TS so age = 0 (valid)
_FIXED_REQUEST_BYTES = _json.dumps({
    "schema": 1,
    "requestId": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
    "requestedAt": "2026-06-12T00:00:00.000Z",
    "kind": "sync-now",
}).encode("utf-8")

# requestedAt is 3601s before _FIXED_TS → stale
_STALE_REQUEST_BYTES = _json.dumps({
    "schema": 1,
    "requestId": "b1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
    "requestedAt": "2026-06-11T22:59:59.000Z",
    "kind": "sync-now",
}).encode("utf-8")


def _daemon_args_with(tmp_path, max_runs=1, interval_seconds=60):
    return _build_parser().parse_args(_VALID_DAEMON_ARGS + [
        "--max-runs", str(max_runs),
        "--interval-seconds", str(interval_seconds),
        "--health-file", str(tmp_path / "health.json"),
    ])


async def _instant_sleep(seconds):
    pass


# ---------------------------------------------------------------------------
# Sync request polling: _poll_sync_request unit tests
# ---------------------------------------------------------------------------


def test_poll_request_store_none_returns_none():
    result = asyncio.run(
        _poll_sync_request(None, lambda: _FIXED_TS, None, logging.getLogger("test"))
    )
    assert result is None


def test_poll_request_no_object_returns_none():
    store = _FakeStore(request_bytes=None)
    result = asyncio.run(
        _poll_sync_request(store, lambda: _FIXED_TS, None, logging.getLogger("test"))
    )
    assert result is None


def test_poll_request_valid_object_returns_dict():
    store = _FakeStore(request_bytes=_FIXED_REQUEST_BYTES)
    result = asyncio.run(
        _poll_sync_request(store, lambda: _FIXED_TS, None, logging.getLogger("test"))
    )
    assert result is not None
    assert result["requestId"] == "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4"


def test_poll_request_stale_returns_none_and_deletes():
    store = _FakeStore(request_bytes=_STALE_REQUEST_BYTES)
    result = asyncio.run(
        _poll_sync_request(store, lambda: _FIXED_TS, None, logging.getLogger("test"))
    )
    assert result is None
    assert len(store.delete_calls) == 1


def test_poll_request_malformed_returns_none_and_deletes():
    store = _FakeStore(request_bytes=b"not json")
    result = asyncio.run(
        _poll_sync_request(store, lambda: _FIXED_TS, None, logging.getLogger("test"))
    )
    assert result is None
    assert len(store.delete_calls) == 1


def test_poll_request_duplicate_returns_none_and_deletes():
    store = _FakeStore(request_bytes=_FIXED_REQUEST_BYTES)
    last_id = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4"
    result = asyncio.run(
        _poll_sync_request(store, lambda: _FIXED_TS, last_id, logging.getLogger("test"))
    )
    assert result is None
    assert len(store.delete_calls) == 1


def test_poll_request_get_failure_returns_none():
    class _ThrowingStore(_FakeStore):
        async def get(self, key):
            raise RuntimeError("R2 connection error")
    store = _ThrowingStore()
    result = asyncio.run(
        _poll_sync_request(store, lambda: _FIXED_TS, None, logging.getLogger("test"))
    )
    assert result is None


def test_best_effort_delete_failure_does_not_raise():
    class _ThrowingStore(_FakeStore):
        async def delete(self, key):
            raise RuntimeError("R2 delete error")
    store = _ThrowingStore()
    # Must not raise
    asyncio.run(_best_effort_delete_request(store, logging.getLogger("test")))


# ---------------------------------------------------------------------------
# Sync request polling: daemon integration tests
# ---------------------------------------------------------------------------


def test_daemon_valid_request_triggers_sync(tmp_path):
    """A valid pending request at loop-start causes a sync attempt."""
    args = _daemon_args_with(tmp_path, max_runs=1)
    store = _FakeStore(request_bytes=_FIXED_REQUEST_BYTES)
    sync_calls = []

    async def counting_sync(*a, **kw):
        sync_calls.append(1)

    code = asyncio.run(run_sync_daemon(
        args,
        config_loader=_FakeConfig,
        client_factory=lambda cfg: _FakeClient(),
        store_factory=lambda cfg: object(),
        sync_fn=counting_sync,
        clock=lambda: _FIXED_TS,
        sleep_fn=_instant_sleep,
        status_store=store,
    ))

    assert code == 0
    assert len(sync_calls) == 1


def test_daemon_request_deleted_after_sync(tmp_path):
    """The request object is best-effort deleted after the sync completes."""
    args = _daemon_args_with(tmp_path, max_runs=1)
    store = _FakeStore(request_bytes=_FIXED_REQUEST_BYTES)

    code = asyncio.run(run_sync_daemon(
        args,
        config_loader=_FakeConfig,
        client_factory=lambda cfg: _FakeClient(),
        store_factory=lambda cfg: object(),
        sync_fn=_noop_sync,
        clock=lambda: _FIXED_TS,
        sleep_fn=_instant_sleep,
        status_store=store,
    ))

    assert code == 0
    assert "ops/sync-request.json" in store.delete_calls


def test_daemon_stale_request_skipped_sync_still_runs(tmp_path):
    """A stale request is deleted; the scheduled sync still runs."""
    args = _daemon_args_with(tmp_path, max_runs=1)
    store = _FakeStore(request_bytes=_STALE_REQUEST_BYTES)
    sync_calls = []

    async def counting_sync(*a, **kw):
        sync_calls.append(1)

    code = asyncio.run(run_sync_daemon(
        args,
        config_loader=_FakeConfig,
        client_factory=lambda cfg: _FakeClient(),
        store_factory=lambda cfg: object(),
        sync_fn=counting_sync,
        clock=lambda: _FIXED_TS,
        sleep_fn=_instant_sleep,
        status_store=store,
    ))

    assert code == 0
    assert len(sync_calls) == 1  # scheduled sync still ran
    assert "ops/sync-request.json" in store.delete_calls


def test_daemon_duplicate_request_skipped_second_sync_runs(tmp_path):
    """
    If the request object is not deleted (delete failed), a second loop
    iteration recognises the same requestId as a duplicate and skips it.
    """
    class _NoDeleteStore(_FakeStore):
        async def delete(self, key):
            self.delete_calls.append(key)
            # Do NOT clear the object to simulate delete failure.

    store = _NoDeleteStore(request_bytes=_FIXED_REQUEST_BYTES)
    args = _daemon_args_with(tmp_path, max_runs=2)
    sync_calls = []

    async def counting_sync(*a, **kw):
        sync_calls.append(1)

    code = asyncio.run(run_sync_daemon(
        args,
        config_loader=_FakeConfig,
        client_factory=lambda cfg: _FakeClient(),
        store_factory=lambda cfg: object(),
        sync_fn=counting_sync,
        clock=lambda: _FIXED_TS,
        sleep_fn=_instant_sleep,
        status_store=store,
    ))

    assert code == 0
    assert len(sync_calls) == 2  # both runs completed
    assert store.delete_calls.count("ops/sync-request.json") >= 2


def test_daemon_sleep_poll_breaks_early_when_request_appears(tmp_path):
    """
    A request discovered during inter-sync sleep should interrupt the sleep and
    be consumed at the next loop-start poll, without waiting the full interval.
    """
    class _AppearingStore(_FakeStore):
        async def get(self, key):
            self.get_calls.append(key)
            if key != "ops/sync-request.json":
                return None
            # First poll at loop start sees nothing. The mid-sleep poll sees
            # the request, and the next loop-start poll consumes it.
            if self.get_calls.count("ops/sync-request.json") == 1:
                return None
            return self._objects.get(key)

    store = _AppearingStore(request_bytes=_FIXED_REQUEST_BYTES)
    args = _daemon_args_with(tmp_path, max_runs=2, interval_seconds=120)
    sync_calls = []
    sleep_calls = []

    async def counting_sync(*a, **kw):
        sync_calls.append(1)

    async def recording_sleep(seconds):
        sleep_calls.append(seconds)

    code = asyncio.run(run_sync_daemon(
        args,
        config_loader=_FakeConfig,
        client_factory=lambda cfg: _FakeClient(),
        store_factory=lambda cfg: object(),
        sync_fn=counting_sync,
        clock=lambda: _FIXED_TS,
        sleep_fn=recording_sleep,
        status_store=store,
    ))

    assert code == 0
    assert len(sync_calls) == 2
    assert sleep_calls == [60]
    assert store.get_calls.count("ops/sync-request.json") >= 3
    assert "ops/sync-request.json" in store.delete_calls


def test_daemon_request_get_failure_does_not_crash(tmp_path):
    """R2 GET failure is a warning; daemon continues normally."""
    class _ThrowingGetStore(_FakeStore):
        async def get(self, key):
            raise RuntimeError("R2 connection error")

    store = _ThrowingGetStore()
    args = _daemon_args_with(tmp_path, max_runs=1)
    sync_calls = []

    async def counting_sync(*a, **kw):
        sync_calls.append(1)

    code = asyncio.run(run_sync_daemon(
        args,
        config_loader=_FakeConfig,
        client_factory=lambda cfg: _FakeClient(),
        store_factory=lambda cfg: object(),
        sync_fn=counting_sync,
        clock=lambda: _FIXED_TS,
        sleep_fn=_instant_sleep,
        status_store=store,
    ))

    assert code == 0
    assert len(sync_calls) == 1  # scheduled sync ran despite poll failure


def test_daemon_request_delete_failure_does_not_crash(tmp_path):
    """R2 DELETE failure is a warning; daemon continues normally."""
    class _ThrowingDeleteStore(_FakeStore):
        async def delete(self, key):
            self.delete_calls.append(key)
            raise RuntimeError("R2 delete error")

    store = _ThrowingDeleteStore(request_bytes=_FIXED_REQUEST_BYTES)
    args = _daemon_args_with(tmp_path, max_runs=1)

    code = asyncio.run(run_sync_daemon(
        args,
        config_loader=_FakeConfig,
        client_factory=lambda cfg: _FakeClient(),
        store_factory=lambda cfg: object(),
        sync_fn=_noop_sync,
        clock=lambda: _FIXED_TS,
        sleep_fn=_instant_sleep,
        status_store=store,
    ))

    assert code == 0
    # delete was attempted despite failure
    assert "ops/sync-request.json" in store.delete_calls


# ---------------------------------------------------------------------------
# Catalog-only request and aggregate result publication
# ---------------------------------------------------------------------------


class _KeyedOpsStore:
    """Key-aware private-R2 fake used for new request/result behavior."""

    def __init__(self, objects: dict[str, bytes] | None = None):
        self.objects = dict(objects or {})
        self.puts: list[tuple[str, bytes, str]] = []
        self.get_calls: list[str] = []
        self.delete_calls: list[str] = []

    async def get(self, key: str) -> bytes | None:
        self.get_calls.append(key)
        return self.objects.get(key)

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        self.puts.append((key, data, content_type))
        self.objects[key] = data

    async def delete(self, key: str) -> None:
        self.delete_calls.append(key)
        self.objects.pop(key, None)


def _catalog_refresh_request_bytes() -> bytes:
    return _json.dumps({
        "schema": 1,
        "requestId": "c1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
        "requestedAt": "2026-06-12T00:00:00.000Z",
        "kind": "publish-catalog",
    }).encode("utf-8")


def test_catalog_only_request_never_invokes_image_sync_and_publishes_result(tmp_path):
    from photo_gate.catalog_refresh_request import CATALOG_REFRESH_REQUEST_KEY
    from photo_gate.sync_result import SYNC_RESULT_KEY

    args = _daemon_args_with(tmp_path, max_runs=1)
    store = _KeyedOpsStore({CATALOG_REFRESH_REQUEST_KEY: _catalog_refresh_request_bytes()})
    sync_calls: list[object] = []
    catalog_calls: list[object] = []

    async def forbidden_sync(*args, **kwargs):
        sync_calls.append((args, kwargs))

    async def publish_catalog():
        catalog_calls.append(1)
        return 0

    code = asyncio.run(run_sync_daemon(
        args,
        config_loader=_FakeConfig,
        client_factory=lambda cfg: _FakeClient(),
        store_factory=lambda cfg: object(),
        sync_fn=forbidden_sync,
        catalog_publish_fn=publish_catalog,
        clock=lambda: _FIXED_TS,
        sleep_fn=_instant_sleep,
        status_store=store,
    ))

    assert code == 0
    assert sync_calls == []
    # Startup refresh plus the requested refresh are both catalog-only.
    assert len(catalog_calls) == 2
    assert CATALOG_REFRESH_REQUEST_KEY in store.delete_calls
    results = [json.loads(data) for key, data, _ in store.puts if key == SYNC_RESULT_KEY]
    assert results[-1]["operation"] == "catalog-refresh"
    assert results[-1]["result"] == "ok"
    assert results[-1]["photos"] == {"total": 0, "uploaded": 0, "skipped": 0}


def test_sync_result_aggregates_only_safe_counts(tmp_path):
    from types import SimpleNamespace
    from photo_gate.sync_result import SYNC_RESULT_KEY

    args = _daemon_args_with(tmp_path, max_runs=1)
    store = _KeyedOpsStore()

    async def counted_sync(*args, **kwargs):
        return SimpleNamespace(photos_total=5, photos_uploaded=2, photos_skipped=3)

    code = asyncio.run(run_sync_daemon(
        args,
        config_loader=_FakeConfig,
        client_factory=lambda cfg: _FakeClient(),
        store_factory=lambda cfg: object(),
        sync_fn=counted_sync,
        clock=lambda: _FIXED_TS,
        sleep_fn=_instant_sleep,
        status_store=store,
    ))

    assert code == 0
    result = next(json.loads(data) for key, data, _ in store.puts if key == SYNC_RESULT_KEY)
    assert result["operation"] == "sync"
    assert result["targets"] == {"attempted": 1, "succeeded": 1, "failed": 0}
    assert result["photos"] == {"total": 5, "uploaded": 2, "skipped": 3}
    assert "albumId" not in result
    assert "error" not in result


def test_daemon_manual_sync_updates_health_file(tmp_path):
    """A manual request sync updates health file same as scheduled sync."""
    health_path = str(tmp_path / "health.json")
    args = _build_parser().parse_args(_VALID_DAEMON_ARGS + [
        "--max-runs", "1",
        "--health-file", health_path,
        "--interval-seconds", "60",
    ])
    store = _FakeStore(request_bytes=_FIXED_REQUEST_BYTES)

    asyncio.run(run_sync_daemon(
        args,
        config_loader=_FakeConfig,
        client_factory=lambda cfg: _FakeClient(),
        store_factory=lambda cfg: object(),
        sync_fn=_noop_sync,
        clock=lambda: _FIXED_TS,
        sleep_fn=_instant_sleep,
        status_store=store,
    ))

    with open(health_path) as f:
        data = _json.load(f)

    assert data["runs_completed"] == 1
    assert data["last_result"] == "ok"
    assert data["consecutive_failures"] == 0


def test_daemon_request_id_not_in_health_file(tmp_path):
    """requestId and request key must never appear in the local health file (schema 1)."""
    health_path = str(tmp_path / "health.json")
    args = _build_parser().parse_args(_VALID_DAEMON_ARGS + [
        "--max-runs", "1",
        "--health-file", health_path,
        "--interval-seconds", "60",
    ])
    store = _FakeStore(request_bytes=_FIXED_REQUEST_BYTES)

    asyncio.run(run_sync_daemon(
        args,
        config_loader=_FakeConfig,
        client_factory=lambda cfg: _FakeClient(),
        store_factory=lambda cfg: object(),
        sync_fn=_noop_sync,
        clock=lambda: _FIXED_TS,
        sleep_fn=_instant_sleep,
        status_store=store,
    ))

    with open(health_path) as f:
        content = f.read()

    assert "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4" not in content, "requestId must not leak into health file"
    assert "ops/sync-request.json" not in content, "request key must not appear in health file"


def test_daemon_manual_trigger_kind_in_status(tmp_path):
    """Manual sync: status publishes lastTriggerKind='manual' and lastHandledRequestId."""
    args = _daemon_args_with(tmp_path, max_runs=1)
    store = _FakeStore(request_bytes=_FIXED_REQUEST_BYTES)

    code = asyncio.run(run_sync_daemon(
        args,
        config_loader=_FakeConfig,
        client_factory=lambda cfg: _FakeClient(),
        store_factory=lambda cfg: object(),
        sync_fn=_noop_sync,
        clock=lambda: _FIXED_TS,
        sleep_fn=_instant_sleep,
        status_store=store,
    ))

    assert code == 0
    assert store.calls, "expected at least one status publish"
    last_body = _json.loads(store.calls[-1][1])
    assert last_body["schema"] == 2
    assert last_body["lastTriggerKind"] == "manual"
    assert last_body["lastHandledRequestId"] == "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4"


def test_daemon_scheduled_trigger_kind_in_status(tmp_path):
    """Scheduled sync (no pending request): status publishes lastTriggerKind='scheduled'."""
    args = _daemon_args_with(tmp_path, max_runs=1)
    store = _FakeStore(request_bytes=None)

    code = asyncio.run(run_sync_daemon(
        args,
        config_loader=_FakeConfig,
        client_factory=lambda cfg: _FakeClient(),
        store_factory=lambda cfg: object(),
        sync_fn=_noop_sync,
        clock=lambda: _FIXED_TS,
        sleep_fn=_instant_sleep,
        status_store=store,
    ))

    assert code == 0
    assert store.calls, "expected at least one status publish"
    last_body = _json.loads(store.calls[-1][1])
    assert last_body["schema"] == 2
    assert last_body["lastTriggerKind"] == "scheduled"
    assert last_body["lastHandledRequestId"] is None


# ---------------------------------------------------------------------------
# _read_sync_targets_from_store unit tests
# ---------------------------------------------------------------------------

from photo_gate.main import _read_sync_targets_from_store, _run_multi_target_attempt


def _make_targets_bytes(targets: list | None = None) -> bytes:
    obj = {
        "schema": 1,
        "publishedAt": "2026-06-29T12:00:00.000Z",
        "targets": targets if targets is not None else [],
    }
    return _json.dumps(obj).encode("utf-8")


_VALID_CATALOG_ID = "a" * 64
_VALID_ALBUM_TARGET = {
    "albumId": "album-one",
    "catalogId": _VALID_CATALOG_ID,
    "title": "Album One",
    "expiresAt": None,
    "downloadEnabled": 0,
    "thumb": {"longEdge": 640, "format": "webp", "quality": 80},
    "preview": {"longEdge": 3840, "format": "jpg", "quality": 88},
    "stripExif": 1,
}


class _TargetsStore:
    """Fake store that returns targets data for the targets key, None otherwise."""

    def __init__(self, targets_bytes: bytes | None, throw_on_get: bool = False):
        self._targets_bytes = targets_bytes
        self._throw = throw_on_get
        self.get_calls: list[str] = []

    async def get(self, key: str) -> bytes | None:
        self.get_calls.append(key)
        if self._throw:
            raise RuntimeError("store get exploded")
        from photo_gate.sync_targets import SYNC_TARGETS_KEY
        if key == SYNC_TARGETS_KEY:
            return self._targets_bytes
        return None

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        pass

    async def delete(self, key: str) -> None:
        pass


def _get_test_log() -> logging.Logger:
    return logging.getLogger("photo_gate.test")


def test_read_sync_targets_missing_returns_empty():
    store = _TargetsStore(None)
    result = asyncio.run(_read_sync_targets_from_store(store, _get_test_log()))
    assert result == []


def test_read_sync_targets_empty_array_returns_empty():
    store = _TargetsStore(_make_targets_bytes([]))
    result = asyncio.run(_read_sync_targets_from_store(store, _get_test_log()))
    assert result == []


def test_read_sync_targets_valid_returns_list():
    store = _TargetsStore(_make_targets_bytes([_VALID_ALBUM_TARGET]))
    result = asyncio.run(_read_sync_targets_from_store(store, _get_test_log()))
    assert result is not None
    assert len(result) == 1
    assert result[0]["albumId"] == "album-one"


def test_read_sync_targets_malformed_returns_none():
    store = _TargetsStore(b"not valid json")
    result = asyncio.run(_read_sync_targets_from_store(store, _get_test_log()))
    assert result is None


def test_read_sync_targets_invalid_schema_returns_none():
    store = _TargetsStore(_json.dumps({"schema": 2, "publishedAt": "2026-06-29T12:00:00.000Z", "targets": []}).encode())
    result = asyncio.run(_read_sync_targets_from_store(store, _get_test_log()))
    assert result is None


def test_read_sync_targets_store_throws_returns_none():
    store = _TargetsStore(None, throw_on_get=True)
    result = asyncio.run(_read_sync_targets_from_store(store, _get_test_log()))
    assert result is None


# ---------------------------------------------------------------------------
# _run_multi_target_attempt unit tests
# ---------------------------------------------------------------------------

import hashlib
import argparse


def _multi_args() -> argparse.Namespace:
    return _build_parser().parse_args(_VALID_DAEMON_ARGS + ["--max-runs", "1"])


class _FakeAlbum:
    def __init__(self, raw_uid: str, title: str = "Album"):
        self.raw_uid = raw_uid
        self.title = title
        self.photo_count = 1
        self.updated_at = None


_RAW_UID = "uid123abc"
_CATALOG_ID_FOR_UID = hashlib.sha256(_RAW_UID.encode()).hexdigest()


class _ListingClient:
    """Fake PhotoPrism client that returns configured albums."""

    def __init__(self, albums: list):
        self._albums = albums
        self.synced: list[str] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    async def list_albums(self):
        return self._albums


async def _capturing_sync(client, album, store, settings, generated_at, concurrency, **kwargs):
    """Records which album was synced."""
    pass


def test_run_multi_target_all_resolved_returns_0(tmp_path):
    args = _multi_args()
    targets = [{
        "albumId": "album-one",
        "catalogId": _CATALOG_ID_FOR_UID,
        "title": "Album One",
        "expiresAt": None,
        "downloadEnabled": 0,
    }]
    albums = [_FakeAlbum(_RAW_UID)]
    client = _ListingClient(albums)

    code = asyncio.run(_run_multi_target_attempt(
        args,
        targets,
        config_loader=lambda: _FakeConfig(),
        client_factory=lambda cfg: client,
        store_factory=lambda cfg: object(),
        sync_fn=_noop_sync,
        clock=lambda: _FIXED_TS,
        log=_get_test_log(),
    ))
    assert code == 0


def test_run_multi_target_no_resolved_returns_minus1(tmp_path):
    args = _multi_args()
    targets = [{
        "albumId": "album-one",
        "catalogId": "c" * 64,
        "title": "Album One",
        "expiresAt": None,
        "downloadEnabled": 0,
    }]
    albums = [_FakeAlbum(_RAW_UID)]
    client = _ListingClient(albums)

    code = asyncio.run(_run_multi_target_attempt(
        args,
        targets,
        config_loader=lambda: _FakeConfig(),
        client_factory=lambda cfg: client,
        store_factory=lambda cfg: object(),
        sync_fn=_noop_sync,
        clock=lambda: _FIXED_TS,
        log=_get_test_log(),
    ))
    assert code == -1


def test_run_multi_target_partial_resolution_syncs_resolved(tmp_path):
    args = _multi_args()
    synced_ids: list[str] = []

    async def _recording_sync(client, album, store, settings, generated_at, concurrency, **kwargs):
        synced_ids.append(album.album_id)

    uid_a = "uid-aaaa"
    uid_b = "uid-bbbb"
    catalog_a = hashlib.sha256(uid_a.encode()).hexdigest()
    catalog_b = hashlib.sha256(uid_b.encode()).hexdigest()

    targets = [
        {"albumId": "album-a", "catalogId": catalog_a, "title": "A", "expiresAt": None, "downloadEnabled": 0},
        {"albumId": "album-b", "catalogId": "d" * 64, "title": "B", "expiresAt": None, "downloadEnabled": 0},
    ]
    albums = [_FakeAlbum(uid_a), _FakeAlbum(uid_b)]
    client = _ListingClient(albums)

    code = asyncio.run(_run_multi_target_attempt(
        args,
        targets,
        config_loader=lambda: _FakeConfig(),
        client_factory=lambda cfg: client,
        store_factory=lambda cfg: object(),
        sync_fn=_recording_sync,
        clock=lambda: _FIXED_TS,
        log=_get_test_log(),
    ))
    assert code == 0
    assert synced_ids == ["album-a"]


def test_run_multi_target_one_fails_continues_rest(tmp_path):
    args = _multi_args()

    uid_a = "uid-aaaa2"
    uid_b = "uid-bbbb2"
    catalog_a = hashlib.sha256(uid_a.encode()).hexdigest()
    catalog_b = hashlib.sha256(uid_b.encode()).hexdigest()

    synced_ids: list[str] = []
    errors: list[str] = []

    async def _partially_failing_sync(client, album, store, settings, generated_at, concurrency, **kwargs):
        if album.album_id == "album-a":
            raise RuntimeError("simulated failure")
        synced_ids.append(album.album_id)

    targets = [
        {"albumId": "album-a", "catalogId": catalog_a, "title": "A", "expiresAt": None, "downloadEnabled": 0},
        {"albumId": "album-b", "catalogId": catalog_b, "title": "B", "expiresAt": None, "downloadEnabled": 0},
    ]
    albums = [_FakeAlbum(uid_a), _FakeAlbum(uid_b)]
    client = _ListingClient(albums)

    code = asyncio.run(_run_multi_target_attempt(
        args,
        targets,
        config_loader=lambda: _FakeConfig(),
        client_factory=lambda cfg: client,
        store_factory=lambda cfg: object(),
        sync_fn=_partially_failing_sync,
        clock=lambda: _FIXED_TS,
        error_sink=errors.append,
        log=_get_test_log(),
    ))
    assert code == 1
    assert synced_ids == ["album-b"]
    assert errors == ["RuntimeError"]


def test_run_multi_target_config_error_returns_2(tmp_path):
    from photo_gate.config import ConfigError
    args = _multi_args()

    def _bad_config():
        raise ConfigError("bad config")

    code = asyncio.run(_run_multi_target_attempt(
        args,
        [{"albumId": "a", "catalogId": _CATALOG_ID_FOR_UID, "title": "T", "expiresAt": None, "downloadEnabled": 0}],
        config_loader=_bad_config,
        client_factory=lambda cfg: _ListingClient([]),
        store_factory=lambda cfg: object(),
        sync_fn=_noop_sync,
        clock=lambda: _FIXED_TS,
        log=_get_test_log(),
    ))
    assert code == 2


# ---------------------------------------------------------------------------
# Daemon integration: sync-targets fallback behavior
# ---------------------------------------------------------------------------

class _SmartStore(_FakeStore):
    """Store that returns different bytes per key."""

    def __init__(self, key_map: dict[str, bytes | None]):
        super().__init__(request_bytes=None)
        self._key_map = key_map

    async def get(self, key: str) -> bytes | None:
        self.get_calls.append(key)
        return self._key_map.get(key, None)


def test_daemon_no_targets_uses_fallback(tmp_path):
    """Empty targets array → daemon uses configured single-album (run_sync_once)."""
    args = _daemon_args_with(tmp_path, max_runs=1)
    synced: list[str] = []

    async def _recording_sync(client, album, store, settings, generated_at, concurrency, **kwargs):
        synced.append(album.album_id)

    from photo_gate.sync_targets import SYNC_TARGETS_KEY
    store = _SmartStore({SYNC_TARGETS_KEY: _make_targets_bytes([])})

    code = asyncio.run(run_sync_daemon(
        args,
        config_loader=lambda: _FakeConfig(),
        client_factory=lambda cfg: _FakeClient(),
        store_factory=lambda cfg: object(),
        sync_fn=_recording_sync,
        clock=lambda: _FIXED_TS,
        sleep_fn=_instant_sleep,
        status_store=store,
    ))
    assert code == 0
    assert synced == ["my-album"]


def test_daemon_missing_targets_uses_fallback(tmp_path):
    """Missing targets object → daemon uses configured single-album."""
    args = _daemon_args_with(tmp_path, max_runs=1)
    synced: list[str] = []

    async def _recording_sync(client, album, store, settings, generated_at, concurrency, **kwargs):
        synced.append(album.album_id)

    from photo_gate.sync_targets import SYNC_TARGETS_KEY
    store = _SmartStore({SYNC_TARGETS_KEY: None})

    code = asyncio.run(run_sync_daemon(
        args,
        config_loader=lambda: _FakeConfig(),
        client_factory=lambda cfg: _FakeClient(),
        store_factory=lambda cfg: object(),
        sync_fn=_recording_sync,
        clock=lambda: _FIXED_TS,
        sleep_fn=_instant_sleep,
        status_store=store,
    ))
    assert code == 0
    assert synced == ["my-album"]


def test_daemon_malformed_targets_uses_fallback(tmp_path):
    """Malformed targets object → daemon falls back to configured single-album."""
    args = _daemon_args_with(tmp_path, max_runs=1)
    synced: list[str] = []

    async def _recording_sync(client, album, store, settings, generated_at, concurrency, **kwargs):
        synced.append(album.album_id)

    from photo_gate.sync_targets import SYNC_TARGETS_KEY
    store = _SmartStore({SYNC_TARGETS_KEY: b"not valid json"})

    code = asyncio.run(run_sync_daemon(
        args,
        config_loader=lambda: _FakeConfig(),
        client_factory=lambda cfg: _FakeClient(),
        store_factory=lambda cfg: object(),
        sync_fn=_recording_sync,
        clock=lambda: _FIXED_TS,
        sleep_fn=_instant_sleep,
        status_store=store,
    ))
    assert code == 0
    assert synced == ["my-album"]


def test_daemon_unresolved_targets_uses_fallback(tmp_path):
    """Valid targets but no catalogIds resolve → daemon falls back to configured album."""
    args = _daemon_args_with(tmp_path, max_runs=1)
    synced: list[str] = []

    async def _recording_sync(client, album, store, settings, generated_at, concurrency, **kwargs):
        synced.append(album.album_id)

    target = dict(_VALID_ALBUM_TARGET)
    target["catalogId"] = "e" * 64
    from photo_gate.sync_targets import SYNC_TARGETS_KEY
    store = _SmartStore({SYNC_TARGETS_KEY: _make_targets_bytes([target])})

    code = asyncio.run(run_sync_daemon(
        args,
        config_loader=lambda: _FakeConfig(),
        client_factory=lambda cfg: _ListingClient([_FakeAlbum(_RAW_UID)]),
        store_factory=lambda cfg: object(),
        sync_fn=_recording_sync,
        clock=lambda: _FIXED_TS,
        sleep_fn=_instant_sleep,
        status_store=store,
    ))
    assert code == 0
    assert synced == ["my-album"]


def test_daemon_valid_targets_syncs_multi(tmp_path):
    """Valid non-empty targets with resolved catalogIds → multi-target sync runs."""
    args = _daemon_args_with(tmp_path, max_runs=1)
    synced: list[str] = []

    async def _recording_sync(client, album, store, settings, generated_at, concurrency, **kwargs):
        synced.append(album.album_id)

    catalog_id = hashlib.sha256(_RAW_UID.encode()).hexdigest()
    target = dict(_VALID_ALBUM_TARGET)
    target["catalogId"] = catalog_id
    from photo_gate.sync_targets import SYNC_TARGETS_KEY
    store = _SmartStore({SYNC_TARGETS_KEY: _make_targets_bytes([target])})

    code = asyncio.run(run_sync_daemon(
        args,
        config_loader=lambda: _FakeConfig(),
        client_factory=lambda cfg: _ListingClient([_FakeAlbum(_RAW_UID)]),
        store_factory=lambda cfg: object(),
        sync_fn=_recording_sync,
        clock=lambda: _FIXED_TS,
        sleep_fn=_instant_sleep,
        status_store=store,
    ))
    assert code == 0
    assert synced == ["album-one"]
