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

## Delivery

Release images are published to GitHub Container Registry as
`ghcr.io/iniwa/photo-gate-sync`.

- **Release flow:** push an immutable `sync-vX.Y.Z` tag (via Gitea, mirrored to
  GitHub). The `docker-ci` workflow builds `linux/amd64,linux/arm64` and pushes
  image tags `X.Y.Z` and `sha-<short-sha>`. No `latest` tag is published.
- **Deployment:** the image runs as a Portainer stack on Raspberry Pi 4. See
  [`deploy/portainer-stack.yml`](../deploy/portainer-stack.yml) for the compose
  definition (interim single-album sync loop; all values injected via Portainer
  env vars).
- **Design:** see
  [`docs/decisions/2026-06-11-delivery-pipeline.md`](../docs/decisions/2026-06-11-delivery-pipeline.md).

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
- `photo_gate.sync_status` — builds sanitized sync status payload for R2 (`ops/sync-status.json`)
- `photo_gate.sync_request` — validates manual sync request objects read from R2 (`ops/sync-request.json`)

Tests run entirely without network access, real PhotoPrism, R2, or credentials.

## Remote Sync Status

The sync daemon writes a sanitized status object to private R2 at a fixed key:

```text
ops/sync-status.json
```

- Content-Type: `application/json`
- Cache-Control: `private, no-cache`
- Published: after initial startup, after each attempt start, and after each attempt completion
- Status publish is best-effort: failure does not affect sync success/failure semantics or Docker HEALTHCHECK
- If R2 credentials or configuration are unavailable at daemon startup, the object is not published; local health file behavior remains the source of Docker HEALTHCHECK truth
- The object contains only aggregate/operational fields; no PID, album title, PhotoPrism UID/URL/token, R2 credentials, or source photo data

## Manual Sync Requests

The Worker writes a schema-1 request object to private R2 at the fixed key
`ops/sync-request.json` when an admin submits `POST /admin/sync/request`.
The daemon consumes this object to trigger an out-of-schedule sync:

- **Poll points**: once at the top of each main loop iteration (before the
  scheduled sync attempt) and once per `REQUEST_POLL_INTERVAL` seconds (60 s)
  during the inter-sync sleep.
- **Validation**: the daemon strictly validates the request before acting:
  schema=1, requestId matches `[0-9a-f]{32}`, requestedAt is a valid UTC
  timestamp (millisecond or second form, no offsets), kind=sync-now, exactly
  4 fields, object size ≤ 4096 bytes.
- **Staleness**: requests with `requestedAt` more than 3600 seconds in the
  past are deleted and skipped. Requests more than 60 seconds in the future
  are also deleted and skipped.
- **Delete-after-handling**: after a valid request triggers a sync, the daemon
  best-effort deletes `ops/sync-request.json`. Failure is logged as a warning
  and swallowed.
- **Duplicate guard**: the handled `requestId` is remembered in daemon memory
  for the process lifetime. If the same ID is seen again (e.g. delete failed),
  the request is deleted and skipped.
- **Failure isolation**: GET or DELETE failures for the request object log a
  sanitized warning and do not affect scheduled sync behavior, health state,
  or Docker HEALTHCHECK.
- **No extra sync**: an invalid, stale, or duplicate request is never executed.
  A running sync is never interrupted. A valid request submitted during a sync
  is picked up at the next poll point after the sync completes.

The request object contains only `schema`, `requestId`, `requestedAt`, and
`kind`. No secrets, admin identity, album title, PhotoPrism UID, or R2
credentials appear in the object or in any log line.
