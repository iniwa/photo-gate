import asyncio
import logging
from datetime import datetime

import pyvips

from .image_processor import ImageProcessor
from .manifest import build_manifest
from .models import AlbumIdentity, ImageSettings, PhotoPrismPhoto
from .object_store import ObjectStore
from .photoprism_client import PhotoPrismClient, PhotoPrismError

_log = logging.getLogger(__name__)

# Long edge in pixels for each PhotoPrism preview size this tool may use
# as a source. Keep the keys in sync with --photoprism-preview-size in
# main.py and _ALLOWED_SIZES in photoprism_client.py.
_SOURCE_SIZE_PX = {
    "fit_720": 720,
    "fit_1280": 1280,
    "fit_1920": 1920,
    "fit_2048": 2048,
    "fit_2560": 2560,
    "fit_3840": 3840,
}

_THUMB_SOURCE_SIZE = "fit_720"


def _require_plausible_source(
    data: bytes, photo: PhotoPrismPhoto, size: str, kind: str
) -> None:
    """
    Fail closed when PhotoPrism returns a placeholder instead of a real
    preview. When asked for a size its thumbnail settings cannot serve,
    PhotoPrism responds 200 image/jpeg with a tiny placeholder; the first
    production sync uploaded 234 identical 24x24 "previews" that way. The
    decoded long edge must reach at least half of what the requested size
    and the source photo dimensions allow.
    """
    try:
        probe: pyvips.Image = pyvips.Image.new_from_buffer(data, "")
    except pyvips.Error as exc:
        raise PhotoPrismError(
            f"PhotoPrism returned undecodable {kind} data for uid={photo.uid!r}"
        ) from exc

    long_edge = max(probe.width, probe.height)
    source_long = max(photo.width, photo.height)
    # Unknown source dimensions (0) make the expectation unverifiable; skip.
    expected = min(_SOURCE_SIZE_PX[size], source_long)
    if source_long > 0 and long_edge < expected // 2:
        raise PhotoPrismError(
            f"PhotoPrism returned an undersized {kind} for uid={photo.uid!r}: "
            f"long edge {long_edge}px, expected about {expected}px. The "
            f"instance likely cannot serve size {size!r} (check "
            f"PHOTOPRISM_THUMB_SIZE / PHOTOPRISM_THUMB_UNCACHED) or pass a "
            f"smaller --photoprism-preview-size."
        )


async def sync_album(
    client: PhotoPrismClient,
    album: AlbumIdentity,
    store: ObjectStore,
    settings: ImageSettings,
    generated_at: datetime,
    concurrency: int = 2,
    preview_source_size: str = "fit_3840",
) -> None:
    """
    Sync one album:
      1. List photos from PhotoPrism.
      2. For each photo: download fit_720 + the preview source size,
         re-encode, validate, upload.
      3. If the album is non-empty, generate and upload the cover webp from
         the first photo's fit_720 preview to albums/<id>/cover.webp.
      4. Upload manifest only after all image uploads (including the cover) succeed.

    If any step for any photo fails the exception propagates and manifest is not uploaded.
    Concurrency limits simultaneous per-photo downloads; default is conservative for Pi.
    """
    if concurrency < 1:
        raise ValueError("concurrency must be positive")
    if preview_source_size not in _SOURCE_SIZE_PX:
        raise ValueError(
            f"preview_source_size {preview_source_size!r} not in "
            f"{sorted(_SOURCE_SIZE_PX)}"
        )

    processor = ImageProcessor()
    photos, preview_token = await client.list_album_photos(album.photoprism_album_uid)
    _log.info("album %s: %d photos to sync", album.album_id, len(photos))

    sem = asyncio.Semaphore(concurrency)
    _done = [0]

    async def process_one(photo: PhotoPrismPhoto) -> None:
        async with sem:
            thumb_src = await client.download_preview(
                photo.hash, preview_token, _THUMB_SOURCE_SIZE
            )
            _require_plausible_source(thumb_src, photo, _THUMB_SOURCE_SIZE, "thumb source")
            preview_src = await client.download_preview(
                photo.hash, preview_token, preview_source_size
            )
            _require_plausible_source(
                preview_src, photo, preview_source_size, "preview source"
            )

            thumb_data = processor.process_thumb(thumb_src, settings.thumb)
            preview_data = processor.process_preview(preview_src, settings.preview)

            processor.validate_no_forbidden_metadata(thumb_data)
            processor.validate_no_forbidden_metadata(preview_data)

            thumb_key = f"albums/{album.album_id}/thumbs/{photo.uid}.webp"
            preview_key = f"albums/{album.album_id}/previews/{photo.uid}.jpg"

            await store.put(thumb_key, thumb_data, "image/webp")
            await store.put(preview_key, preview_data, "image/jpeg")
            _done[0] += 1
            _log.info("synced %s (%d/%d)", photo.uid, _done[0], len(photos))

    async with asyncio.TaskGroup() as tg:
        for photo in photos:
            tg.create_task(process_one(photo))

    if photos:
        cover_photo = photos[0]
        cover_src = await client.download_preview(
            cover_photo.hash, preview_token, _THUMB_SOURCE_SIZE
        )
        _require_plausible_source(cover_src, cover_photo, _THUMB_SOURCE_SIZE, "cover source")
        cover_data = processor.process_thumb(cover_src, settings.thumb)
        processor.validate_no_forbidden_metadata(cover_data)
        cover_key = f"albums/{album.album_id}/cover.webp"
        await store.put(cover_key, cover_data, "image/webp")
        _log.info("uploaded cover for album %s", album.album_id)

    manifest_json = build_manifest(album, photos, settings, generated_at)
    manifest_key = f"albums/{album.album_id}/manifest.json"
    await store.put(manifest_key, manifest_json.encode("utf-8"), "application/json")
    _log.info("uploaded manifest for album %s", album.album_id)
