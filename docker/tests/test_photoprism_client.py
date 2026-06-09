import asyncio
import json

import httpx
import pytest

from photo_gate.photoprism_client import PhotoPrismClient, PhotoPrismError


class _MockTransport(httpx.AsyncBaseTransport):
    """Minimal async transport driven by a handler callable."""

    def __init__(self, handler):
        self._handler = handler

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        response = self._handler(request)
        response.request = request
        return response


def _make_client(handler, base_url="http://photoprism.test", page_size=2):
    transport = _MockTransport(handler)
    return PhotoPrismClient(
        base_url=base_url,
        token="test-token",
        page_size=page_size,
        _transport=transport,
    )


def _photo_json(uid, hash_val, title="Photo", taken_at="2026-06-01T10:00:00Z"):
    return {
        "UID": uid,
        "Hash": hash_val,
        "Title": title,
        "TakenAt": taken_at,
        "Width": 3840,
        "Height": 2560,
    }


# ---------------------------------------------------------------------------
# list_album_photos — single page
# ---------------------------------------------------------------------------


def test_list_photos_single_page():
    photos = [_photo_json("uid001aaa", "a" * 40)]

    def handler(request: httpx.Request) -> httpx.Response:
        assert "/api/v1/photos" in str(request.url)
        return httpx.Response(
            200,
            headers={"X-Preview-Token": "tok_xyz", "X-Count": "1", "X-Limit": "2"},
            content=json.dumps(photos).encode(),
        )

    async def run():
        async with _make_client(handler) as client:
            result, token = await client.list_album_photos("albumUid001")
        assert len(result) == 1
        assert result[0].uid == "uid001aaa"
        assert result[0].hash == "a" * 40
        assert token == "tok_xyz"

    asyncio.run(run())


def test_list_photos_pagination():
    """Continues when X-Count == X-Limit; stops when X-Count < X-Limit."""
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        offset = int(request.url.params.get("offset", 0))
        calls.append(offset)
        if offset == 0:
            body = [_photo_json("uid001abc", "1" * 40), _photo_json("uid002abc", "2" * 40)]
            return httpx.Response(
                200,
                headers={"X-Preview-Token": "tok_p", "X-Count": "2", "X-Limit": "2"},
                content=json.dumps(body).encode(),
            )
        else:
            body = [_photo_json("uid003abc", "3" * 40)]
            return httpx.Response(
                200,
                headers={"X-Preview-Token": "tok_p", "X-Count": "1", "X-Limit": "2"},
                content=json.dumps(body).encode(),
            )

    async def run():
        async with _make_client(handler) as client:
            result, token = await client.list_album_photos("albumUid001")
        assert calls == [0, 2]
        assert len(result) == 3
        assert {p.uid for p in result} == {"uid001abc", "uid002abc", "uid003abc"}

    asyncio.run(run())


def test_list_photos_requires_preview_token():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"X-Count": "0", "X-Limit": "2"},
            content=b"[]",
        )

    async def run():
        with pytest.raises(PhotoPrismError, match="X-Preview-Token"):
            async with _make_client(handler) as client:
                await client.list_album_photos("albumUid001")

    asyncio.run(run())


def test_list_photos_rejects_missing_uid():
    def handler(request: httpx.Request) -> httpx.Response:
        body = [{"Hash": "a" * 40, "TakenAt": "2026-01-01T00:00:00Z"}]
        return httpx.Response(
            200,
            headers={"X-Preview-Token": "tok", "X-Count": "1", "X-Limit": "2"},
            content=json.dumps(body).encode(),
        )

    async def run():
        with pytest.raises(PhotoPrismError, match="UID"):
            async with _make_client(handler) as client:
                await client.list_album_photos("albumUid001")

    asyncio.run(run())


def test_list_photos_rejects_missing_hash():
    def handler(request: httpx.Request) -> httpx.Response:
        body = [{"UID": "uid001abc", "TakenAt": "2026-01-01T00:00:00Z"}]
        return httpx.Response(
            200,
            headers={"X-Preview-Token": "tok", "X-Count": "1", "X-Limit": "2"},
            content=json.dumps(body).encode(),
        )

    async def run():
        with pytest.raises(PhotoPrismError, match="Hash"):
            async with _make_client(handler) as client:
                await client.list_album_photos("albumUid001")

    asyncio.run(run())


def test_list_photos_rejects_unsafe_uid():
    def handler(request: httpx.Request) -> httpx.Response:
        body = [_photo_json("../../evil", "a" * 40)]
        return httpx.Response(
            200,
            headers={"X-Preview-Token": "tok", "X-Count": "1", "X-Limit": "2"},
            content=json.dumps(body).encode(),
        )

    async def run():
        with pytest.raises(PhotoPrismError, match="unsafe"):
            async with _make_client(handler) as client:
                await client.list_album_photos("albumUid001")

    asyncio.run(run())


def test_list_photos_http_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, content=b"Unauthorized")

    async def run():
        with pytest.raises(PhotoPrismError, match="401"):
            async with _make_client(handler) as client:
                await client.list_album_photos("albumUid001")

    asyncio.run(run())


def test_list_photos_rejects_malformed_entry():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"X-Preview-Token": "tok", "X-Count": "1", "X-Limit": "2"},
            content=b'["not-an-object"]',
        )

    async def run():
        with pytest.raises(PhotoPrismError, match="malformed"):
            async with _make_client(handler) as client:
                await client.list_album_photos("albumUid001")

    asyncio.run(run())


def test_client_rejects_non_positive_page_size():
    with pytest.raises(ValueError, match="page_size"):
        _make_client(lambda request: None, page_size=0)


def test_list_photos_sends_authorization_header():
    received: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        received.append(request.headers.get("authorization", ""))
        return httpx.Response(
            200,
            headers={"X-Preview-Token": "tok", "X-Count": "0", "X-Limit": "2"},
            content=b"[]",
        )

    async def run():
        async with _make_client(handler) as client:
            await client.list_album_photos("albumUid001")
        assert received[0] == "Bearer test-token"

    asyncio.run(run())


def test_list_photos_sends_cf_access_headers():
    received_headers: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        received_headers["cf-id"] = request.headers.get("CF-Access-Client-Id", "")
        received_headers["cf-secret"] = request.headers.get(
            "CF-Access-Client-Secret", ""
        )
        return httpx.Response(
            200,
            headers={"X-Preview-Token": "tok", "X-Count": "0", "X-Limit": "2"},
            content=b"[]",
        )

    async def run():
        transport = _MockTransport(handler)
        client = PhotoPrismClient(
            base_url="http://photoprism.test",
            token="tok",
            cf_client_id="cf-id-value",
            cf_client_secret="cf-secret-value",
            _transport=transport,
        )
        async with client:
            await client.list_album_photos("albumUid001")
        assert received_headers["cf-id"] == "cf-id-value"
        assert received_headers["cf-secret"] == "cf-secret-value"

    asyncio.run(run())


# ---------------------------------------------------------------------------
# download_preview
# ---------------------------------------------------------------------------


def test_download_preview_returns_bytes():
    image_bytes = b"\xff\xd8\xff\xe0" + b"\x00" * 100

    def handler(request: httpx.Request) -> httpx.Response:
        assert "fit_720" in str(request.url)
        return httpx.Response(
            200,
            headers={"content-type": "image/jpeg"},
            content=image_bytes,
        )

    async def run():
        async with _make_client(handler) as client:
            result = await client.download_preview("a" * 40, "tok_preview", "fit_720")
        assert result == image_bytes

    asyncio.run(run())


def test_download_preview_rejects_disallowed_size():
    async def run():
        with pytest.raises(ValueError, match="allowlist"):
            async with _make_client(lambda r: None) as client:
                await client.download_preview("a" * 40, "tok", "fit_1920")

    asyncio.run(run())


def test_download_preview_rejects_non_hex_hash():
    async def run():
        with pytest.raises(ValueError, match="hex"):
            async with _make_client(lambda r: None) as client:
                await client.download_preview("not-a-hash!!", "tok", "fit_720")

    asyncio.run(run())


def test_download_preview_rejects_http_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, content=b"not found")

    async def run():
        with pytest.raises(PhotoPrismError, match="404"):
            async with _make_client(handler) as client:
                await client.download_preview("b" * 40, "tok", "fit_3840")

    asyncio.run(run())


def test_download_preview_rejects_non_image_content_type():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "text/html"},
            content=b"<html></html>",
        )

    async def run():
        with pytest.raises(PhotoPrismError, match="content-type"):
            async with _make_client(handler) as client:
                await client.download_preview("c" * 40, "tok", "fit_720")

    asyncio.run(run())


def test_error_message_excludes_token():
    """Token must not appear in PhotoPrismError messages."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, content=b"forbidden")

    secret_token = "super-secret-bearer-token"

    async def run():
        transport = _MockTransport(handler)
        client = PhotoPrismClient(
            base_url="http://photoprism.test",
            token=secret_token,
            _transport=transport,
        )
        async with client:
            try:
                await client.list_album_photos("albumUid001")
            except PhotoPrismError as exc:
                assert secret_token not in str(exc)
                return
        raise AssertionError("Expected PhotoPrismError")

    asyncio.run(run())


def test_preview_transport_error_excludes_preview_token():
    secret_preview_token = "super-secret-preview-token"

    async def run():
        transport = httpx.MockTransport(
            lambda request: (_ for _ in ()).throw(httpx.ConnectError("failed"))
        )
        client = PhotoPrismClient(
            base_url="http://photoprism.test",
            token="bearer",
            _transport=transport,
        )
        async with client:
            with pytest.raises(PhotoPrismError) as exc_info:
                await client.download_preview(
                    "a" * 40, secret_preview_token, "fit_720"
                )
        assert secret_preview_token not in str(exc_info.value)

    asyncio.run(run())
