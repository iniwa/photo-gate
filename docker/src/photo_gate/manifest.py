import json
from datetime import datetime, timezone

from .models import AlbumIdentity, ImageSettings, PhotoPrismPhoto


def build_manifest(
    album: AlbumIdentity,
    photos: list[PhotoPrismPhoto],
    settings: ImageSettings,
    generated_at: datetime,
) -> str:
    """
    Returns a deterministic UTF-8 JSON string matching schemaVersion 1.
    Photos are sorted by taken_at then uid.
    Raises ValueError on duplicate photo UIDs.
    The caller supplies generated_at; this function never reads the clock.
    """
    if generated_at.tzinfo is None or generated_at.utcoffset() is None:
        raise ValueError("generated_at must include a timezone")

    seen_uids: set[str] = set()
    for photo in photos:
        if photo.uid in seen_uids:
            raise ValueError(f"Duplicate photo UID: {photo.uid!r}")
        seen_uids.add(photo.uid)

    sorted_photos = sorted(
        photos, key=lambda p: (p.taken_at.astimezone(timezone.utc), p.uid)
    )

    manifest: dict = {
        "schemaVersion": 1,
        "albumId": album.album_id,
        "title": album.title,
        "source": {
            "type": "photoprism",
            "albumUid": album.photoprism_album_uid,
        },
        "generatedAt": generated_at.isoformat(),
        "images": {
            "thumb": {
                "longEdge": settings.thumb.long_edge,
                "format": settings.thumb.format,
                "quality": settings.thumb.quality,
            },
            "preview": {
                "longEdge": settings.preview.long_edge,
                "format": settings.preview.format,
                "quality": settings.preview.quality,
            },
            "stripExif": True,
        },
        "photos": [
            {
                "id": photo.uid,
                "title": photo.title,
                "thumb": f"thumbs/{photo.uid}.webp",
                "preview": f"previews/{photo.uid}.jpg",
                "takenAt": photo.taken_at.isoformat(),
                "width": photo.width,
                "height": photo.height,
            }
            for photo in sorted_photos
        ],
    }

    return json.dumps(manifest, ensure_ascii=False, indent=2)
