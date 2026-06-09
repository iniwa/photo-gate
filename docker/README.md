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

## Configuration

Required environment variables:

| Variable | Description |
|---|---|
| `PHOTOPRISM_URL` | PhotoPrism base URL (`https://`, path prefix allowed) |
| `PHOTOPRISM_TOKEN` | PhotoPrism API token |
| `R2_ENDPOINT_URL` | Cloudflare R2 endpoint URL |
| `R2_ACCESS_KEY_ID` | R2 access key ID |
| `R2_SECRET_ACCESS_KEY` | R2 secret access key |
| `R2_BUCKET` | R2 bucket name |

Optional environment variables (must both be set or both absent):

| Variable | Description |
|---|---|
| `CF_ACCESS_CLIENT_ID` | Cloudflare Access service token client ID |
| `CF_ACCESS_CLIENT_SECRET` | Cloudflare Access service token client secret |

## CLI

```sh
photo-gate-sync sync-once \
  --album-id ALBUM_ID \
  --album-title "Album Title" \
  --photoprism-album-uid PHOTOPRISM_UID \
  --confirm-upload \
  [--concurrency 2] \
  [--thumb-long-edge 640] \
  [--thumb-quality 80] \
  [--preview-long-edge 3840] \
  [--preview-quality 88]
```

Or via the shell wrapper:

```sh
./scripts/sync-once.sh \
  --album-id ALBUM_ID \
  --album-title "Album Title" \
  --photoprism-album-uid PHOTOPRISM_UID \
  --confirm-upload
```

`--confirm-upload` is required and must be explicit to prevent accidental uploads.

## Docker

### Build

```sh
docker build -t photo-gate-sync:local docker
```

### Smoke Test

```sh
# CLI help — default startup must show help and exit cleanly
docker run --rm photo-gate-sync:local --help
docker run --rm photo-gate-sync:local sync-once --help

# Confirm libvips loads and print its version
docker run --rm --entrypoint python photo-gate-sync:local \
  -c "import pyvips; print(pyvips.version(0))"

# Confirm the container runs as non-root
docker run --rm --entrypoint python photo-gate-sync:local \
  -c "import os; assert os.getuid() != 0, 'running as root'"
```

### One-shot Sync

Secrets must be injected at runtime. Never commit, bake into the image, or pass as
`--build-arg`. Use a local `.env` file (never copied into the image):

```sh
docker run --rm \
  --env-file .env \
  photo-gate-sync:local \
  sync-once \
  --album-id ALBUM_ID \
  --album-title "Album Title" \
  --photoprism-album-uid UID \
  --confirm-upload
```

No port is exposed. This image is a one-shot CLI, not an HTTP service.

### Multi-platform Build

Verify both `linux/amd64` and `linux/arm64` build without pushing:

```sh
docker buildx build --platform linux/amd64,linux/arm64 --output type=cacheonly docker
```

## Architecture

- `photo_gate.config` — AppConfig and load_config (environment variable loader)
- `photo_gate.main` — CLI entrypoint (`photo-gate-sync sync-once`)
- `photo_gate.photoprism_client` — async httpx client for PhotoPrism API
- `photo_gate.image_processor` — pyvips re-encoding and metadata validation
- `photo_gate.manifest` — deterministic manifest.json builder
- `photo_gate.object_store` — ObjectStore Protocol and ObjectStoreError
- `photo_gate.r2_store` — R2Config and R2ObjectStore (boto3 S3-compatible, SigV4, asyncio.to_thread)
- `photo_gate.sync` — sync orchestration: list → download → re-encode → validate → upload → manifest
- `photo_gate.models` — typed dataclasses shared across modules

Tests run entirely without network access, real PhotoPrism, R2, or credentials.
