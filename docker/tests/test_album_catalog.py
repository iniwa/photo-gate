"""
Album catalog builder tests.

No network access, real credentials, PhotoPrism, R2, or libvips required.
"""

import hashlib
import json
import types

import pytest

from photo_gate.album_catalog import CatalogError, build_catalog_bytes


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_album(raw_uid, title, photo_count=None, updated_at=None):
    return types.SimpleNamespace(
        raw_uid=raw_uid,
        title=title,
        photo_count=photo_count,
        updated_at=updated_at,
    )


_PUBLISHED_AT = "2026-06-26T00:00:00Z"
_UID_A = "albumUidAaa001"
_UID_B = "albumUidBbb002"
_UID_C = "albumUidCcc003"


# ---------------------------------------------------------------------------
# Empty catalog
# ---------------------------------------------------------------------------


def test_empty_albums_produces_valid_catalog():
    data = build_catalog_bytes([], _PUBLISHED_AT)
    catalog = json.loads(data)
    assert catalog["schema"] == 1
    assert catalog["publishedAt"] == _PUBLISHED_AT
    assert catalog["albums"] == []


# ---------------------------------------------------------------------------
# catalogId computation
# ---------------------------------------------------------------------------


def test_catalog_id_is_sha256_of_raw_uid():
    uid = _UID_A
    expected_id = hashlib.sha256(uid.encode()).hexdigest()
    album = _make_album(uid, "My Album")
    data = build_catalog_bytes([album], _PUBLISHED_AT)
    catalog = json.loads(data)
    assert catalog["albums"][0]["catalogId"] == expected_id
    assert len(expected_id) == 64
    import re
    assert re.fullmatch(r"[0-9a-f]{64}", expected_id)


def test_raw_uid_not_in_output():
    uid = "secretPhotoPrismUid99"
    album = _make_album(uid, "Secret Album")
    data = build_catalog_bytes([album], _PUBLISHED_AT)
    assert uid.encode() not in data
    assert uid not in data.decode("utf-8")


def test_catalog_id_format_is_64_lowercase_hex():
    import re
    album = _make_album(_UID_A, "Album")
    data = build_catalog_bytes([album], _PUBLISHED_AT)
    catalog = json.loads(data)
    cid = catalog["albums"][0]["catalogId"]
    assert re.fullmatch(r"[0-9a-f]{64}", cid)


# ---------------------------------------------------------------------------
# Sorting
# ---------------------------------------------------------------------------


def test_albums_sorted_by_title_then_catalog_id():
    albums = [
        _make_album(_UID_C, "Zebra Album"),
        _make_album(_UID_A, "Apple Album"),
        _make_album(_UID_B, "Apple Album"),  # same title, different UID
    ]
    data = build_catalog_bytes(albums, _PUBLISHED_AT)
    catalog = json.loads(data)
    titles = [e["title"] for e in catalog["albums"]]
    # Apple albums first (sorted by catalogId), then Zebra
    assert titles[0] == "Apple Album"
    assert titles[1] == "Apple Album"
    assert titles[2] == "Zebra Album"
    # Within same title, catalogId ascending
    cid_0 = catalog["albums"][0]["catalogId"]
    cid_1 = catalog["albums"][1]["catalogId"]
    assert cid_0 < cid_1


# ---------------------------------------------------------------------------
# Duplicate catalogId detection
# ---------------------------------------------------------------------------


def test_duplicate_catalog_id_raises_catalog_error():
    # Same UID → same catalogId → duplicate
    albums = [
        _make_album(_UID_A, "Album Alpha"),
        _make_album(_UID_A, "Album Beta"),
    ]
    with pytest.raises(CatalogError, match="duplicate"):
        build_catalog_bytes(albums, _PUBLISHED_AT)


# ---------------------------------------------------------------------------
# Null fields
# ---------------------------------------------------------------------------


def test_null_photo_count_in_output():
    album = _make_album(_UID_A, "Album", photo_count=None)
    data = build_catalog_bytes([album], _PUBLISHED_AT)
    catalog = json.loads(data)
    assert catalog["albums"][0]["photoCount"] is None


def test_null_updated_at_in_output():
    album = _make_album(_UID_A, "Album", updated_at=None)
    data = build_catalog_bytes([album], _PUBLISHED_AT)
    catalog = json.loads(data)
    assert catalog["albums"][0]["updatedAt"] is None


def test_valid_photo_count_in_output():
    album = _make_album(_UID_A, "Album", photo_count=42)
    data = build_catalog_bytes([album], _PUBLISHED_AT)
    catalog = json.loads(data)
    assert catalog["albums"][0]["photoCount"] == 42


def test_zero_photo_count_in_output():
    album = _make_album(_UID_A, "Album", photo_count=0)
    data = build_catalog_bytes([album], _PUBLISHED_AT)
    catalog = json.loads(data)
    assert catalog["albums"][0]["photoCount"] == 0


def test_valid_updated_at_in_output():
    ts = "2026-06-15T08:30:00Z"
    album = _make_album(_UID_A, "Album", updated_at=ts)
    data = build_catalog_bytes([album], _PUBLISHED_AT)
    catalog = json.loads(data)
    assert catalog["albums"][0]["updatedAt"] == ts


# ---------------------------------------------------------------------------
# publishedAt validation
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("bad_ts", [
    "",
    "not-a-date",
    "2026-06-26T00:00:00",       # missing Z
    "2026-06-26T00:00:00.000Z",  # milliseconds (not Docker seconds form)
    "2026-06-26",                # date only
    None,
])
def test_invalid_published_at_raises_catalog_error(bad_ts):
    with pytest.raises(CatalogError, match="publishedAt"):
        build_catalog_bytes([], bad_ts)


# ---------------------------------------------------------------------------
# Title validation
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("bad_title", [
    "",                     # empty
    " Album",               # leading space
    "Album ",               # trailing space
    "Al\x00bum",           # null byte
    "Al\x1fbum",           # control char
    "Al\x7fbum",           # DEL
])
def test_invalid_title_raises_catalog_error(bad_title):
    album = _make_album(_UID_A, bad_title)
    with pytest.raises(CatalogError, match="title"):
        build_catalog_bytes([album], _PUBLISHED_AT)


def test_title_too_long_raises_catalog_error():
    long_title = "a" * 1025
    album = _make_album(_UID_A, long_title)
    with pytest.raises(CatalogError, match="title"):
        build_catalog_bytes([album], _PUBLISHED_AT)


def test_title_exactly_1024_code_points_accepted():
    title = "a" * 1024
    album = _make_album(_UID_A, title)
    data = build_catalog_bytes([album], _PUBLISHED_AT)
    catalog = json.loads(data)
    assert catalog["albums"][0]["title"] == title


# ---------------------------------------------------------------------------
# photoCount validation
# ---------------------------------------------------------------------------


def test_negative_photo_count_raises_catalog_error():
    album = _make_album(_UID_A, "Album", photo_count=-1)
    with pytest.raises(CatalogError, match="photoCount"):
        build_catalog_bytes([album], _PUBLISHED_AT)


def test_non_integer_photo_count_raises_catalog_error():
    album = _make_album(_UID_A, "Album", photo_count="42")
    with pytest.raises(CatalogError, match="photoCount"):
        build_catalog_bytes([album], _PUBLISHED_AT)


# ---------------------------------------------------------------------------
# updatedAt validation
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("bad_ts", [
    "not-a-date",
    "2026-06-26T00:00:00",       # missing Z
    "2026-06-26T00:00:00.000Z",  # milliseconds form not accepted in catalog
    "",
])
def test_invalid_updated_at_raises_catalog_error(bad_ts):
    album = _make_album(_UID_A, "Album", updated_at=bad_ts)
    with pytest.raises(CatalogError, match="updatedAt"):
        build_catalog_bytes([album], _PUBLISHED_AT)


# ---------------------------------------------------------------------------
# Output schema
# ---------------------------------------------------------------------------


def test_output_is_valid_utf8_json():
    album = _make_album(_UID_A, "日本語タイトル", photo_count=5, updated_at="2026-06-01T00:00:00Z")
    data = build_catalog_bytes([album], _PUBLISHED_AT)
    assert isinstance(data, bytes)
    catalog = json.loads(data.decode("utf-8"))
    assert catalog["schema"] == 1
    assert "日本語タイトル" in catalog["albums"][0]["title"]


def test_output_is_deterministic():
    albums = [
        _make_album(_UID_B, "Beta"),
        _make_album(_UID_A, "Alpha"),
    ]
    data1 = build_catalog_bytes(albums, _PUBLISHED_AT)
    data2 = build_catalog_bytes(albums, _PUBLISHED_AT)
    assert data1 == data2


def test_output_schema_fields():
    album = _make_album(_UID_A, "Test", photo_count=3, updated_at="2026-06-26T12:00:00Z")
    data = build_catalog_bytes([album], _PUBLISHED_AT)
    catalog = json.loads(data)
    assert set(catalog.keys()) == {"schema", "publishedAt", "albums"}
    entry = catalog["albums"][0]
    assert set(entry.keys()) == {"catalogId", "title", "photoCount", "updatedAt"}
