# Download Variants And RAW Boundary

## 1. Context

The viewer currently supports one authenticated attachment route:

```text
GET /download/:albumId/preview/:photoId
```

It returns only the generated private R2 preview JPEG after session validation,
album permission validation, `download_enabled` re-read, manifest validation,
exact photo membership, and a private R2 read.

The requested product direction is a three-choice download UI:

- thumb: low quality derivative;
- preview: existing high quality generated derivative;
- RAW/original: source data.

This conflicts with existing project invariants unless the RAW/original option
is carefully separated. Current invariants say:

- normal viewing uses Workers, D1, and private R2 only;
- shared users never access PhotoPrism or NAS directly;
- Workers must not access NAS originals, PhotoPrism, or develop RAW files;
- R2 must never contain RAW/RW2/originals/location-bearing source files;
- only generated metadata-stripped thumbnails, previews, covers, and manifests
  may be stored in private R2.

## 2. Decision

### 2.1 Implement download variants in phases

Use a phased design:

1. Phase 1: implement derived-asset download variants for generated R2 assets
   only: `thumb` and `preview`.
2. Phase 2: decide whether any RAW/original export is allowed as a separate,
   explicit, operator-approved system. Do not implement RAW/original download in
   the shared viewer.

### 2.2 Phase 1 allowed variants

The Worker may serve these attachment variants:

```text
GET /download/:albumId/thumb/:photoId
GET /download/:albumId/preview/:photoId
```

Both routes must use the same authorization chain:

1. require a valid viewer session;
2. require album permission;
3. validate `photoId` before any R2 read;
4. re-read the album and require `download_enabled = 1`;
5. load and validate `manifest.json`;
6. require exact manifest membership by `photo.id`;
7. read only the manifest-proven generated object key;
8. return a fixed attachment response without forwarding R2 metadata.

`preview` remains backward compatible with the existing route.

`thumb` serves only:

```text
albums/{albumId}/thumbs/{photoId}.webp
```

with fixed response headers:

```text
Content-Type: image/webp
Content-Disposition: attachment; filename="<safe>.webp"
Cache-Control: private, no-store
X-Content-Type-Options: nosniff
```

`preview` continues to serve only:

```text
albums/{albumId}/previews/{photoId}.jpg
```

with fixed response headers:

```text
Content-Type: image/jpeg
Content-Disposition: attachment; filename="<safe>.jpg"
Cache-Control: private, no-store
X-Content-Type-Options: nosniff
```

Filenames may include a safe ASCII title, variant label, and photo ID for
uniqueness. They must never include album IDs, R2 keys, bucket names,
PhotoPrism UIDs, source hashes, source filenames, NAS paths, timestamps, EXIF,
GPS, SQL, session data, or Access claims.

### 2.3 RAW/original is not a viewer feature

Do not add RAW/original download to the shared viewer in the current
architecture.

Specifically, do not add:

- `GET /download/:albumId/raw/:photoId`;
- Worker-to-NAS access;
- Worker-to-PhotoPrism access;
- public or signed R2 URLs for originals;
- RAW/RW2/original storage in R2;
- original filenames, NAS paths, PhotoPrism file paths, or location metadata in
  manifests;
- Docker-to-D1 or Docker viewer authorization logic.

### 2.4 Future RAW/original export must be a separate design

If RAW/original export is still required later, it needs a separate ADR and
human approval. That future design must explicitly answer:

- Who is allowed to export originals: shared viewers, admins only, or operator
  only?
- Is the export online through the app, or an offline operator process?
- How is per-album/per-photo authorization enforced without giving Docker D1
  access or Workers NAS access?
- How are RAW/RW2/original files prevented from entering R2?
- How are source filenames, paths, EXIF/GPS, and PhotoPrism metadata kept out of
  viewer responses and logs?
- How is the operation audited, rate-limited, revoked, and expired?
- What is the incident response if an original or location-bearing file is
  exposed?

Until that ADR is accepted, RAW/original download remains deferred.

## 3. Implementation Phases

### Phase 1: derived download variants

Implement thumb + preview attachment downloads from existing generated R2 assets.
This is a Worker-only change and must not change Docker, R2 object layout,
manifest schema, D1 schema, or production secrets.

Expected UI behavior:

- album detail and photo preview pages may show two download links when
  `download_enabled = 1`:
  - low quality: `/download/:albumId/thumb/:photoId`;
  - high quality: `/download/:albumId/preview/:photoId`.
- when `download_enabled = 0`, no download links are rendered.
- labels must not imply RAW/original availability.

### Phase 2: optional RAW/original export ADR

Only if the operator explicitly wants RAW/original export after Phase 1, write a
new ADR. No code change should be made before that ADR is accepted.

## 4. Security And Privacy Requirements

Phase 1 must prove by tests that:

- unauthenticated requests return 401/no-store;
- missing album permission returns 403/no-store;
- invalid `photoId` returns 404 before R2 reads;
- `download_enabled = 0` returns 403 before manifest or generated image reads;
- manifest missing or membership mismatch returns 404;
- manifest invalid/read failure returns 500 with a sanitized body;
- generated object missing returns 404;
- successful thumb download returns `image/webp` and `.webp` filename;
- successful preview download returns `image/jpeg` and `.jpg` filename;
- no ETag, Last-Modified, Content-Length, Content-Range, stored
  Cache-Control, or R2 metadata is forwarded;
- errors do not expose album IDs, photo IDs, R2 keys, bucket names, PhotoPrism
  UIDs, URLs, tokens, NAS paths, source hashes, SQL, stack traces, or exception
  messages;
- UI does not render any RAW/original link.

## 5. Rejected Alternatives

### Store RAW/originals in R2

Rejected. It violates the invariant that R2 contains only generated,
metadata-stripped share assets. RAW/original files may contain sensitive source
metadata, location data, filenames, and sidecar relationships.

### Have Workers read NAS or PhotoPrism for RAW downloads

Rejected. Workers must not access NAS originals or PhotoPrism and cannot safely
develop RAW files or strip metadata.

### Add signed URLs to PhotoPrism, NAS, or R2 originals

Rejected. It bypasses the current Worker authorization and manifest membership
boundary, and it risks exposing source systems or originals directly to shared
viewers.

### Put source paths or original filenames in the manifest

Rejected. The manifest is a viewer-facing authorization and rendering artifact.
It must not contain NAS paths, original filenames, source paths, EXIF/GPS, or
PhotoPrism source metadata.

## 6. Non Goals

- No RAW/RW2/original download in Phase 1.
- No R2 object layout change.
- No manifest schema change.
- No D1 migration.
- No Worker secret or Cloudflare binding change.
- No Docker sync change.
- No public R2 access.
- No R2 deletion.