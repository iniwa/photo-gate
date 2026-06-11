"""
CLI entrypoint tests.

No network access, real credentials, PhotoPrism, R2, or libvips required.
All service dependencies are injected via factories.
"""

import asyncio
from datetime import datetime, timezone

import pytest

from photo_gate.main import _build_parser, _describe_error, run_sync_once
from photo_gate.photoprism_client import PhotoPrismError

# ---------------------------------------------------------------------------
# Shared constants
# ---------------------------------------------------------------------------

_FIXED_TS = datetime(2026, 6, 9, 9, 0, 0, tzinfo=timezone.utc)

_VALID_SYNC_ARGS = [
    "sync-once",
    "--album-id", "my-album",
    "--album-title", "My Album",
    "--photoprism-album-uid", "uid123abc",
    "--confirm-upload",
]


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class _FakeClient:
    """Minimal async context manager for testing. Tracks close calls."""

    def __init__(self):
        self.closed = False

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        self.closed = True


class _FakeConfig:
    photoprism_url = "https://photos.example.com"
    photoprism_token = "tok"
    cf_client_id = None
    cf_client_secret = None
    r2 = None  # unused — store_factory is always injected in tests


async def _noop_sync(*args, **kwargs):
    pass


# ---------------------------------------------------------------------------
# --help
# ---------------------------------------------------------------------------


def test_help_exits_with_zero():
    parser = _build_parser()
    with pytest.raises(SystemExit) as exc_info:
        parser.parse_args(["--help"])
    assert exc_info.value.code == 0


def test_sync_once_help_exits_with_zero():
    parser = _build_parser()
    with pytest.raises(SystemExit) as exc_info:
        parser.parse_args(["sync-once", "--help"])
    assert exc_info.value.code == 0


# ---------------------------------------------------------------------------
# --confirm-upload guard
# ---------------------------------------------------------------------------


def test_refuses_without_confirm_upload():
    parser = _build_parser()
    args = parser.parse_args([
        "sync-once",
        "--album-id", "my-album",
        "--album-title", "My Album",
        "--photoprism-album-uid", "uid123abc",
        # no --confirm-upload
    ])

    code = asyncio.run(run_sync_once(
        args,
        config_loader=lambda: pytest.fail("config_loader must not be called"),
        client_factory=lambda cfg: pytest.fail("client_factory must not be called"),
        store_factory=lambda cfg: pytest.fail("store_factory must not be called"),
        sync_fn=None,
    ))

    assert code == 2


# ---------------------------------------------------------------------------
# Argument validation before factories
# ---------------------------------------------------------------------------


def test_invalid_concurrency_fails_before_factory():
    parser = _build_parser()
    args = parser.parse_args(_VALID_SYNC_ARGS + ["--concurrency", "0"])

    code = asyncio.run(run_sync_once(
        args,
        config_loader=lambda: pytest.fail("config_loader must not be called"),
        client_factory=lambda cfg: pytest.fail("client_factory must not be called"),
        store_factory=lambda cfg: pytest.fail("store_factory must not be called"),
        sync_fn=None,
    ))

    assert code == 2


def test_invalid_album_id_fails_before_factory():
    parser = _build_parser()
    args = parser.parse_args([
        "sync-once",
        "--album-id", "my album",  # space not allowed in safe ID
        "--album-title", "My Album",
        "--photoprism-album-uid", "uid123abc",
        "--confirm-upload",
    ])

    config_calls = []
    code = asyncio.run(run_sync_once(
        args,
        config_loader=lambda: config_calls.append(1) or None,
        client_factory=lambda cfg: None,
        store_factory=lambda cfg: None,
        sync_fn=None,
    ))

    assert code == 2
    assert not config_calls, "config_loader must not be called for invalid album_id"


def test_invalid_photoprism_uid_fails_before_factory():
    parser = _build_parser()
    args = parser.parse_args([
        "sync-once",
        "--album-id", "my-album",
        "--album-title", "My Album",
        "--photoprism-album-uid", "uid 123",  # space not allowed
        "--confirm-upload",
    ])

    config_calls = []
    code = asyncio.run(run_sync_once(
        args,
        config_loader=lambda: config_calls.append(1) or None,
        client_factory=lambda cfg: None,
        store_factory=lambda cfg: None,
        sync_fn=None,
    ))

    assert code == 2
    assert not config_calls


def test_invalid_thumb_settings_fail_before_factory():
    parser = _build_parser()
    args = parser.parse_args(_VALID_SYNC_ARGS + ["--thumb-long-edge", "0"])

    config_calls = []
    code = asyncio.run(run_sync_once(
        args,
        config_loader=lambda: config_calls.append(1) or None,
        client_factory=lambda cfg: None,
        store_factory=lambda cfg: None,
        sync_fn=None,
    ))

    assert code == 2
    assert not config_calls


def test_invalid_preview_settings_fail_before_factory():
    parser = _build_parser()
    args = parser.parse_args(_VALID_SYNC_ARGS + ["--preview-quality", "0"])

    config_calls = []
    code = asyncio.run(run_sync_once(
        args,
        config_loader=lambda: config_calls.append(1) or None,
        client_factory=lambda cfg: None,
        store_factory=lambda cfg: None,
        sync_fn=None,
    ))

    assert code == 2
    assert not config_calls


# ---------------------------------------------------------------------------
# Configuration error
# ---------------------------------------------------------------------------


def test_config_error_returns_2():
    from photo_gate.config import ConfigError

    parser = _build_parser()
    args = parser.parse_args(_VALID_SYNC_ARGS)

    code = asyncio.run(run_sync_once(
        args,
        config_loader=lambda: (_ for _ in ()).throw(ConfigError("Missing R2_BUCKET")),
        client_factory=lambda cfg: pytest.fail("client_factory must not be called"),
        store_factory=lambda cfg: pytest.fail("store_factory must not be called"),
        sync_fn=None,
    ))

    assert code == 2


def test_config_error_returns_2_via_raising_loader():
    from photo_gate.config import ConfigError

    def failing_loader():
        raise ConfigError("R2_BUCKET not set")

    parser = _build_parser()
    args = parser.parse_args(_VALID_SYNC_ARGS)

    code = asyncio.run(run_sync_once(
        args,
        config_loader=failing_loader,
        client_factory=lambda cfg: pytest.fail("must not be called"),
        store_factory=lambda cfg: pytest.fail("must not be called"),
        sync_fn=None,
    ))

    assert code == 2


# ---------------------------------------------------------------------------
# Successful sync
# ---------------------------------------------------------------------------


def test_successful_sync_returns_0():
    parser = _build_parser()
    args = parser.parse_args(_VALID_SYNC_ARGS)

    code = asyncio.run(run_sync_once(
        args,
        config_loader=_FakeConfig,
        client_factory=lambda cfg: _FakeClient(),
        store_factory=lambda cfg: object(),
        sync_fn=_noop_sync,
        clock=lambda: _FIXED_TS,
    ))

    assert code == 0


def test_successful_sync_calls_sync_exactly_once():
    parser = _build_parser()
    args = parser.parse_args(_VALID_SYNC_ARGS)

    sync_calls = []

    async def tracking_sync(client, album, store, settings, generated_at, concurrency, **kwargs):
        sync_calls.append({
            "album_id": album.album_id,
            "album_title": album.title,
            "concurrency": concurrency,
        })

    asyncio.run(run_sync_once(
        args,
        config_loader=_FakeConfig,
        client_factory=lambda cfg: _FakeClient(),
        store_factory=lambda cfg: object(),
        sync_fn=tracking_sync,
        clock=lambda: _FIXED_TS,
    ))

    assert len(sync_calls) == 1
    assert sync_calls[0]["album_id"] == "my-album"
    assert sync_calls[0]["album_title"] == "My Album"
    assert sync_calls[0]["concurrency"] == 2  # default


def test_concurrency_flag_is_passed_to_sync():
    parser = _build_parser()
    args = parser.parse_args(_VALID_SYNC_ARGS + ["--concurrency", "4"])

    received = []

    async def tracking_sync(client, album, store, settings, generated_at, concurrency, **kwargs):
        received.append(concurrency)

    asyncio.run(run_sync_once(
        args,
        config_loader=_FakeConfig,
        client_factory=lambda cfg: _FakeClient(),
        store_factory=lambda cfg: object(),
        sync_fn=tracking_sync,
        clock=lambda: _FIXED_TS,
    ))

    assert received == [4]


def test_preview_size_flag_is_passed_to_sync():
    parser = _build_parser()
    args = parser.parse_args(
        _VALID_SYNC_ARGS + ["--photoprism-preview-size", "fit_2048"]
    )

    received = []

    async def tracking_sync(*args, **kwargs):
        received.append(kwargs.get("preview_source_size"))

    asyncio.run(run_sync_once(
        args,
        config_loader=_FakeConfig,
        client_factory=lambda cfg: _FakeClient(),
        store_factory=lambda cfg: object(),
        sync_fn=tracking_sync,
        clock=lambda: _FIXED_TS,
    ))

    assert received == ["fit_2048"]


def test_preview_size_defaults_to_fit_3840():
    parser = _build_parser()
    args = parser.parse_args(_VALID_SYNC_ARGS)
    assert args.photoprism_preview_size == "fit_3840"


def test_preview_size_rejects_unknown_value(capsys):
    parser = _build_parser()
    with pytest.raises(SystemExit):
        parser.parse_args(
            _VALID_SYNC_ARGS + ["--photoprism-preview-size", "original"]
        )


def test_factories_receive_config_from_loader():
    parser = _build_parser()
    args = parser.parse_args(_VALID_SYNC_ARGS)

    sentinel = object()
    received_configs = []

    asyncio.run(run_sync_once(
        args,
        config_loader=lambda: sentinel,
        client_factory=lambda cfg: (received_configs.append(cfg), _FakeClient())[1],
        store_factory=lambda cfg: (received_configs.append(cfg), object())[1],
        sync_fn=_noop_sync,
        clock=lambda: _FIXED_TS,
    ))

    assert all(c is sentinel for c in received_configs), \
        "Factories must receive the config returned by config_loader"


def test_clock_result_is_passed_to_sync():
    parser = _build_parser()
    args = parser.parse_args(_VALID_SYNC_ARGS)

    received_ts = []

    async def tracking_sync(client, album, store, settings, generated_at, concurrency, **kwargs):
        received_ts.append(generated_at)

    asyncio.run(run_sync_once(
        args,
        config_loader=_FakeConfig,
        client_factory=lambda cfg: _FakeClient(),
        store_factory=lambda cfg: object(),
        sync_fn=tracking_sync,
        clock=lambda: _FIXED_TS,
    ))

    assert received_ts == [_FIXED_TS]


# ---------------------------------------------------------------------------
# PhotoPrism client lifecycle
# ---------------------------------------------------------------------------


def test_client_closed_on_success():
    parser = _build_parser()
    args = parser.parse_args(_VALID_SYNC_ARGS)

    fake_client = _FakeClient()

    asyncio.run(run_sync_once(
        args,
        config_loader=_FakeConfig,
        client_factory=lambda cfg: fake_client,
        store_factory=lambda cfg: object(),
        sync_fn=_noop_sync,
        clock=lambda: _FIXED_TS,
    ))

    assert fake_client.closed


def test_client_closed_on_sync_failure():
    parser = _build_parser()
    args = parser.parse_args(_VALID_SYNC_ARGS)

    fake_client = _FakeClient()

    async def failing_sync(*args, **kwargs):
        raise RuntimeError("injected sync failure")

    code = asyncio.run(run_sync_once(
        args,
        config_loader=_FakeConfig,
        client_factory=lambda cfg: fake_client,
        store_factory=lambda cfg: object(),
        sync_fn=failing_sync,
        clock=lambda: _FIXED_TS,
    ))

    assert code == 1
    assert fake_client.closed


def test_client_closed_when_store_factory_fails():
    parser = _build_parser()
    args = parser.parse_args(_VALID_SYNC_ARGS)

    fake_client = _FakeClient()

    def failing_store_factory(config):
        raise RuntimeError("injected store construction failure")

    code = asyncio.run(run_sync_once(
        args,
        config_loader=_FakeConfig,
        client_factory=lambda cfg: fake_client,
        store_factory=failing_store_factory,
        sync_fn=_noop_sync,
        clock=lambda: _FIXED_TS,
    ))

    assert code == 1
    assert fake_client.closed


def test_client_factory_failure_returns_1_without_leaking_secret(capsys):
    injected_secret = "INJECTED-FACTORY-SECRET-XYZ"
    parser = _build_parser()
    args = parser.parse_args(_VALID_SYNC_ARGS)

    def failing_client_factory(config):
        raise RuntimeError(injected_secret)

    code = asyncio.run(run_sync_once(
        args,
        config_loader=_FakeConfig,
        client_factory=failing_client_factory,
        store_factory=lambda cfg: pytest.fail("store_factory must not be called"),
        sync_fn=_noop_sync,
        clock=lambda: _FIXED_TS,
    ))

    captured = capsys.readouterr()
    assert code == 1
    assert injected_secret not in captured.out
    assert injected_secret not in captured.err


# ---------------------------------------------------------------------------
# Runtime failure — exit code and secret safety
# ---------------------------------------------------------------------------


def test_runtime_failure_returns_1():
    parser = _build_parser()
    args = parser.parse_args(_VALID_SYNC_ARGS)

    async def failing_sync(*args, **kwargs):
        raise RuntimeError("boom")

    code = asyncio.run(run_sync_once(
        args,
        config_loader=_FakeConfig,
        client_factory=lambda cfg: _FakeClient(),
        store_factory=lambda cfg: object(),
        sync_fn=failing_sync,
        clock=lambda: _FIXED_TS,
    ))

    assert code == 1


# ---------------------------------------------------------------------------
# _describe_error — sanitized diagnostics
# ---------------------------------------------------------------------------


def test_describe_error_prints_message_for_sanitized_types():
    exc = PhotoPrismError("PhotoPrism photo list returned HTTP 401")
    assert _describe_error(exc) == (
        "PhotoPrismError: PhotoPrism photo list returned HTTP 401"
    )


def test_describe_error_hides_message_for_unknown_types():
    exc = RuntimeError("token=SHOULD-NOT-APPEAR")
    described = _describe_error(exc)
    assert described == "RuntimeError"
    assert "SHOULD-NOT-APPEAR" not in described


def test_describe_error_unwraps_cause_chain():
    cause = ConnectionError("dns details that must stay hidden")
    exc = PhotoPrismError("PhotoPrism photo list request failed")
    exc.__cause__ = cause
    described = _describe_error(exc)
    assert described == (
        "PhotoPrismError: PhotoPrism photo list request failed "
        "(caused by ConnectionError)"
    )
    assert "dns details" not in described


def test_describe_error_unwraps_exception_group():
    group = ExceptionGroup(
        "unhandled errors in a TaskGroup",
        [
            PhotoPrismError("Preview download returned HTTP 404"),
            RuntimeError("secret-in-message"),
        ],
    )
    described = _describe_error(group)
    assert "ExceptionGroup[" in described
    assert "PhotoPrismError: Preview download returned HTTP 404" in described
    assert "RuntimeError" in described
    assert "secret-in-message" not in described


def test_describe_error_caps_group_size_and_depth():
    leaves = [ValueError(f"v{i}") for i in range(5)]
    group = ExceptionGroup("g", leaves)
    described = _describe_error(group)
    assert "+2 more" in described

    deep = ValueError("root")
    for _ in range(6):
        wrapper = PhotoPrismError("wrap")
        wrapper.__cause__ = deep
        deep = wrapper
    assert "..." in _describe_error(deep)


def test_runtime_failure_prints_sanitized_detail(capsys):
    async def failing_sync(*args, **kwargs):
        raise PhotoPrismError("PhotoPrism photo list returned HTTP 401")

    parser = _build_parser()
    args = parser.parse_args(_VALID_SYNC_ARGS)

    code = asyncio.run(run_sync_once(
        args,
        config_loader=_FakeConfig,
        client_factory=lambda cfg: _FakeClient(),
        store_factory=lambda cfg: object(),
        sync_fn=failing_sync,
        clock=lambda: _FIXED_TS,
    ))

    captured = capsys.readouterr()
    assert code == 1
    assert "Sync failed for album 'my-album'" in captured.err
    assert "PhotoPrismError: PhotoPrism photo list returned HTTP 401" in captured.err


def test_runtime_failure_does_not_leak_secrets(capsys):
    injected_secret = "INJECTED-SECRET-VALUE-XYZ"

    async def failing_sync(*args, **kwargs):
        raise RuntimeError(f"Connection error: token={injected_secret}")

    parser = _build_parser()
    args = parser.parse_args(_VALID_SYNC_ARGS)

    asyncio.run(run_sync_once(
        args,
        config_loader=_FakeConfig,
        client_factory=lambda cfg: _FakeClient(),
        store_factory=lambda cfg: object(),
        sync_fn=failing_sync,
        clock=lambda: _FIXED_TS,
    ))

    captured = capsys.readouterr()
    assert injected_secret not in captured.out
    assert injected_secret not in captured.err
