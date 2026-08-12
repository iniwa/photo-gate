"""Sanitized per-operation aggregate result publisher payload."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime

SYNC_RESULT_KEY = "ops/sync-result.json"

_DAEMON_TS = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
_OPERATIONS = frozenset({"sync", "catalog-refresh"})
_TRIGGER_KINDS = frozenset({"scheduled", "manual"})
_RESULTS = frozenset({"ok", "failed", "partial"})


def _require_timestamp(value: object, field: str) -> None:
    if not isinstance(value, str) or not _DAEMON_TS.match(value):
        raise ValueError(f"{field} must be a daemon UTC timestamp")
    try:
        datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ")
    except ValueError as exc:
        raise ValueError(f"{field} must be a valid daemon UTC timestamp") from exc


def _require_count(value: object, field: str) -> None:
    if type(value) is not int or value < 0 or value > 1_000_000:
        raise ValueError(f"{field} must be a bounded non-negative integer")


@dataclass(frozen=True)
class SyncRunSummary:
    """Only aggregate counters; no album, photo, or source identities."""

    targets_attempted: int = 0
    targets_succeeded: int = 0
    targets_failed: int = 0
    photos_total: int = 0
    photos_uploaded: int = 0
    photos_skipped: int = 0

    def validate(self) -> None:
        for field, value in (
            ("targets_attempted", self.targets_attempted),
            ("targets_succeeded", self.targets_succeeded),
            ("targets_failed", self.targets_failed),
            ("photos_total", self.photos_total),
            ("photos_uploaded", self.photos_uploaded),
            ("photos_skipped", self.photos_skipped),
        ):
            _require_count(value, field)
        if self.targets_succeeded + self.targets_failed > self.targets_attempted:
            raise ValueError("target result counts exceed attempted count")
        if self.photos_uploaded + self.photos_skipped > self.photos_total:
            raise ValueError("photo result counts exceed total count")


def build_sync_result(
    summary: SyncRunSummary,
    *,
    published_at: str,
    operation: str,
    trigger_kind: str,
    result: str,
    started_at: str,
    completed_at: str,
    catalog_refreshed: bool,
) -> bytes:
    """
    Build a strictly validated, sanitized aggregate result. This payload never
    contains album IDs, titles, object keys, PhotoPrism identifiers, URLs,
    credentials, timestamps from image metadata, or error text.
    """
    summary.validate()
    _require_timestamp(published_at, "published_at")
    _require_timestamp(started_at, "started_at")
    _require_timestamp(completed_at, "completed_at")
    if operation not in _OPERATIONS:
        raise ValueError("operation must be sync or catalog-refresh")
    if trigger_kind not in _TRIGGER_KINDS:
        raise ValueError("trigger_kind must be scheduled or manual")
    if result not in _RESULTS:
        raise ValueError("result must be ok, failed, or partial")
    if type(catalog_refreshed) is not bool:
        raise ValueError("catalog_refreshed must be a bool")

    payload = {
        "schema": 1,
        "publishedAt": published_at,
        "operation": operation,
        "triggerKind": trigger_kind,
        "result": result,
        "startedAt": started_at,
        "completedAt": completed_at,
        "targets": {
            "attempted": summary.targets_attempted,
            "succeeded": summary.targets_succeeded,
            "failed": summary.targets_failed,
        },
        "photos": {
            "total": summary.photos_total,
            "uploaded": summary.photos_uploaded,
            "skipped": summary.photos_skipped,
        },
        "catalogRefreshed": catalog_refreshed,
    }
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")
