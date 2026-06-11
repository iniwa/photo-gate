"""
photo-gate-sync CLI entrypoint.

Usage:
    photo-gate-sync sync-once --album-id ID --album-title TITLE
        --photoprism-album-uid UID --confirm-upload [options]

All photo_gate imports are deferred inside functions so the module is
importable (and --help works) without libvips or real credentials.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from datetime import datetime, timezone
from typing import Callable


# Exception types whose messages are sanitized at the raise site (no
# tokens, credentials, or preview tokens) and are therefore safe to print.
# Matching is by class name so this module stays importable without
# libvips (image_processor) or network dependencies.
#   - photo_gate types: ConfigError, MetadataValidationError,
#     ObjectStoreError, PhotoPrismError, and validation ValueErrors.
#   - botocore ClientError: messages contain only operation and error code.
# httpx exceptions are intentionally NOT listed: their messages can embed
# request URLs, which include the PhotoPrism preview token.
_SANITIZED_ERROR_TYPES = frozenset({
    "ClientError",
    "ConfigError",
    "MetadataValidationError",
    "ObjectStoreError",
    "PhotoPrismError",
    "ValueError",
})


def _describe_error(exc: BaseException, depth: int = 0) -> str:
    """
    Operator-readable failure description that never prints messages of
    unknown exception types (class name only). Unwraps exception groups
    and causes a few levels deep so the root cause is visible in logs.
    """
    if depth >= 4:
        return "..."
    name = type(exc).__name__
    if isinstance(exc, BaseExceptionGroup):
        parts = [_describe_error(sub, depth + 1) for sub in exc.exceptions[:3]]
        remaining = len(exc.exceptions) - 3
        if remaining > 0:
            parts.append(f"+{remaining} more")
        return f"{name}[{'; '.join(parts)}]"
    if name in _SANITIZED_ERROR_TYPES:
        described = f"{name}: {exc}"
    else:
        described = name
    if exc.__cause__ is not None:
        described = f"{described} (caused by {_describe_error(exc.__cause__, depth + 1)})"
    return described


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
    sync.add_argument("--thumb-long-edge", type=int, default=640, metavar="PX")
    sync.add_argument("--thumb-quality", type=int, default=80, metavar="Q")
    sync.add_argument("--preview-long-edge", type=int, default=3840, metavar="PX")
    sync.add_argument("--preview-quality", type=int, default=88, metavar="Q")

    return parser


def _validate_sync_once_args(args: argparse.Namespace) -> str | None:
    """Return an error message, or None if args are valid."""
    if not args.confirm_upload:
        return "--confirm-upload is required to prevent accidental uploads"
    if args.concurrency < 1:
        return "--concurrency must be a positive integer"
    return None


async def run_sync_once(
    args: argparse.Namespace,
    *,
    config_loader: Callable | None = None,
    client_factory: Callable | None = None,
    store_factory: Callable | None = None,
    sync_fn: Callable | None = None,
    clock: Callable[[], datetime] | None = None,
) -> int:
    """
    Async composition function for sync-once.

    Factories are injectable for testing. Returns exit code:
      0 — success
      1 — runtime sync failure
      2 — argument / configuration / confirmation error
    """
    # Check CLI flags before any factory or network call.
    error = _validate_sync_once_args(args)
    if error:
        print(f"Error: {error}", file=sys.stderr)
        return 2

    # Defer all photo_gate imports so the module stays importable without libvips.
    from .models import AlbumIdentity, ImageSettings, PreviewSettings, ThumbSettings
    from .config import ConfigError

    try:
        album = AlbumIdentity(
            album_id=args.album_id,
            title=args.album_title,
            photoprism_album_uid=args.photoprism_album_uid,
        )
    except ValueError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2

    try:
        settings = ImageSettings(
            thumb=ThumbSettings(
                long_edge=args.thumb_long_edge,
                quality=args.thumb_quality,
            ),
            preview=PreviewSettings(
                long_edge=args.preview_long_edge,
                quality=args.preview_quality,
            ),
        )
    except ValueError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2

    if config_loader is None:
        from .config import load_config
        config_loader = load_config

    try:
        config = config_loader()
    except ConfigError as exc:
        print(f"Configuration error: {exc}", file=sys.stderr)
        return 2

    if client_factory is None:
        from .photoprism_client import PhotoPrismClient

        def client_factory(cfg):
            return PhotoPrismClient(
                base_url=cfg.photoprism_url,
                token=cfg.photoprism_token,
                cf_client_id=cfg.cf_client_id,
                cf_client_secret=cfg.cf_client_secret,
            )

    if store_factory is None:
        from .r2_store import R2ObjectStore

        def store_factory(cfg):
            return R2ObjectStore(cfg.r2)

    if sync_fn is None:
        from .sync import sync_album
        sync_fn = sync_album

    if clock is None:
        clock = lambda: datetime.now(tz=timezone.utc)

    try:
        generated_at = clock()
        client = client_factory(config)
        async with client:
            store = store_factory(config)
            await sync_fn(client, album, store, settings, generated_at, args.concurrency)
    except Exception as exc:
        print(
            f"Sync failed for album {args.album_id!r}: {_describe_error(exc)}",
            file=sys.stderr,
        )
        return 1

    print(f"Sync complete: album={args.album_id!r}")
    return 0


def main() -> None:
    parser = _build_parser()
    args = parser.parse_args()

    if args.command == "sync-once":
        sys.exit(asyncio.run(run_sync_once(args)))
    else:
        parser.print_help()
        sys.exit(2)
