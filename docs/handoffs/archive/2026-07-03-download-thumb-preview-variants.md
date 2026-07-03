Read AGENTS.md, CLAUDE.md, and this handoff file before implementation.
If implementation would violate constraints or require files outside this
handoff, stop and ask before editing.

## Goal

Implement derived-asset download variants for the viewer:

- low quality: `GET /download/:albumId/thumb/:photoId`
- high quality: existing `GET /download/:albumId/preview/:photoId`

This implements Phase 1 from
`docs/decisions/2026-07-03-download-variants-and-raw-boundary.md`.

RAW/original download is explicitly out of scope and must remain unimplemented.

## Background

The viewer currently supports only preview JPEG attachment downloads:

```text
GET /download/:albumId/preview/:photoId
```

The route already enforces session, album permission, `download_enabled`,
validated manifest membership, and private R2 reads. The project now needs a
small choice between generated low-quality and generated high-quality downloads.

Current generated R2 keys are:

```text
albums/{albumId}/thumbs/{photoId}.webp
albums/{albumId}/previews/{photoId}.jpg
```

Only these generated, metadata-stripped derivatives may be served. Do not add
RAW/original download.

## Acceptance Criteria

1. `GET /download/:albumId/thumb/:photoId` is added.
2. Existing `GET /download/:albumId/preview/:photoId` remains backward
   compatible.
3. Both thumb and preview use the same fail-closed chain:
   - `requireSession` first;
   - `requireAlbumPermission` second;
   - validate `photoId` before any R2 read;
   - `getAuthorizedAlbum` and require `download_enabled === 1` before manifest
     or generated image reads;
   - `loadAlbumManifest`;
   - exact `photo.id === photoId` membership;
   - then read only the selected generated object.
4. Thumb success response:
   - `Content-Type: image/webp`
   - `Content-Disposition: attachment; filename="<safe>.webp"`
   - `Cache-Control: private, no-store`
   - `X-Content-Type-Options: nosniff`
5. Preview success response remains:
   - `Content-Type: image/jpeg`
   - `.jpg` filename
   - `Cache-Control: private, no-store`
   - `X-Content-Type-Options: nosniff`
6. No R2 metadata is forwarded: no `ETag`, `Last-Modified`, `Content-Length`,
   `Content-Range`, stored `Cache-Control`, or stored content type.
7. Safe filenames remain ASCII-only and unique per photo. They may include a
   variant label, but must not include album IDs, R2 keys, bucket names,
   PhotoPrism UIDs, source hashes, source filenames, NAS paths, timestamps,
   EXIF/GPS, SQL, session data, or Access claims.
8. Album detail and photo preview pages render two download links when
   `download_enabled = 1`:
   - low quality / thumb link to `/download/:albumId/thumb/:photoId`
   - high quality / preview link to `/download/:albumId/preview/:photoId`
9. When `download_enabled = 0`, no download links are rendered.
10. No RAW/original link, route, UI label, object key, manifest field, or code
    path is added.
11. Errors remain sanitized and do not reveal album IDs, photo IDs, R2 keys,
    bucket names, PhotoPrism UIDs/URLs/tokens, NAS paths, source hashes, SQL,
    stack traces, or exception messages.
12. Existing image-view routes under `/img` are unchanged.

## Files To Inspect

- `docs/decisions/2026-07-03-download-variants-and-raw-boundary.md`
- `workers/src/routes/download-routes.ts`
- `workers/src/services/private-album-object-service.ts`
- `workers/src/middleware/private-object-response.ts`
- `workers/src/routes/pages.tsx`
- `workers/test/download-routes.test.ts`
- `workers/test/private-object-response.test.ts`
- `workers/test/pages.test.ts`
- `workers/README.md`

## Files To Edit

- `workers/src/routes/download-routes.ts`
- `workers/src/middleware/private-object-response.ts`
- `workers/src/routes/pages.tsx`
- `workers/test/download-routes.test.ts`
- `workers/test/private-object-response.test.ts`
- `workers/test/pages.test.ts`
- `workers/README.md`

Stop before editing any other file.

## Constraints

- Preserve all AGENTS/Fable invariants.
- Do not add RAW, RW2, original, source JPEG, NAS, or PhotoPrism download.
- Do not store or expose RAW/originals in R2.
- Do not add Worker-to-NAS, Worker-to-PhotoPrism, Worker-to-Docker, or
  Worker-to-Portainer access.
- Do not add Docker-to-D1 or Docker viewer authorization logic.
- Do not change manifest schema.
- Do not change R2 key layout.
- Do not change D1 schema or migrations.
- Do not add dependencies, JavaScript, external assets, or CSP relaxations.
- Do not change session/auth/permission middleware semantics.
- Do not forward R2 metadata or provider headers.
- Keep responses private/no-store for downloads.
- Keep errors generic and fail closed.

## Non Goals

- No RAW/original download.
- No admin UI for RAW export.
- No PhotoPrism or NAS integration.
- No public/signed URLs.
- No R2 deletion or cleanup changes.
- No Docker changes.
- No design work beyond the already accepted ADR.
- No commit, push, deploy, or handoff archive.

## Verification

From `workers/`:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm audit --omit=dev --audit-level=high
```

From repository root:

```powershell
git diff --check
git diff HEAD -- docker/
git diff HEAD -- workers/migrations/
git diff HEAD -- docs/fable/
git diff HEAD -- docs/operations/
git diff HEAD -- docs/decisions/
git diff HEAD -- docs/handoffs/archive/
git status --short
```

## Expected Report

Report:

- changed files;
- exact route behavior for thumb and preview;
- auth/permission/download_enabled/manifest membership order;
- success headers for thumb and preview;
- UI behavior when downloads are enabled and disabled;
- proof that RAW/original download is not implemented;
- tests added/updated and key assertions;
- full verification results;
- skipped checks with exact reasons;
- confirmation that Docker, migrations, docs/fable, docs/operations,
  docs/decisions, and archived handoffs were not changed;
- design questions, if any.