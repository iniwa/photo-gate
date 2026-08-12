"""Validation tests for the separate catalog-only daemon request."""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from photo_gate.catalog_refresh_request import (
    CATALOG_REFRESH_REQUEST_KEY,
    check_catalog_refresh_request_timing,
    validate_catalog_refresh_request,
)


_NOW = datetime(2026, 8, 12, 0, 0, tzinfo=timezone.utc)


def _payload(**overrides: object) -> bytes:
    value: dict[str, object] = {
        "schema": 1,
        "requestId": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
        "requestedAt": "2026-08-12T00:00:00.000Z",
        "kind": "publish-catalog",
    }
    value.update(overrides)
    return json.dumps(value).encode("utf-8")


def test_uses_a_separate_private_key():
    assert CATALOG_REFRESH_REQUEST_KEY == "ops/catalog-refresh-request.json"
    assert CATALOG_REFRESH_REQUEST_KEY != "ops/sync-request.json"


def test_accepts_valid_catalog_only_request():
    request, reason = validate_catalog_refresh_request(_payload())
    assert reason is None
    assert request is not None
    assert request["kind"] == "publish-catalog"


def test_rejects_normal_sync_kind_in_catalog_key():
    request, reason = validate_catalog_refresh_request(_payload(kind="sync-now"))
    assert request is None
    assert reason == "invalid-kind"


def test_rejects_extra_fields_and_untrusted_payload_shape():
    request, reason = validate_catalog_refresh_request(_payload(extra="not accepted"))
    assert request is None
    assert reason == "malformed"


def test_rejects_invalid_request_id_without_echoing_it():
    request, reason = validate_catalog_refresh_request(_payload(requestId="secret-like-value"))
    assert request is None
    assert reason == "invalid-id"
    assert "secret" not in reason


def test_timing_accepts_current_request_and_rejects_stale_or_future():
    request, reason = validate_catalog_refresh_request(_payload())
    assert reason is None and request is not None
    assert check_catalog_refresh_request_timing(request, _NOW) is None

    stale = dict(request)
    stale["requestedAt"] = (_NOW - timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    assert check_catalog_refresh_request_timing(stale, _NOW) == "stale"

    future = dict(request)
    future["requestedAt"] = (_NOW + timedelta(minutes=2)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    assert check_catalog_refresh_request_timing(future, _NOW) == "invalid-timestamp"
