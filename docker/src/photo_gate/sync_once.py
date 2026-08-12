"""One-shot image sync composition."""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from typing import Callable

from .cli import _validate_sync_once_args
from .runtime import _describe_error

async def run_sync_once(
    args: argparse.Namespace,
    *,
    config_loader: Callable | None = None,
    client_factory: Callable | None = None,
    store_factory: Callable | None = None,
    sync_fn: Callable | None = None,
    clock: Callable[[], datetime] | None = None,
    error_sink: Callable[[str], None] | None = None,
    summary_sink: Callable[[object], None] | None = None,
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
            sync_result = await sync_fn(
                client,
                album,
                store,
                settings,
                generated_at,
                args.concurrency,
                preview_source_size=args.photoprism_preview_size,
            )
            if summary_sink is not None:
                try:
                    summary_sink(sync_result)
                except Exception:
                    # Aggregate publication must never turn a completed image
                    # sync into a failure. The daemon still validates the final
                    # summary before publishing it.
                    pass
    except Exception as exc:
        described = _describe_error(exc)
        print(
            f"Sync failed for album {args.album_id!r}: {described}",
            file=sys.stderr,
        )
        if error_sink is not None:
            # described is already sanitized; safe to record elsewhere.
            error_sink(described)
        return 1

    print(f"Sync complete: album={args.album_id!r}")
    return 0
