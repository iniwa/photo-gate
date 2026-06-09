import asyncio
from datetime import datetime

from .image_processor import ImageProcessor
from .manifest import build_manifest
from .models import AlbumIdentity, ImageSettings, PhotoPrismPhoto
from .object_store import ObjectStore
from .photoprism_client import PhotoPrismClient


async def sync_album(
    client: PhotoPrismClient,
    album: AlbumIdentity,
    store: ObjectStore,
    settings: ImageSettings,
    generated_at: datetime,
    concurrency: int = 2,
) -> None:
    """
    Sync one album:
      1. List photos from PhotoPrism.
      2. For each photo: download fit_720 + fit_3840, re-encode, validate, upload.
      3. Upload manifest only after all image uploads succeed.

    If any step for any photo fails the exception propagates and manifest is not uploaded.
    Concurrency limits simultaneous per-photo downloads; default is conservative for Pi.
    """
    if concurrency < 1:
        raise ValueError("concurrency must be positive")

    processor = ImageProcessor()
    photos, preview_token = await client.list_album_photos(album.photoprism_album_uid)

    sem = asyncio.Semaphore(concurrency)

    async def process_one(photo: PhotoPrismPhoto) -> None:
        async with sem:
            thumb_src = await client.download_preview(
                photo.hash, preview_token, "fit_720"
            )
            preview_src = await client.download_preview(
                photo.hash, preview_token, "fit_3840"
            )

            thumb_data = processor.process_thumb(thumb_src, settings.thumb)
            preview_data = processor.process_preview(preview_src, settings.preview)

            processor.validate_no_forbidden_metadata(thumb_data)
            processor.validate_no_forbidden_metadata(preview_data)

            thumb_key = f"albums/{album.album_id}/thumbs/{photo.uid}.webp"
            preview_key = f"albums/{album.album_id}/previews/{photo.uid}.jpg"

            await store.put(thumb_key, thumb_data, "image/webp")
            await store.put(preview_key, preview_data, "image/jpeg")

    async with asyncio.TaskGroup() as tg:
        for photo in photos:
            tg.create_task(process_one(photo))

    manifest_json = build_manifest(album, photos, settings, generated_at)
    manifest_key = f"albums/{album.album_id}/manifest.json"
    await store.put(manifest_key, manifest_json.encode("utf-8"), "application/json")
