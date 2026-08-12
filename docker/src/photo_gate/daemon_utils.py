"""Small daemon-only helpers for safe aggregate accounting and sleep polling."""
from __future__ import annotations

import asyncio
from typing import Callable

def _safe_photo_counts(sync_result: object) -> tuple[int, int, int]:
    """Extract only valid aggregate counters from a successful sync result."""
    total = getattr(sync_result, "photos_total", None)
    uploaded = getattr(sync_result, "photos_uploaded", None)
    skipped = getattr(sync_result, "photos_skipped", None)
    if (
        type(total) is int
        and type(uploaded) is int
        and type(skipped) is int
        and 0 <= total <= 1_000_000
        and 0 <= uploaded <= total
        and 0 <= skipped <= total
        and uploaded + skipped <= total
    ):
        return total, uploaded, skipped
    return 0, 0, 0


async def _sleep_with_request_polling(
    shutdown_event: asyncio.Event,
    sleep_fn: Callable[[float], object],
    interval_seconds: int,
    poll_interval_seconds: int,
    poll_for_pending_request: Callable[[], object],
) -> None:
    """Sleep in bounded chunks and return early when either request appears."""
    elapsed = 0.0
    total = float(interval_seconds)
    while elapsed < total and not shutdown_event.is_set():
        chunk = min(float(poll_interval_seconds), total - elapsed)
        waiter = asyncio.create_task(shutdown_event.wait())
        sleeper = asyncio.create_task(sleep_fn(chunk))
        try:
            await asyncio.wait({waiter, sleeper}, return_when=asyncio.FIRST_COMPLETED)
        finally:
            for task in (waiter, sleeper):
                task.cancel()
            await asyncio.gather(waiter, sleeper, return_exceptions=True)
        if shutdown_event.is_set():
            return
        elapsed += chunk
        if elapsed < total and await poll_for_pending_request():
            return
