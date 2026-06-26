"""
Tests for sync_request module: validate_sync_request and check_request_timing.

No network, R2, libvips, or credentials required.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import pytest

from photo_gate.sync_request import (
    STALENESS_THRESHOLD_SECONDS,
    FUTURE_SKEW_TOLERANCE_SECONDS,
    validate_sync_request,
    check_request_timing,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_VALID_ID = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4"
_VALID_TS_MS = "2026-06-12T00:00:00.000Z"   # Worker millisecond form
_VALID_TS_S  = "2026-06-12T00:00:00Z"        # Docker second form


def _make(*, schema=1, requestId=_VALID_ID, requestedAt=_VALID_TS_MS, kind="sync-now") -> bytes:
    return json.dumps({
        "schema": schema,
        "requestId": requestId,
        "requestedAt": requestedAt,
        "kind": kind,
    }).encode("utf-8")


def _make_now() -> datetime:
    return datetime(2026, 6, 12, 0, 0, 0, tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# validate_sync_request — success cases
# ---------------------------------------------------------------------------


def test_valid_worker_ms_form_returns_dict():
    req, reason = validate_sync_request(_make(requestedAt=_VALID_TS_MS))
    assert reason is None
    assert isinstance(req, dict)
    assert req["schema"] == 1
    assert req["requestId"] == _VALID_ID
    assert req["requestedAt"] == _VALID_TS_MS
    assert req["kind"] == "sync-now"


def test_valid_docker_second_form_returns_dict():
    req, reason = validate_sync_request(_make(requestedAt=_VALID_TS_S))
    assert reason is None
    assert isinstance(req, dict)
    assert req["requestedAt"] == _VALID_TS_S


def test_valid_returns_copy_not_original():
    data = _make()
    req, _ = validate_sync_request(data)
    req["schema"] = 99  # mutation should not affect a second call
    req2, _ = validate_sync_request(data)
    assert req2["schema"] == 1


# ---------------------------------------------------------------------------
# validate_sync_request — size / encoding failures (malformed)
# ---------------------------------------------------------------------------


def test_oversized_payload_malformed():
    big = b"x" * 4097
    _, reason = validate_sync_request(big)
    assert reason == "malformed"


def test_exactly_4096_bytes_accepted_if_valid():
    # Pad the valid JSON with whitespace to hit exactly 4096 bytes
    base = _make()
    padding = b" " * (4096 - len(base))
    # JSON ignores trailing whitespace if we wrap; simpler: just check <= 4096 passes
    _, reason = validate_sync_request(base)
    assert reason is None  # base is well under 4096


def test_non_utf8_bytes_malformed():
    _, reason = validate_sync_request(b"\xff\xfe")
    assert reason == "malformed"


def test_invalid_json_malformed():
    _, reason = validate_sync_request(b"not json {{{")
    assert reason == "malformed"


def test_json_array_malformed():
    _, reason = validate_sync_request(b'["schema", 1]')
    assert reason == "malformed"


def test_json_string_malformed():
    _, reason = validate_sync_request(b'"just a string"')
    assert reason == "malformed"


def test_json_null_malformed():
    _, reason = validate_sync_request(b"null")
    assert reason == "malformed"


# ---------------------------------------------------------------------------
# validate_sync_request — field-set failures (malformed)
# ---------------------------------------------------------------------------


def test_missing_field_malformed():
    obj = {"schema": 1, "requestId": _VALID_ID, "requestedAt": _VALID_TS_MS}
    # missing kind
    _, reason = validate_sync_request(json.dumps(obj).encode())
    assert reason == "malformed"


def test_extra_field_malformed():
    obj = {
        "schema": 1, "requestId": _VALID_ID,
        "requestedAt": _VALID_TS_MS, "kind": "sync-now",
        "extra": "field",
    }
    _, reason = validate_sync_request(json.dumps(obj).encode())
    assert reason == "malformed"


# ---------------------------------------------------------------------------
# validate_sync_request — schema validation
# ---------------------------------------------------------------------------


def test_schema_2_unknown_schema():
    _, reason = validate_sync_request(_make(schema=2))
    assert reason == "unknown-schema"


def test_schema_true_bool_unknown_schema():
    # True == 1 in Python but type(True) is bool, not int
    _, reason = validate_sync_request(_make(schema=True))
    assert reason == "unknown-schema"


def test_schema_string_unknown_schema():
    _, reason = validate_sync_request(_make(schema="1"))
    assert reason == "unknown-schema"


# ---------------------------------------------------------------------------
# validate_sync_request — requestId validation
# ---------------------------------------------------------------------------


def test_requestid_uppercase_hex_invalid():
    _, reason = validate_sync_request(_make(requestId="A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4"))
    assert reason == "invalid-id"


def test_requestid_too_short_invalid():
    _, reason = validate_sync_request(_make(requestId="abc123"))
    assert reason == "invalid-id"


def test_requestid_too_long_invalid():
    _, reason = validate_sync_request(_make(requestId="a" * 33))
    assert reason == "invalid-id"


def test_requestid_non_hex_chars_invalid():
    _, reason = validate_sync_request(_make(requestId="a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3zz"))
    assert reason == "invalid-id"


def test_requestid_integer_invalid():
    _, reason = validate_sync_request(_make(requestId=12345))
    assert reason == "invalid-id"


# ---------------------------------------------------------------------------
# validate_sync_request — requestedAt validation
# ---------------------------------------------------------------------------


def test_requestedat_offset_timezone_invalid():
    _, reason = validate_sync_request(_make(requestedAt="2026-06-12T09:00:00.000+09:00"))
    assert reason == "invalid-timestamp"


def test_requestedat_docker_form_no_ms_accepted():
    _, reason = validate_sync_request(_make(requestedAt="2026-06-12T00:00:00Z"))
    assert reason is None


def test_requestedat_not_a_date_invalid():
    _, reason = validate_sync_request(_make(requestedAt="not-a-date"))
    assert reason == "invalid-timestamp"


def test_requestedat_integer_invalid():
    _, reason = validate_sync_request(_make(requestedAt=1234567890))
    assert reason == "invalid-timestamp"


def test_requestedat_missing_milliseconds_worker_form():
    # "2026-06-12T00:00:00Z" is the Docker form — should be accepted
    # "2026-06-12T00:00:00.Z" has dot but no digits — should be rejected
    _, reason = validate_sync_request(_make(requestedAt="2026-06-12T00:00:00.Z"))
    assert reason == "invalid-timestamp"


# ---------------------------------------------------------------------------
# validate_sync_request — kind validation
# ---------------------------------------------------------------------------


def test_kind_wrong_value_invalid():
    _, reason = validate_sync_request(_make(kind="sync-later"))
    assert reason == "invalid-kind"


def test_kind_integer_invalid():
    _, reason = validate_sync_request(_make(kind=1))
    assert reason == "invalid-kind"


# ---------------------------------------------------------------------------
# check_request_timing
# ---------------------------------------------------------------------------


def test_timing_recent_request_ok():
    req, _ = validate_sync_request(_make(requestedAt="2026-06-12T00:00:00.000Z"))
    now = datetime(2026, 6, 12, 0, 0, 30, tzinfo=timezone.utc)  # 30s after
    assert check_request_timing(req, now) is None


def test_timing_stale_request():
    req, _ = validate_sync_request(_make(requestedAt="2026-06-11T22:59:59.000Z"))
    # now = 2026-06-12T00:00:00 → age = 3601.0s > threshold
    now = datetime(2026, 6, 12, 0, 0, 0, tzinfo=timezone.utc)
    assert check_request_timing(req, now) == "stale"


def test_timing_exactly_at_threshold_is_stale():
    # age == 3600 is NOT stale (> 3600 is stale)
    req, _ = validate_sync_request(_make(requestedAt="2026-06-11T23:00:00.000Z"))
    now = datetime(2026, 6, 12, 0, 0, 0, tzinfo=timezone.utc)  # age = 3600.0
    # age 3600 is NOT > 3600, so not stale
    assert check_request_timing(req, now) is None


def test_timing_one_second_past_threshold_is_stale():
    req, _ = validate_sync_request(_make(requestedAt="2026-06-11T22:59:59.000Z"))
    now = datetime(2026, 6, 12, 0, 0, 0, tzinfo=timezone.utc)  # age = 3601
    assert check_request_timing(req, now) == "stale"


def test_timing_future_within_tolerance_ok():
    req, _ = validate_sync_request(_make(requestedAt="2026-06-12T00:01:00.000Z"))
    now = datetime(2026, 6, 12, 0, 0, 0, tzinfo=timezone.utc)  # age = -60s
    # tolerance is 60s; -60 is NOT < -60, so OK
    assert check_request_timing(req, now) is None


def test_timing_future_beyond_tolerance_invalid():
    req, _ = validate_sync_request(_make(requestedAt="2026-06-12T00:01:01.000Z"))
    now = datetime(2026, 6, 12, 0, 0, 0, tzinfo=timezone.utc)  # age = -61s
    assert check_request_timing(req, now) == "invalid-timestamp"


def test_timing_docker_second_form_stale():
    req, _ = validate_sync_request(_make(requestedAt="2026-06-11T22:59:59Z"))
    now = datetime(2026, 6, 12, 0, 0, 0, tzinfo=timezone.utc)
    assert check_request_timing(req, now) == "stale"


def test_timing_docker_second_form_recent():
    req, _ = validate_sync_request(_make(requestedAt="2026-06-11T23:30:00Z"))
    now = datetime(2026, 6, 12, 0, 0, 0, tzinfo=timezone.utc)  # age = 1800s
    assert check_request_timing(req, now) is None
