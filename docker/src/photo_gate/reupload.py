"""
Reupload suppression helpers for sync_album.

Parses a previous manifest.json from R2 and returns a mapping of
photo UID -> sourceHash for photos that are provably unchanged.
The caller compares each current photo.hash against this map before
deciding to skip download, re-encoding, and upload.

Any parse error, schema mismatch, or unverifiable field produces an
empty map (safe cache miss), not a sync failure.
"""
import json
import logging

from .models import AlbumIdentity, ImageSettings

_log = logging.getLogger(__name__)


def _images_match(prev: object, settings: ImageSettings) -> bool:
    if not isinstance(prev, dict):
        return False
    thumb = prev.get("thumb")
    preview = prev.get("preview")
    if not isinstance(thumb, dict) or not isinstance(preview, dict):
        return False
    if prev.get("stripExif") is not True:
        return False
    return (
        thumb.get("longEdge") == settings.thumb.long_edge
        and thumb.get("format") == settings.thumb.format
        and thumb.get("quality") == settings.thumb.quality
        and preview.get("longEdge") == settings.preview.long_edge
        and preview.get("format") == settings.preview.format
        and preview.get("quality") == settings.preview.quality
    )


def build_prev_photo_hashes(
    raw: bytes | None,
    album: AlbumIdentity,
    settings: ImageSettings,
) -> dict[str, str]:
    """
    Parse a previous manifest and return {uid: sourceHash} for photos whose
    thumb and preview outputs are provably unchanged. Returns {} on any cache
    miss or parse error.

    The caller must still compare the returned sourceHash against the current
    PhotoPrismPhoto.hash before skipping.

    Safe cache-miss conditions (returns {}):
    - raw is None (manifest absent)
    - invalid UTF-8 or non-JSON
    - top-level value is not a dict
    - schemaVersion != 2
    - albumId, source.type, or source.albumUid mismatch
    - images settings mismatch
    - photos is not a list, or contains a non-dict entry
    - any entry has a missing or non-string id
    - duplicate photo id in the list

    Per-photo miss (entry excluded from result but manifest remains valid):
    - sourceHash is missing or not a string
    - thumb or preview key does not match the expected pattern
    """
    if raw is None:
        return {}

    try:
        doc = json.loads(raw.decode("utf-8"))
    except Exception:
        return {}

    if not isinstance(doc, dict):
        return {}
    if doc.get("schemaVersion") != 2:
        return {}
    if doc.get("albumId") != album.album_id:
        return {}

    source = doc.get("source")
    if not isinstance(source, dict):
        return {}
    if source.get("type") != "photoprism":
        return {}
    if source.get("albumUid") != album.photoprism_album_uid:
        return {}

    if not _images_match(doc.get("images"), settings):
        return {}

    photos = doc.get("photos")
    if not isinstance(photos, list):
        return {}

    seen: set[str] = set()
    uid_map: dict[str, str] = {}
    for entry in photos:
        if not isinstance(entry, dict):
            return {}
        uid = entry.get("id")
        if not isinstance(uid, str) or not uid:
            return {}
        if uid in seen:
            return {}
        seen.add(uid)

        source_hash = entry.get("sourceHash")
        if (
            isinstance(source_hash, str)
            and entry.get("thumb") == f"thumbs/{uid}.webp"
            and entry.get("preview") == f"previews/{uid}.jpg"
        ):
            uid_map[uid] = source_hash

    return uid_map
