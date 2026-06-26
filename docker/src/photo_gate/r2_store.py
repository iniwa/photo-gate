"""
Cloudflare R2 production implementation of ObjectStore.

Uses boto3's S3-compatible API with SigV4 signing.
Each put_object call is isolated in a thread via asyncio.to_thread to avoid
blocking the event loop.
"""

import asyncio
import re
from dataclasses import dataclass
from urllib.parse import urlparse

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from .object_store import ObjectStoreError

# R2 bucket: 3-63 chars, lowercase alphanumeric start/end, hyphens inside.
_SAFE_BUCKET = re.compile(r"^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$")

# Allowlist of key shapes mirroring the R2 layout defined in AGENTS.md.
_ALLOWED_KEY = re.compile(
    r"^albums/(?:[a-zA-Z0-9][a-zA-Z0-9_-]{0,127})/"
    r"(?:manifest\.json"
    r"|cover\.webp"
    r"|thumbs/(?:[a-zA-Z0-9][a-zA-Z0-9_-]{0,127})\.webp"
    r"|previews/(?:[a-zA-Z0-9][a-zA-Z0-9_-]{0,127})\.jpg)$"
)

_SUFFIX_CONTENT_TYPE: dict[str, str] = {
    ".webp": "image/webp",
    ".jpg": "image/jpeg",
    ".json": "application/json",
}

_IMMUTABLE_CACHE = "public, max-age=31536000, immutable"
_MANIFEST_CACHE = "private, no-cache"
_STATUS_KEY = "ops/sync-status.json"
_REQUEST_KEY = "ops/sync-request.json"
_STATUS_CACHE = "private, no-cache"


@dataclass(frozen=True, repr=False)
class R2Config:
    """Immutable R2 adapter configuration. Secret fields are never exposed in repr."""

    endpoint: str
    access_key_id: str
    secret_access_key: str
    bucket: str

    def __post_init__(self) -> None:
        parsed = urlparse(self.endpoint)
        if self.endpoint != self.endpoint.strip():
            raise ValueError("endpoint must not contain surrounding whitespace")
        if parsed.scheme != "https":
            raise ValueError(
                f"endpoint must use https scheme, got {parsed.scheme!r}"
            )
        if not parsed.hostname:
            raise ValueError("endpoint must be an absolute URL with a hostname")
        if parsed.username or parsed.password:
            raise ValueError("endpoint must not contain embedded credentials")
        if parsed.query:
            raise ValueError("endpoint must not contain query parameters")
        if parsed.fragment:
            raise ValueError("endpoint must not contain a fragment")
        if parsed.path and parsed.path != "/":
            raise ValueError("endpoint must not contain an object path")
        if not self.access_key_id.strip():
            raise ValueError("access_key_id must not be empty")
        if not self.secret_access_key.strip():
            raise ValueError("secret_access_key must not be empty")
        if not _SAFE_BUCKET.match(self.bucket):
            raise ValueError(
                f"bucket name {self.bucket!r} is invalid: must be 3-63 characters, "
                "start and end with a lowercase letter or digit, and contain only "
                "lowercase letters, digits, or hyphens"
            )

    def __repr__(self) -> str:
        return (
            f"R2Config(endpoint={self.endpoint!r}, bucket={self.bucket!r}, "
            "access_key_id=<redacted>, secret_access_key=<redacted>)"
        )


def _validate_key(key: str) -> None:
    if not key:
        raise ValueError("key must not be empty")
    if key.startswith("/"):
        raise ValueError(f"key must not start with '/': {key!r}")
    if "\\" in key:
        raise ValueError(f"key must not contain backslashes: {key!r}")
    for segment in key.split("/"):
        if segment in (".", ".."):
            raise ValueError(
                f"key contains illegal path segment {segment!r}: {key!r}"
            )
    if any(ord(c) < 32 or ord(c) == 127 for c in key):
        raise ValueError(f"key contains control characters: {key!r}")
    if key == _STATUS_KEY:
        return
    if key == _REQUEST_KEY:
        return
    if not _ALLOWED_KEY.match(key):
        raise ValueError(
            f"key does not match any allowed schema path "
            "(albums/{{albumId}}/{{manifest.json|cover.webp|"
            "thumbs/{{uid}}.webp|previews/{{uid}}.jpg}}): "
            f"{key!r}"
        )


def _cache_control(key: str) -> str:
    if key == _STATUS_KEY:
        return _STATUS_CACHE
    if key.endswith("/manifest.json"):
        return _MANIFEST_CACHE
    return _IMMUTABLE_CACHE


def _check_content_type(key: str, content_type: str) -> None:
    if not content_type:
        raise ValueError("content_type must not be empty")
    for suffix, expected in _SUFFIX_CONTENT_TYPE.items():
        if key.endswith(suffix):
            if content_type != expected:
                raise ValueError(
                    f"content type {content_type!r} is inconsistent with key "
                    f"suffix for {key!r} (expected {expected!r})"
                )
            return


class R2ObjectStore:
    """ObjectStore adapter for Cloudflare R2 via the S3-compatible API."""

    def __init__(self, config: R2Config, *, _s3_client=None) -> None:
        self._config = config
        self._s3 = _s3_client or boto3.client(
            "s3",
            endpoint_url=config.endpoint,
            aws_access_key_id=config.access_key_id,
            aws_secret_access_key=config.secret_access_key,
            region_name="auto",
            config=Config(
                signature_version="s3v4",
                s3={"addressing_style": "path"},
            ),
        )

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        _validate_key(key)
        _check_content_type(key, content_type)
        cache = _cache_control(key)
        bucket = self._config.bucket
        await asyncio.to_thread(self._put_sync, bucket, key, data, content_type, cache)

    async def get(self, key: str) -> bytes | None:
        _validate_key(key)
        bucket = self._config.bucket
        return await asyncio.to_thread(self._get_sync, bucket, key)

    async def delete(self, key: str) -> None:
        _validate_key(key)
        bucket = self._config.bucket
        await asyncio.to_thread(self._delete_sync, bucket, key)

    def _put_sync(
        self,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
        cache_control: str,
    ) -> None:
        try:
            self._s3.put_object(
                Bucket=bucket,
                Key=key,
                Body=data,
                ContentType=content_type,
                CacheControl=cache_control,
            )
        except (BotoCoreError, ClientError) as exc:
            raise ObjectStoreError(
                f"R2 put failed: bucket={bucket!r} key={key!r}"
            ) from exc

    def _get_sync(self, bucket: str, key: str) -> bytes | None:
        try:
            resp = self._s3.get_object(Bucket=bucket, Key=key)
            return resp["Body"].read()
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code", "")
            if code in ("NoSuchKey", "404", "NotFound"):
                return None
            raise ObjectStoreError(
                f"R2 get failed: bucket={bucket!r} key={key!r}"
            ) from exc
        except BotoCoreError as exc:
            raise ObjectStoreError(
                f"R2 get failed: bucket={bucket!r} key={key!r}"
            ) from exc

    def _delete_sync(self, bucket: str, key: str) -> None:
        try:
            self._s3.delete_object(Bucket=bucket, Key=key)
        except (BotoCoreError, ClientError) as exc:
            raise ObjectStoreError(
                f"R2 delete failed: bucket={bucket!r} key={key!r}"
            ) from exc
