Read AGENTS.md, CLAUDE.md, and this handoff file before implementation.
If implementation would violate constraints or require files outside this
handoff, stop and ask before editing.

## Goal

Implement safe viewer download for the already-published R2 preview JPEG.

This is NOT original/RAW/NAS download. It must only return the existing
metadata-stripped preview object already stored in private R2 at:

`albums/<albumId>/previews/<photoId>.jpg`

The feature should add a browser-visible download link from the album detail
photo grid when the album permits downloads, and a download route that streams
that preview JPEG as an attachment.

## Background

The operator wants browser-side photo download. For now the accepted scope is
only the existing R2 preview image, not originals.

Existing safety model:

- Viewer pages use Cloudflare Workers + D1 + private R2 only.
- Workers must not access NAS, PhotoPrism, Docker, or Portainer.
- R2 remains private.
- Only re-encoded, metadata-stripped share assets may be served.
- Thumb/preview image reads must enforce exact membership in the current
  validated manifest before reading the image object.
- `albums.download_enabled` already exists and should gate download behavior.

Existing routes:

- `GET /albums/:albumId` renders the album photo grid.
- `GET /img/:albumId/preview/:photoId` streams the preview JPEG inline.
- `loadManifestAuthorizedPreview(reader, albumId, photoId)` already enforces
  manifest membership before reading the preview object.

## Acceptance Criteria

1. Add a new authenticated viewer download route:
   - recommended path: `GET /download/:albumId/preview/:photoId`;
   - guarded by the same session and album authorization checks as image routes;
   - validates `photoId` with existing safe-ID validation before any manifest or
     R2 read;
   - enforces exact manifest membership using the existing
     `loadManifestAuthorizedPreview` path or an equivalent reuse;
   - reads only the existing preview JPEG object;
   - returns generic 404 for invalid photo ID, manifest absent, photo not listed,
     or object absent;
   - returns generic 500 for manifest invalid, reader failure, or unexpected
     internal error;
   - does not reveal album IDs, photo IDs, R2 keys, bucket names, manifest
     contents, or exception details in error responses.
2. Gate downloads with `albums.download_enabled`:
   - authorized album lookup must expose `download_enabled` safely to viewer code;
   - if `download_enabled = 0`, the download route returns `403 Forbidden`
     before any manifest or R2 read;
   - if `download_enabled = 0`, the album detail page must not render download
     links;
   - if `download_enabled = 1`, render a download link for each photo.
3. Download response headers:
   - `Content-Type: image/jpeg`;
   - `Content-Disposition: attachment; filename="<safe filename>.jpg"`;
   - `Cache-Control: private, no-store`;
   - `X-Content-Type-Options: nosniff`;
   - do not forward R2 object metadata, stored content type, ETag, Last-Modified,
     Content-Length, Content-Range, or stored Cache-Control.
4. Filename safety:
   - derive a safe filename from `photo.title` and/or `photoId` from the current
     validated manifest;
   - strip or replace path separators, quotes, control characters, CR/LF, and
     non-printable characters;
   - cap filename length;
   - if title is empty or sanitizes to empty, fall back to `photoId`;
   - do not include album ID, R2 key, bucket name, PhotoPrism UID, or source hash
     in the filename.
5. Album detail UI:
   - when downloads are enabled, each photo card shows a clear download link or
     button targeting `/download/<albumId>/preview/<photoId>`;
   - existing thumb grid and preview link behavior remains unchanged;
   - when downloads are disabled, no download links are rendered.
6. Boundaries:
   - no NAS access;
   - no PhotoPrism access;
   - no Docker or Portainer access;
   - no RAW/original/high-quality source download;
   - no new R2 objects;
   - no R2 mutation;
   - no D1 migration;
   - no admin changes;
   - no production action, commit, push, deploy, or handoff archival.
7. Documentation:
   - update `workers/README.md` to document the download route, its
     `download_enabled` gate, and that it serves only the existing generated
     preview JPEG as an attachment.

## Files To Inspect

- `AGENTS.md`
- `CLAUDE.md`
- `FABLE.md`
- `docs/fable/project-context.md`
- `docs/fable/current-state.md`
- `workers/src/routes/pages.tsx`
- `workers/src/routes/img-routes.ts`
- `workers/src/index.tsx`
- `workers/src/services/authorized-album-repository.ts`
- `workers/src/types/authorized-album.ts`
- `workers/src/services/manifest-authorized-photo-service.ts`
- `workers/src/services/private-album-object-service.ts`
- `workers/src/middleware/private-object-response.ts`
- `workers/src/middleware/require-session.ts`
- `workers/src/middleware/require-album-permission.ts`
- `workers/src/services/safe-id.ts`
- `workers/test/pages.test.ts` or existing page route tests
- `workers/test/img-routes.test.ts` or existing image route tests
- `workers/test/authorized-album-repository.test.ts`
- `workers/test/private-object-response.test.ts`
- `workers/README.md`

## Files To Edit

Edit only these files unless an existing test filename differs:

- `workers/src/types/authorized-album.ts`
- `workers/src/services/authorized-album-repository.ts`
- `workers/src/middleware/private-object-response.ts` or a new narrowly scoped
  response helper module for attachment responses
- `workers/src/routes/download-routes.ts` (new, recommended)
- `workers/src/routes/pages.tsx`
- `workers/src/index.tsx`
- `workers/test/authorized-album-repository.test.ts`
- `workers/test/private-object-response.test.ts` or equivalent response helper
  test
- `workers/test/download-routes.test.ts` (new, recommended)
- `workers/test/pages.test.ts` or equivalent existing page route test
- `workers/README.md`

Do not edit:

- `workers/migrations/`
- `docker/`
- `docs/fable/`
- `docs/operations/`
- `docs/decisions/`
- `docs/handoffs/archive/`
- `.github/`
- `docs/iniwa-issues.md`

## Constraints

- Preserve every non-negotiable invariant in `AGENTS.md`.
- The route serves only generated private R2 preview JPEGs.
- Do not expose or fetch originals, RAW/RW2, NAS files, PhotoPrism source files,
  or high-quality source JPEGs.
- Worker must not access PhotoPrism, NAS, Docker, or Portainer.
- Docker must not read D1.
- R2 remains private; do not create public URLs or signed URLs.
- Do not add any R2 write/delete/list operation for this feature.
- Do not weaken existing image route behavior.
- Do not bypass manifest membership checks.
- Do not render or log `photoprism_album_uid`, R2 object keys, bucket name,
  PhotoPrism UID/URL/token, source hash, EXIF/GPS, SQL, stack traces, or
  exception messages.
- Preserve unrelated user changes. `docs/iniwa-issues.md`, if present, is
  unrelated and must not be edited, staged, or committed.

## Non Goals

- No preview page/lightbox yet.
- No previous/next navigation yet.
- No multi-select download yet.
- No ZIP download.
- No RAW/original/NAS download.
- No new high-quality generated derivative.
- No Docker changes.
- No D1 migration.
- No admin UI changes.
- No deployment or live smoke.

## Verification

Run from `workers/`:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm audit --omit=dev --audit-level=high
```

Run from repository root:

```powershell
git diff --check
git diff HEAD -- docker/
git diff HEAD -- workers/migrations/
git diff HEAD -- docs/fable/
git diff HEAD -- docs/operations/
git diff HEAD -- docs/decisions/
git status --short
```

Do not run Docker tests unless Docker files are changed by mistake.

## Expected Report

Report in Japanese.

Include:

1. Changed files.
2. Route summary for `GET /download/:albumId/preview/:photoId`.
3. Authorization chain and `download_enabled` behavior.
4. Manifest membership proof.
5. Download response headers, including `Content-Disposition` filename rules.
6. Album detail UI behavior when downloads are enabled vs disabled.
7. Privacy/security proof:
   - no NAS/PhotoPrism/Docker/Portainer access;
   - no originals/RAW/source JPEGs;
   - no R2 mutation;
   - no sensitive data rendered/logged.
8. Failure matrix:
   - unauthenticated;
   - unauthorized album;
   - invalid photo ID;
   - download disabled;
   - manifest absent;
   - photo not in manifest;
   - preview object missing;
   - manifest invalid / reader failure;
   - success.
9. Test additions and key assertions.
10. Verification command results.
11. Skipped checks with exact reasons.
12. Confirmation that Docker, migrations, Fable docs, operations docs,
    decisions, production state, archived handoffs, and `docs/iniwa-issues.md`
    were not changed.
13. Any blockers or Codex design questions. If none, say none.