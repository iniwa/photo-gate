"""
Tests for sync_targets.py: validate_sync_targets and SYNC_TARGETS_KEY.
No network or R2 access. No raw PhotoPrism UIDs.
"""
import json
import pytest

from photo_gate.sync_targets import validate_sync_targets, SYNC_TARGETS_KEY, SyncTargetError


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_VALID_PUBLISHED_AT = "2026-06-29T12:00:00.000Z"
_VALID_CATALOG_ID = "a" * 64
_VALID_CATALOG_ID_2 = "b" * 64
_VALID_ALBUM_ID = "ise-ryokou-id"
_VALID_ALBUM_ID_2 = "kyoto-summer"


def _make_target(overrides: dict | None = None) -> dict:
    t: dict = {
        "albumId": _VALID_ALBUM_ID,
        "catalogId": _VALID_CATALOG_ID,
        "title": "Ise Ryokou",
        "expiresAt": None,
        "downloadEnabled": 0,
        "thumb": {"longEdge": 640, "format": "webp", "quality": 80},
        "preview": {"longEdge": 3840, "format": "jpg", "quality": 88},
        "stripExif": 1,
    }
    if overrides:
        t.update(overrides)
    return t


def _make_payload(targets: list | None = None, overrides: dict | None = None) -> bytes:
    obj: dict = {
        "schema": 1,
        "publishedAt": _VALID_PUBLISHED_AT,
        "targets": targets if targets is not None else [],
    }
    if overrides:
        obj.update(overrides)
    return json.dumps(obj).encode("utf-8")


# ---------------------------------------------------------------------------
# Fixed key
# ---------------------------------------------------------------------------

def test_sync_targets_key():
    assert SYNC_TARGETS_KEY == "ops/sync-targets.json"


# ---------------------------------------------------------------------------
# Empty targets list
# ---------------------------------------------------------------------------

def test_empty_targets_list():
    result = validate_sync_targets(_make_payload([]))
    assert result == []


# ---------------------------------------------------------------------------
# Valid single target
# ---------------------------------------------------------------------------

def test_valid_single_target():
    result = validate_sync_targets(_make_payload([_make_target()]))
    assert len(result) == 1
    assert result[0]["albumId"] == _VALID_ALBUM_ID
    assert result[0]["catalogId"] == _VALID_CATALOG_ID
    assert result[0]["title"] == "Ise Ryokou"
    assert result[0]["expiresAt"] is None
    assert result[0]["downloadEnabled"] == 0


def test_valid_target_with_expires_at():
    result = validate_sync_targets(_make_payload([
        _make_target({"expiresAt": "2027-01-01T00:00:00.000Z"})
    ]))
    assert result[0]["expiresAt"] == "2027-01-01T00:00:00.000Z"


def test_valid_target_download_enabled_1():
    result = validate_sync_targets(_make_payload([
        _make_target({"downloadEnabled": 1})
    ]))
    assert result[0]["downloadEnabled"] == 1


def test_valid_two_targets():
    result = validate_sync_targets(_make_payload([
        _make_target({"albumId": _VALID_ALBUM_ID, "catalogId": _VALID_CATALOG_ID}),
        _make_target({"albumId": _VALID_ALBUM_ID_2, "catalogId": _VALID_CATALOG_ID_2}),
    ]))
    assert len(result) == 2


def test_result_does_not_contain_uid():
    result = validate_sync_targets(_make_payload([_make_target()]))
    payload_str = json.dumps(result)
    assert "uid" not in payload_str
    assert "photoprism" not in payload_str


# ---------------------------------------------------------------------------
# Root-level validation
# ---------------------------------------------------------------------------

def test_not_utf8():
    with pytest.raises(SyncTargetError):
        validate_sync_targets(b"\xff\xfe invalid")


def test_not_json():
    with pytest.raises(SyncTargetError):
        validate_sync_targets(b"not json")


def test_json_array_at_root():
    with pytest.raises(SyncTargetError):
        validate_sync_targets(b"[]")


def test_missing_schema_key():
    with pytest.raises(SyncTargetError):
        validate_sync_targets(_make_payload(overrides={"schema": None, "extra": 1}))


def test_extra_root_key():
    data = json.dumps({
        "schema": 1,
        "publishedAt": _VALID_PUBLISHED_AT,
        "targets": [],
        "extra": True,
    }).encode()
    with pytest.raises(SyncTargetError):
        validate_sync_targets(data)


def test_schema_not_1():
    with pytest.raises(SyncTargetError):
        validate_sync_targets(_make_payload(overrides={"schema": 2}))


def test_schema_bool_rejected():
    with pytest.raises(SyncTargetError):
        validate_sync_targets(_make_payload(overrides={"schema": True}))


def test_published_at_missing_milliseconds():
    with pytest.raises(SyncTargetError):
        validate_sync_targets(_make_payload(overrides={"publishedAt": "2026-06-29T12:00:00Z"}))


def test_published_at_not_string():
    with pytest.raises(SyncTargetError):
        validate_sync_targets(_make_payload(overrides={"publishedAt": 12345}))


def test_targets_not_array():
    with pytest.raises(SyncTargetError):
        validate_sync_targets(_make_payload(overrides={"targets": {}}))


def test_too_many_targets():
    targets = [
        _make_target({"albumId": f"album-{i:03d}", "catalogId": hex(i)[2:].zfill(64)})
        for i in range(101)
    ]
    with pytest.raises(SyncTargetError):
        validate_sync_targets(_make_payload(targets))


def test_object_too_large():
    with pytest.raises(SyncTargetError):
        validate_sync_targets(b"x" * (256 * 1024 + 1))


# ---------------------------------------------------------------------------
# Target-level validation
# ---------------------------------------------------------------------------

def test_target_not_object():
    with pytest.raises(SyncTargetError):
        validate_sync_targets(_make_payload(["not an object"]))


def test_target_extra_key():
    t = _make_target()
    t["extra"] = True
    with pytest.raises(SyncTargetError):
        validate_sync_targets(_make_payload([t]))


def test_target_missing_key():
    t = _make_target()
    del t["catalogId"]
    with pytest.raises(SyncTargetError):
        validate_sync_targets(_make_payload([t]))


def test_invalid_album_id():
    with pytest.raises(SyncTargetError):
        validate_sync_targets(_make_payload([_make_target({"albumId": "!bad!"})]))


def test_invalid_catalog_id_too_short():
    with pytest.raises(SyncTargetError):
        validate_sync_targets(_make_payload([_make_target({"catalogId": "tooshort"})]))


def test_invalid_catalog_id_uppercase():
    with pytest.raises(SyncTargetError):
        validate_sync_targets(_make_payload([_make_target({"catalogId": "A" * 64})]))


def test_empty_title():
    with pytest.raises(SyncTargetError):
        validate_sync_targets(_make_payload([_make_target({"title": ""})]))


def test_title_with_leading_space():
    with pytest.raises(SyncTargetError):
        validate_sync_targets(_make_payload([_make_target({"title": " bad"})]))


def test_title_with_control_char():
    with pytest.raises(SyncTargetError):
        validate_sync_targets(_make_payload([_make_target({"title": "bad\x01"})]))


def test_expires_at_invalid_format():
    with pytest.raises(SyncTargetError):
        validate_sync_targets(_make_payload([_make_target({"expiresAt": "not-a-date"})]))


def test_expires_at_docker_format_rejected():
    with pytest.raises(SyncTargetError):
        validate_sync_targets(_make_payload([_make_target({"expiresAt": "2026-06-29T12:00:00Z"})]))


def test_download_enabled_2():
    with pytest.raises(SyncTargetError):
        validate_sync_targets(_make_payload([_make_target({"downloadEnabled": 2})]))


def test_download_enabled_bool():
    with pytest.raises(SyncTargetError):
        validate_sync_targets(_make_payload([_make_target({"downloadEnabled": True})]))


def test_thumb_wrong_long_edge():
    t = _make_target()
    t["thumb"] = {"longEdge": 320, "format": "webp", "quality": 80}
    with pytest.raises(SyncTargetError):
        validate_sync_targets(_make_payload([t]))


def test_thumb_wrong_format():
    t = _make_target()
    t["thumb"] = {"longEdge": 640, "format": "jpg", "quality": 80}
    with pytest.raises(SyncTargetError):
        validate_sync_targets(_make_payload([t]))


def test_thumb_extra_key():
    t = _make_target()
    t["thumb"] = {"longEdge": 640, "format": "webp", "quality": 80, "extra": True}
    with pytest.raises(SyncTargetError):
        validate_sync_targets(_make_payload([t]))


def test_preview_wrong_long_edge():
    t = _make_target()
    t["preview"] = {"longEdge": 1920, "format": "jpg", "quality": 88}
    with pytest.raises(SyncTargetError):
        validate_sync_targets(_make_payload([t]))


def test_preview_wrong_format():
    t = _make_target()
    t["preview"] = {"longEdge": 3840, "format": "webp", "quality": 88}
    with pytest.raises(SyncTargetError):
        validate_sync_targets(_make_payload([t]))


def test_strip_exif_not_1():
    with pytest.raises(SyncTargetError):
        validate_sync_targets(_make_payload([_make_target({"stripExif": 0})]))


# ---------------------------------------------------------------------------
# Duplicate detection
# ---------------------------------------------------------------------------

def test_duplicate_album_id():
    with pytest.raises(SyncTargetError):
        validate_sync_targets(_make_payload([
            _make_target({"albumId": _VALID_ALBUM_ID, "catalogId": _VALID_CATALOG_ID}),
            _make_target({"albumId": _VALID_ALBUM_ID, "catalogId": _VALID_CATALOG_ID_2}),
        ]))


def test_duplicate_catalog_id():
    with pytest.raises(SyncTargetError):
        validate_sync_targets(_make_payload([
            _make_target({"albumId": _VALID_ALBUM_ID, "catalogId": _VALID_CATALOG_ID}),
            _make_target({"albumId": _VALID_ALBUM_ID_2, "catalogId": _VALID_CATALOG_ID}),
        ]))
