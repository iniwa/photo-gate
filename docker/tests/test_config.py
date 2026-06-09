"""
AppConfig and load_config tests.

No network access, real credentials, or services required.
"""

import pytest

from photo_gate.config import AppConfig, ConfigError, load_config

# ---------------------------------------------------------------------------
# Shared fixture
# ---------------------------------------------------------------------------

_VALID_ENV = {
    "PHOTOPRISM_URL": "https://photos.example.com",
    "PHOTOPRISM_TOKEN": "my-token",
    "R2_ENDPOINT_URL": "https://account123.r2.cloudflarestorage.com",
    "R2_ACCESS_KEY_ID": "key-id",
    "R2_SECRET_ACCESS_KEY": "secret-key",
    "R2_BUCKET": "my-bucket",
}


# ---------------------------------------------------------------------------
# Valid configuration
# ---------------------------------------------------------------------------


def test_load_config_valid():
    cfg = load_config(_VALID_ENV)
    assert cfg.photoprism_url == "https://photos.example.com"
    assert cfg.r2.bucket == "my-bucket"
    assert cfg.cf_client_id is None
    assert cfg.cf_client_secret is None


def test_load_config_normalizes_trailing_slash():
    env = {**_VALID_ENV, "PHOTOPRISM_URL": "https://photos.example.com/prefix/"}
    cfg = load_config(env)
    assert cfg.photoprism_url == "https://photos.example.com/prefix"


def test_load_config_trims_url_whitespace():
    env = {**_VALID_ENV, "PHOTOPRISM_URL": "  https://photos.example.com  "}
    cfg = load_config(env)
    assert cfg.photoprism_url == "https://photos.example.com"


def test_load_config_trims_bucket_whitespace():
    env = {**_VALID_ENV, "R2_BUCKET": "  my-bucket  "}
    cfg = load_config(env)
    assert cfg.r2.bucket == "my-bucket"


def test_load_config_allows_path_prefix_in_photoprism_url():
    env = {**_VALID_ENV, "PHOTOPRISM_URL": "https://photos.example.com/pp"}
    cfg = load_config(env)
    assert cfg.photoprism_url == "https://photos.example.com/pp"


def test_load_config_accepts_both_cf_credentials():
    env = {
        **_VALID_ENV,
        "CF_ACCESS_CLIENT_ID": "cf-id",
        "CF_ACCESS_CLIENT_SECRET": "cf-secret",
    }
    cfg = load_config(env)
    assert cfg.cf_client_id == "cf-id"
    assert cfg.cf_client_secret == "cf-secret"


def test_load_config_accepts_neither_cf_credential():
    cfg = load_config(_VALID_ENV)
    assert cfg.cf_client_id is None
    assert cfg.cf_client_secret is None


# ---------------------------------------------------------------------------
# Missing required variables — each must name the missing variable
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("missing_var", list(_VALID_ENV.keys()))
def test_load_config_missing_required_names_variable(missing_var):
    env = {k: v for k, v in _VALID_ENV.items() if k != missing_var}
    with pytest.raises(ConfigError, match=missing_var):
        load_config(env)


# ---------------------------------------------------------------------------
# Invalid PHOTOPRISM_URL
# ---------------------------------------------------------------------------


def test_load_config_rejects_http_photoprism_url():
    env = {**_VALID_ENV, "PHOTOPRISM_URL": "http://photos.example.com"}
    with pytest.raises(ConfigError, match="https"):
        load_config(env)


def test_load_config_rejects_missing_hostname_in_url():
    env = {**_VALID_ENV, "PHOTOPRISM_URL": "https://"}
    with pytest.raises(ConfigError, match="hostname"):
        load_config(env)


def test_load_config_rejects_embedded_credentials_in_url():
    env = {**_VALID_ENV, "PHOTOPRISM_URL": "https://user:pass@photos.example.com"}
    with pytest.raises(ConfigError, match="credentials"):
        load_config(env)


def test_load_config_rejects_query_params_in_url():
    env = {**_VALID_ENV, "PHOTOPRISM_URL": "https://photos.example.com?foo=bar"}
    with pytest.raises(ConfigError, match="query"):
        load_config(env)


def test_load_config_rejects_fragment_in_url():
    env = {**_VALID_ENV, "PHOTOPRISM_URL": "https://photos.example.com#section"}
    with pytest.raises(ConfigError, match="fragment"):
        load_config(env)


def test_load_config_rejects_malformed_photoprism_url_as_config_error():
    env = {**_VALID_ENV, "PHOTOPRISM_URL": "https://[invalid"}
    with pytest.raises(ConfigError, match="PHOTOPRISM_URL"):
        load_config(env)


# ---------------------------------------------------------------------------
# Invalid R2 configuration
# ---------------------------------------------------------------------------


def test_load_config_rejects_invalid_r2_bucket():
    env = {**_VALID_ENV, "R2_BUCKET": "MY_BUCKET!!"}
    with pytest.raises(ConfigError, match="R2_BUCKET"):
        load_config(env)


def test_load_config_rejects_http_r2_endpoint():
    env = {**_VALID_ENV, "R2_ENDPOINT_URL": "http://account.r2.example.com"}
    with pytest.raises(ConfigError, match="R2_ENDPOINT_URL"):
        load_config(env)


# ---------------------------------------------------------------------------
# Cloudflare Access — only one credential set
# ---------------------------------------------------------------------------


def test_load_config_rejects_only_cf_client_id():
    env = {**_VALID_ENV, "CF_ACCESS_CLIENT_ID": "id-only"}
    with pytest.raises(ConfigError, match="CF_ACCESS"):
        load_config(env)


def test_load_config_rejects_only_cf_client_secret():
    env = {**_VALID_ENV, "CF_ACCESS_CLIENT_SECRET": "secret-only"}
    with pytest.raises(ConfigError, match="CF_ACCESS"):
        load_config(env)


# ---------------------------------------------------------------------------
# Secret safety
# ---------------------------------------------------------------------------


def test_config_repr_excludes_secrets():
    cfg = load_config(_VALID_ENV)
    r = repr(cfg)
    assert "my-token" not in r
    assert "key-id" not in r
    assert "secret-key" not in r
    assert "photos.example.com" in r  # safe URL is shown


def test_config_is_immutable():
    from dataclasses import FrozenInstanceError

    cfg = load_config(_VALID_ENV)
    with pytest.raises(FrozenInstanceError):
        cfg.photoprism_url = "https://other.example.com"


def test_config_error_names_variable_but_not_value():
    """ConfigError must name the missing variable, never expose its value."""
    secret_token = "VERY-SECRET-TOKEN-XYZ"
    env = {
        **_VALID_ENV,
        "PHOTOPRISM_TOKEN": secret_token,
        "R2_BUCKET": "MY_BUCKET!!",  # invalid — triggers ConfigError after token is read
    }
    with pytest.raises(ConfigError) as exc_info:
        load_config(env)
    assert secret_token not in str(exc_info.value)
