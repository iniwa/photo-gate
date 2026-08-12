"""Private R2 request polling for sync and catalog-only operations."""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Callable

async def _poll_sync_request(
    store: object,
    clock: "Callable[[], datetime]",
    last_handled_id: "str | None",
    log: "logging.Logger",
) -> "dict | None":
    """
    Poll R2 for a pending sync request object.

    Returns the parsed request dict when a valid, non-stale, non-duplicate
    request is found. Returns None for missing, invalid, stale, or duplicate
    requests, deleting them best-effort in those cases. Never raises.
    """
    if store is None:
        return None
    from .sync_request import (
        SYNC_REQUEST_KEY,
        validate_sync_request,
        check_request_timing,
    )
    try:
        data = await store.get(SYNC_REQUEST_KEY)
    except Exception:
        log.warning("request poll failed")
        return None
    if data is None:
        return None
    req, reason = validate_sync_request(data)
    if reason is not None:
        log.warning("request ignored: %s", reason)
        await _best_effort_delete_request(store, log)
        return None
    timing_reason = check_request_timing(req, clock())
    if timing_reason is not None:
        log.warning("request ignored: %s", timing_reason)
        await _best_effort_delete_request(store, log)
        return None
    if req["requestId"] == last_handled_id:
        log.warning("request ignored: duplicate")
        await _best_effort_delete_request(store, log)
        return None
    return req


async def _poll_catalog_refresh_request(
    store: object,
    clock: "Callable[[], datetime]",
    last_handled_id: "str | None",
    log: "logging.Logger",
) -> "dict | None":
    """Poll the separate catalog-only request without affecting image sync."""
    if store is None:
        return None
    from .catalog_refresh_request import (
        CATALOG_REFRESH_REQUEST_KEY,
        check_catalog_refresh_request_timing,
        validate_catalog_refresh_request,
    )
    try:
        data = await store.get(CATALOG_REFRESH_REQUEST_KEY)
    except Exception:
        log.warning("catalog refresh request poll failed")
        return None
    if data is None:
        return None
    req, reason = validate_catalog_refresh_request(data)
    if reason is not None:
        log.warning("catalog refresh request ignored: %s", reason)
        await _best_effort_delete_request(store, log, CATALOG_REFRESH_REQUEST_KEY)
        return None
    timing_reason = check_catalog_refresh_request_timing(req, clock())
    if timing_reason is not None:
        log.warning("catalog refresh request ignored: %s", timing_reason)
        await _best_effort_delete_request(store, log, CATALOG_REFRESH_REQUEST_KEY)
        return None
    if req["requestId"] == last_handled_id:
        log.warning("catalog refresh request ignored: duplicate")
        await _best_effort_delete_request(store, log, CATALOG_REFRESH_REQUEST_KEY)
        return None
    return req


async def _best_effort_delete_request(
    store: object,
    log: "logging.Logger",
    key: "str | None" = None,
) -> None:
    """Best-effort delete of a known private request object. Never raises."""
    if store is None:
        return
    if key is None:
        from .sync_request import SYNC_REQUEST_KEY
        key = SYNC_REQUEST_KEY
    try:
        await store.delete(key)
    except Exception:
        log.warning("request delete failed")
