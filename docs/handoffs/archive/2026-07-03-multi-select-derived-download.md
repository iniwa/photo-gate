Read AGENTS.md, CLAUDE.md, and this handoff file before implementation.
If implementation would violate constraints or require files outside this
handoff, stop and ask before editing.

## Goal

Implement a safe first phase of multi-select downloads for generated viewer
assets only.

Users should be able to select multiple photos on an album detail page and get a
private result page containing individual download links for either:

- low quality generated thumb WebP downloads; or
- high quality generated preview JPEG downloads.

This phase must not implement ZIP archives, automatic browser multi-download,
RAW/original downloads, NAS access, PhotoPrism access, or any new storage path.

## Background

Single-photo generated downloads are already deployed:

```text
GET /download/:albumId/thumb/:photoId
GET /download/:albumId/preview/:photoId
```

Both routes authenticate the session, authorize album access, require
`download_enabled = 1`, validate manifest membership, and then read only the
selected generated R2 object.

`docs/iniwa-issues.md` still has a remaining item for selecting photos from the
list and downloading them. A true bulk archive would require a separate design
because Cloudflare Workers would need ZIP generation or another bundling
strategy. For this handoff, implement the narrow no-JS selection workflow:

1. render selection controls on the album detail page;
2. submit selected `photoId`s and variant (`thumb` or `preview`);
3. re-validate the album, `download_enabled`, manifest, and selected membership;
4. render a no-store HTML page of individual links to the existing download
   routes.

The result page is a convenience page; the actual file downloads still go
through the existing single-photo download routes.

## Acceptance Criteria

1. Album detail pages render multi-select controls only when
   `download_enabled = 1`.
2. The controls allow selecting one or more manifest photos and choosing exactly
   one variant:
   - `thumb` -> links to `/download/:albumId/thumb/:photoId`;
   - `preview` -> links to `/download/:albumId/preview/:photoId`.
3. When `download_enabled = 0`, no multi-select form and no `/download/` links
   are rendered.
4. Add a new no-JS POST route, recommended path:

   ```text
   POST /download/:albumId/selection
   ```

5. The POST route uses the fail-closed chain:
   - `requireSession` first;
   - `requireAlbumPermission` second;
   - same-origin check;
   - exact form Content-Type (`application/x-www-form-urlencoded`, optional
     `charset=utf-8` allowed if that matches existing local form helpers);
   - parse body with bounded fields;
   - require `variant` to be exactly `thumb` or `preview`;
   - require 1..100 selected `photoId` values;
   - every selected `photoId` must pass `isValidId`;
   - `getAuthorizedAlbum` and require `download_enabled === 1` before manifest
     reads;
   - `loadAlbumManifest`;
   - every selected `photoId` must exist exactly in the current manifest;
   - render result HTML only after validation succeeds.
6. The POST route must not read any photo object body. It may read only the
   manifest. Individual generated image reads happen later through existing
   GET download routes when a link is clicked.
7. Failure behavior:
   - unauthenticated -> existing session behavior;
   - permission denied -> 403;
   - invalid Origin / Content-Type / body / variant / selected IDs -> 400;
   - disabled download or race-missing album -> 403;
   - manifest missing -> 404;
   - manifest invalid / reader failure / repository failure -> 500;
   - selected ID not in manifest -> 404.
8. All POST responses are private/no-store. Successful result page should be
   `200` HTML with `Cache-Control: private, no-store`.
9. Result page renders:
   - album title already available from authorized summary;
   - selected photo titles from the validated manifest;
   - one individual download link per selected photo;
   - a link back to `/albums/:albumId`.
10. Result page must not auto-download files, use JavaScript, or create a ZIP.
11. No RAW/original route, UI label, link, object key, manifest field, or code
    path is added.
12. No new dependencies, external assets, CSP relaxations, D1 migrations, R2 key
    layout changes, Docker changes, or Worker-to-NAS/PhotoPrism/Portainer access.
13. Existing single-photo thumb/preview download routes remain backward
    compatible.
14. Errors remain sanitized and do not reveal album IDs, photo IDs, R2 keys,
    bucket names, PhotoPrism UIDs/URLs/tokens, NAS paths, source hashes, SQL,
    stack traces, or exception messages.

## Files To Inspect

- `docs/iniwa-issues.md`
- `docs/decisions/2026-07-03-download-variants-and-raw-boundary.md`
- `workers/src/routes/pages.tsx`
- `workers/src/routes/download-routes.ts`
- `workers/src/services/private-album-object-service.ts`
- `workers/src/middleware/private-object-response.ts`
- `workers/src/middleware/require-session.ts`
- `workers/src/middleware/require-album-permission.ts`
- `workers/test/pages.test.ts`
- `workers/test/download-routes.test.ts`
- `workers/README.md`

## Files To Edit

- `workers/src/routes/pages.tsx`
- `workers/src/routes/download-routes.ts`
- `workers/test/pages.test.ts`
- `workers/test/download-routes.test.ts`
- `workers/README.md`

Stop before editing any other file.

## Constraints

- Preserve all AGENTS/Fable invariants.
- Do not implement ZIP archives in this handoff.
- Do not implement automatic multi-file browser downloads.
- Do not add JavaScript.
- Do not add dependencies.
- Do not add RAW, RW2, original, source JPEG, NAS, or PhotoPrism download.
- Do not store or expose RAW/originals in R2.
- Do not add Worker-to-NAS, Worker-to-PhotoPrism, Worker-to-Docker, or
  Worker-to-Portainer access.
- Do not add Docker-to-D1 or Docker viewer authorization logic.
- Do not change manifest schema.
- Do not change R2 key layout.
- Do not change D1 schema or migrations.
- Do not change session/auth/permission middleware semantics.
- Do not forward R2 metadata or provider headers.
- Keep result and error responses private/no-store where the route is protected.
- Keep errors generic and fail closed.

## Non Goals

- No RAW/original download.
- No admin RAW export.
- No ZIP/bulk archive generation.
- No auto-starting multiple downloads.
- No PhotoPrism or NAS integration.
- No public/signed URLs.
- No R2 deletion or cleanup changes.
- No Docker changes.
- No visual design overhaul beyond minimal form/result markup needed for the
  workflow.
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
- exact UI behavior when downloads are enabled and disabled;
- exact POST `/download/:albumId/selection` behavior;
- auth/permission/same-origin/content-type/body/download_enabled/manifest
  validation order;
- success result page contents;
- proof that the POST route does not read thumb/preview object bodies;
- proof that RAW/original, ZIP, JavaScript, and auto-download were not added;
- tests added/updated and key assertions;
- full verification results;
- skipped checks with exact reasons;
- confirmation that Docker, migrations, docs/fable, docs/operations,
  docs/decisions, and archived handoffs were not changed;
- design questions, if any.