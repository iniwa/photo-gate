"""Local daemon health-file validation."""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone

def _run_healthcheck(args: argparse.Namespace) -> int:
    """
    Check daemon health file. Exit 0 if healthy, 1 if not.
    Prints a single sanitized line to stderr on failure; no stack traces.
    No network or libvips required.
    """
    import json

    path = args.health_file
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        print(f"healthcheck: health file not found: {path}", file=sys.stderr)
        return 1
    except (json.JSONDecodeError, OSError):
        print("healthcheck: health file is missing or unparseable", file=sys.stderr)
        return 1

    if not isinstance(data, dict) or data.get("schema") != 1:
        print("healthcheck: unknown health file schema", file=sys.stderr)
        return 1

    consecutive = data.get("consecutive_failures")
    if not isinstance(consecutive, int):
        # Fail closed: a schema-1 file must carry this field.
        print("healthcheck: consecutive_failures missing or invalid", file=sys.stderr)
        return 1
    if consecutive >= args.max_consecutive_failures:
        print(
            f"healthcheck: consecutive_failures={consecutive} >= "
            f"threshold={args.max_consecutive_failures}",
            file=sys.stderr,
        )
        return 1

    heartbeat_str = data.get("heartbeat_at")
    if not heartbeat_str:
        print("healthcheck: heartbeat_at missing", file=sys.stderr)
        return 1

    try:
        heartbeat_dt = datetime.fromisoformat(heartbeat_str.replace("Z", "+00:00"))
        now = datetime.now(tz=timezone.utc)
        age = (now - heartbeat_dt).total_seconds()
    except (ValueError, TypeError):
        print("healthcheck: heartbeat_at unparseable", file=sys.stderr)
        return 1

    if age > args.heartbeat_stale_seconds:
        print(
            f"healthcheck: heartbeat stale ({age:.0f}s > "
            f"{args.heartbeat_stale_seconds}s threshold)",
            file=sys.stderr,
        )
        return 1

    return 0
