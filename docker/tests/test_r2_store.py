"""
R2ObjectStore adapter tests.

No real R2, network access, or credentials used.
Uses botocore Stubber to validate exact put_object arguments.
"""

import asyncio
from dataclasses import FrozenInstanceError

import boto3
import pytest
from botocore.stub import Stubber

from photo_gate.object_store import ObjectStoreError
from photo_gate.r2_store import R2Config, R2ObjectStore

# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------

_ENDPOINT = "https://account123.r2.cloudflarestorage.com"
_KEY_ID = "test-access-key-id"
_SECRET = "test-secret-access-key"
_BUCKET = "test-bucket"

_CONFIG = R2Config(
    endpoint=_ENDPOINT,
    access_key_id=_KEY_ID,
    secret_access_key=_SECRET,
    bucket=_BUCKET,
)

_THUMB_KEY = "albums/my-album/thumbs/uid001abc.webp"
_PREVIEW_KEY = "albums/my-album/previews/uid001abc.jpg"
_MANIFEST_KEY = "albums/my-album/manifest.json"
_COVER_KEY = "albums/my-album/cover.webp"


def _make_store(config: R2Config = _CONFIG):
    """Return (store, Stubber) backed by an injected boto3 client."""
    s3 = boto3.client(
        "s3",
        region_name="us-east-1",
        aws_access_key_id="stub-key-id",
        aws_secret_access_key="stub-secret",
    )
    stubber = Stubber(s3)
    store = R2ObjectStore(config, _s3_client=s3)
    return store, stubber


# ---------------------------------------------------------------------------
# R2Config — endpoint validation
# ---------------------------------------------------------------------------


def test_config_valid():
    cfg = R2Config(
        endpoint="https://abc123.r2.cloudflarestorage.com",
        access_key_id="kid",
        secret_access_key="secret",
        bucket="my-bucket",
    )
    assert cfg.bucket == "my-bucket"


def test_config_rejects_http_endpoint():
    with pytest.raises(ValueError, match="https"):
        R2Config(
            endpoint="http://account.r2.example.com",
            access_key_id="kid",
            secret_access_key="sec",
            bucket="my-bucket",
        )


def test_config_rejects_embedded_credentials():
    with pytest.raises(ValueError, match="credentials"):
        R2Config(
            endpoint="https://user:pass@account.r2.cloudflarestorage.com",
            access_key_id="kid",
            secret_access_key="sec",
            bucket="my-bucket",
        )


def test_config_rejects_query_params():
    with pytest.raises(ValueError, match="query"):
        R2Config(
            endpoint="https://account.r2.cloudflarestorage.com?foo=bar",
            access_key_id="kid",
            secret_access_key="sec",
            bucket="my-bucket",
        )


def test_config_rejects_fragment():
    with pytest.raises(ValueError, match="fragment"):
        R2Config(
            endpoint="https://account.r2.cloudflarestorage.com#section",
            access_key_id="kid",
            secret_access_key="sec",
            bucket="my-bucket",
        )


def test_config_rejects_object_path():
    with pytest.raises(ValueError, match="object path"):
        R2Config(
            endpoint="https://account.r2.cloudflarestorage.com/bucket/key",
            access_key_id="kid",
            secret_access_key="sec",
            bucket="my-bucket",
        )


def test_config_rejects_missing_hostname():
    with pytest.raises(ValueError, match="hostname"):
        R2Config(
            endpoint="https://",
            access_key_id="kid",
            secret_access_key="sec",
            bucket="my-bucket",
        )


def test_config_is_immutable():
    cfg = R2Config(
        endpoint=_ENDPOINT,
        access_key_id="kid",
        secret_access_key="sec",
        bucket="my-bucket",
    )
    with pytest.raises(FrozenInstanceError):
        cfg.bucket = "other-bucket"


# ---------------------------------------------------------------------------
# R2Config — credential and bucket validation
# ---------------------------------------------------------------------------


def test_config_rejects_empty_access_key():
    with pytest.raises(ValueError, match="access_key_id"):
        R2Config(
            endpoint=_ENDPOINT,
            access_key_id="",
            secret_access_key="sec",
            bucket="my-bucket",
        )


def test_config_rejects_empty_secret():
    with pytest.raises(ValueError, match="secret_access_key"):
        R2Config(
            endpoint=_ENDPOINT,
            access_key_id="kid",
            secret_access_key="",
            bucket="my-bucket",
        )


def test_config_rejects_unsafe_bucket_chars():
    with pytest.raises(ValueError, match="bucket"):
        R2Config(
            endpoint=_ENDPOINT,
            access_key_id="kid",
            secret_access_key="sec",
            bucket="MY BUCKET!!",
        )


@pytest.mark.parametrize("bucket", ["my_bucket", "my.bucket"])
def test_config_rejects_bucket_characters_not_supported_by_r2(bucket):
    with pytest.raises(ValueError, match="bucket"):
        R2Config(
            endpoint=_ENDPOINT,
            access_key_id="kid",
            secret_access_key="sec",
            bucket=bucket,
        )


def test_config_rejects_short_bucket():
    with pytest.raises(ValueError, match="bucket"):
        R2Config(
            endpoint=_ENDPOINT,
            access_key_id="kid",
            secret_access_key="sec",
            bucket="ab",
        )


def test_config_repr_excludes_secrets():
    cfg = R2Config(
        endpoint=_ENDPOINT,
        access_key_id="SUPER_SECRET_KEY_ID",
        secret_access_key="SUPER_SECRET_KEY_VALUE",
        bucket="my-bucket",
    )
    r = repr(cfg)
    assert "SUPER_SECRET_KEY_ID" not in r
    assert "SUPER_SECRET_KEY_VALUE" not in r
    assert "my-bucket" in r
    assert _ENDPOINT in r


# ---------------------------------------------------------------------------
# Key validation — rejection cases
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "key",
    [
        "",                                         # empty
        "/albums/my-album/thumbs/uid001.webp",      # leading slash
        "albums\\my-album\\thumbs\\uid001.webp",    # backslash
        "albums/my-album/./thumbs/uid001.webp",     # dot segment
        "albums/my-album/../other/manifest.json",   # dotdot traversal
        "albums/../../etc/thumbs/uid001.webp",      # traversal in album id part
        "other/my-album/thumbs/uid001.webp",        # unknown prefix
        "albums/my-album/secrets/uid001.bin",       # unsupported type
        "albums/my-album/thumbs/uid001.gif",        # wrong extension
        "albums/my-album/thumbs/.webp",             # uid starting with dot
    ],
)
def test_key_validation_rejects(key):
    store, _ = _make_store()
    with pytest.raises(ValueError):
        asyncio.run(store.put(key, b"data", "image/webp"))


def test_key_rejects_control_characters():
    store, _ = _make_store()
    key = "albums/my-album/thumbs/uid\x00001.webp"
    with pytest.raises(ValueError, match="control"):
        asyncio.run(store.put(key, b"data", "image/webp"))


# ---------------------------------------------------------------------------
# Key validation — acceptance cases
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "key,content_type",
    [
        (_THUMB_KEY, "image/webp"),
        (_PREVIEW_KEY, "image/jpeg"),
        (_MANIFEST_KEY, "application/json"),
        (_COVER_KEY, "image/webp"),
    ],
)
def test_valid_schema_keys_accepted(key, content_type):
    store, stubber = _make_store()
    data = b"fake-content"
    expected_cache = (
        "private, no-cache"
        if key.endswith("manifest.json")
        else "public, max-age=31536000, immutable"
    )
    stubber.add_response(
        "put_object",
        {},
        expected_params={
            "Bucket": _BUCKET,
            "Key": key,
            "Body": data,
            "ContentType": content_type,
            "CacheControl": expected_cache,
        },
    )
    with stubber:
        asyncio.run(store.put(key, data, content_type))
    stubber.assert_no_pending_responses()


# ---------------------------------------------------------------------------
# Content type validation
# ---------------------------------------------------------------------------


def test_content_type_mismatch_rejected_before_boto3():
    store, stubber = _make_store()
    # Stubber has no queued responses: any boto3 call would raise StubResponseError.
    # A ValueError here proves validation happened before the network call.
    with stubber:
        with pytest.raises(ValueError, match="content type"):
            asyncio.run(store.put(_THUMB_KEY, b"data", "image/jpeg"))
    stubber.assert_no_pending_responses()


def test_empty_content_type_rejected():
    store, _ = _make_store()
    with pytest.raises(ValueError, match="content_type"):
        asyncio.run(store.put(_THUMB_KEY, b"data", ""))


# ---------------------------------------------------------------------------
# Upload behavior
# ---------------------------------------------------------------------------


def test_image_upload_sends_correct_params_and_immutable_cache():
    store, stubber = _make_store()
    data = b"image-bytes"
    stubber.add_response(
        "put_object",
        {},
        expected_params={
            "Bucket": _BUCKET,
            "Key": _THUMB_KEY,
            "Body": data,
            "ContentType": "image/webp",
            "CacheControl": "public, max-age=31536000, immutable",
        },
    )
    with stubber:
        asyncio.run(store.put(_THUMB_KEY, data, "image/webp"))
    stubber.assert_no_pending_responses()


def test_manifest_upload_sends_private_no_cache():
    store, stubber = _make_store()
    data = b'{"schemaVersion": 1}'
    stubber.add_response(
        "put_object",
        {},
        expected_params={
            "Bucket": _BUCKET,
            "Key": _MANIFEST_KEY,
            "Body": data,
            "ContentType": "application/json",
            "CacheControl": "private, no-cache",
        },
    )
    with stubber:
        asyncio.run(store.put(_MANIFEST_KEY, data, "application/json"))
    stubber.assert_no_pending_responses()


def test_put_is_awaitable_and_completes():
    """put() must be awaitable (runs via asyncio.to_thread)."""
    store, stubber = _make_store()
    data = b"preview-bytes"
    stubber.add_response(
        "put_object",
        {},
        expected_params={
            "Bucket": _BUCKET,
            "Key": _PREVIEW_KEY,
            "Body": data,
            "ContentType": "image/jpeg",
            "CacheControl": "public, max-age=31536000, immutable",
        },
    )
    with stubber:
        asyncio.run(store.put(_PREVIEW_KEY, data, "image/jpeg"))
    stubber.assert_no_pending_responses()


# ---------------------------------------------------------------------------
# Error handling
# ---------------------------------------------------------------------------


def test_boto3_error_becomes_object_store_error():
    store, stubber = _make_store()
    stubber.add_client_error("put_object", service_error_code="NoSuchBucket")
    with stubber:
        with pytest.raises(ObjectStoreError):
            asyncio.run(store.put(_THUMB_KEY, b"data", "image/webp"))


def test_error_text_excludes_credentials():
    secret_key_id = "VERY-SECRET-KEY-ID-XYZ"
    secret_key = "VERY-SECRET-ACCESS-KEY-XYZ"
    config = R2Config(
        endpoint=_ENDPOINT,
        access_key_id=secret_key_id,
        secret_access_key=secret_key,
        bucket=_BUCKET,
    )
    store, stubber = _make_store(config)
    stubber.add_client_error("put_object", service_error_code="AccessDenied")
    with stubber:
        with pytest.raises(ObjectStoreError) as exc_info:
            asyncio.run(store.put(_THUMB_KEY, b"data", "image/webp"))
    assert secret_key_id not in str(exc_info.value)
    assert secret_key not in str(exc_info.value)


# ---------------------------------------------------------------------------
# Status key: ops/sync-status.json
# ---------------------------------------------------------------------------

_STATUS_KEY = "ops/sync-status.json"
_STATUS_DATA = b'{"schema": 1}'
_STATUS_CONTENT_TYPE = "application/json"
_STATUS_CACHE = "private, no-cache"


def test_status_key_accepted():
    store, stubber = _make_store()
    stubber.add_response(
        "put_object",
        {},
        expected_params={
            "Bucket": _BUCKET,
            "Key": _STATUS_KEY,
            "Body": _STATUS_DATA,
            "ContentType": _STATUS_CONTENT_TYPE,
            "CacheControl": _STATUS_CACHE,
        },
    )
    with stubber:
        asyncio.run(store.put(_STATUS_KEY, _STATUS_DATA, _STATUS_CONTENT_TYPE))
    stubber.assert_no_pending_responses()


def test_status_key_cache_control_is_private_no_cache():
    from photo_gate.r2_store import _cache_control
    assert _cache_control(_STATUS_KEY) == "private, no-cache"


def test_status_key_content_type_must_be_json():
    store, _ = _make_store()
    with pytest.raises(ValueError, match="content type"):
        asyncio.run(store.put(_STATUS_KEY, _STATUS_DATA, "text/plain"))


def test_other_ops_keys_rejected():
    store, _ = _make_store()
    with pytest.raises(ValueError):
        asyncio.run(store.put("ops/other.json", b"data", "application/json"))


def test_ops_directory_traversal_rejected():
    store, _ = _make_store()
    with pytest.raises(ValueError):
        asyncio.run(store.put("ops/../albums/album-x/manifest.json", b"data", "application/json"))


# ---------------------------------------------------------------------------
# Request key: ops/sync-request.json — get
# ---------------------------------------------------------------------------

_REQUEST_KEY = "ops/sync-request.json"
_REQUEST_DATA = b'{"schema": 1, "requestId": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4", "requestedAt": "2026-06-12T00:00:00.000Z", "kind": "sync-now"}'


def test_request_key_get_returns_bytes():
    store, stubber = _make_store()
    import io
    stubber.add_response(
        "get_object",
        {"Body": io.BytesIO(_REQUEST_DATA), "ContentLength": len(_REQUEST_DATA)},
        expected_params={"Bucket": _BUCKET, "Key": _REQUEST_KEY},
    )
    with stubber:
        result = asyncio.run(store.get(_REQUEST_KEY))
    assert result == _REQUEST_DATA
    stubber.assert_no_pending_responses()


def test_request_key_get_missing_returns_none():
    store, stubber = _make_store()
    stubber.add_client_error(
        "get_object",
        service_error_code="NoSuchKey",
        expected_params={"Bucket": _BUCKET, "Key": _REQUEST_KEY},
    )
    with stubber:
        result = asyncio.run(store.get(_REQUEST_KEY))
    assert result is None
    stubber.assert_no_pending_responses()


def test_request_key_get_r2_error_raises_object_store_error():
    from photo_gate.object_store import ObjectStoreError
    store, stubber = _make_store()
    stubber.add_client_error(
        "get_object",
        service_error_code="InternalError",
        expected_params={"Bucket": _BUCKET, "Key": _REQUEST_KEY},
    )
    with stubber:
        with pytest.raises(ObjectStoreError):
            asyncio.run(store.get(_REQUEST_KEY))


def test_get_rejects_non_allowed_ops_key():
    store, _ = _make_store()
    with pytest.raises(ValueError):
        asyncio.run(store.get("ops/other.json"))


def test_get_rejects_arbitrary_key():
    store, _ = _make_store()
    with pytest.raises(ValueError):
        asyncio.run(store.get("unknown/key.json"))


# ---------------------------------------------------------------------------
# Request key: ops/sync-request.json — delete
# ---------------------------------------------------------------------------


def test_request_key_delete_succeeds():
    store, stubber = _make_store()
    stubber.add_response(
        "delete_object",
        {},
        expected_params={"Bucket": _BUCKET, "Key": _REQUEST_KEY},
    )
    with stubber:
        asyncio.run(store.delete(_REQUEST_KEY))
    stubber.assert_no_pending_responses()


def test_request_key_delete_r2_error_raises_object_store_error():
    from photo_gate.object_store import ObjectStoreError
    store, stubber = _make_store()
    stubber.add_client_error(
        "delete_object",
        service_error_code="InternalError",
        expected_params={"Bucket": _BUCKET, "Key": _REQUEST_KEY},
    )
    with stubber:
        with pytest.raises(ObjectStoreError):
            asyncio.run(store.delete(_REQUEST_KEY))


def test_delete_rejects_non_allowed_ops_key():
    store, _ = _make_store()
    with pytest.raises(ValueError):
        asyncio.run(store.delete("ops/other.json"))


def test_delete_rejects_arbitrary_key():
    store, _ = _make_store()
    with pytest.raises(ValueError):
        asyncio.run(store.delete("unknown/key.json"))


def test_status_key_accepted_by_get():
    store, stubber = _make_store()
    import io
    stubber.add_response(
        "get_object",
        {"Body": io.BytesIO(b"{}"), "ContentLength": 2},
        expected_params={"Bucket": _BUCKET, "Key": _STATUS_KEY},
    )
    with stubber:
        result = asyncio.run(store.get(_STATUS_KEY))
    assert result == b"{}"


def test_other_ops_key_rejected_by_get():
    store, _ = _make_store()
    with pytest.raises(ValueError):
        asyncio.run(store.get("ops/something-else.json"))


# ---------------------------------------------------------------------------
# Catalog key: ops/album-catalog.json
# ---------------------------------------------------------------------------

_CATALOG_KEY = "ops/album-catalog.json"
_CATALOG_DATA = b'{"schema":1,"publishedAt":"2026-06-26T00:00:00Z","albums":[]}'
_CATALOG_CONTENT_TYPE = "application/json"
_CATALOG_CACHE = "private, no-cache"


def test_catalog_key_accepted_for_put():
    store, stubber = _make_store()
    stubber.add_response(
        "put_object",
        {},
        expected_params={
            "Bucket": _BUCKET,
            "Key": _CATALOG_KEY,
            "Body": _CATALOG_DATA,
            "ContentType": _CATALOG_CONTENT_TYPE,
            "CacheControl": _CATALOG_CACHE,
        },
    )
    with stubber:
        asyncio.run(store.put(_CATALOG_KEY, _CATALOG_DATA, _CATALOG_CONTENT_TYPE))
    stubber.assert_no_pending_responses()


def test_catalog_key_cache_control_is_private_no_cache():
    from photo_gate.r2_store import _cache_control
    assert _cache_control(_CATALOG_KEY) == "private, no-cache"


def test_catalog_key_content_type_must_be_json():
    store, _ = _make_store()
    with pytest.raises(ValueError, match="content type"):
        asyncio.run(store.put(_CATALOG_KEY, _CATALOG_DATA, "text/plain"))


def test_catalog_key_accepted_for_get():
    store, stubber = _make_store()
    import io
    stubber.add_response(
        "get_object",
        {"Body": io.BytesIO(_CATALOG_DATA), "ContentLength": len(_CATALOG_DATA)},
        expected_params={"Bucket": _BUCKET, "Key": _CATALOG_KEY},
    )
    with stubber:
        result = asyncio.run(store.get(_CATALOG_KEY))
    assert result == _CATALOG_DATA


def test_other_ops_keys_still_rejected_after_catalog():
    store, _ = _make_store()
    with pytest.raises(ValueError):
        asyncio.run(store.put("ops/unknown.json", b"data", "application/json"))
    with pytest.raises(ValueError):
        asyncio.run(store.get("ops/something-else.json"))
