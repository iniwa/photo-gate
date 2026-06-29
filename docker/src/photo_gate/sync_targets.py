"""
Docker-side validator for sync target objects read from R2.

Mirrors the Worker schema (schema=1) without raw PhotoPrism UIDs.
"""
from __future__ import annotations

import json
import re

SYNC_TARGETS_KEY = "ops/sync-targets.json"


class SyncTargetError(Exception):
    """Raised when sync target validation fails. Messages are safe to print."""


_SAFE_ID_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$", re.ASCII)
_CATALOG_ID_RE = re.compile(r"^[0-9a-f]{64}$", re.ASCII)
_WORKER_MS_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$", re.ASCII)
_TITLE_MAX_CODE_POINTS = 1024

_EXPECTED_ROOT_KEYS = frozenset({"schema", "publishedAt", "targets"})
_EXPECTED_TARGET_KEYS = frozenset({
    "albumId", "catalogId", "title", "expiresAt", "downloadEnabled",
    "thumb", "preview", "stripExif",
})
_EXPECTED_IMAGE_KEYS = frozenset({"longEdge", "format", "quality"})

_MAX_TARGETS = 100
_MAX_BYTES = 256 * 1024


def _is_worker_ms_timestamp(value: object) -> bool:
    if not isinstance(value, str):
        return False
    return bool(_WORKER_MS_RE.match(value))


def _is_safe_title(value: object) -> bool:
    if not isinstance(value, str) or len(value) == 0:
        return False
    if value != value.strip():
        return False
    if re.search(r"[\x00-\x1f\x7f]", value):
        return False
    if sum(1 for _ in value) > _TITLE_MAX_CODE_POINTS:
        return False
    return True


def _parse_target(obj: object) -> dict:
    if not isinstance(obj, dict):
        raise SyncTargetError("target must be an object")
    if set(obj.keys()) != _EXPECTED_TARGET_KEYS:
        raise SyncTargetError("target has unexpected keys")

    album_id = obj["albumId"]
    if not isinstance(album_id, str) or not _SAFE_ID_RE.match(album_id):
        raise SyncTargetError("target albumId invalid")

    catalog_id = obj["catalogId"]
    if not isinstance(catalog_id, str) or not _CATALOG_ID_RE.match(catalog_id):
        raise SyncTargetError("target catalogId invalid")

    if not _is_safe_title(obj["title"]):
        raise SyncTargetError("target title invalid")

    expires_at = obj["expiresAt"]
    if expires_at is not None and not _is_worker_ms_timestamp(expires_at):
        raise SyncTargetError("target expiresAt invalid")

    download_enabled = obj["downloadEnabled"]
    if type(download_enabled) is not int or download_enabled not in (0, 1):
        raise SyncTargetError("target downloadEnabled invalid")

    thumb = obj["thumb"]
    if not isinstance(thumb, dict) or set(thumb.keys()) != _EXPECTED_IMAGE_KEYS:
        raise SyncTargetError("target thumb invalid")
    if thumb["longEdge"] != 640 or thumb["format"] != "webp" or thumb["quality"] != 80:
        raise SyncTargetError("target thumb values invalid")

    preview = obj["preview"]
    if not isinstance(preview, dict) or set(preview.keys()) != _EXPECTED_IMAGE_KEYS:
        raise SyncTargetError("target preview invalid")
    if preview["longEdge"] != 3840 or preview["format"] != "jpg" or preview["quality"] != 88:
        raise SyncTargetError("target preview values invalid")

    if obj["stripExif"] != 1:
        raise SyncTargetError("target stripExif must be 1")

    return {
        "albumId": album_id,
        "catalogId": catalog_id,
        "title": obj["title"],
        "expiresAt": expires_at,
        "downloadEnabled": download_enabled,
    }


def validate_sync_targets(data: bytes) -> list[dict]:
    """
    Validate raw bytes from R2 and return a list of safe target dicts.

    Each dict has keys: albumId, catalogId, title, expiresAt, downloadEnabled.
    Raises SyncTargetError on any validation failure.
    Never includes raw PhotoPrism UIDs, credentials, or R2 metadata.
    """
    if len(data) > _MAX_BYTES:
        raise SyncTargetError("sync-targets object too large")

    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise SyncTargetError("sync-targets not valid UTF-8") from exc

    try:
        obj = json.loads(text)
    except json.JSONDecodeError as exc:
        raise SyncTargetError("sync-targets not valid JSON") from exc

    if not isinstance(obj, dict):
        raise SyncTargetError("sync-targets root must be an object")

    if set(obj.keys()) != _EXPECTED_ROOT_KEYS:
        raise SyncTargetError("sync-targets root has unexpected keys")

    if type(obj["schema"]) is not int or obj["schema"] != 1:
        raise SyncTargetError("sync-targets schema must be 1")

    if not _is_worker_ms_timestamp(obj["publishedAt"]):
        raise SyncTargetError("sync-targets publishedAt invalid")

    targets_raw = obj["targets"]
    if not isinstance(targets_raw, list):
        raise SyncTargetError("sync-targets targets must be an array")

    if len(targets_raw) > _MAX_TARGETS:
        raise SyncTargetError("sync-targets targets array exceeds maximum length")

    targets: list[dict] = []
    seen_album_ids: set[str] = set()
    seen_catalog_ids: set[str] = set()

    for entry in targets_raw:
        parsed = _parse_target(entry)
        if parsed["albumId"] in seen_album_ids:
            raise SyncTargetError("sync-targets duplicate albumId")
        if parsed["catalogId"] in seen_catalog_ids:
            raise SyncTargetError("sync-targets duplicate catalogId")
        seen_album_ids.add(parsed["albumId"])
        seen_catalog_ids.add(parsed["catalogId"])
        targets.append(parsed)

    return targets
