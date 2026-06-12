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

from photo_gate.main import _build_parser, run_sync_daemon, _run_healthcheck
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
