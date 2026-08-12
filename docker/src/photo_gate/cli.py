"""CLI parsing and validation without runtime network behavior."""
from __future__ import annotations

import argparse

def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="photo-gate-sync",
        description="photo-gate sync tool",
    )
    sub = parser.add_subparsers(dest="command")

    sync = sub.add_parser(
        "sync-once",
        help="Sync one album to R2 (requires --confirm-upload)",
    )
    sync.add_argument("--album-id", required=True, metavar="ID")
    sync.add_argument("--album-title", required=True, metavar="TITLE")
    sync.add_argument("--photoprism-album-uid", required=True, metavar="UID")
    sync.add_argument(
        "--confirm-upload",
        action="store_true",
        help="Required to prevent accidental uploads",
    )
    sync.add_argument("--concurrency", type=int, default=2, metavar="N")
    # Keep in sync with _SOURCE_SIZE_PX in sync.py (not imported here so the
    # module stays importable without libvips).
    sync.add_argument(
        "--photoprism-preview-size",
        choices=["fit_720", "fit_1280", "fit_1920", "fit_2048", "fit_2560", "fit_3840"],
        default="fit_3840",
        help="PhotoPrism size used as the preview source; pick one the "
        "instance's thumbnail settings can actually serve",
    )
    sync.add_argument("--thumb-long-edge", type=int, default=640, metavar="PX")
    sync.add_argument("--thumb-quality", type=int, default=80, metavar="Q")
    sync.add_argument("--preview-long-edge", type=int, default=3840, metavar="PX")
    sync.add_argument("--preview-quality", type=int, default=88, metavar="Q")

    # sync-daemon subcommand
    daemon = sub.add_parser(
        "sync-daemon",
        help="Run sync repeatedly on a schedule (requires --confirm-upload)",
    )
    # Same positional args as sync-once
    daemon.add_argument("--album-id", required=True, metavar="ID")
    daemon.add_argument("--album-title", required=True, metavar="TITLE")
    daemon.add_argument("--photoprism-album-uid", required=True, metavar="UID")
    daemon.add_argument("--confirm-upload", action="store_true",
                        help="Required to prevent accidental uploads")
    daemon.add_argument("--concurrency", type=int, default=2, metavar="N")
    daemon.add_argument(
        "--photoprism-preview-size",
        choices=["fit_720", "fit_1280", "fit_1920", "fit_2048", "fit_2560", "fit_3840"],
        default="fit_3840",
    )
    daemon.add_argument("--thumb-long-edge", type=int, default=640, metavar="PX")
    daemon.add_argument("--thumb-quality", type=int, default=80, metavar="Q")
    daemon.add_argument("--preview-long-edge", type=int, default=3840, metavar="PX")
    daemon.add_argument("--preview-quality", type=int, default=88, metavar="Q")
    daemon.add_argument("--interval-seconds", type=int, default=86400, metavar="N")
    daemon.add_argument("--health-file", default="/tmp/photo-gate-health.json", metavar="PATH")
    daemon.add_argument("--max-runs", type=int, default=0, metavar="N")

    # publish-catalog subcommand
    sub.add_parser(
        "publish-catalog",
        help="Publish sanitized PhotoPrism album catalog to private R2 (ops/album-catalog.json)",
    )

    # healthcheck subcommand
    hc = sub.add_parser("healthcheck", help="Check daemon health file (for Docker HEALTHCHECK)")
    hc.add_argument("--health-file", default="/tmp/photo-gate-health.json", metavar="PATH")
    hc.add_argument("--max-consecutive-failures", type=int, default=3, metavar="N")
    hc.add_argument("--heartbeat-stale-seconds", type=int, default=300, metavar="N")

    return parser


def _validate_sync_once_args(args: argparse.Namespace) -> str | None:
    """Return an error message, or None if args are valid."""
    if not args.confirm_upload:
        return "--confirm-upload is required to prevent accidental uploads"
    if args.concurrency < 1:
        return "--concurrency must be a positive integer"
    return None


def _validate_daemon_args(args: argparse.Namespace) -> str | None:
    """Return an error message, or None if args are valid."""
    if not args.confirm_upload:
        return "--confirm-upload is required to prevent accidental uploads"
    if args.interval_seconds < 60:
        return "--interval-seconds must be >= 60"
    if args.concurrency < 1:
        return "--concurrency must be a positive integer"
    return None
