"""
Application configuration loaded from environment variables.

Secrets never appear in repr or error messages.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.parse import urlparse

from .r2_store import R2Config


class ConfigError(Exception):
    """Raised when required configuration is missing or invalid."""


@dataclass(frozen=True, repr=False)
class AppConfig:
    photoprism_url: str
    photoprism_token: str
    r2: R2Config
    cf_client_id: str | None
    cf_client_secret: str | None

    def __repr__(self) -> str:
        return (
            f"AppConfig(photoprism_url={self.photoprism_url!r}, "
            "photoprism_token=<redacted>, r2=<redacted>, "
            "cf_client_id=<redacted>, cf_client_secret=<redacted>)"
        )


def _get_required(name: str, env: dict[str, str], *, trim: bool) -> str:
    raw = env.get(name, "")
    value = raw.strip() if trim else raw
    if not value:
        raise ConfigError(f"Required environment variable {name!r} is not set")
    return value


def _validate_photoprism_url(raw: str) -> str:
    url = raw.strip()
    try:
        parsed = urlparse(url)
        hostname = parsed.hostname
    except ValueError as exc:
        raise ConfigError("PHOTOPRISM_URL is not a valid URL") from exc
    if parsed.scheme != "https":
        raise ConfigError(
            f"PHOTOPRISM_URL must use https scheme, got {parsed.scheme!r}"
        )
    if not hostname:
        raise ConfigError("PHOTOPRISM_URL must be an absolute URL with a hostname")
    if parsed.username or parsed.password:
        raise ConfigError("PHOTOPRISM_URL must not contain embedded credentials")
    if parsed.query:
        raise ConfigError("PHOTOPRISM_URL must not contain query parameters")
    if parsed.fragment:
        raise ConfigError("PHOTOPRISM_URL must not contain a fragment")
    return url.rstrip("/")


def load_config(env: dict[str, str] | None = None) -> AppConfig:
    """Load and validate AppConfig from environment variables.

    Raises ConfigError with the variable name for missing or invalid config.
    Never includes secret values in error messages.
    """
    if env is None:
        env = dict(os.environ)

    photoprism_url_raw = _get_required("PHOTOPRISM_URL", env, trim=True)
    photoprism_url = _validate_photoprism_url(photoprism_url_raw)

    photoprism_token = _get_required("PHOTOPRISM_TOKEN", env, trim=False)

    r2_endpoint = _get_required("R2_ENDPOINT_URL", env, trim=True)
    r2_key_id = _get_required("R2_ACCESS_KEY_ID", env, trim=False)
    r2_secret = _get_required("R2_SECRET_ACCESS_KEY", env, trim=False)
    r2_bucket = _get_required("R2_BUCKET", env, trim=True)

    try:
        r2 = R2Config(
            endpoint=r2_endpoint,
            access_key_id=r2_key_id,
            secret_access_key=r2_secret,
            bucket=r2_bucket,
        )
    except ValueError as exc:
        field = "R2_BUCKET" if str(exc).startswith("bucket ") else "R2_ENDPOINT_URL"
        raise ConfigError(f"Invalid environment variable {field}") from exc

    cf_id = env.get("CF_ACCESS_CLIENT_ID", "")
    cf_secret = env.get("CF_ACCESS_CLIENT_SECRET", "")

    if bool(cf_id) != bool(cf_secret):
        raise ConfigError(
            "CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET "
            "must both be set or both be absent"
        )

    return AppConfig(
        photoprism_url=photoprism_url,
        photoprism_token=photoprism_token,
        r2=r2,
        cf_client_id=cf_id or None,
        cf_client_secret=cf_secret or None,
    )
