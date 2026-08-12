"""Tests for the private, sanitized aggregate sync-result payload."""
from __future__ import annotations

import json

import pytest

from photo_gate.sync_result import SYNC_RESULT_KEY, SyncRunSummary, build_sync_result


_TS = "2026-08-12T00:00:00Z"


def _build(summary: SyncRunSummary = SyncRunSummary()) -> dict:
    return json.loads(build_sync_result(
        summary,
        published_at=_TS,
        operation="sync",
        trigger_kind="manual",
        result="ok",
        started_at=_TS,
        completed_at=_TS,
        catalog_refreshed=True,
    ))


def test_payload_has_only_sanitized_aggregate_fields():
    payload = _build(SyncRunSummary(
        targets_attempted=2,
        targets_succeeded=2,
        targets_failed=0,
        photos_total=256,
        photos_uploaded=10,
        photos_skipped=246,
    ))
    assert payload == {
        "schema": 1,
        "publishedAt": _TS,
        "operation": "sync",
        "triggerKind": "manual",
        "result": "ok",
        "startedAt": _TS,
        "completedAt": _TS,
        "targets": {"attempted": 2, "succeeded": 2, "failed": 0},
        "photos": {"total": 256, "uploaded": 10, "skipped": 246},
        "catalogRefreshed": True,
    }
    serialized = json.dumps(payload)
    for forbidden in ("albumId", "photoId", "uid", "token", "http", "key", "error"):
        assert forbidden not in serialized


def test_catalog_only_result_has_no_image_or_target_counts():
    payload = json.loads(build_sync_result(
        SyncRunSummary(),
        published_at=_TS,
        operation="catalog-refresh",
        trigger_kind="manual",
        result="ok",
        started_at=_TS,
        completed_at=_TS,
        catalog_refreshed=True,
    ))
    assert payload["operation"] == "catalog-refresh"
    assert payload["targets"] == {"attempted": 0, "succeeded": 0, "failed": 0}
    assert payload["photos"] == {"total": 0, "uploaded": 0, "skipped": 0}


@pytest.mark.parametrize(
    "summary",
    [
        SyncRunSummary(targets_attempted=-1),
        SyncRunSummary(targets_attempted=1, targets_succeeded=2),
        SyncRunSummary(photos_total=1, photos_uploaded=1, photos_skipped=1),
        SyncRunSummary(photos_total=1_000_001),
    ],
)
def test_rejects_invalid_or_inconsistent_counts(summary):
    with pytest.raises(ValueError):
        _build(summary)


@pytest.mark.parametrize(
    "field,value",
    [
        ("operation", "other"),
        ("trigger_kind", "other"),
        ("result", "other"),
    ],
)
def test_rejects_unknown_enum_values(field, value):
    kwargs = {
        "published_at": _TS,
        "operation": "sync",
        "trigger_kind": "scheduled",
        "result": "ok",
        "started_at": _TS,
        "completed_at": _TS,
        "catalog_refreshed": False,
    }
    kwargs[field] = value
    with pytest.raises(ValueError):
        build_sync_result(SyncRunSummary(), **kwargs)


def test_result_uses_one_fixed_private_key():
    assert SYNC_RESULT_KEY == "ops/sync-result.json"
