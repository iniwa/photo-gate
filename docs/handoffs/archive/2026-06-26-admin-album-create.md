Read AGENTS.md, CLAUDE.md, and this handoff file before implementation.
If implementation would violate constraints or require files outside this
handoff, stop and ask before editing.

## Goal

Implement Phase 2 from `docs/decisions/2026-06-26-admin-browser-management.md`:
D1-only album creation from the admin browser.

Add `POST /admin/albums/create` and a create form on `GET /admin/albums` that
inserts an `albums` row with `enabled = 0`. This handoff must not contact
PhotoPrism, NAS, Docker, Portainer, or R2.

## Background

Existing admin album capabilities:

- `GET /admin/albums` lists safe album fields only: `id`, `title`, `enabled`,
  `expires_at`, `download_enabled`, `created_at`, `updated_at`.
- `POST /admin/albums/enable` / `/disable` toggle `enabled`.
- `POST /admin/albums/update-public-metadata` updates only `title`,
  `expires_at`, `download_enabled`, and `updated_at`.
- Existing admin mutations use this pattern:
  `requireAdmin` -> strict same-origin Origin -> exact form Content-Type ->
  strict `parseBody({ all: true })` field validation -> clock/repository ->
  `303` redirect with `Cache-Control: no-store`.

ADR decisions to preserve:

- Creating an album means inserting a D1 row only.
- The Worker must not validate the PhotoPrism UID by calling PhotoPrism.
- The Docker daemon remains configured through Portainer and does not read D1.
- Creating a D1 album row does not configure a sync target and does not write
  any R2 object.
- A new album is inserted with `enabled = 0` explicitly. The schema default is
  `enabled = 1`, so the INSERT must not rely on the default.
- `photoprism_album_uid` is accepted only on create and is write-only after
  insertion. It must never be selected back, rendered as an existing value,
  logged, or returned in an error response.

Relevant schema facts from `workers/migrations/0002_albums_permissions.sql`:

- Required columns without defaults: `id`, `title`, `photoprism_album_uid`,
  `created_at`, `updated_at`.
- `enabled` has schema default `1`, but this route must explicitly insert `0`.
- These columns have schema defaults and must not be user-controlled in this
  handoff: `thumb_long_edge`, `thumb_format`, `thumb_quality`,
  `preview_long_edge`, `preview_format`, `preview_quality`, `strip_exif`.
- `download_enabled` has schema default `0`, but this route accepts explicit
  `downloadEnabled` (`0` or `1`) per ADR Phase 2.

## Acceptance Criteria

### Repository

Add `AdminAlbumRepository.createAlbum(...)`.

Recommended signature:

```ts
createAlbum(
  albumId: string,
  title: string,
  photoprismAlbumUid: string,
  expiresAt: string | null,
  downloadEnabled: 0 | 1,
  createdAt: string,
  updatedAt: string,
): Promise<void>
```

Repository behavior:

- Validate before D1:
  - `albumId`: existing `isValidId`.
  - `title`: same constraints as existing public metadata title validation.
  - `photoprismAlbumUid`: string, non-empty, printable non-whitespace ASCII,
    length <= 128. Use `/^[\x21-\x7e]{1,128}$/` or an equivalent predicate.
  - `expiresAt`: `null` or canonical UTC timestamp accepted by
    `isCanonicalUtcTimestamp`.
  - `downloadEnabled`: numeric `0` or `1` only.
  - `createdAt` and `updatedAt`: canonical UTC timestamps.
- D1 SQL inserts only these explicit columns:
  - `id`
  - `title`
  - `photoprism_album_uid`
  - `enabled`
  - `expires_at`
  - `download_enabled`
  - `created_at`
  - `updated_at`
- SQL must set `enabled` as literal `0` in the INSERT.
- SQL must omit transform and EXIF columns so schema defaults apply:
  - `thumb_long_edge`
  - `thumb_format`
  - `thumb_quality`
  - `preview_long_edge`
  - `preview_format`
  - `preview_quality`
  - `strip_exif`
- SQL must not touch `album_permissions`, `users`, `sessions`, R2, or any other
  table/object.
- Bind order must be documented in tests. Recommended order:
  `(albumId, title, photoprismAlbumUid, expiresAt, downloadEnabled, createdAt, updatedAt)`.
- Duplicate `albumId` / D1 constraint failures are sanitized repository failures
  (`database operation failed`). Do not make create idempotent.

### Route

Add `POST /admin/albums/create` before `admin.all('*', ...)`.

Route behavior:

- Uses the existing admin mutation security sequence:
  guard -> strict same-origin -> exact form Content-Type -> strict body
  validation -> clock -> repository -> `303 Location: /admin/albums`.
- Exact form fields:
  - `albumId`
  - `title`
  - `photoprismAlbumUid`
  - `expiresAt`
  - `downloadEnabled`
- `expiresAt` empty string maps to `null`; non-empty values must be canonical
  `Date.toISOString()` strings.
- `downloadEnabled` accepts only string `"0"` or `"1"` and is converted to
  numeric `0` or `1` before repository use.
- Reject missing, repeated, extra, file-valued, invalid, empty, leading/trailing
  whitespace title, ASCII control title, invalid `albumId`, invalid UID,
  invalid `expiresAt`, or invalid `downloadEnabled` with `400 no-store`.
- Auth/Origin failures return the existing generic `403 no-store`.
- Content-Type failure returns `400 no-store`.
- Clock/repository failures return fixed `500 no-store`.
- Success returns `303 no-store` with empty body.
- No response body may reflect submitted `albumId`, `title`,
  `photoprismAlbumUid`, or D1 error text.

### GET /admin/albums Form

Add a create form to `AdminAlbumsPage`.

Requirements:

- Form action: `/admin/albums/create`.
- Method: `post`.
- Inputs:
  - `name="albumId"`, text, required.
  - `name="title"`, text, required.
  - `name="photoprismAlbumUid"`, text, required.
  - `name="expiresAt"`, text, optional. Placeholder may show the canonical ISO
    format or say blank means no expiry.
  - `name="downloadEnabled"`, select preferred, options `0` and `1`, default `0`.
- The form may contain static label text such as `PhotoPrism album UID`, but it
  must never render any existing/stored UID value from D1.
- The create form should be visible even when the album list is empty.
- Do not add client-side JavaScript.
- Existing enable/disable and update-public-metadata forms must remain
  unchanged in behavior.

### Documentation

Update `workers/README.md` to record:

- `POST /admin/albums/create`.
- It writes D1 only.
- It inserts `enabled = 0` explicitly.
- It accepts `photoprismAlbumUid` only on create and never selects/renders it
  back.
- It does not touch Docker, Portainer, PhotoPrism, NAS, or R2.

## Files To Inspect

- `AGENTS.md`
- `CLAUDE.md`
- `docs/decisions/2026-06-26-admin-browser-management.md`
- `docs/handoffs/archive/2026-06-26-admin-user-assignment-ui.md`
- `workers/migrations/0002_albums_permissions.sql`
- `workers/src/services/admin-album-repository.ts`
- `workers/src/routes/admin.tsx`
- `workers/src/index.tsx`
- `workers/test/admin-album-repository.test.ts`
- `workers/test/admin-routes.test.ts`
- `workers/test/helpers/mock-d1.ts`
- `workers/README.md`

## Files To Edit

Only:

- `workers/src/services/admin-album-repository.ts`
- `workers/src/routes/admin.tsx`
- `workers/test/admin-album-repository.test.ts`
- `workers/test/admin-routes.test.ts`
- `workers/README.md`

Do not edit migrations, Docker files, Fable docs, deployment docs, or archived
handoffs in this handoff.

If an implementation seems to require another file, stop and ask before editing.

## Constraints

- Do not use `claude -p`.
- No production commands.
- No commit, push, deploy, tag, or handoff archive.
- No D1 migration.
- No album enable on create; create must insert `enabled = 0`.
- No album hard delete.
- No user changes.
- No permission grant/revoke changes.
- No R2 reads/writes/deletes/lists.
- No PhotoPrism/NAS/Docker/Portainer access.
- No new dependencies.
- Keep all admin responses `Cache-Control: no-store`.
- Keep errors sanitized: no SQL, ID values, title values, PhotoPrism UID values,
  D1 error details, stack traces, bucket names, or source identifiers in error
  responses.
- Do not log or render submitted `photoprismAlbumUid`.
- Do not weaken existing admin guard, same-origin, Content-Type, or form
  validation helpers.
- Keep route ordering before `admin.all('*', ...)`.
- Keep existing viewer routes and auth behavior unchanged.

## Non Goals

- PhotoPrism album discovery/catalog.
- Validating the UID against PhotoPrism.
- Docker or Portainer sync-target configuration.
- Multi-album sync routing.
- Album hard delete.
- R2 orphan report or cleanup.
- R2 object creation.
- D1 migration or schema changes.
- UI styling beyond minimal existing classes.
- Client-side JavaScript.
- Production smoke/deploy.

## Verification

Run from `workers/`:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm audit --omit=dev --audit-level=high
```

Then from repo root:

```powershell
git diff --check
git diff HEAD -- docker/
git diff HEAD -- workers/migrations/
```

Do not run Docker tests unless Docker files were accidentally changed.

## Expected Report

Report in Japanese with:

1. Changed files.
2. Album create behavior:
   - route;
   - accepted fields;
   - validation;
   - success/failure responses.
3. SQL and bind order:
   - explicit inserted columns;
   - proof that `enabled = 0` is explicit;
   - proof that transform/EXIF columns are omitted and use schema defaults.
4. Privacy and boundary proof:
   - `photoprism_album_uid` is accepted only on create and not selected/rendered
     back;
   - no PhotoPrism/NAS/Docker/Portainer/R2 access;
   - no submitted values reflected in error responses.
5. Tests added/updated.
6. Verification results.
7. Skipped checks with exact reason.
8. Any design questions for Codex.