# photo-gate-sync

Raspberry Pi Docker service for photo-gate. Fetches PhotoPrism-generated previews,
re-encodes them with metadata stripped, and uploads share assets to R2.

## System Requirements

The `pyvips` Python package requires the system `libvips` shared library.

```sh
# Debian / Raspberry Pi OS
sudo apt-get install libvips libvips-tools

# macOS
brew install vips
```

CI environments also need `libvips` before installing the Python package.

## Development

```sh
pip install -e ".[dev]"
python -m pytest
python -m compileall src
```

## Architecture

- `photo_gate.photoprism_client` — async httpx client for PhotoPrism API
- `photo_gate.image_processor` — pyvips re-encoding and metadata validation
- `photo_gate.manifest` — deterministic manifest.json builder
- `photo_gate.object_store` — ObjectStore Protocol (no real R2 access yet)
- `photo_gate.sync` — sync orchestration: list → download → re-encode → validate → upload → manifest
- `photo_gate.models` — typed dataclasses shared across modules

Tests run entirely without network access, real PhotoPrism, R2, or credentials.
