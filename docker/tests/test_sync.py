"""
Sync orchestration tests.

Uses an in-memory fake ObjectStore and httpx mock transport.
No network access, no real PhotoPrism, no real R2 required.
"""

import asyncio
import json
from datetime import datetime, timezone

import httpx
import pytest

from photo_gate.photoprism_client import PhotoPrismClient
from photo_gate.models import AlbumIdentity, ImageSettings

_sync_importable = True
try:
    from photo_gate.sync import sync_album
except (ImportError, OSError):
    _sync_importable = False

_FIXED_TS = datetime(2026, 6, 9, 9, 0, 0, tzinfo=timezone.utc)
_MANIFEST_KEY_SUFFIX = "manifest.json"

_ALBUM = AlbumIdentity(
    album_id="test-album",
    title="Test Album",
    photoprism_album_uid="uid_album001",
)

_SETTINGS = ImageSettings()


# ---------------------------------------------------------------------------
# Fake object store
# ---------------------------------------------------------------------------


class _FakeStore:
    """Records put calls in order. Supports pre-loaded objects for get()."""

    def __init__(
        self,
        fail_on_key: str | None = None,
        initial_objects: dict[str, bytes] | None = None,
        get_raises: bool = False,
    ):
        self._fail_on_key = fail_on_key
        self._objects: dict[str, bytes] = dict(initial_objects or {})
        self._get_raises = get_raises
        self.puts: list[tuple[str, str]] = []  # (key, content_type)

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        if self._fail_on_key and key.endswith(self._fail_on_key):
            raise RuntimeError(f"Injected failure for key {key!r}")
        self.puts.append((key, content_type))
        self._objects[key] = data

    async def get(self, key: str) -> bytes | None:
        if self._get_raises:
            raise RuntimeError("Injected get failure")
        return self._objects.get(key)

    async def delete(self, key: str) -> None:
        self._objects.pop(key, None)


# ---------------------------------------------------------------------------
# Fake image bytes (minimal valid JPEG for pyvips/Pillow)
# ---------------------------------------------------------------------------


def _tiny_jpeg() -> bytes:
    """Return a minimal 1×1 white JPEG created with Pillow."""
    try:
        import io
        from PIL import Image

        img = Image.new("RGB", (4, 4), color=(200, 200, 200))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=75)
        return buf.getvalue()
    except ImportError:
        # Pillow absent: return a pre-made 1×1 JPEG (SOI + minimal markers + EOI).
        # This path is tested only if Pillow is unavailable, which is unexpected.
        raise


# ---------------------------------------------------------------------------
# Mock transport helpers
# ---------------------------------------------------------------------------


class _MockTransport(httpx.AsyncBaseTransport):
    def __init__(self, handler):
        self._handler = handler

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        response = self._handler(request)
        response.request = request
        return response


def _make_photoprism_client(photos_json: list[dict], preview_bytes: bytes) -> PhotoPrismClient:
    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "/api/v1/photos" in url:
            return httpx.Response(
                200,
                headers={
                    "X-Preview-Token": "preview_tok",
                    "X-Count": str(len(photos_json)),
                    "X-Limit": "500",
                },
                content=json.dumps(photos_json).encode(),
            )
        if "/api/v1/t/" in url:
            return httpx.Response(
                200,
                headers={"content-type": "image/jpeg"},
                content=preview_bytes,
            )
        return httpx.Response(404, content=b"not found")

    transport = _MockTransport(handler)
    return PhotoPrismClient(
        base_url="http://photoprism.test",
        token="test-token",
        _transport=transport,
    )


def _photo_entry(uid: str, hash_val: str) -> dict:
    return {
        "UID": uid,
        "Hash": hash_val,
        "Title": "Test",
        "TakenAt": "2026-06-01T10:00:00Z",
        "Width": 4,
        "Height": 4,
    }


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


skip_no_pyvips = pytest.mark.skipif(
    not _sync_importable,
    reason="libvips not available — sync tests skipped",
)


@skip_no_pyvips
def test_manifest_is_final_upload():
    """Manifest must be the very last key uploaded."""
    photos_json = [
        _photo_entry("uid001abc", "1" * 40),
        _photo_entry("uid002abc", "2" * 40),
    ]
    preview = _tiny_jpeg()
    client = _make_photoprism_client(photos_json, preview)
    store = _FakeStore()

    async def run():
        async with client:
            await sync_album(client, _ALBUM, store, _SETTINGS, _FIXED_TS)

    asyncio.run(run())

    assert store.puts, "No uploads were recorded"
    last_key, last_ct = store.puts[-1]
    assert last_key.endswith(_MANIFEST_KEY_SUFFIX), (
        f"Expected manifest as last upload, got {last_key!r}"
    )
    assert last_ct == "application/json"


@skip_no_pyvips
def test_all_image_keys_uploaded_before_manifest():
    photos_json = [_photo_entry("uid001abc", "1" * 40)]
    preview = _tiny_jpeg()
    client = _make_photoprism_client(photos_json, preview)
    store = _FakeStore()

    async def run():
        async with client:
            await sync_album(client, _ALBUM, store, _SETTINGS, _FIXED_TS)

    asyncio.run(run())

    keys = [k for k, _ in store.puts]
    manifest_idx = next(i for i, k in enumerate(keys) if k.endswith(_MANIFEST_KEY_SUFFIX))
    for i, k in enumerate(keys):
        if not k.endswith(_MANIFEST_KEY_SUFFIX):
            assert i < manifest_idx, f"Image key {k!r} uploaded after manifest"


@skip_no_pyvips
def test_manifest_absent_after_image_upload_failure():
    """If any image upload fails, manifest must not be uploaded."""
    photos_json = [
        _photo_entry("uid001abc", "1" * 40),
        _photo_entry("uid002abc", "2" * 40),
    ]
    preview = _tiny_jpeg()
    client = _make_photoprism_client(photos_json, preview)
    # Inject failure when uploading uid001abc thumb
    store = _FakeStore(fail_on_key="thumbs/uid001abc.webp")

    async def run():
        async with client:
            await sync_album(client, _ALBUM, store, _SETTINGS, _FIXED_TS)

    with pytest.raises(Exception):
        asyncio.run(run())

    uploaded_keys = [k for k, _ in store.puts]
    manifest_keys = [k for k in uploaded_keys if k.endswith(_MANIFEST_KEY_SUFFIX)]
    assert not manifest_keys, (
        f"Manifest was uploaded despite image upload failure: {manifest_keys}"
    )


@skip_no_pyvips
def test_sync_empty_album_uploads_empty_manifest():
    """An empty album should still produce a manifest with zero photos."""
    client = _make_photoprism_client([], b"")
    store = _FakeStore()

    async def run():
        async with client:
            await sync_album(client, _ALBUM, store, _SETTINGS, _FIXED_TS)

    asyncio.run(run())

    assert len(store.puts) == 1
    manifest_key, ct = store.puts[0]
    assert manifest_key.endswith(_MANIFEST_KEY_SUFFIX)
    assert ct == "application/json"


@skip_no_pyvips
def test_r2_keys_use_album_id_and_photo_uid():
    photos_json = [_photo_entry("uid001abc", "1" * 40)]
    preview = _tiny_jpeg()
    client = _make_photoprism_client(photos_json, preview)
    store = _FakeStore()

    async def run():
        async with client:
            await sync_album(client, _ALBUM, store, _SETTINGS, _FIXED_TS)

    asyncio.run(run())

    keys = [k for k, _ in store.puts]
    assert any("test-album/thumbs/uid001abc.webp" in k for k in keys)
    assert any("test-album/previews/uid001abc.jpg" in k for k in keys)
    assert any("test-album/manifest.json" in k for k in keys)


def _make_size_aware_client(photos_json: list[dict], by_size: dict[str, bytes]) -> PhotoPrismClient:
    """PhotoPrism fake that serves different bytes per requested size."""
    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "/api/v1/photos" in url:
            return httpx.Response(
                200,
                headers={
                    "X-Preview-Token": "preview_tok",
                    "X-Count": str(len(photos_json)),
                    "X-Limit": "500",
                },
                content=json.dumps(photos_json).encode(),
            )
        if "/api/v1/t/" in url:
            size = url.rstrip("/").rsplit("/", 1)[-1]
            return httpx.Response(
                200,
                headers={"content-type": "image/jpeg"},
                content=by_size[size],
            )
        return httpx.Response(404, content=b"not found")

    return PhotoPrismClient(
        base_url="http://photoprism.test",
        token="test-token",
        _transport=_MockTransport(handler),
    )


def _jpeg_of_size(width: int, height: int) -> bytes:
    import io
    from PIL import Image

    img = Image.new("RGB", (width, height), color=(120, 140, 160))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=75)
    return buf.getvalue()


def _large_photo_entry(uid: str, hash_val: str) -> dict:
    entry = _photo_entry(uid, hash_val)
    entry["Width"] = 4000
    entry["Height"] = 3000
    return entry


@skip_no_pyvips
def test_sync_fails_closed_on_placeholder_preview():
    """
    Regression: PhotoPrism answers 200 image/jpeg with a tiny placeholder
    when its thumbnail settings cannot serve the requested size. The first
    production sync uploaded 234 such 24x24 "previews"; sync must fail and
    withhold the manifest instead.
    """
    photos_json = [_large_photo_entry("uid001abc", "1" * 40)]
    client = _make_size_aware_client(
        photos_json,
        {"fit_720": _jpeg_of_size(720, 540), "fit_3840": _jpeg_of_size(24, 24)},
    )
    store = _FakeStore()

    async def run():
        async with client:
            await sync_album(client, _ALBUM, store, _SETTINGS, _FIXED_TS)

    with pytest.raises(BaseExceptionGroup) as excinfo:
        asyncio.run(run())
    assert "undersized" in repr(excinfo.value.exceptions)

    uploaded_keys = [k for k, _ in store.puts]
    assert not any(k.endswith(_MANIFEST_KEY_SUFFIX) for k in uploaded_keys), (
        "Manifest must not be uploaded when previews are placeholders"
    )


@skip_no_pyvips
def test_sync_fails_closed_on_placeholder_thumb_source():
    photos_json = [_large_photo_entry("uid001abc", "1" * 40)]
    client = _make_size_aware_client(
        photos_json,
        {"fit_720": _jpeg_of_size(24, 24), "fit_3840": _jpeg_of_size(3840, 2880)},
    )
    store = _FakeStore()

    async def run():
        async with client:
            await sync_album(client, _ALBUM, store, _SETTINGS, _FIXED_TS)

    with pytest.raises(BaseExceptionGroup):
        asyncio.run(run())
    assert not any(k.endswith(_MANIFEST_KEY_SUFFIX) for k, _ in store.puts)


@skip_no_pyvips
def test_sync_accepts_moderately_smaller_source():
    """A legit source somewhat below the requested size (e.g. a 2048px
    cached thumb for fit_3840 on a 4000px photo) must be accepted."""
    photos_json = [_large_photo_entry("uid001abc", "1" * 40)]
    client = _make_size_aware_client(
        photos_json,
        {"fit_720": _jpeg_of_size(720, 540), "fit_3840": _jpeg_of_size(2048, 1536)},
    )
    store = _FakeStore()

    async def run():
        async with client:
            await sync_album(client, _ALBUM, store, _SETTINGS, _FIXED_TS)

    asyncio.run(run())
    assert any(k.endswith(_MANIFEST_KEY_SUFFIX) for k, _ in store.puts)


@skip_no_pyvips
def test_sync_uses_configured_preview_source_size():
    photos_json = [_large_photo_entry("uid001abc", "1" * 40)]
    client = _make_size_aware_client(
        photos_json,
        {"fit_720": _jpeg_of_size(720, 540), "fit_2048": _jpeg_of_size(2048, 1536)},
    )
    store = _FakeStore()

    async def run():
        async with client:
            await sync_album(
                client, _ALBUM, store, _SETTINGS, _FIXED_TS,
                preview_source_size="fit_2048",
            )

    asyncio.run(run())
    assert any(k.endswith(_MANIFEST_KEY_SUFFIX) for k, _ in store.puts)


@skip_no_pyvips
def test_sync_rejects_unknown_preview_source_size():
    client = _make_photoprism_client([], b"")
    store = _FakeStore()

    async def run():
        async with client:
            await sync_album(
                client, _ALBUM, store, _SETTINGS, _FIXED_TS,
                preview_source_size="original",
            )

    with pytest.raises(ValueError, match="preview_source_size"):
        asyncio.run(run())


@skip_no_pyvips
def test_sync_rejects_non_positive_concurrency():
    client = _make_photoprism_client([], b"")
    store = _FakeStore()

    async def run():
        async with client:
            await sync_album(
                client, _ALBUM, store, _SETTINGS, _FIXED_TS, concurrency=0
            )

    with pytest.raises(ValueError, match="concurrency"):
        asyncio.run(run())


# ---------------------------------------------------------------------------
# Cover generation tests
# ---------------------------------------------------------------------------


@skip_no_pyvips
def test_cover_uploaded_for_non_empty_album():
    """sync_album must upload a cover.webp for a non-empty album."""
    photos_json = [_photo_entry("uid001abc", "1" * 40)]
    preview = _tiny_jpeg()
    client = _make_photoprism_client(photos_json, preview)
    store = _FakeStore()

    async def run():
        async with client:
            await sync_album(client, _ALBUM, store, _SETTINGS, _FIXED_TS)

    asyncio.run(run())

    keys = [k for k, _ in store.puts]
    cover_puts = [(k, ct) for k, ct in store.puts if "cover.webp" in k]
    assert cover_puts, f"No cover.webp uploaded; keys={keys}"
    cover_key, cover_ct = cover_puts[0]
    assert "test-album/cover.webp" in cover_key
    assert cover_ct == "image/webp"


@skip_no_pyvips
def test_cover_uploaded_before_manifest():
    """Cover must be uploaded before the manifest."""
    photos_json = [_photo_entry("uid001abc", "1" * 40)]
    preview = _tiny_jpeg()
    client = _make_photoprism_client(photos_json, preview)
    store = _FakeStore()

    async def run():
        async with client:
            await sync_album(client, _ALBUM, store, _SETTINGS, _FIXED_TS)

    asyncio.run(run())

    keys = [k for k, _ in store.puts]
    cover_idx = next((i for i, k in enumerate(keys) if "cover.webp" in k), None)
    manifest_idx = next((i for i, k in enumerate(keys) if k.endswith(_MANIFEST_KEY_SUFFIX)), None)
    assert cover_idx is not None, "No cover.webp found in uploads"
    assert manifest_idx is not None, "No manifest found in uploads"
    assert cover_idx < manifest_idx, (
        f"Cover (idx={cover_idx}) must be uploaded before manifest (idx={manifest_idx})"
    )


@skip_no_pyvips
def test_empty_album_uploads_manifest_only_no_cover():
    """An empty album must not produce a cover upload — only the manifest."""
    client = _make_photoprism_client([], b"")
    store = _FakeStore()

    async def run():
        async with client:
            await sync_album(client, _ALBUM, store, _SETTINGS, _FIXED_TS)

    asyncio.run(run())

    assert len(store.puts) == 1, f"Expected exactly 1 put (manifest), got {store.puts}"
    manifest_key, ct = store.puts[0]
    assert manifest_key.endswith(_MANIFEST_KEY_SUFFIX)
    assert ct == "application/json"
    cover_puts = [k for k, _ in store.puts if "cover.webp" in k]
    assert not cover_puts, f"Unexpected cover upload for empty album: {cover_puts}"


@skip_no_pyvips
def test_cover_upload_failure_withholds_manifest():
    """If the cover upload fails, manifest must not be uploaded."""
    photos_json = [_photo_entry("uid001abc", "1" * 40)]
    preview = _tiny_jpeg()
    client = _make_photoprism_client(photos_json, preview)
    store = _FakeStore(fail_on_key="cover.webp")

    async def run():
        async with client:
            await sync_album(client, _ALBUM, store, _SETTINGS, _FIXED_TS)

    with pytest.raises(Exception):
        asyncio.run(run())

    uploaded_keys = [k for k, _ in store.puts]
    manifest_keys = [k for k in uploaded_keys if k.endswith(_MANIFEST_KEY_SUFFIX)]
    assert not manifest_keys, (
        f"Manifest was uploaded despite cover failure: {manifest_keys}"
    )


@skip_no_pyvips
def test_cover_uses_first_photo_thumb_source():
    """Cover must be derived from the FIRST photo, not any subsequent one."""
    import io
    from PIL import Image

    # First photo: 700x700 square -> after thumb processing (max edge 640): 640x640
    # Second photo: 700x350 landscape -> after thumb processing: 640x320
    # The outputs are distinguishable by their aspect ratio / dimensions.
    hash1 = "1" * 40
    hash2 = "2" * 40

    photos_json = [
        _photo_entry("uid001abc", hash1),
        _photo_entry("uid002abc", hash2),
    ]
    # Update dimensions in photo entries so plausibility check passes
    photos_json[0]["Width"] = 700
    photos_json[0]["Height"] = 700
    photos_json[1]["Width"] = 700
    photos_json[1]["Height"] = 350

    first_jpeg = _jpeg_of_size(700, 700)   # square
    second_jpeg = _jpeg_of_size(700, 350)  # landscape

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "/api/v1/photos" in url:
            return httpx.Response(
                200,
                headers={
                    "X-Preview-Token": "preview_tok",
                    "X-Count": str(len(photos_json)),
                    "X-Limit": "500",
                },
                content=json.dumps(photos_json).encode(),
            )
        if "/api/v1/t/" in url:
            # URL pattern: /api/v1/t/<hash>/<token>/<size>
            parts = url.rstrip("/").split("/")
            photo_hash = parts[-3]
            if photo_hash == hash1:
                return httpx.Response(200, headers={"content-type": "image/jpeg"}, content=first_jpeg)
            if photo_hash == hash2:
                return httpx.Response(200, headers={"content-type": "image/jpeg"}, content=second_jpeg)
        return httpx.Response(404, content=b"not found")

    client = PhotoPrismClient(
        base_url="http://photoprism.test",
        token="test-token",
        _transport=_MockTransport(handler),
    )

    class _DataCapturingStore:
        """Like _FakeStore but also records raw bytes per key."""
        def __init__(self):
            self.puts: list[tuple[str, str]] = []
            self.data: dict[str, bytes] = {}

        async def put(self, key: str, data: bytes, content_type: str) -> None:
            self.puts.append((key, content_type))
            self.data[key] = data

    store = _DataCapturingStore()

    async def run():
        async with client:
            await sync_album(client, _ALBUM, store, _SETTINGS, _FIXED_TS)

    asyncio.run(run())

    cover_key = f"albums/{_ALBUM.album_id}/cover.webp"
    assert cover_key in store.data, f"Cover not uploaded; keys={list(store.data)}"

    cover_img = Image.open(io.BytesIO(store.data[cover_key]))
    w, h = cover_img.size
    # First photo was 700x700 square; after thumb (max long edge 640): 640x640
    # Verify it's roughly square (within 5% tolerance)
    assert w == h, (
        f"Cover should be square (from first photo 700x700), got {w}x{h}"
    )


# ---------------------------------------------------------------------------
# Reupload suppression tests
# ---------------------------------------------------------------------------


def _schema2_manifest(
    album_id: str,
    album_uid: str,
    photos: list[tuple[str, str]],  # (uid, source_hash)
    settings: ImageSettings | None = None,
) -> bytes:
    """Build a valid schema 2 manifest as bytes for pre-loading into _FakeStore."""
    s = settings or _SETTINGS
    doc = {
        "schemaVersion": 2,
        "albumId": album_id,
        "title": "Test Album",
        "source": {"type": "photoprism", "albumUid": album_uid},
        "generatedAt": "2026-06-09T09:00:00+00:00",
        "images": {
            "thumb": {
                "longEdge": s.thumb.long_edge,
                "format": s.thumb.format,
                "quality": s.thumb.quality,
            },
            "preview": {
                "longEdge": s.preview.long_edge,
                "format": s.preview.format,
                "quality": s.preview.quality,
            },
            "stripExif": True,
        },
        "photos": [
            {
                "id": uid,
                "sourceHash": source_hash,
                "title": "Test",
                "thumb": f"thumbs/{uid}.webp",
                "preview": f"previews/{uid}.jpg",
                "takenAt": "2026-06-01T10:00:00+00:00",
                "width": 4,
                "height": 4,
            }
            for uid, source_hash in photos
        ],
    }
    return json.dumps(doc).encode("utf-8")


def _make_tracking_client(
    photos_json: list[dict], preview_bytes: bytes
) -> tuple["PhotoPrismClient", list[str]]:
    """Like _make_photoprism_client but also records hashes requested for /api/v1/t/."""
    download_hashes: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "/api/v1/photos" in url:
            return httpx.Response(
                200,
                headers={
                    "X-Preview-Token": "preview_tok",
                    "X-Count": str(len(photos_json)),
                    "X-Limit": "500",
                },
                content=json.dumps(photos_json).encode(),
            )
        if "/api/v1/t/" in url:
            parts = url.rstrip("/").split("/")
            download_hashes.append(parts[-3])
            return httpx.Response(
                200,
                headers={"content-type": "image/jpeg"},
                content=preview_bytes,
            )
        return httpx.Response(404, content=b"not found")

    client = PhotoPrismClient(
        base_url="http://photoprism.test",
        token="test-token",
        _transport=_MockTransport(handler),
    )
    return client, download_hashes


@skip_no_pyvips
def test_unchanged_photo_not_downloaded():
    """When a photo's hash matches the previous schema 2 manifest, no download is issued."""
    uid = "uid001abc"
    hash_val = "1" * 40
    photos_json = [_photo_entry(uid, hash_val)]
    prev_manifest = _schema2_manifest(
        _ALBUM.album_id, _ALBUM.photoprism_album_uid, [(uid, hash_val)]
    )
    store = _FakeStore(initial_objects={f"albums/{_ALBUM.album_id}/manifest.json": prev_manifest})
    client, download_hashes = _make_tracking_client(photos_json, _tiny_jpeg())

    async def run():
        async with client:
            await sync_album(client, _ALBUM, store, _SETTINGS, _FIXED_TS)

    asyncio.run(run())

    # Cover still requires one download (cover photo = first photo)
    # No thumb/preview download for the skipped photo
    photo_downloads = [h for h in download_hashes if h == hash_val]
    assert len(photo_downloads) == 1, (
        f"Expected exactly 1 download (cover), got {len(photo_downloads)}: {download_hashes}"
    )


@skip_no_pyvips
def test_unchanged_photo_thumb_preview_not_put():
    """Skipped photo thumb and preview must not be PUT to the store."""
    uid = "uid001abc"
    hash_val = "1" * 40
    photos_json = [_photo_entry(uid, hash_val)]
    prev_manifest = _schema2_manifest(
        _ALBUM.album_id, _ALBUM.photoprism_album_uid, [(uid, hash_val)]
    )
    store = _FakeStore(initial_objects={f"albums/{_ALBUM.album_id}/manifest.json": prev_manifest})
    client = _make_photoprism_client(photos_json, _tiny_jpeg())

    async def run():
        async with client:
            await sync_album(client, _ALBUM, store, _SETTINGS, _FIXED_TS)

    asyncio.run(run())

    put_keys = [k for k, _ in store.puts]
    assert not any(f"thumbs/{uid}" in k for k in put_keys), (
        f"Thumb was PUT for skipped photo: {put_keys}"
    )
    assert not any(f"previews/{uid}" in k for k in put_keys), (
        f"Preview was PUT for skipped photo: {put_keys}"
    )


@skip_no_pyvips
def test_all_skipped_cover_still_uploaded():
    """Cover must be regenerated and PUT even when all photo thumb/preview pairs are skipped."""
    uid = "uid001abc"
    hash_val = "1" * 40
    photos_json = [_photo_entry(uid, hash_val)]
    prev_manifest = _schema2_manifest(
        _ALBUM.album_id, _ALBUM.photoprism_album_uid, [(uid, hash_val)]
    )
    store = _FakeStore(initial_objects={f"albums/{_ALBUM.album_id}/manifest.json": prev_manifest})
    client = _make_photoprism_client(photos_json, _tiny_jpeg())

    async def run():
        async with client:
            await sync_album(client, _ALBUM, store, _SETTINGS, _FIXED_TS)

    asyncio.run(run())

    put_keys = [k for k, _ in store.puts]
    assert any("cover.webp" in k for k in put_keys), (
        f"Cover.webp was not uploaded despite non-empty album: {put_keys}"
    )


@skip_no_pyvips
def test_all_skipped_manifest_still_final():
    """Manifest must be uploaded as the last PUT even when all photo pairs are skipped."""
    uid = "uid001abc"
    hash_val = "1" * 40
    photos_json = [_photo_entry(uid, hash_val)]
    prev_manifest = _schema2_manifest(
        _ALBUM.album_id, _ALBUM.photoprism_album_uid, [(uid, hash_val)]
    )
    store = _FakeStore(initial_objects={f"albums/{_ALBUM.album_id}/manifest.json": prev_manifest})
    client = _make_photoprism_client(photos_json, _tiny_jpeg())

    async def run():
        async with client:
            await sync_album(client, _ALBUM, store, _SETTINGS, _FIXED_TS)

    asyncio.run(run())

    assert store.puts, "No uploads recorded"
    last_key, last_ct = store.puts[-1]
    assert last_key.endswith("manifest.json"), (
        f"Expected manifest as last upload, got {last_key!r}"
    )
    assert last_ct == "application/json"


@skip_no_pyvips
def test_partial_skip():
    """Changed photos are processed; only matching-hash photos are skipped."""
    uid_a = "uid001abc"
    uid_b = "uid002abc"
    hash_a = "1" * 40
    hash_b_old = "2" * 40
    hash_b_new = "3" * 40

    photos_json = [
        _photo_entry(uid_a, hash_a),   # same hash → skip
        _photo_entry(uid_b, hash_b_new),  # changed hash → process
    ]
    prev_manifest = _schema2_manifest(
        _ALBUM.album_id, _ALBUM.photoprism_album_uid,
        [(uid_a, hash_a), (uid_b, hash_b_old)],
    )
    store = _FakeStore(initial_objects={f"albums/{_ALBUM.album_id}/manifest.json": prev_manifest})
    client = _make_photoprism_client(photos_json, _tiny_jpeg())

    async def run():
        async with client:
            await sync_album(client, _ALBUM, store, _SETTINGS, _FIXED_TS)

    asyncio.run(run())

    put_keys = [k for k, _ in store.puts]
    assert not any(f"thumbs/{uid_a}" in k for k in put_keys), (
        f"Skipped photo {uid_a!r} thumb was PUT: {put_keys}"
    )
    assert not any(f"previews/{uid_a}" in k for k in put_keys), (
        f"Skipped photo {uid_a!r} preview was PUT: {put_keys}"
    )
    assert any(f"thumbs/{uid_b}" in k for k in put_keys), (
        f"Changed photo {uid_b!r} thumb was not PUT: {put_keys}"
    )
    assert any(f"previews/{uid_b}" in k for k in put_keys), (
        f"Changed photo {uid_b!r} preview was not PUT: {put_keys}"
    )
    assert put_keys[-1].endswith("manifest.json"), "Manifest must be last upload"


@skip_no_pyvips
def test_cache_miss_schema_1_manifest():
    """A schema 1 previous manifest must be treated as a cache miss (all photos processed)."""
    uid = "uid001abc"
    hash_val = "1" * 40
    photos_json = [_photo_entry(uid, hash_val)]
    schema1_manifest = json.dumps({
        "schemaVersion": 1,
        "albumId": _ALBUM.album_id,
        "source": {"type": "photoprism", "albumUid": _ALBUM.photoprism_album_uid},
        "generatedAt": "2026-06-09T09:00:00+00:00",
        "images": {
            "thumb": {"longEdge": 640, "format": "webp", "quality": 80},
            "preview": {"longEdge": 3840, "format": "jpg", "quality": 88},
            "stripExif": True,
        },
        "photos": [{"id": uid, "thumb": f"thumbs/{uid}.webp", "preview": f"previews/{uid}.jpg"}],
    }).encode()
    store = _FakeStore(initial_objects={f"albums/{_ALBUM.album_id}/manifest.json": schema1_manifest})
    client = _make_photoprism_client(photos_json, _tiny_jpeg())

    async def run():
        async with client:
            await sync_album(client, _ALBUM, store, _SETTINGS, _FIXED_TS)

    asyncio.run(run())

    put_keys = [k for k, _ in store.puts]
    assert any(f"thumbs/{uid}" in k for k in put_keys), (
        "Photo should be processed (cache miss) when prev manifest is schema 1"
    )


@skip_no_pyvips
def test_cache_miss_malformed_json():
    """Malformed JSON previous manifest must be treated as a cache miss."""
    uid = "uid001abc"
    hash_val = "1" * 40
    photos_json = [_photo_entry(uid, hash_val)]
    store = _FakeStore(
        initial_objects={f"albums/{_ALBUM.album_id}/manifest.json": b"not json {{{"}
    )
    client = _make_photoprism_client(photos_json, _tiny_jpeg())

    async def run():
        async with client:
            await sync_album(client, _ALBUM, store, _SETTINGS, _FIXED_TS)

    asyncio.run(run())

    put_keys = [k for k, _ in store.puts]
    assert any(f"thumbs/{uid}" in k for k in put_keys), (
        "Photo should be processed when prev manifest is malformed JSON"
    )


@skip_no_pyvips
def test_cache_miss_wrong_album_id():
    """A previous manifest with a different albumId must be treated as a cache miss."""
    uid = "uid001abc"
    hash_val = "1" * 40
    photos_json = [_photo_entry(uid, hash_val)]
    prev_manifest = _schema2_manifest(
        "different-album", _ALBUM.photoprism_album_uid, [(uid, hash_val)]
    )
    store = _FakeStore(initial_objects={f"albums/{_ALBUM.album_id}/manifest.json": prev_manifest})
    client = _make_photoprism_client(photos_json, _tiny_jpeg())

    async def run():
        async with client:
            await sync_album(client, _ALBUM, store, _SETTINGS, _FIXED_TS)

    asyncio.run(run())

    put_keys = [k for k, _ in store.puts]
    assert any(f"thumbs/{uid}" in k for k in put_keys), (
        "Photo should be processed when albumId mismatches"
    )


@skip_no_pyvips
def test_cache_miss_store_get_exception():
    """A store.get exception must not propagate; sync proceeds as a full cache miss."""
    uid = "uid001abc"
    hash_val = "1" * 40
    photos_json = [_photo_entry(uid, hash_val)]
    store = _FakeStore(get_raises=True)
    client = _make_photoprism_client(photos_json, _tiny_jpeg())

    async def run():
        async with client:
            await sync_album(client, _ALBUM, store, _SETTINGS, _FIXED_TS)

    asyncio.run(run())  # must not raise

    put_keys = [k for k, _ in store.puts]
    assert any(f"thumbs/{uid}" in k for k in put_keys), (
        "Photo should be processed when store.get raises"
    )
    assert put_keys[-1].endswith("manifest.json")


@skip_no_pyvips
def test_cache_miss_duplicate_uid_in_prev_manifest():
    """Duplicate photo UIDs in the previous manifest invalidate it as a cache miss."""
    uid = "uid001abc"
    hash_val = "1" * 40
    photos_json = [_photo_entry(uid, hash_val)]
    doc = {
        "schemaVersion": 2,
        "albumId": _ALBUM.album_id,
        "title": "Test",
        "source": {"type": "photoprism", "albumUid": _ALBUM.photoprism_album_uid},
        "generatedAt": "2026-06-09T09:00:00+00:00",
        "images": {
            "thumb": {"longEdge": 640, "format": "webp", "quality": 80},
            "preview": {"longEdge": 3840, "format": "jpg", "quality": 88},
            "stripExif": True,
        },
        "photos": [
            {"id": uid, "sourceHash": hash_val, "thumb": f"thumbs/{uid}.webp", "preview": f"previews/{uid}.jpg"},
            {"id": uid, "sourceHash": hash_val, "thumb": f"thumbs/{uid}.webp", "preview": f"previews/{uid}.jpg"},
        ],
    }
    store = _FakeStore(
        initial_objects={f"albums/{_ALBUM.album_id}/manifest.json": json.dumps(doc).encode()}
    )
    client = _make_photoprism_client(photos_json, _tiny_jpeg())

    async def run():
        async with client:
            await sync_album(client, _ALBUM, store, _SETTINGS, _FIXED_TS)

    asyncio.run(run())

    put_keys = [k for k, _ in store.puts]
    assert any(f"thumbs/{uid}" in k for k in put_keys), (
        "Photo should be processed when prev manifest has duplicate UIDs"
    )


@skip_no_pyvips
def test_manifest_schema_version_is_two():
    """The uploaded manifest must be schemaVersion 2."""
    uid = "uid001abc"
    hash_val = "1" * 40
    photos_json = [_photo_entry(uid, hash_val)]
    client = _make_photoprism_client(photos_json, _tiny_jpeg())

    class _CapturingStore(_FakeStore):
        def __init__(self):
            super().__init__()
            self.manifest_bytes: bytes | None = None

        async def put(self, key: str, data: bytes, content_type: str) -> None:
            await super().put(key, data, content_type)
            if key.endswith("manifest.json"):
                self.manifest_bytes = data

    store = _CapturingStore()

    async def run():
        async with client:
            await sync_album(client, _ALBUM, store, _SETTINGS, _FIXED_TS)

    asyncio.run(run())

    assert store.manifest_bytes is not None
    doc = json.loads(store.manifest_bytes)
    assert doc["schemaVersion"] == 2, f"Expected schemaVersion 2, got {doc.get('schemaVersion')}"


@skip_no_pyvips
def test_manifest_photo_entry_has_source_hash():
    """Each photo entry in the uploaded manifest must include sourceHash."""
    uid = "uid001abc"
    hash_val = "1" * 40
    photos_json = [_photo_entry(uid, hash_val)]
    client = _make_photoprism_client(photos_json, _tiny_jpeg())

    class _CapturingStore(_FakeStore):
        def __init__(self):
            super().__init__()
            self.manifest_bytes: bytes | None = None

        async def put(self, key: str, data: bytes, content_type: str) -> None:
            await super().put(key, data, content_type)
            if key.endswith("manifest.json"):
                self.manifest_bytes = data

    store = _CapturingStore()

    async def run():
        async with client:
            await sync_album(client, _ALBUM, store, _SETTINGS, _FIXED_TS)

    asyncio.run(run())

    assert store.manifest_bytes is not None
    doc = json.loads(store.manifest_bytes)
    assert doc["photos"], "Expected at least one photo entry"
    entry = doc["photos"][0]
    assert "sourceHash" in entry, f"sourceHash missing from photo entry: {entry}"
    assert entry["sourceHash"] == hash_val
