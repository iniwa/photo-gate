"""photo-gate-sync CLI compatibility facade.

The implementation is deliberately split by responsibility; exports below keep
existing callers and tests importing ``photo_gate.main`` compatible.
"""
from __future__ import annotations

import asyncio
import sys

from .catalog_publisher import _best_effort_publish_catalog, run_publish_catalog
from .cli import _build_parser, _validate_daemon_args, _validate_sync_once_args
from .daemon import run_sync_daemon
from .daemon_utils import _safe_photo_counts, _sleep_with_request_polling
from .healthcheck import _run_healthcheck
from .request_consumer import (
    _best_effort_delete_request,
    _poll_catalog_refresh_request,
    _poll_sync_request,
)
from .runtime import _configure_daemon_logging, _describe_error, _utc_now_iso
from .status_publisher import _publish_sync_result, _publish_sync_status
from .sync_once import run_sync_once
from .target_sync import _read_sync_targets_from_store, _run_multi_target_attempt


def main() -> None:
    parser = _build_parser()
    args = parser.parse_args()

    if args.command == "sync-once":
        sys.exit(asyncio.run(run_sync_once(args)))
    elif args.command == "sync-daemon":
        async def _daemon_catalog_publish() -> int:
            return await run_publish_catalog(args)

        sys.exit(asyncio.run(run_sync_daemon(
            args,
            catalog_publish_fn=_daemon_catalog_publish,
        )))
    elif args.command == "healthcheck":
        sys.exit(_run_healthcheck(args))
    elif args.command == "publish-catalog":
        sys.exit(asyncio.run(run_publish_catalog(args)))
    else:
        parser.print_help()
        sys.exit(2)
