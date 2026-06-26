"""
Docker-side validator for sync request objects read from R2.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone

SYNC_REQUEST_KEY = "ops/sync-request.json"

_MAX_REQUEST_BYTES = 4096
_EXPECTED_KEYS = frozenset({"schema", "requestId", "requestedAt", "kind"})
_REQUEST_ID_RE = re.compile(r"^[0-9a-f]{32}$")

# Accepted timestamp forms:
# - Worker millisecond form: YYYY-MM-DDTHH:mm:ss.sssZ
# - Docker second form:      YYYY-MM-DDTHH:mm:ssZ
# Timezone offsets (e.g. +09:00) are rejected.
_WORKER_MS_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")
_DOCKER_S_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")

STALENESS_THRESHOLD_SECONDS = 3600
FUTURE_SKEW_TOLERANCE_SECONDS = 60
REQUEST_POLL_INTERVAL = 60


def _parse_request_ts(value: str) -> datetime | None:
    """Parse an accepted UTC timestamp string to an aware datetime, or None."""
    if _WORKER_MS_RE.match(value):
        try:
            return datetime.strptime(value, "%Y-%m-%dT%H:%M:%S.%fZ").replace(
                tzinfo=timezone.utc
            )
        except ValueError:
            return None
    if _DOCKER_S_RE.match(value):
        try:
            return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(
                tzinfo=timezone.utc
            )
        except ValueError:
            return None
    return None


def validate_sync_request(data: bytes) -> tuple[dict, None] | tuple[None, str]:
    """
    Validate raw bytes from R2.

    Returns (parsed_dict, None) on success, or (None, reason_code) on failure.
    Never raises. Never includes field values in the reason code.
    Reason codes: malformed, unknown-schema, invalid-id, invalid-timestamp, invalid-kind.
    """
    if len(data) > _MAX_REQUEST_BYTES:
        return None, "malformed"
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return None, "malformed"
    try:
        obj = json.loads(text)
    except json.JSONDecodeError:
        return None, "malformed"
    if not isinstance(obj, dict):
        return None, "malformed"
    if set(obj.keys()) != _EXPECTED_KEYS:
        return None, "malformed"
    schema = obj["schema"]
    # bool is a subtype of int in Python; reject it explicitly
    if type(schema) is not int or schema != 1:
        return None, "unknown-schema"
    request_id = obj["requestId"]
    if not isinstance(request_id, str) or not _REQUEST_ID_RE.match(request_id):
        return None, "invalid-id"
    requested_at = obj["requestedAt"]
    if not isinstance(requested_at, str) or _parse_request_ts(requested_at) is None:
        return None, "invalid-timestamp"
    kind = obj["kind"]
    if kind != "sync-now":
        return None, "invalid-kind"
    return dict(obj), None


def check_request_timing(req: dict, now: datetime) -> str | None:
    """
    Check staleness and future-skew for a pre-validated request dict.

    Returns None if timing is acceptable, or a reason code if not.
    Reason codes: stale, invalid-timestamp.
    """
    dt = _parse_request_ts(req["requestedAt"])
    if dt is None:
        return "invalid-timestamp"
    age = (now - dt).total_seconds()
    if age > STALENESS_THRESHOLD_SECONDS:
        return "stale"
    if age < -FUTURE_SKEW_TOLERANCE_SECONDS:
        return "invalid-timestamp"
    return None
