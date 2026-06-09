Read `AGENTS.md`, `CLAUDE.md`, `photo-gate-design.md`, the PhotoPrism preview decision record, and this handoff file before implementation.
If implementation would violate constraints or require files outside this handoff, stop and ask before editing.

## Goal

Implement the first Phase 1 Docker sync core:

- bootstrap the `docker/` Python package
- list all primary photos in a specified PhotoPrism album
- download PhotoPrism-generated `fit_720` and `fit_3840` previews
- re-encode them into metadata-stripped share assets
- build schema version 1 `manifest.json`
- upload assets through an object-store abstraction, with manifest uploaded last

This handoff must be fully testable without real PhotoPrism, R2, Cloudflare, NAS, or credentials.

## Background

The previous design assumed the Pi service would normally read originals and develop RAW files. Investigation established that PhotoPrism-generated previews can be used as the normal sync source:

- album photos can be queried with `GET /api/v1/photos?s={albumUid}&primary=true`
- each result includes the primary file SHA1 `Hash`
- the response header `X-Preview-Token` permits Thumbnail API requests
- previews can be requested from `/api/v1/t/{hash}/{previewToken}/fit_720` and `fit_3840`

PhotoPrism-generated previews must not be copied directly to R2. An official demo preview was observed to retain an EXIF metadata block. Every share asset must be re-encoded and checked for metadata before upload.

Read:

- `docs/decisions/2026-06-09-use-photoprism-previews-as-sync-source.md`
- `photo-gate-design.md`, especially sections 7, 8, and 12

## Files To Inspect

- `AGENTS.md`
- `CLAUDE.md`
- `photo-gate-design.md`
- `docs/decisions/2026-06-09-use-photoprism-previews-as-sync-source.md`
- `.gitignore`
- `.editorconfig`
- `.gitattributes`

## Files To Create Or Edit

- `docker/pyproject.toml`
- `docker/README.md`
- `docker/src/photo_gate/__init__.py`
- `docker/src/photo_gate/models.py`
- `docker/src/photo_gate/photoprism_client.py`
- `docker/src/photo_gate/image_processor.py`
- `docker/src/photo_gate/manifest.py`
- `docker/src/photo_gate/object_store.py`
- `docker/src/photo_gate/sync.py`
- `docker/tests/test_photoprism_client.py`
- `docker/tests/test_image_processor.py`
- `docker/tests/test_manifest.py`
- `docker/tests/test_sync.py`

Remove superseded `.gitkeep` files only from directories that receive real files in this handoff.

Do not edit files outside this list unless a small documentation correction is strictly required. Ask first if a design change is needed.

## Runtime And Dependencies

- Python: `>=3.12`
- Build backend: standard setuptools configuration in `pyproject.toml`
- Runtime dependencies:
  - `httpx` for PhotoPrism HTTP requests
  - `pyvips` for image re-encoding
- Development dependencies:
  - `pytest`
  - `Pillow`, used only by tests to create and inspect metadata-bearing image fixtures

Do not add boto3, an R2 SDK, FastAPI, Flask, Pydantic, CLI frameworks, or other dependencies in this handoff.

The package must remain compatible with Raspberry Pi `linux/arm64`. Document that local and CI environments need the system `libvips` package.

## Required Contracts

### Models

Use typed dataclasses for the internal models. At minimum represent:

- album identity: public album ID, title, PhotoPrism album UID
- PhotoPrism primary photo: PhotoPrism photo UID, hash, title/name, taken time, width, height
- image settings:
  - thumb: long edge 640, format WebP, quality 80
  - preview: long edge 3840, format JPEG, quality 88
  - metadata stripping enabled
- generated object: R2 key, content type, bytes

Use the PhotoPrism photo `UID` as the stable `photoId` and R2 filename component. Reject unsafe or missing identifiers rather than deriving paths from titles or filenames.

### PhotoPrism Client

Implement an async `httpx` client.

Required behavior:

- accept a normalized PhotoPrism base URL and bearer/app-password token
- optionally accept Cloudflare Access client ID and client secret headers
- send `Authorization: Bearer <token>`
- list an album using `GET /api/v1/photos` with:
  - `s={albumUid}`
  - `primary=true`
  - `count=<page size>`
  - `offset=<offset>`
- continue pagination while `X-Count == X-Limit`
- read and require `X-Preview-Token`
- map only required response fields and reject entries missing `UID` or `Hash`
- download previews from `/api/v1/t/{hash}/{previewToken}/{size}`
- support only an explicit allowlist of sizes needed by this handoff: `fit_720`, `fit_3840`
- reject non-success responses and non-image response content types with clear errors
- apply finite connect/read/write/pool timeouts
- never log or include access tokens, preview tokens, or Cloudflare credentials in error messages

Tests must use `httpx.MockTransport`; do not contact a real PhotoPrism instance.

### Image Processor

Implement image processing with `pyvips`.

Required behavior:

- accept encoded image bytes and return newly encoded bytes
- preserve aspect ratio and never upscale
- thumb output:
  - maximum long edge 640
  - WebP
  - quality 80
- preview output:
  - maximum long edge 3840
  - JPEG
  - quality 88
- apply correct orientation before output
- strip EXIF, XMP, IPTC, GPS, comments, and other source metadata
- avoid carrying source filenames or paths into output metadata
- retain only metadata strictly required to display the image correctly; an ICC profile may be retained if needed for correct color
- provide a validation function used before upload that fails closed if forbidden metadata remains

Tests must create an input image containing EXIF and GPS metadata, process it, and confirm:

- expected output format
- expected dimensions
- no upscaling
- forbidden metadata is absent
- pixel content is still a valid image

Do not claim metadata is stripped based only on encoder options. Inspect the produced bytes in tests.

### Manifest

Generate deterministic UTF-8 JSON matching `schemaVersion: 1` in the design document.

Required behavior:

- use PhotoPrism photo UID for each photo `id`
- use relative asset paths:
  - `thumbs/{photoUid}.webp`
  - `previews/{photoUid}.jpg`
- include album source UID, title, generated timestamp, image settings, title, taken time, width, and height
- sort photos deterministically by taken time, then photo UID
- serialize with stable key/order/formatting so unchanged inputs produce unchanged bytes except when the caller explicitly supplies a different generation timestamp
- reject duplicate photo UIDs

The manifest builder must accept the generation timestamp as an argument. Do not read the current clock inside deterministic serialization logic.

### Object Store And Sync Orchestration

Define a minimal async object-store `Protocol`; do not implement real R2 access yet.

Required operations:

- put an object by key, bytes, and content type

Implement the sync core so that:

1. it lists PhotoPrism album photos
2. for each photo, it downloads `fit_720` and `fit_3840`
3. it produces metadata-stripped thumb and preview assets
4. it validates each output before upload
5. it uploads all image assets
6. it uploads `albums/{albumId}/manifest.json` only after every image upload succeeds

If any image fetch, processing, validation, or image upload fails, manifest must not be uploaded.

Use bounded concurrency for per-photo work. The limit must be supplied by the caller and default conservatively for Raspberry Pi use. Avoid loading every album image into memory at once.

The sync test must use an in-memory fake object store and assert that manifest is the final upload. It must also assert that manifest is absent after an injected image-upload failure.

## Error Handling

- Use explicit project exceptions or clear standard exceptions; do not silently skip malformed photos.
- Errors must identify the operation and safe photo UID/hash context where useful.
- Never include credentials or preview tokens in exceptions.
- Do not retry in this handoff. Leave retry/backoff policy for a later handoff.

## Constraints

- Preserve all architecture and security invariants in `AGENTS.md`.
- PhotoPrism previews are the only image source in this handoff.
- Do not read RAW, originals, NAS mounts, or PhotoPrism storage directories.
- Do not directly copy PhotoPrism preview bytes to output.
- Do not implement a fallback to originals.
- Do not upload an asset unless metadata validation succeeds.
- Do not implement deletion or cleanup.
- Do not implement real R2 access.
- Do not implement the sync HTTP API/server.
- Do not add Dockerfile, compose, GitHub Actions, or deployment configuration yet.
- Do not touch secrets, credentials, `.env`, or local settings.
- Do not commit automatically.

## Non Goals

- real PhotoPrism integration testing
- real R2 integration
- R2 diff calculation, skip logic, cleanup, trash prefix, or deletion
- persistent job state
- D1 or Workers changes
- API server endpoints
- CLI commands
- retries and backoff
- Docker image creation
- deployment or CI/CD
- RAW development or original-file fallback
- resolving PhotoPrism maximum-preview-size fallback behavior

## Verification

From `docker/`:

```powershell
python -m pip install -e ".[dev]"
python -m pytest
python -m compileall src
```

Also run from the repository root:

```powershell
git diff --check
git status --short
```

Tests must not require network access, credentials, R2, PhotoPrism, or Cloudflare.

If `libvips` is unavailable in the execution environment, report the blocked image-processing tests clearly. Do not replace `pyvips` with Pillow in runtime code merely to make local verification pass.

## Expected Report

- Changed files
- Implementation summary
- Dependency choices and versions selected
- Verification results
- Blocked checks and reasons
- Any API/schema/design questions that should return to Codex
