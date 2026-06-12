"""
Health state for the sync-daemon process.

Writes a JSON health file atomically so Docker HEALTHCHECK and external
monitors can observe daemon liveness and last-run outcome without connecting
to any network service.
"""

from __future__ import annotations

import dataclasses
import json
import os


@dataclasses.dataclass(frozen=True)
class HealthState:
    schema: int          # always 1
    pid: int
    album_id: str
    interval_seconds: int
    started_at: str      # ISO-8601 UTC, e.g. "2026-06-12T00:00:00Z"
    heartbeat_at: str    # ISO-8601 UTC
    last_attempt_started_at: str | None
    last_attempt_completed_at: str | None
    last_result: str | None   # "ok" | "failed" | None
    last_error: str | None
    consecutive_failures: int
    runs_completed: int


def write_health(state: HealthState, path: str) -> None:
    """
    Serialize *state* to JSON and write it atomically to *path*.

    Writes to ``<path>.tmp`` in the same directory then calls
    ``os.replace`` so readers never see a partial file.
    """
    tmp_path = path + ".tmp"
    data = dataclasses.asdict(state)
    payload = json.dumps(data, indent=2)
    with open(tmp_path, "w", encoding="utf-8") as f:
        f.write(payload)
    os.replace(tmp_path, path)
