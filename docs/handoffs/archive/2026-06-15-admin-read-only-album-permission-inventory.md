# Admin Read-Only Album And Permission Inventory

Status: active.

Read AGENTS.md, CLAUDE.md, and this handoff file before implementation.
If implementation would violate constraints or require files outside this
handoff, stop and ask before editing.

## Goal

Extend the protected admin surface with narrow, read-only inventories:

- `GET /admin/albums`
- `GET /admin/permissions`

This handoff must not add any mutation, sync control, PhotoPrism detail,
session inspection, or R2 inspection.

## Background

- The reviewed and deployed `/admin` Cloudflare Access boundary protects every
  admin path with Worker-side JWT verification and an administrator email
  allowlist.
- `GET /admin/users` established the repository, route dependency injection,
  strict row validation, sanitized error, no-store response, and keyset
  pagination patterns to follow.
- D1 `albums` contains viewer-safe operational fields plus
  `photoprism_album_uid` and sync/transform configuration that are outside this
  narrow inventory.
- D1 `album_permissions` is a composite-key edge table. A permission inventory
  can be useful without joining or exposing user passwords, sessions, album
  source identifiers, or other private data.
- Production Access application setup and Worker values remain a separate
  operator action. This task is local implementation and verification only.

## Acceptance Criteria

- Add links from `GET /admin` to `/admin/albums` and `/admin/permissions`.
- Add `GET /admin/albums`, protected by the existing admin guard.
- List only these fields for each album:
  - `id`
  - `title`
  - `enabled`
  - `expires_at`
  - `download_enabled`
  - `created_at`
  - `updated_at`
- Never select, return, render, log, or otherwise expose
  `photoprism_album_uid`, thumbnail/preview transform configuration,
  `strip_exif`, R2 keys/objects/manifests, or PhotoPrism/NAS details.
- Add `GET /admin/permissions`, protected by the existing admin guard.
- List only these fields for each permission:
  - `album_id`
  - `user_id`
  - `created_at`
- Do not join `users` or `albums` for the permission inventory. Do not expose
  display names, titles, password hashes, sessions, or any additional columns.
- Implement dedicated read-only admin repositories with keyset pagination:
  - page size exactly 50;
  - query at most 51 rows and return at most 50;
  - no `OFFSET`, `COUNT`, `SELECT *`, or unbounded query;
  - all values and limits bound as parameters.
- Album pagination:
  - order by `id ASC`;
  - optional single `after` cursor using a valid album ID.
- Permission pagination:
  - order by `album_id ASC, user_id ASC`;
  - optional composite cursor using exactly one `after_album` and exactly one
    `after_user`;
  - both cursor values must be absent or both present;
  - use the lexicographic condition
    `album_id > ? OR (album_id = ? AND user_id > ?)` with bound values.
- Invalid, incomplete, or repeated cursor query values fail closed with a
  generic `400 Bad Request`, `Cache-Control: no-store`, no reflected input, and
  no repository call.
- Strictly validate every D1 row before returning it:
  - IDs use the existing ID rules;
  - album `title` is a string of at most 1024 Unicode code points;
  - album `enabled` and `download_enabled` are exactly `0` or `1`;
  - album `expires_at` is `null` or a canonical UTC timestamp;
  - all `created_at` and `updated_at` values are canonical UTC timestamps;
  - duplicate album IDs or duplicate permission `(album_id, user_id)` pairs
    are errors;
  - malformed D1 result shapes are errors.
- D1/binding/query/row-validation failures return fixed generic `500`
  responses with `Cache-Control: no-store`. Do not log or echo raw errors,
  IDs, titles, timestamps, cursor values, SQL, or binding details.
- Successful pages use `Cache-Control: no-store`, retain existing security
  headers, render a safe empty state, and add no mutation controls.
- Pagination links contain only validated cursor IDs.
- Existing `/admin` authentication, `/admin/users`, authenticated admin 404,
  viewer routes, D1 schema, and every security invariant remain unchanged.
- Add focused repository and route tests covering SQL shape, explicit selected
  columns, parameterization, row validation, pagination, empty states, cursor
  rejection, generic failures, leak resistance, and preserved authentication.
- Update Workers documentation for both new read-only routes.

## Files To Inspect

- `docs/handoffs/archive/2026-06-15-admin-read-only-user-inventory.md`
- `workers/migrations/0002_albums_permissions.sql`
- `workers/src/index.tsx`
- `workers/src/routes/admin.tsx`
- `workers/src/services/admin-user-repository.ts`
- `workers/src/services/repository-validation.ts`
- `workers/src/types/admin-user.ts`
- `workers/public/styles.css`
- `workers/test/admin-routes.test.ts`
- `workers/test/admin-user-repository.test.ts`
- `workers/test/helpers/mock-d1.ts`
- `workers/README.md`

## Files To Edit

- `workers/src/index.tsx`
- `workers/src/routes/admin.tsx`
- `workers/src/types/admin-album.ts` (new)
- `workers/src/types/admin-permission.ts` (new)
- `workers/src/services/admin-album-repository.ts` (new)
- `workers/src/services/admin-permission-repository.ts` (new)
- `workers/public/styles.css` (only if needed for minimal readable tables)
- `workers/test/admin-routes.test.ts`
- `workers/test/admin-album-repository.test.ts` (new)
- `workers/test/admin-permission-repository.test.ts` (new)
- `workers/README.md`

If combining the two new type files or test files clearly improves the result,
keep the replacement under the same directory and report it. Stop before
editing any other file.

## Constraints

- Preserve every Non-Negotiable Invariant in `AGENTS.md`.
- Preserve the existing Cloudflare Access JWT and allowlist boundary without
  weakening, bypassing, duplicating, or replacing it.
- Reuse the admin user inventory's dependency injection, validation, error,
  pagination, rendering, and testing patterns.
- Use explicit SQL columns. `SELECT *` and joins are forbidden for these
  repositories.
- Password hashes, session data, PhotoPrism identifiers, transform settings,
  object keys, manifests, and R2 data must not appear in implementation SQL,
  returned types, route dependencies, rendered HTML, logs, errors, fixtures,
  or snapshots. Tests may mention forbidden column names only in negative
  assertions proving they are absent.
- Do not add aggregate counts or scans.
- Do not add mutable module-level request state or client-side JavaScript.
- Do not add dependencies or migrations.
- Do not add forms, POST routes, action buttons, hidden mutation endpoints, or
  mutation repository methods.
- Do not display or persist the Access administrator email.
- Keep every admin response non-cacheable.
- Keep failures fixed and sanitized; never expose raw exceptions.
- Use dependency injection so route tests use fake repositories without D1.

## Non Goals

- Creating, editing, enabling, disabling, expiring, or deleting albums.
- Creating or revoking permissions.
- User administration changes or session inspection.
- Showing PhotoPrism album UIDs, sync/transform settings, R2 objects,
  manifests, photo counts, covers, thumbnails, or previews.
- Sync request/status administration or audit logging.
- D1 migrations.
- Access application creation, Worker value registration, deployment,
  production smoke tests, commit, push, or handoff archival.
- General UI redesign.

## Verification

Run from `workers/`:

```powershell
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm audit
```

Also review the final diff for:

- only approved album and permission columns are selected and exposed;
- no forbidden columns/data, joins, mutations, or new dependencies;
- no auth bypass or change to the existing admin guard;
- parameterized, bounded, keyset-paginated SQL only;
- fixed sanitized errors and `no-store` admin responses;
- no real IDs, titles, emails, tokens, object keys, or secrets.

## Expected Report

Report:

- changed files;
- implementation summary;
- exact success, pagination, bad-cursor, empty, and failure behavior for both
  routes;
- exact selected D1 columns and confirmation that forbidden data is absent;
- verification commands and results;
- dependency/audit result;
- any skipped or blocked checks with exact reasons;
- any required out-of-scope edit or design question.
