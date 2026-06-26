"""
Sanitized sync status object for R2 publishing.
"""
from __future__ import annotations

import json
import re
from datetime import datetime

from .health import HealthState

SYNC_STATUS_KEY = "ops/sync-status.json"

_DAEMON_TS = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
_SAFE_ID = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$")
_VALID_LAST_RESULT = frozenset({"ok", "failed"})
_VALID_TRIGGER_KINDS = frozenset({"scheduled", "manual"})
_TRIGGER_ID_RE = re.compile(r"^[0-9a-f]{32}$")


def _require_daemon_ts(value: object, field: str) -> None:
    if not isinstance(value, str) or not _DAEMON_TS.match(value):
        raise ValueError(
            f"{field!r} must be a daemon UTC timestamp (YYYY-MM-DDTHH:MM:SSZ), got {value!r}"
        )
    try:
        datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ")
    except ValueError as exc:
        raise ValueError(
            f"{field!r} must be a valid daemon UTC timestamp, got {value!r}"
        ) from exc


def _is_non_negative_int(value: object) -> bool:
    return type(value) is int and value >= 0


def _require_nullable_daemon_ts(value: object, field: str) -> None:
    if value is None:
        return
    _require_daemon_ts(value, field)


def build_sync_status(
    state: HealthState,
    published_at: str,
    *,
    last_trigger_kind: str | None = None,
    last_handled_request_id: str | None = None,
) -> bytes:
    """
    Build and validate the public sync status payload from *state*.
    Returns UTF-8 JSON bytes.
    Raises ValueError if any field fails validation.
    Does NOT include PID, album title, PhotoPrism UID, credentials, or secrets.
    """
    _require_daemon_ts(published_at, "published_at")

    if not isinstance(state.album_id, str) or not _SAFE_ID.match(state.album_id):
        raise ValueError(f"album_id is not a safe ID: {state.album_id!r}")

    if not _is_non_negative_int(state.interval_seconds):
        raise ValueError(
            f"interval_seconds must be a non-negative int, got {state.interval_seconds!r}"
        )

    _require_daemon_ts(state.started_at, "started_at")
    _require_daemon_ts(state.heartbeat_at, "heartbeat_at")
    _require_nullable_daemon_ts(state.last_attempt_started_at, "last_attempt_started_at")
    _require_nullable_daemon_ts(state.last_attempt_completed_at, "last_attempt_completed_at")

    if state.last_result is not None and state.last_result not in _VALID_LAST_RESULT:
        raise ValueError(
            f"last_result must be 'ok', 'failed', or None, got {state.last_result!r}"
        )

    if state.last_error is not None and not isinstance(state.last_error, str):
        raise ValueError("last_error must be a string or None")

    if not _is_non_negative_int(state.consecutive_failures):
        raise ValueError(
            f"consecutive_failures must be a non-negative int, got {state.consecutive_failures!r}"
        )

    if not _is_non_negative_int(state.runs_completed):
        raise ValueError(
            f"runs_completed must be a non-negative int, got {state.runs_completed!r}"
        )

    if last_trigger_kind is not None and last_trigger_kind not in _VALID_TRIGGER_KINDS:
        raise ValueError(
            f"last_trigger_kind must be 'scheduled', 'manual', or None, got {last_trigger_kind!r}"
        )

    if last_handled_request_id is not None:
        if (
            not isinstance(last_handled_request_id, str)
            or not _TRIGGER_ID_RE.match(last_handled_request_id)
        ):
            raise ValueError(
                "last_handled_request_id must be a 32-char lowercase hex string or None"
            )

    payload = {
        "schema": 2,
        "publishedAt": published_at,
        "albumId": state.album_id,
        "intervalSeconds": state.interval_seconds,
        "startedAt": state.started_at,
        "heartbeatAt": state.heartbeat_at,
        "lastAttemptStartedAt": state.last_attempt_started_at,
        "lastAttemptCompletedAt": state.last_attempt_completed_at,
        "lastResult": state.last_result,
        "lastError": state.last_error,
        "consecutiveFailures": state.consecutive_failures,
        "runsCompleted": state.runs_completed,
        "lastTriggerKind": last_trigger_kind,
        "lastHandledRequestId": last_handled_request_id,
    }

    return json.dumps(payload, ensure_ascii=False).encode("utf-8")
