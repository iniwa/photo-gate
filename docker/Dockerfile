# Debian trixie ships libvips 8.16. Do not downgrade to bookworm: its
# libvips 8.14 synthesizes a fresh mandatory-tag EXIF block at save time
# even when all metadata has been removed from the image, which the
# fail-closed output validator rejects (first production sync failures,
# 2026-06-11). libvips >= 8.15 (keep-based metadata handling) is required.
FROM python:3.12-slim-trixie AS runtime

# In trixie "libvips" is only a virtual package; libvips42t64 is the real
# binary package providing libvips.so.42 for pyvips.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libvips42t64 \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 1001 appuser \
    && useradd --system --uid 1001 --gid 1001 --no-create-home --shell /usr/sbin/nologin appuser

WORKDIR /app

COPY pyproject.toml README.md ./
COPY src/ ./src/
COPY scripts/ ./scripts/

RUN pip install --no-cache-dir .

ENV PYTHONUNBUFFERED=1

USER appuser

ENTRYPOINT ["photo-gate-sync"]
CMD ["--help"]

# Test image: runs the suite against the exact runtime libvips so
# version-specific metadata behavior is caught before release. Built only
# in CI via --target test; never published.
FROM runtime AS test
USER root
COPY tests/ ./tests/
RUN pip install --no-cache-dir ".[dev]"
USER appuser
ENTRYPOINT []
CMD ["python", "-m", "pytest", "-q", "-p", "no:cacheprovider"]

# Keep the published image as the default build target (last stage wins).
FROM runtime AS final
HEALTHCHECK --interval=60s --timeout=10s --start-period=120s --retries=3 \
    CMD ["photo-gate-sync", "healthcheck"]
