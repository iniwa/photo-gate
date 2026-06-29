"""
Unit tests for photo_gate.reupload.build_prev_photo_hashes.

All inputs are treated as untrusted bytes. Any parse failure, schema
mismatch, or unverifiable field must return {} (safe cache miss).
"""
import json

import pytest

from photo_gate.models import AlbumIdentity, ImageSettings
from photo_gate.reupload import build_prev_photo_hashes

_ALBUM = AlbumIdentity(
    album_id="family-trip-2026",
    title="Family Trip",
    photoprism_album_uid="as6g7xxxxxxx",
)

_SETTINGS = ImageSettings()

_HASH_A = "a" * 40
_HASH_B = "b" * 40


def _doc(**overrides) -> dict:
    """Return a minimal valid schema 2 manifest document."""
    base: dict = {
        "schemaVersion": 2,
        "albumId": _ALBUM.album_id,
        "title": "Family Trip",
        "source": {"type": "photoprism", "albumUid": _ALBUM.photoprism_album_uid},
        "generatedAt": "2026-06-09T09:00:00+00:00",
        "images": {
            "thumb": {
                "longEdge": _SETTINGS.thumb.long_edge,
                "format": _SETTINGS.thumb.format,
                "quality": _SETTINGS.thumb.quality,
            },
            "preview": {
                "longEdge": _SETTINGS.preview.long_edge,
                "format": _SETTINGS.preview.format,
                "quality": _SETTINGS.preview.quality,
            },
            "stripExif": True,
        },
        "photos": [],
    }
    base.update(overrides)
    return base


def _entry(uid: str, source_hash: str = _HASH_A) -> dict:
    return {
        "id": uid,
        "sourceHash": source_hash,
        "title": "Test",
        "thumb": f"thumbs/{uid}.webp",
        "preview": f"previews/{uid}.jpg",
        "takenAt": "2026-06-01T10:00:00+00:00",
        "width": 4,
        "height": 4,
    }


def _raw(doc: dict) -> bytes:
    return json.dumps(doc).encode("utf-8")


# ---------------------------------------------------------------------------
# None / structural misses
# ---------------------------------------------------------------------------


def test_returns_empty_for_none():
    assert build_prev_photo_hashes(None, _ALBUM, _SETTINGS) == {}


def test_returns_empty_for_invalid_utf8():
    assert build_prev_photo_hashes(b"\xff\xfe bad", _ALBUM, _SETTINGS) == {}


def test_returns_empty_for_non_json():
    assert build_prev_photo_hashes(b"not json {{", _ALBUM, _SETTINGS) == {}


def test_returns_empty_for_json_array():
    assert build_prev_photo_hashes(b"[]", _ALBUM, _SETTINGS) == {}


def test_returns_empty_for_json_string():
    assert build_prev_photo_hashes(b'"hello"', _ALBUM, _SETTINGS) == {}


# ---------------------------------------------------------------------------
# Schema version
# ---------------------------------------------------------------------------


def test_returns_empty_for_schema_version_1():
    assert build_prev_photo_hashes(_raw(_doc(schemaVersion=1)), _ALBUM, _SETTINGS) == {}


def test_returns_empty_for_schema_version_3():
    assert build_prev_photo_hashes(_raw(_doc(schemaVersion=3)), _ALBUM, _SETTINGS) == {}


def test_returns_empty_for_missing_schema_version():
    doc = _doc()
    del doc["schemaVersion"]
    assert build_prev_photo_hashes(_raw(doc), _ALBUM, _SETTINGS) == {}


# ---------------------------------------------------------------------------
# albumId mismatch
# ---------------------------------------------------------------------------


def test_returns_empty_for_wrong_album_id():
    assert build_prev_photo_hashes(_raw(_doc(albumId="other-album")), _ALBUM, _SETTINGS) == {}


def test_returns_empty_for_missing_album_id():
    doc = _doc()
    del doc["albumId"]
    assert build_prev_photo_hashes(_raw(doc), _ALBUM, _SETTINGS) == {}


# ---------------------------------------------------------------------------
# source mismatch
# ---------------------------------------------------------------------------


def test_returns_empty_for_wrong_source_type():
    doc = _doc(source={"type": "other", "albumUid": _ALBUM.photoprism_album_uid})
    assert build_prev_photo_hashes(_raw(doc), _ALBUM, _SETTINGS) == {}


def test_returns_empty_for_wrong_source_album_uid():
    doc = _doc(source={"type": "photoprism", "albumUid": "different-uid"})
    assert build_prev_photo_hashes(_raw(doc), _ALBUM, _SETTINGS) == {}


def test_returns_empty_for_missing_source():
    doc = _doc()
    del doc["source"]
    assert build_prev_photo_hashes(_raw(doc), _ALBUM, _SETTINGS) == {}


def test_returns_empty_for_non_dict_source():
    doc = _doc(source="photoprism")
    assert build_prev_photo_hashes(_raw(doc), _ALBUM, _SETTINGS) == {}


# ---------------------------------------------------------------------------
# images mismatch
# ---------------------------------------------------------------------------


def test_returns_empty_for_wrong_thumb_long_edge():
    doc = _doc()
    doc["images"]["thumb"]["longEdge"] = 999
    assert build_prev_photo_hashes(_raw(doc), _ALBUM, _SETTINGS) == {}


def test_returns_empty_for_wrong_preview_quality():
    doc = _doc()
    doc["images"]["preview"]["quality"] = 99
    assert build_prev_photo_hashes(_raw(doc), _ALBUM, _SETTINGS) == {}


def test_returns_empty_for_strip_exif_false():
    doc = _doc()
    doc["images"]["stripExif"] = False
    assert build_prev_photo_hashes(_raw(doc), _ALBUM, _SETTINGS) == {}


def test_returns_empty_for_missing_strip_exif():
    doc = _doc()
    del doc["images"]["stripExif"]
    assert build_prev_photo_hashes(_raw(doc), _ALBUM, _SETTINGS) == {}


def test_returns_empty_for_missing_images():
    doc = _doc()
    del doc["images"]
    assert build_prev_photo_hashes(_raw(doc), _ALBUM, _SETTINGS) == {}


# ---------------------------------------------------------------------------
# photos list structural misses
# ---------------------------------------------------------------------------


def test_returns_empty_for_missing_photos():
    doc = _doc()
    del doc["photos"]
    assert build_prev_photo_hashes(_raw(doc), _ALBUM, _SETTINGS) == {}


def test_returns_empty_for_non_list_photos():
    doc = _doc(photos={})
    assert build_prev_photo_hashes(_raw(doc), _ALBUM, _SETTINGS) == {}


def test_returns_empty_for_non_dict_entry():
    doc = _doc(photos=["not-a-dict"])
    assert build_prev_photo_hashes(_raw(doc), _ALBUM, _SETTINGS) == {}


def test_returns_empty_for_missing_entry_id():
    entry = _entry("uid001")
    del entry["id"]
    doc = _doc(photos=[entry])
    assert build_prev_photo_hashes(_raw(doc), _ALBUM, _SETTINGS) == {}


def test_returns_empty_for_non_string_entry_id():
    entry = _entry("uid001")
    entry["id"] = 42
    doc = _doc(photos=[entry])
    assert build_prev_photo_hashes(_raw(doc), _ALBUM, _SETTINGS) == {}


def test_returns_empty_for_empty_string_entry_id():
    entry = _entry("uid001")
    entry["id"] = ""
    doc = _doc(photos=[entry])
    assert build_prev_photo_hashes(_raw(doc), _ALBUM, _SETTINGS) == {}


def test_returns_empty_for_duplicate_uid():
    doc = _doc(photos=[_entry("uid001"), _entry("uid001")])
    assert build_prev_photo_hashes(_raw(doc), _ALBUM, _SETTINGS) == {}


# ---------------------------------------------------------------------------
# Valid manifest — happy paths
# ---------------------------------------------------------------------------


def test_empty_photos_returns_empty_map():
    result = build_prev_photo_hashes(_raw(_doc(photos=[])), _ALBUM, _SETTINGS)
    assert result == {}


def test_single_valid_entry_returned():
    doc = _doc(photos=[_entry("uid001", _HASH_A)])
    result = build_prev_photo_hashes(_raw(doc), _ALBUM, _SETTINGS)
    assert result == {"uid001": _HASH_A}


def test_multiple_valid_entries_returned():
    doc = _doc(photos=[_entry("uid001", _HASH_A), _entry("uid002", _HASH_B)])
    result = build_prev_photo_hashes(_raw(doc), _ALBUM, _SETTINGS)
    assert result == {"uid001": _HASH_A, "uid002": _HASH_B}


# ---------------------------------------------------------------------------
# Per-photo miss: invalid entry is excluded but rest of manifest is still used
# ---------------------------------------------------------------------------


def test_entry_with_wrong_thumb_key_excluded():
    bad = _entry("uid001", _HASH_A)
    bad["thumb"] = "wrong/path.webp"
    good = _entry("uid002", _HASH_B)
    doc = _doc(photos=[bad, good])
    result = build_prev_photo_hashes(_raw(doc), _ALBUM, _SETTINGS)
    assert "uid001" not in result
    assert result.get("uid002") == _HASH_B


def test_entry_with_wrong_preview_key_excluded():
    bad = _entry("uid001", _HASH_A)
    bad["preview"] = "wrong/path.jpg"
    good = _entry("uid002", _HASH_B)
    doc = _doc(photos=[bad, good])
    result = build_prev_photo_hashes(_raw(doc), _ALBUM, _SETTINGS)
    assert "uid001" not in result
    assert result.get("uid002") == _HASH_B


def test_entry_with_missing_source_hash_excluded():
    bad = _entry("uid001", _HASH_A)
    del bad["sourceHash"]
    good = _entry("uid002", _HASH_B)
    doc = _doc(photos=[bad, good])
    result = build_prev_photo_hashes(_raw(doc), _ALBUM, _SETTINGS)
    assert "uid001" not in result
    assert result.get("uid002") == _HASH_B


def test_entry_with_non_string_source_hash_excluded():
    bad = _entry("uid001", _HASH_A)
    bad["sourceHash"] = 12345
    good = _entry("uid002", _HASH_B)
    doc = _doc(photos=[bad, good])
    result = build_prev_photo_hashes(_raw(doc), _ALBUM, _SETTINGS)
    assert "uid001" not in result
    assert result.get("uid002") == _HASH_B


# ---------------------------------------------------------------------------
# Source hash comparison logic
# ---------------------------------------------------------------------------


def test_source_hash_value_is_preserved():
    custom_hash = "f" * 40
    doc = _doc(photos=[_entry("uid001", custom_hash)])
    result = build_prev_photo_hashes(_raw(doc), _ALBUM, _SETTINGS)
    assert result["uid001"] == custom_hash


def test_source_hash_compared_by_caller():
    """Verify that a non-matching hash produces no skip (comparison done by caller)."""
    doc = _doc(photos=[_entry("uid001", _HASH_A)])
    result = build_prev_photo_hashes(_raw(doc), _ALBUM, _SETTINGS)
    # Result has the hash; caller checks result.get(uid) == current_photo.hash
    assert result.get("uid001") != _HASH_B
