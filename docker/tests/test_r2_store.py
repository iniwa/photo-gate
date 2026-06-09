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
