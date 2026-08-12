"""Best-effort publication of sanitized daemon status and aggregate results."""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Callable

from .runtime import _utc_now_iso

async def _publish_sync_status(
    state: "HealthState",
    store: object,
    clock: "Callable[[], datetime]",
    *,
    last_trigger_kind: "str | None" = None,
    last_handled_request_id: "str | None" = None,
) -> None:
    """Best-effort R2 publish of sanitized sync status. Never propagates."""
    if store is None:
        return
    try:
        from .sync_status import build_sync_status, SYNC_STATUS_KEY
        published_at = _utc_now_iso(clock)
        data = build_sync_status(
            state,
            published_at,
            last_trigger_kind=last_trigger_kind,
            last_handled_request_id=last_handled_request_id,
        )
        await store.put(SYNC_STATUS_KEY, data, "application/json")
    except Exception:
        logging.getLogger(__name__).warning("sync status publish failed")


async def _publish_sync_result(
    summary: object,
    store: object,
    clock: "Callable[[], datetime]",
    *,
    operation: str,
    trigger_kind: str,
    result: str,
    started_at: str,
    completed_at: str,
    catalog_refreshed: bool,
) -> None:
    """Best-effort publication of a sanitized, aggregate operation result."""
    if store is None:
        return
    try:
        from .sync_result import SYNC_RESULT_KEY, build_sync_result
        data = build_sync_result(
            summary,
            published_at=_utc_now_iso(clock),
            operation=operation,
            trigger_kind=trigger_kind,
            result=result,
            started_at=started_at,
            completed_at=completed_at,
            catalog_refreshed=catalog_refreshed,
        )
        await store.put(SYNC_RESULT_KEY, data, "application/json")
    except Exception:
        logging.getLogger(__name__).warning("sync result publish failed")


# Third-party loggers that emit request URLs or other untrusted text at
# INFO. httpx/httpcore log every request line as
# "HTTP Request: GET <full url>" — and that URL embeds the PhotoPrism
# preview token (see _SANITIZED_ERROR_TYPES, which excludes httpx for the
# same reason). They must never reach stdout, so the root logger stays at
# WARNING and only our own package logs at INFO.
