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
    """Records put calls in order."""

    def __init__(self, fail_on_key: str | None = None):
        self._fail_on_key = fail_on_key
        self.puts: list[tuple[str, str]] = []  # (key, content_type)

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        if self._fail_on_key and key.endswith(self._fail_on_key):
            raise RuntimeError(f"Injected failure for key {key!r}")
        self.puts.append((key, content_type))


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
