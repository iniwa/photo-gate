"""Shared sanitized diagnostics and daemon logging configuration."""
from __future__ import annotations

import logging
import sys
import time
from datetime import datetime, timezone
from typing import Callable

_UTC = timezone.utc


# Exception types whose messages are sanitized at the raise site (no
# tokens, credentials, or preview tokens) and are therefore safe to print.
# Matching is by class name so this module stays importable without
# libvips (image_processor) or network dependencies.
#   - photo_gate types: ConfigError, MetadataValidationError,
#     ObjectStoreError, PhotoPrismError, and validation ValueErrors.
#   - botocore ClientError: messages contain only operation and error code.
# httpx exceptions are intentionally NOT listed: their messages can embed
# request URLs, which include the PhotoPrism preview token.
_SANITIZED_ERROR_TYPES = frozenset({
    "CatalogError",
    "ClientError",
    "ConfigError",
    "MetadataValidationError",
    "ObjectStoreError",
    "PhotoPrismError",
    "SyncTargetError",
    "ValueError",
})


def _utc_now_iso(clock: Callable[[], datetime]) -> str:
    return clock().strftime("%Y-%m-%dT%H:%M:%SZ")


def _describe_error(exc: BaseException, depth: int = 0) -> str:
    """
    Operator-readable failure description that never prints messages of
    unknown exception types (class name only). Unwraps exception groups
    and causes a few levels deep so the root cause is visible in logs.
    """
    if depth >= 4:
        return "..."
    name = type(exc).__name__
    if isinstance(exc, BaseExceptionGroup):
        parts = [_describe_error(sub, depth + 1) for sub in exc.exceptions[:3]]
        remaining = len(exc.exceptions) - 3
        if remaining > 0:
            parts.append(f"+{remaining} more")
        return f"{name}[{'; '.join(parts)}]"
    if name in _SANITIZED_ERROR_TYPES:
        described = f"{name}: {exc}"
    else:
        described = name
    if exc.__cause__ is not None:
        described = f"{described} (caused by {_describe_error(exc.__cause__, depth + 1)})"
    return described

_NOISY_LOGGER_NAMES = ("httpx", "httpcore", "botocore", "boto3", "urllib3", "pyvips")


def _configure_daemon_logging() -> None:
    # Root stays at WARNING so third-party INFO logs (which can contain the
    # PhotoPrism preview token in request URLs) never reach stdout.
    logging.basicConfig(
        stream=sys.stdout,
        format="%(asctime)sZ %(levelname)s %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
        level=logging.WARNING,
        force=True,
    )
    # Only photo_gate.* logs at INFO; its records propagate to the root
    # handler installed above. Children (photo_gate.main, photo_gate.sync)
    # inherit this level.
    logging.getLogger("photo_gate").setLevel(logging.INFO)
    # Defense in depth: pin known-chatty libraries to WARNING even if some
    # future caller raises the root level back to INFO.
    for name in _NOISY_LOGGER_NAMES:
        logging.getLogger(name).setLevel(logging.WARNING)
    # Make logging use UTC
    logging.Formatter.converter = time.gmtime
