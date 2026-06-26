"""
Tests for sync_status module.
No network, R2, credentials, or Docker access.
"""
from __future__ import annotations

import dataclasses
import json

import pytest

from photo_gate.health import HealthState
from photo_gate.sync_status import SYNC_STATUS_KEY, build_sync_status

_BASE_STATE = HealthState(
    schema=1,
    pid=12345,
    album_id="my-album",
    interval_seconds=86400,
    started_at="2026-06-25T00:00:00Z",
    heartbeat_at="2026-06-25T00:01:00Z",
    last_attempt_started_at="2026-06-25T00:00:00Z",
    last_attempt_completed_at="2026-06-25T00:02:00Z",
    last_result="ok",
    last_error=None,
    consecutive_failures=0,
    runs_completed=1,
)

_PUBLISHED_AT = "2026-06-25T00:02:05Z"

_VALID_REQUEST_ID = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4"


def _payload(state=_BASE_STATE, published_at=_PUBLISHED_AT, **kwargs):
    return json.loads(build_sync_status(state, published_at, **kwargs))


# ---------------------------------------------------------------------------
# Key constant
# ---------------------------------------------------------------------------


def test_sync_status_key_is_fixed():
    assert SYNC_STATUS_KEY == "ops/sync-status.json"


# ---------------------------------------------------------------------------
# Return type and JSON shape
# ---------------------------------------------------------------------------


def test_build_returns_bytes():
    result = build_sync_status(_BASE_STATE, _PUBLISHED_AT)
    assert isinstance(result, bytes)


def test_build_is_valid_json():
    result = build_sync_status(_BASE_STATE, _PUBLISHED_AT)
    parsed = json.loads(result)
    assert isinstance(parsed, dict)


def test_build_schema_is_2():
    assert _payload()["schema"] == 2


def test_build_published_at_matches_arg():
    assert _payload()["publishedAt"] == _PUBLISHED_AT


def test_build_album_id():
    assert _payload()["albumId"] == _BASE_STATE.album_id


def test_build_interval_seconds():
    assert _payload()["intervalSeconds"] == _BASE_STATE.interval_seconds


# ---------------------------------------------------------------------------
# Forbidden field exclusion
# ---------------------------------------------------------------------------


def test_build_excludes_pid():
    payload = _payload()
    assert "pid" not in payload


def test_build_excludes_album_title():
    raw = build_sync_status(_BASE_STATE, _PUBLISHED_AT).decode("utf-8")
    for key in ("albumTitle", "title", "album_title"):
        assert key not in raw


def test_build_excludes_photoprism_uid():
    raw = build_sync_status(_BASE_STATE, _PUBLISHED_AT).decode("utf-8")
    assert "photoprism" not in raw.lower()


# ---------------------------------------------------------------------------
# lastResult variants
# ---------------------------------------------------------------------------


def test_build_last_result_ok():
    assert _payload()["lastResult"] == "ok"


def test_build_last_result_failed():
    state = dataclasses.replace(_BASE_STATE, last_result="failed")
    assert _payload(state)["lastResult"] == "failed"


def test_build_last_result_none():
    state = dataclasses.replace(_BASE_STATE, last_result=None)
    assert _payload(state)["lastResult"] is None


# ---------------------------------------------------------------------------
# Nullable attempt timestamps
# ---------------------------------------------------------------------------


def test_build_last_attempt_nullable():
    state = dataclasses.replace(
        _BASE_STATE,
        last_attempt_started_at=None,
        last_attempt_completed_at=None,
    )
    payload = _payload(state)
    assert payload["lastAttemptStartedAt"] is None
    assert payload["lastAttemptCompletedAt"] is None


# ---------------------------------------------------------------------------
# lastError
# ---------------------------------------------------------------------------


def test_build_last_error_string():
    state = dataclasses.replace(_BASE_STATE, last_error="ConfigError: bad config")
    assert _payload(state)["lastError"] == "ConfigError: bad config"


def test_build_last_error_none():
    assert _payload()["lastError"] is None


# ---------------------------------------------------------------------------
# Counts
# ---------------------------------------------------------------------------


def test_build_consecutive_failures_zero():
    state = dataclasses.replace(_BASE_STATE, consecutive_failures=0)
    assert _payload(state)["consecutiveFailures"] == 0


def test_build_runs_completed_zero():
    state = dataclasses.replace(_BASE_STATE, runs_completed=0)
    assert _payload(state)["runsCompleted"] == 0


# ---------------------------------------------------------------------------
# Trigger fields — defaults
# ---------------------------------------------------------------------------


def test_build_last_trigger_kind_default_null():
    assert _payload()["lastTriggerKind"] is None


def test_build_last_handled_request_id_default_null():
    assert _payload()["lastHandledRequestId"] is None


# ---------------------------------------------------------------------------
# Trigger fields — valid values
# ---------------------------------------------------------------------------


def test_build_last_trigger_kind_scheduled():
    assert _payload(last_trigger_kind="scheduled")["lastTriggerKind"] == "scheduled"


def test_build_last_trigger_kind_manual():
    assert _payload(last_trigger_kind="manual")["lastTriggerKind"] == "manual"


def test_build_last_handled_request_id_valid():
    assert (
        _payload(last_handled_request_id=_VALID_REQUEST_ID)["lastHandledRequestId"]
        == _VALID_REQUEST_ID
    )


# ---------------------------------------------------------------------------
# Trigger fields — validation failures
# ---------------------------------------------------------------------------


def test_rejects_invalid_last_trigger_kind():
    with pytest.raises(ValueError):
        build_sync_status(_BASE_STATE, _PUBLISHED_AT, last_trigger_kind="unknown")


def test_rejects_bool_last_trigger_kind():
    with pytest.raises(ValueError):
        build_sync_status(_BASE_STATE, _PUBLISHED_AT, last_trigger_kind=True)  # type: ignore[arg-type]


def test_rejects_last_handled_request_id_uppercase():
    with pytest.raises(ValueError):
        build_sync_status(
            _BASE_STATE, _PUBLISHED_AT, last_handled_request_id="A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4"
        )


def test_rejects_last_handled_request_id_too_short():
    with pytest.raises(ValueError):
        build_sync_status(_BASE_STATE, _PUBLISHED_AT, last_handled_request_id="abc123")


def test_rejects_bool_last_handled_request_id():
    with pytest.raises(ValueError):
        build_sync_status(_BASE_STATE, _PUBLISHED_AT, last_handled_request_id=True)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Validation: published_at
# ---------------------------------------------------------------------------


def test_rejects_invalid_published_at():
    with pytest.raises(ValueError):
        build_sync_status(_BASE_STATE, "not-a-ts")


def test_rejects_invalid_published_at_with_offset():
    with pytest.raises(ValueError):
        build_sync_status(_BASE_STATE, "2026-06-25T00:00:00+09:00")


def test_rejects_published_at_with_milliseconds():
    # Daemon format is second-only; millisecond form is not accepted
    with pytest.raises(ValueError):
        build_sync_status(_BASE_STATE, "2026-06-25T00:00:00.000Z")


# ---------------------------------------------------------------------------
# Validation: state fields
# ---------------------------------------------------------------------------


def test_rejects_invalid_started_at():
    state = dataclasses.replace(_BASE_STATE, started_at="not-valid")
    with pytest.raises(ValueError):
        build_sync_status(state, _PUBLISHED_AT)
def test_rejects_impossible_started_at_date():
    state = dataclasses.replace(_BASE_STATE, started_at="2026-99-25T00:00:00Z")
    with pytest.raises(ValueError):
        build_sync_status(state, _PUBLISHED_AT)


def test_rejects_invalid_album_id_with_spaces():
    state = dataclasses.replace(_BASE_STATE, album_id="my album")
    with pytest.raises(ValueError):
        build_sync_status(state, _PUBLISHED_AT)


def test_rejects_empty_album_id():
    state = dataclasses.replace(_BASE_STATE, album_id="")
    with pytest.raises(ValueError):
        build_sync_status(state, _PUBLISHED_AT)


def test_rejects_negative_interval_seconds():
    state = dataclasses.replace(_BASE_STATE, interval_seconds=-1)
    with pytest.raises(ValueError):
        build_sync_status(state, _PUBLISHED_AT)
def test_rejects_bool_interval_seconds():
    state = dataclasses.replace(_BASE_STATE, interval_seconds=True)
    with pytest.raises(ValueError):
        build_sync_status(state, _PUBLISHED_AT)


def test_rejects_negative_consecutive_failures():
    state = dataclasses.replace(_BASE_STATE, consecutive_failures=-1)
    with pytest.raises(ValueError):
        build_sync_status(state, _PUBLISHED_AT)


def test_rejects_negative_runs_completed():
    state = dataclasses.replace(_BASE_STATE, runs_completed=-1)
    with pytest.raises(ValueError):
        build_sync_status(state, _PUBLISHED_AT)


def test_rejects_invalid_last_result():
    state = dataclasses.replace(_BASE_STATE, last_result="pending")
    with pytest.raises(ValueError):
        build_sync_status(state, _PUBLISHED_AT)


# ---------------------------------------------------------------------------
# Exact key set (14 keys for schema 2)
# ---------------------------------------------------------------------------


def test_exact_keys():
    expected = {
        "schema",
        "publishedAt",
        "albumId",
        "intervalSeconds",
        "startedAt",
        "heartbeatAt",
        "lastAttemptStartedAt",
        "lastAttemptCompletedAt",
        "lastResult",
        "lastError",
        "consecutiveFailures",
        "runsCompleted",
        "lastTriggerKind",
        "lastHandledRequestId",
    }
    assert set(_payload().keys()) == expected
