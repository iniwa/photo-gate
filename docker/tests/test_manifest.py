import json
from datetime import datetime, timezone

import pytest

from photo_gate.manifest import build_manifest
from photo_gate.models import AlbumIdentity, ImageSettings, PhotoPrismPhoto

_FIXED_TS = datetime(2026, 6, 9, 9, 0, 0, tzinfo=timezone.utc)

_ALBUM = AlbumIdentity(
    album_id="family-trip-2026",
    title="家族旅行 2026",
    photoprism_album_uid="as6g7xxxxxxx",
)

_SETTINGS = ImageSettings()


def _photo(uid: str, taken_at: str = "2026-06-01T10:00:00+00:00") -> PhotoPrismPhoto:
    return PhotoPrismPhoto(
        uid=uid,
        hash="a" * 40,
        title=f"Photo {uid}",
        taken_at=datetime.fromisoformat(taken_at),
        width=3840,
        height=2560,
    )


# ---------------------------------------------------------------------------
# Schema version and required fields
# ---------------------------------------------------------------------------


def test_schema_version_is_two():
    doc = json.loads(build_manifest(_ALBUM, [], _SETTINGS, _FIXED_TS))
    assert doc["schemaVersion"] == 2


def test_album_id_and_title():
    doc = json.loads(build_manifest(_ALBUM, [], _SETTINGS, _FIXED_TS))
    assert doc["albumId"] == "family-trip-2026"
    assert doc["title"] == "家族旅行 2026"


def test_source_contains_photoprism_uid():
    doc = json.loads(build_manifest(_ALBUM, [], _SETTINGS, _FIXED_TS))
    assert doc["source"]["type"] == "photoprism"
    assert doc["source"]["albumUid"] == "as6g7xxxxxxx"


def test_generated_at_from_caller():
    doc = json.loads(build_manifest(_ALBUM, [], _SETTINGS, _FIXED_TS))
    assert doc["generatedAt"] == _FIXED_TS.isoformat()


def test_generated_at_requires_timezone():
    with pytest.raises(ValueError, match="timezone"):
        build_manifest(_ALBUM, [], _SETTINGS, datetime(2026, 6, 9, 9, 0, 0))


def test_different_timestamps_produce_different_output():
    ts2 = datetime(2026, 6, 10, 0, 0, 0, tzinfo=timezone.utc)
    out1 = build_manifest(_ALBUM, [], _SETTINGS, _FIXED_TS)
    out2 = build_manifest(_ALBUM, [], _SETTINGS, ts2)
    assert out1 != out2


def test_image_settings_in_output():
    doc = json.loads(build_manifest(_ALBUM, [], _SETTINGS, _FIXED_TS))
    assert doc["images"]["thumb"]["longEdge"] == 640
    assert doc["images"]["thumb"]["format"] == "webp"
    assert doc["images"]["thumb"]["quality"] == 80
    assert doc["images"]["preview"]["longEdge"] == 3840
    assert doc["images"]["preview"]["format"] == "jpg"
    assert doc["images"]["preview"]["quality"] == 88
    assert doc["images"]["stripExif"] is True


# ---------------------------------------------------------------------------
# Photo entries
# ---------------------------------------------------------------------------


def test_photo_entry_uses_uid_as_id():
    photos = [_photo("pp_abc001")]
    doc = json.loads(build_manifest(_ALBUM, photos, _SETTINGS, _FIXED_TS))
    assert doc["photos"][0]["id"] == "pp_abc001"


def test_photo_entry_includes_source_hash():
    photos = [_photo("pp_abc001")]
    doc = json.loads(build_manifest(_ALBUM, photos, _SETTINGS, _FIXED_TS))
    assert doc["photos"][0]["sourceHash"] == "a" * 40


def test_photo_relative_paths():
    photos = [_photo("pp_abc001")]
    doc = json.loads(build_manifest(_ALBUM, photos, _SETTINGS, _FIXED_TS))
    entry = doc["photos"][0]
    assert entry["thumb"] == "thumbs/pp_abc001.webp"
    assert entry["preview"] == "previews/pp_abc001.jpg"


def test_photo_width_height_title_taken_at():
    photos = [_photo("pp_abc001", "2026-06-01T14:22:00+09:00")]
    doc = json.loads(build_manifest(_ALBUM, photos, _SETTINGS, _FIXED_TS))
    entry = doc["photos"][0]
    assert entry["width"] == 3840
    assert entry["height"] == 2560
    assert entry["title"] == "Photo pp_abc001"
    assert "2026-06-01" in entry["takenAt"]


# ---------------------------------------------------------------------------
# Sorting
# ---------------------------------------------------------------------------


def test_photos_sorted_by_taken_at_then_uid():
    photos = [
        _photo("uid_b", "2026-06-02T00:00:00+00:00"),
        _photo("uid_a", "2026-06-01T00:00:00+00:00"),
        _photo("uid_c", "2026-06-01T00:00:00+00:00"),
    ]
    doc = json.loads(build_manifest(_ALBUM, photos, _SETTINGS, _FIXED_TS))
    ids = [p["id"] for p in doc["photos"]]
    assert ids == ["uid_a", "uid_c", "uid_b"]


def test_photos_sorted_by_actual_instant_across_offsets():
    photos = [
        _photo("later", "2026-06-01T09:00:00+00:00"),
        _photo("earlier", "2026-06-01T10:00:00+02:00"),
    ]
    doc = json.loads(build_manifest(_ALBUM, photos, _SETTINGS, _FIXED_TS))
    assert [p["id"] for p in doc["photos"]] == ["earlier", "later"]


# ---------------------------------------------------------------------------
# Duplicate UID rejection
# ---------------------------------------------------------------------------


def test_duplicate_uid_raises():
    photos = [_photo("uid001"), _photo("uid001")]
    with pytest.raises(ValueError, match="uid001"):
        build_manifest(_ALBUM, photos, _SETTINGS, _FIXED_TS)


# ---------------------------------------------------------------------------
# Determinism
# ---------------------------------------------------------------------------


def test_same_inputs_produce_same_bytes():
    photos = [
        _photo("uid_z", "2026-06-01T10:00:00+00:00"),
        _photo("uid_a", "2026-06-02T10:00:00+00:00"),
    ]
    out1 = build_manifest(_ALBUM, photos, _SETTINGS, _FIXED_TS)
    out2 = build_manifest(_ALBUM, photos, _SETTINGS, _FIXED_TS)
    assert out1 == out2


def test_output_is_valid_utf8_json():
    photos = [_photo("pp_abc001")]
    raw = build_manifest(_ALBUM, photos, _SETTINGS, _FIXED_TS)
    raw.encode("utf-8")
    json.loads(raw)
