# Project Context

## Purpose

`photo-gate` safely shares selected PhotoPrism albums without exposing
PhotoPrism, NAS originals, or a public object bucket to shared viewers.

The system publishes only generated share assets. Normal viewing must remain
available from Cloudflare Workers, D1, and private R2 without contacting the
home NAS or PhotoPrism.

## Architecture

### PhotoPrism / NAS

Owns originals, RAW/RW2 files, sidecars, indexing, and album curation. It is not
a viewer-facing sharing service. Access is protected by Cloudflare Access.

### Docker Sync Service

Runs on a Raspberry Pi 4 (`linux/arm64`) and:

- reads album photos and generated previews through PhotoPrism APIs;
- re-encodes with pyvips;
- strips and validates removal of EXIF, XMP, IPTC, GPS, and related metadata;
- uploads share thumbnails/previews and a deterministic manifest to R2;
- publishes the manifest only after referenced images are available.

It must not implement viewer authentication, viewer pages, or D1 permissions.

### Cloudflare Workers

Owns viewer/admin UI, login, sessions, D1 authorization, validated manifest
reads, and private R2 image delivery. It must not develop RAW files, transform
images, strip metadata, or access NAS originals.

### Cloudflare R2

Private storage for generated share assets only:

```text
albums/{albumId}/manifest.json
albums/{albumId}/cover.webp
albums/{albumId}/thumbs/{photoId}.webp
albums/{albumId}/previews/{photoId}.jpg
```

Never store originals, RAW/RW2, PhotoPrism data, or location-bearing source
files. Never make the bucket public.

### Cloudflare D1

Stores shared users, sessions, album configuration, album permissions, and
later operational job state.

## Mandatory Request Boundary

Every real viewer data request must follow this order:

1. validate session;
2. validate album permission;
3. for photos, validate exact membership in the current validated manifest;
4. build or validate only a standard private R2 key;
5. read private R2;
6. return a fixed safe response without forwarding R2 metadata.

## Data Consistency

- `manifest.json` schema changes require explicit versioning and compatibility
  consideration.
- Upload or update images before publishing the new manifest.
- Do not publish manifests that reference missing files.
- Sync must be rerunnable and avoid unnecessary regeneration/upload.
- R2 deletion is high risk and remains dry-run only until separately approved.
- PhotoPrism generated previews are input, but must always be re-encoded before
  upload because they may retain metadata.

## Runtime And Technology

- Workers: Node.js 22, TypeScript, Hono + JSX SSR, npm, Workers Assets, D1, R2.
- Docker: Python 3.12, httpx, pyvips, boto3, Debian Bookworm container.
- Docker image target: `linux/amd64` and `linux/arm64`.
- Canonical source repository: Gitea.
- Mirror and CI/CD platform: GitHub.
- Docker runtime management: Portainer; the first stack/container setup is
  performed by a human.

## Durable Security Rules

- Private by default and fail closed.
- Validate all caller-controlled IDs, timestamps, object keys, and D1 results.
- Parameterize D1 SQL.
- Store only session token digests in D1.
- Use secure, HttpOnly, SameSite=Strict session cookies.
- Sanitize errors and never include credentials, tokens, IDs, SQL, object keys,
  manifests, or provider details unless explicitly safe and necessary.
- Do not forward R2 metadata, ETag, cache headers, or content types.
- Authenticated HTML and objects must not enter shared caches.
