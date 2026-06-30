Read AGENTS.md, CLAUDE.md, and this handoff file before implementation.
If implementation would violate constraints or require files outside this
handoff, stop and ask before editing.

## Goal

Implement a no-JavaScript authenticated viewer photo preview page.

The current album detail grid links thumbnails directly to the private image
object route:

`GET /img/<albumId>/preview/<photoId>`

That opens a bare image. Replace that viewer behavior with an HTML page that
shows the existing generated R2 preview JPEG, plus navigation controls:

- previous photo;
- next photo;
- back to album list/detail;
- download link when the album permits downloads.

This is a viewer UX change only. It must keep using the already-published,
metadata-stripped private R2 preview object through the existing Worker image
route. It must not add NAS, PhotoPrism, original, RAW, or source-JPEG access.

## Background

The operator wants a browser preview experience after login:

- open a photo preview page instead of only the raw image object;
- move to the next image;
- move to the previous image;
- return to the album grid/list;
- keep the existing preview download path available.

Recent related work:

- `GET /download/:albumId/preview/:photoId` is implemented and deployed.
- Manifest schema version 2 is accepted by Workers.
- Preview download filenames were fixed to include `photoId`.
- `docs/decisions/2026-06-30-admin-hard-delete-controls.md` exists, but hard
  delete remains unimplemented. Do not implement hard delete in this handoff.
- R2 cleanup deletion remains disabled except for the already-implemented
  confirmation preview. Do not implement actual R2 deletion in this handoff.

Existing safety model:

- Viewer pages use Cloudflare Workers + D1 + private R2 only.
- Workers must not access NAS, PhotoPrism, Docker, or Portainer.
- R2 remains private.
- Only re-encoded, metadata-stripped share assets may be served.
- A photo object may be read only after exact membership in the current
  validated manifest is confirmed.
- `GET /img/:albumId/preview/:photoId` already performs session auth, album
  authorization, safe ID validation, manifest-first membership, and fixed
  `image/jpeg` response headers.

## Acceptance Criteria

1. Add an authenticated HTML preview page route:
   - recommended path: `GET /albums/:albumId/photos/:photoId`;
   - guarded by the same page session behavior as other viewer pages
     (`requireSessionPage`, unauthenticated -> `303 /`);
   - guarded by the same album authorization behavior as
     `GET /albums/:albumId`;
   - validates `photoId` with existing safe-ID validation before any manifest or
     R2 read;
   - loads and validates the current album manifest with `loadAlbumManifest`;
   - renders the page only if `photoId` is an exact member of
     `manifest.photos`;
   - returns generic `404` for invalid `photoId`, manifest absence, or photo
     not in the current manifest;
   - returns generic `500` for manifest invalid, reader failure, repository
     failure, or unexpected internal error;
   - does not reveal album IDs, photo IDs, R2 keys, bucket names, manifest
     contents, exception details, SQL, PhotoPrism UID, or source hashes in error
     responses.
2. Preview image display:
   - render one main `<img>` whose `src` is the existing safe image route:
     `/img/<albumId>/preview/<photoId>`;
   - do not read the preview image object directly from the page route;
   - rely on the existing `/img` route to enforce manifest membership before
     image object reads;
   - use the photo title as escaped alt text;
   - do not render EXIF/GPS, source hash, dimensions, taken-at timestamp, R2
     path, or manifest paths.
3. Navigation:
   - determine previous and next photos from the current manifest order;
   - if there is a previous photo, render a link to
     `/albums/<albumId>/photos/<previousPhotoId>`;
   - if there is a next photo, render a link to
     `/albums/<albumId>/photos/<nextPhotoId>`;
   - at the first photo, do not render a bogus previous link;
   - at the last photo, do not render a bogus next link;
   - render a back link to `/albums/<albumId>` and keep the existing album-list
     back link behavior where appropriate.
4. Album detail grid behavior:
   - change each thumbnail link from `/img/<albumId>/preview/<photoId>` to
     `/albums/<albumId>/photos/<photoId>`;
   - keep thumbnail image sources unchanged:
     `/img/<albumId>/thumb/<photoId>`;
   - keep the existing per-photo download link behavior unchanged.
5. Download link on preview page:
   - if `download_enabled = 1`, render a download link to
     `/download/<albumId>/preview/<photoId>`;
   - if `download_enabled = 0`, render no download link;
   - do not bypass or duplicate download route security.
6. HTTP behavior:
   - successful preview page responses use `Cache-Control: private, no-cache`;
   - redirects and errors use existing page behavior (`no-store` where current
     helper behavior does so);
   - no client-side JavaScript is required;
   - no new CSP relaxation is required.
7. Documentation:
   - update `workers/README.md` to document
     `GET /albums/:albumId/photos/:photoId`;
   - document that it is an HTML page that embeds the existing `/img` preview
     route and does not serve originals or access PhotoPrism/NAS;
   - note that admin hard delete has an ADR but remains unimplemented only if
     the README already has a relevant "not connected" or route-state section
     touched by this handoff. Do not create a broad Fable rewrite.
8. Boundaries:
   - no NAS access;
   - no PhotoPrism access;
   - no Docker or Portainer access;
   - no RAW/original/source JPEG download;
   - no new R2 objects;
   - no R2 mutation;
   - no R2 list operation;
   - no D1 migration;
   - no admin UI changes;
   - no hard delete implementation;
   - no actual R2 deletion;
   - no production action, commit, push, deploy, or handoff archival.

## Files To Inspect

- `AGENTS.md`
- `CLAUDE.md`
- `FABLE.md`
- `docs/fable/project-context.md`
- `docs/fable/current-state.md`
- `docs/fable/roadmap.md`
- `docs/decisions/2026-06-30-admin-hard-delete-controls.md`
- `docs/decisions/2026-06-30-r2-cleanup-deletion-controls.md`
- `workers/src/routes/pages.tsx`
- `workers/src/routes/img-routes.ts`
- `workers/src/routes/download-routes.ts`
- `workers/src/index.tsx`
- `workers/src/services/authorized-album-repository.ts`
- `workers/src/types/authorized-album.ts`
- `workers/src/services/private-album-object-service.ts`
- `workers/src/services/manifest-authorized-photo-service.ts`
- `workers/src/services/safe-id.ts`
- `workers/src/middleware/require-session-page.ts`
- `workers/src/middleware/require-album-permission.ts`
- `workers/test/pages.test.ts`
- `workers/test/img-routes.test.ts`
- `workers/test/download-routes.test.ts`
- `workers/README.md`

## Files To Edit

Edit only these files unless an existing test filename differs:

- `workers/src/routes/pages.tsx`
- `workers/test/pages.test.ts`
- `workers/README.md`

If an extremely small shared page helper is clearly needed, stop and ask before
creating another source file. The expected implementation should fit in
`pages.tsx`.

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
- The page may embed only generated private R2 preview JPEGs via the existing
  `/img` route.
- Do not expose or fetch originals, RAW/RW2, NAS files, PhotoPrism source files,
  or high-quality source JPEGs.
- Worker must not access PhotoPrism, NAS, Docker, or Portainer.
- Docker must not read D1.
- R2 remains private; do not create public URLs or signed URLs.
- Do not add any R2 write/delete/list operation.
- Do not weaken existing image or download route behavior.
- Do not bypass manifest membership checks.
- Do not render or log `photoprism_album_uid`, R2 object keys, bucket name,
  PhotoPrism UID/URL/token, source hash, EXIF/GPS, SQL, stack traces, or
  exception messages.
- Preserve unrelated user changes. `docs/iniwa-issues.md`, if present, is
  already committed as a user issue list and must not be edited in this handoff.

## Non Goals

- No JavaScript lightbox.
- No modal UI.
- No keyboard navigation.
- No preloading of adjacent images.
- No multi-select download.
- No ZIP download.
- No RAW/original/NAS download.
- No three-kind download selector yet.
- No new high-quality generated derivative.
- No Docker changes.
- No D1 migration.
- No admin UI changes.
- No hard delete implementation.
- No actual R2 deletion.
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
2. Route summary for `GET /albums/:albumId/photos/:photoId`.
3. Authorization chain and failure behavior.
4. Manifest membership proof:
   - invalid `photoId` rejected before manifest/R2 read;
   - unlisted `photoId` does not render an image URL;
   - page route does not read the preview object directly.
5. Preview page UI behavior:
   - main image;
   - previous/next links;
   - back links;
   - download link behavior for `download_enabled = 1` vs `0`.
6. Album detail grid behavior after the change.
7. Privacy/security proof:
   - no NAS/PhotoPrism/Docker/Portainer access;
   - no originals/RAW/source JPEGs;
   - no R2 mutation or R2 list;
   - no sensitive data rendered/logged.
8. Failure matrix:
   - unauthenticated;
   - unauthorized album;
   - invalid photo ID;
   - manifest absent;
   - photo not in manifest;
   - manifest invalid / reader failure;
   - repository failure;
   - success.
9. Test additions and key assertions.
10. Verification command results.
11. Skipped checks with exact reasons.
12. Confirmation that Docker, migrations, Fable docs, operations docs,
    decisions, production state, archived handoffs, and `docs/iniwa-issues.md`
    were not changed.
13. Any blockers or Codex design questions. If none, say none.
