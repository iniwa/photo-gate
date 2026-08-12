"""Docker-side validator for a catalog-only request stored in private R2."""
from __future__ import annotations

import json
import re

from .sync_request import (
    FUTURE_SKEW_TOLERANCE_SECONDS,
    STALENESS_THRESHOLD_SECONDS,
    _parse_request_ts,
)

CATALOG_REFRESH_REQUEST_KEY = "ops/catalog-refresh-request.json"

_MAX_REQUEST_BYTES = 4096
_EXPECTED_KEYS = frozenset({"schema", "requestId", "requestedAt", "kind"})
_REQUEST_ID_RE = re.compile(r"^[0-9a-f]{32}$")


def validate_catalog_refresh_request(data: bytes) -> tuple[dict, None] | tuple[None, str]:
    """
    Validate raw catalog-refresh request bytes without ever raising or
    including untrusted values in a reason code.
    """
    if len(data) > _MAX_REQUEST_BYTES:
        return None, "malformed"
    try:
        text = data.decode("utf-8")
        obj = json.loads(text)
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None, "malformed"
    if not isinstance(obj, dict) or set(obj.keys()) != _EXPECTED_KEYS:
        return None, "malformed"
    if type(obj["schema"]) is not int or obj["schema"] != 1:
        return None, "unknown-schema"
    if not isinstance(obj["requestId"], str) or not _REQUEST_ID_RE.match(obj["requestId"]):
        return None, "invalid-id"
    if not isinstance(obj["requestedAt"], str) or _parse_request_ts(obj["requestedAt"]) is None:
        return None, "invalid-timestamp"
    if obj["kind"] != "publish-catalog":
        return None, "invalid-kind"
    return dict(obj), None


def check_catalog_refresh_request_timing(req: dict, now) -> str | None:
    """Return a fixed timing error code for a previously validated request."""
    dt = _parse_request_ts(req["requestedAt"])
    if dt is None:
        return "invalid-timestamp"
    age = (now - dt).total_seconds()
    if age > STALENESS_THRESHOLD_SECONDS:
        return "stale"
    if age < -FUTURE_SKEW_TOLERANCE_SECONDS:
        return "invalid-timestamp"
    return None
