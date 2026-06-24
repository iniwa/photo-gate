Read AGENTS.md, CLAUDE.md, and this handoff file before implementation.
If implementation would violate constraints or require files outside this
handoff, stop and ask before editing.

## Goal

Add an admin-only operation to update safe public album metadata for existing
albums from `/admin/albums`.

The operation edits only:

- `title`
- `expires_at`
- `download_enabled`
- `updated_at`

It must not create albums, delete albums, touch PhotoPrism identity, change sync
transform settings, mutate permissions, or touch R2 data.

## Background

Level 3 admin work already includes:

- Cloudflare Access JWT validation and admin email allowlist;
- read-only user, album, and permission inventories;
- permission grant/revoke;
- album enable/disable;
- user enable/disable;
- user create/password reset.

The remaining album administration should be split carefully. Full album
creation would require `photoprism_album_uid` and transform settings, which is a
larger sync-coupled design. This handoff intentionally implements only metadata
already displayed in the admin album inventory and safe to edit at the Worker
layer.

Existing album list behavior:

- `GET /admin/albums` selects exactly seven columns:
  `id`, `title`, `enabled`, `expires_at`, `download_enabled`, `created_at`,
  `updated_at`.
- It intentionally does not select or render `photoprism_album_uid`,
  transform settings, `strip_exif`, R2 keys, manifests, permissions, or user
  data.
- `POST /admin/albums/enable` and `/disable` already provide the admin mutation
  pattern to follow.

## Acceptance Criteria

### Route

Add:

- `POST /admin/albums/update-public-metadata`

The route must be behind the existing `/admin` guard and must run in this exact
order:

1. existing `requireAdmin` guard;
2. strict same-origin Origin check;
3. strict URL-encoded form Content-Type check;
4. exact form validation;
5. clock/repository work only after the request is fully validated.

Expected responses:

- auth failure: existing generic `403 Forbidden`, `Cache-Control: no-store`;
- missing/null/malformed/mismatched Origin: `403 Forbidden`, no repository
  call, no clock;
- wrong Content-Type: `400 Bad Request`, `Cache-Control: no-store`, no
  repository call, no clock;
- invalid form: `400 Bad Request`, `Cache-Control: no-store`, no repository
  call, no clock;
- clock failure, invalid clock date, D1 failure, or unknown album id:
  generic `500 Internal Server Error`, `Cache-Control: no-store`;
- success: `303` with `Location: /admin/albums`, `Cache-Control: no-store`,
  empty body.

### Form Shape

`GET /admin/albums` should render a per-row metadata update form.

Fields must be exactly:

- `albumId`
- `title`
- `expiresAt`
- `downloadEnabled`

Validation must reject missing, repeated, file-valued, extra, empty-invalid, or
malformed fields. Use `parseBody({ all: true })` so repeated fields become
arrays and are rejected.

Field validation:

- `albumId`: existing `isValidId`;
- `title`: non-empty string, at most 1024 Unicode code points, no ASCII control
  characters, and no leading/trailing whitespace;
- `expiresAt`: either an empty string, meaning SQL `NULL`, or a canonical UTC
  timestamp exactly equal to `Date.toISOString()` output
  (example: `2026-12-31T23:59:59.000Z`);
- `downloadEnabled`: exact string `"0"` or `"1"`, converted to numeric `0 | 1`;
- no trimming or normalization to make invalid values valid.

The form should use a plain text input for `expiresAt` to preserve the canonical
UTC contract. Do not use client-side JavaScript.

### Repository Behavior

Extend `AdminAlbumRepository` with a narrow method, for example:

```ts
updatePublicMetadata(
  albumId: string,
  title: string,
  expiresAt: string | null,
  downloadEnabled: number,
  updatedAt: string,
): Promise<void>
```

Use a single parameterized D1 statement:

```sql
UPDATE albums
SET title = ?, expires_at = ?, download_enabled = ?, updated_at = ?
WHERE id = ?
```

Bind order must be exactly:

```text
(title, expiresAt, downloadEnabled, updatedAt, albumId)
```

Repository-level validation is mandatory and must mirror route-level value
constraints:

- `albumId` must pass `isValidId`;
- `title` must be non-empty, no leading/trailing whitespace, no ASCII control
  characters, and at most 1024 code points;
- `expiresAt` must be `null` or a canonical UTC timestamp;
- `downloadEnabled` must be exactly numeric `0` or `1`;
- `updatedAt` must be a canonical UTC timestamp.

This is deliberate defense in depth: even if the route is bypassed in a future
refactor, repository calls must reject invalid write values before SQL is
prepared.

Unknown album id:

- treat `meta.changes === 0` as a generic database operation failure when D1
  provides change metadata;
- do not pre-select;
- do not reveal whether the album existed.

### Data Safety

The update must not touch:

- `photoprism_album_uid`
- `thumb_long_edge`, `thumb_format`, `thumb_quality`
- `preview_long_edge`, `preview_format`, `preview_quality`
- `strip_exif`
- `enabled`
- `created_at`
- `album_permissions`
- `users`
- `sessions`
- R2 objects
- manifests
- PhotoPrism or NAS

Existing enable/disable behavior must remain unchanged.

`GET /admin/albums` must continue to select only the existing seven approved
columns. The new form can render the already-approved values (`id`, `title`,
`expires_at`, `download_enabled`) but must not introduce forbidden data.

### Error And Leak Safety

- Do not reflect invalid form input in responses.
- Do not log album ids, titles, timestamps, SQL, D1 errors, Access emails, JWTs,
  or admin identities.
- All D1 failures should map to the same sanitized database operation failure in
  the repository and generic `500` in the route.
- All admin responses remain `Cache-Control: no-store`.

## Files To Inspect

- `AGENTS.md`
- `CLAUDE.md`
- `FABLE.md`
- `docs/fable/current-state.md`
- `docs/fable/roadmap.md`
- `docs/fable/progress.md`
- `workers/src/routes/admin.tsx`
- `workers/src/services/admin-album-repository.ts`
- `workers/src/services/repository-validation.ts`
- `workers/src/types/admin-album.ts`
- `workers/src/index.tsx`
- `workers/migrations/0002_albums_permissions.sql`
- `workers/test/admin-routes.test.ts`
- `workers/test/admin-album-repository.test.ts`
- `workers/test/helpers/mock-d1.ts`
- `workers/README.md`

## Files To Edit

- `workers/src/routes/admin.tsx`
- `workers/src/services/admin-album-repository.ts`
- `workers/test/admin-routes.test.ts`
- `workers/test/admin-album-repository.test.ts`
- `workers/README.md`

Only edit `workers/src/index.tsx` if the route dependency shape cannot be kept
compatible by extending `AdminAlbumRepository` in place.

Only edit `workers/test/helpers/mock-d1.ts` if existing D1 run-result support is
insufficient for checking changed-row metadata.

Do not edit migrations; no schema change is expected.

## Constraints

- Preserve every invariant in `AGENTS.md`.
- Stay within the existing admin mutation security pattern.
- Keep errors sanitized and fail closed.
- Use parameterized D1 statements only.
- Do not add dependencies.
- Do not expose or edit PhotoPrism UID or sync transform settings.
- Do not grant/revoke permissions.
- Do not modify R2 objects or manifests.
- Do not change viewer route semantics except through the existing D1 fields:
  `title`, `expires_at`, and `download_enabled`.
- Preserve existing mojibake text unless directly editing nearby UI labels; do
  not perform broad encoding cleanup.

## Non Goals

- Album creation.
- Album deletion.
- PhotoPrism UID editing.
- Sync transform setting editing.
- Permission changes.
- R2 cleanup.
- Sync administration.
- Audit log storage.
- Client-side JavaScript.
- Production mutation, smoke testing against production, deploy, commit, push,
  or handoff archival.

## Verification

Run from `workers/`:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm audit
npm audit --omit=dev --audit-level=high
```

If any check is skipped or blocked, report the exact command and reason.

## Expected Report

Report back with:

- changed files;
- exact route behavior for `POST /admin/albums/update-public-metadata`;
- exact SQL statement and bind order;
- proof that route-level and repository-level validation both reject invalid
  title, expiry, download flag, id, and timestamp values before D1;
- proof that forbidden columns/tables (`photoprism_album_uid`, transform
  settings, `strip_exif`, `enabled`, `created_at`, permissions, users,
  sessions) are not touched;
- proof that `GET /admin/albums` still selects only the seven approved columns;
- verification results with command names;
- any out-of-scope edits or design questions.
