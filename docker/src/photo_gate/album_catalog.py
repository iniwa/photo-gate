"""
Album catalog builder for ops/album-catalog.json.

Converts validated PhotoPrism album rows to a sanitized display catalog.
Raw PhotoPrism UIDs are replaced by opaque catalogId values (SHA-256 hex digest).
The published JSON contains no UID, token, URL, NAS path, or source photo data.
"""

import hashlib
import json
import re


_CATALOG_ID_RE = re.compile(r'^[0-9a-f]{64}$', re.ASCII)
_TITLE_MAX_CODE_POINTS = 1024
_DOCKER_TIMESTAMP_RE = re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$', re.ASCII)


class CatalogError(Exception):
    """Raised when catalog validation or build fails. Messages are safe to print."""


def _is_safe_title(value: object) -> bool:
    if not isinstance(value, str) or len(value) == 0:
        return False
    if value != value.strip():
        return False
    if re.search(r'[\x00-\x1f\x7f]', value):
        return False
    if sum(1 for _ in value) > _TITLE_MAX_CODE_POINTS:
        return False
    return True


def _is_docker_timestamp(value: object) -> bool:
    return isinstance(value, str) and bool(_DOCKER_TIMESTAMP_RE.match(value))


def build_catalog_bytes(albums: list, published_at: str) -> bytes:
    """
    Build and serialize the ops/album-catalog.json payload.

    albums: sequence of objects with .raw_uid, .title, .photo_count, .updated_at
            (PhotoPrismAlbum instances from photoprism_client)
    published_at: YYYY-MM-DDTHH:mm:ssZ

    Returns deterministic UTF-8 JSON bytes.
    Raises CatalogError for invalid input. Never includes raw_uid in output.
    Fails closed on duplicate catalogId before any R2 write.
    """
    if not _is_docker_timestamp(published_at):
        raise CatalogError("publishedAt must be a Docker UTC seconds timestamp")

    entries: list[dict] = []
    seen_ids: set[str] = set()

    for album in albums:
        catalog_id = hashlib.sha256(album.raw_uid.encode()).hexdigest()
        if not _CATALOG_ID_RE.match(catalog_id):
            raise CatalogError("catalogId failed format validation")

        if catalog_id in seen_ids:
            raise CatalogError("duplicate catalogId detected before R2 write")
        seen_ids.add(catalog_id)

        if not _is_safe_title(album.title):
            raise CatalogError("album title failed validation")

        photo_count = album.photo_count
        if photo_count is not None and (not isinstance(photo_count, int) or photo_count < 0):
            raise CatalogError("album photoCount must be null or a non-negative integer")

        updated_at = album.updated_at
        if updated_at is not None and not _is_docker_timestamp(updated_at):
            raise CatalogError("album updatedAt must be null or a Docker UTC timestamp")

        entries.append({
            "catalogId": catalog_id,
            "photoCount": photo_count,
            "title": album.title,
            "updatedAt": updated_at,
        })

    entries.sort(key=lambda e: (e["title"], e["catalogId"]))

    catalog = {
        "albums": entries,
        "publishedAt": published_at,
        "schema": 1,
    }

    return json.dumps(catalog, ensure_ascii=False, sort_keys=True).encode("utf-8")
