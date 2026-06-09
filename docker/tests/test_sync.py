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
