"""Resolution and synchronization of browser-configured safe sync targets."""
from __future__ import annotations

import argparse
import logging
import sys
from datetime import datetime, timezone
from typing import Callable

from .runtime import _describe_error

async def _read_sync_targets_from_store(
    store: object,
    log: "logging.Logger",
) -> "list[dict] | None":
    """
    Read and validate ops/sync-targets.json from the store.

    Returns a (possibly empty) list of validated target dicts on success.
    Returns None if the object is missing, unreadable, or malformed.
    Never raises. Never logs raw JSON, catalog IDs, UIDs, or credentials.
    """
    from .sync_targets import SYNC_TARGETS_KEY, validate_sync_targets, SyncTargetError
    try:
        data = await store.get(SYNC_TARGETS_KEY)
    except Exception:
        log.warning("sync-targets read failed")
        return None
    if data is None:
        return []
    try:
        return validate_sync_targets(data)
    except SyncTargetError:
        log.warning("sync-targets malformed: falling back to configured album")
        return None


async def _run_multi_target_attempt(
    args: "argparse.Namespace",
    raw_targets: "list[dict]",
    *,
    config_loader: "Callable | None" = None,
    client_factory: "Callable | None" = None,
    store_factory: "Callable | None" = None,
    sync_fn: "Callable | None" = None,
    clock: "Callable[[], datetime] | None" = None,
    error_sink: "Callable[[str], None] | None" = None,
    summary_sink: "Callable[[bool, object | None], None] | None" = None,
    log: "logging.Logger",
) -> int:
    """
    Sync all resolved targets sequentially using a single PhotoPrism connection.

    Returns exit code: 0 = all succeeded, 1 = at least one failed, 2 = config error.
    Targets whose catalogId cannot be resolved are skipped with a fixed warning.
    Falls back to single-album mode (returns -1) if no targets resolve.
    Never logs raw UIDs, catalog IDs, credentials, or raw JSON.
    """
    import hashlib

    from .models import AlbumIdentity, ImageSettings, ThumbSettings, PreviewSettings
    from .config import ConfigError

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

    try:
        client = client_factory(config)
        async with client:
            pp_albums = await client.list_albums()
            uid_by_catalog: dict[str, str] = {}
            for pp_album in pp_albums:
                cid = hashlib.sha256(pp_album.raw_uid.encode()).hexdigest()
                uid_by_catalog[cid] = pp_album.raw_uid

            resolved: list[AlbumIdentity] = []
            for t in raw_targets:
                uid = uid_by_catalog.get(t["catalogId"])
                if uid is None:
                    log.warning("sync-targets: catalogId unresolved, skipping target")
                    continue
                try:
                    identity = AlbumIdentity(
                        album_id=t["albumId"],
                        title=t["title"],
                        photoprism_album_uid=uid,
                    )
                except ValueError:
                    log.warning("sync-targets: target identity invalid, skipping")
                    continue
                resolved.append(identity)

            if not resolved:
                return -1

            store = store_factory(config)
            any_failed = False
            for identity in resolved:
                try:
                    generated_at = clock()
                    sync_result = await sync_fn(
                        client,
                        identity,
                        store,
                        settings,
                        generated_at,
                        args.concurrency,
                        preview_source_size=args.photoprism_preview_size,
                    )
                    if summary_sink is not None:
                        try:
                            summary_sink(True, sync_result)
                        except Exception:
                            pass
                    log.info("sync-targets: synced album %s", identity.album_id)
                except Exception as exc:
                    if summary_sink is not None:
                        try:
                            summary_sink(False, None)
                        except Exception:
                            pass
                    described = _describe_error(exc)
                    print(
                        f"Sync failed for album {identity.album_id!r}: {described}",
                        file=sys.stderr,
                    )
                    if error_sink is not None:
                        error_sink(described)
                    any_failed = True

    except Exception as exc:
        described = _describe_error(exc)
        print(f"Multi-target sync setup failed: {described}", file=sys.stderr)
        if error_sink is not None:
            error_sink(described)
        return 1

    return 1 if any_failed else 0
