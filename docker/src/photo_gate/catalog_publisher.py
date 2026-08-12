"""Sanitized PhotoPrism album catalog publication."""
from __future__ import annotations

import argparse
import logging
import sys
from datetime import datetime, timezone
from typing import Callable

from .runtime import _UTC, _describe_error

_CATALOG_KEY = "ops/album-catalog.json"


async def run_publish_catalog(
    args: argparse.Namespace,
    *,
    config_loader: Callable | None = None,
    client_factory: Callable | None = None,
    store_factory: Callable | None = None,
    publish_fn: Callable | None = None,
    clock: Callable[[], datetime] | None = None,
) -> int:
    """
    Async composition function for publish-catalog.

    Reads all PhotoPrism albums, builds a sanitized catalog, and writes it to
    ops/album-catalog.json in private R2. Factories are injectable for testing.
    Returns exit code:
      0 — success
      1 — runtime failure
      2 — configuration error
    """
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

    if publish_fn is None:
        from .album_catalog import build_catalog_bytes
        publish_fn = build_catalog_bytes

    if clock is None:
        clock = lambda: datetime.now(tz=_UTC)

    album_count = 0
    try:
        published_at = clock().strftime("%Y-%m-%dT%H:%M:%SZ")
        client = client_factory(config)
        async with client:
            albums = await client.list_albums()
            album_count = len(albums)
            data = publish_fn(albums, published_at)
        store = store_factory(config)
        await store.put(_CATALOG_KEY, data, "application/json")
    except Exception as exc:
        described = _describe_error(exc)
        print(f"Publish catalog failed: {described}", file=sys.stderr)
        return 1

    print(f"Published album catalog: count={album_count}")
    return 0


async def _best_effort_publish_catalog(
    publish_catalog_fn: Callable[[], object] | None,
    log: logging.Logger,
) -> bool:
    """Publish the sanitized catalog without changing daemon sync semantics."""
    if publish_catalog_fn is None:
        return False

    try:
        result = await publish_catalog_fn()
    except Exception:
        log.warning("album catalog publication failed; continuing sync daemon")
        return False

    if result != 0:
        log.warning("album catalog publication failed; continuing sync daemon")
        return False
    return True
