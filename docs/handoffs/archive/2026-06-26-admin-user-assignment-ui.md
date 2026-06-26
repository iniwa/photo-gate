Read AGENTS.md, CLAUDE.md, and this handoff file before implementation.
If implementation would violate constraints or require files outside this
handoff, stop and ask before editing.

## Goal

Implement Phase 1 from `docs/decisions/2026-06-26-admin-browser-management.md`:

1. Admin user display-name editing.
2. Browser-friendly user/album assignment UI that avoids manual ID typing.

This handoff must not implement user hard delete, album hard delete, album
creation, PhotoPrism catalog publishing, sync-target catalogs, R2 cleanup, or
cloud-storage mutation.

## Background

Existing admin behavior:

- `/admin` is protected by Cloudflare Access JWT verification and admin email
  allowlist.
- Existing admin mutations already use the pattern:
  `requireAdmin` -> strict same-origin Origin -> exact form Content-Type ->
  strict `parseBody({ all: true })` field validation -> clock/repository ->
  `303` redirect with `Cache-Control: no-store`.
- `POST /admin/users/create`, `/reset-password`, `/enable`, and `/disable`
  already exist.
- `POST /admin/permissions/grant` and `/revoke` already exist, but the UI
  requires raw `albumId` and `userId` typing.

ADR decisions to preserve:

- Disable is the normal safe path for users; hard delete is deferred.
- Assignment UI may use admin-only joined queries, but must select only safe
  display fields.
- Disabled users and disabled albums should be visible in assignment UI with
  status labels, so the operator can pre-assign users to disabled albums before
  enabling them.
- `photoprism_album_uid`, password hashes, session tokens, R2 keys, PhotoPrism
  URLs/tokens, NAS paths, and source metadata must never be selected, rendered,
  logged, or returned.

## Acceptance Criteria

### User Display-Name Editing

Add:

- `AdminUserRepository.updateDisplayName(userId, displayName, updatedAt)`
- `POST /admin/users/update-display-name`
- an edit form in `GET /admin/users` for each user row

Behavior:

- Route uses the same admin mutation security sequence as existing user
  enable/disable:
  guard -> same-origin -> form Content-Type -> strict body validation -> clock
  -> repository -> `303 Location: /admin/users`.
- Exact form fields: `userId`, `displayName`.
- Reject missing, repeated, extra, file-valued, invalid, empty, leading/trailing
  whitespace, ASCII control character, or >1024 code point display names with
  `400 no-store`.
- Auth/Origin failures return the existing generic `403 no-store`.
- Content-Type failure returns `400 no-store`.
- Clock/repository failures return fixed `500 no-store`.
- Success returns `303 no-store` with empty body.
- Repository SQL updates only:
  - `display_name`
  - `updated_at`
- Repository SQL must not update:
  - `password_hash`
  - `enabled`
  - `fail_count`
  - `locked_until`
  - `created_at`
  - `sessions`
  - `album_permissions`
  - any album/R2 data
- Unknown user should be a sanitized repository failure (`meta.changes === 0`
  -> `database operation failed`), matching reset-password behavior rather than
  the idempotent enable/disable behavior.

### Browser-Friendly Assignment UI

Add a safe admin-only assignment listing that supports choosing users/albums
without typing raw IDs.

Recommended minimal design:

- Extend `AdminPermissionRepository` with a new read method, for example:
  `listAssignmentOptions()`.
- Return a structured page object containing:
  - users: `id`, `display_name`, `enabled`
  - albums: `id`, `title`, `enabled`
  - permissions: existing `album_id`, `user_id`, `created_at`
- Render on `GET /admin/permissions`:
  - grant form with `<select name="albumId">` and `<select name="userId">`
    built from the safe album/user lists;
  - existing revoke forms for current permissions;
  - status labels for disabled users/albums;
  - no JavaScript requirement.

Constraints for assignment data:

- Disabled users and disabled albums are included, with visible status text.
- Select and render only:
  - `users.id`
  - `users.display_name`
  - `users.enabled`
  - `albums.id`
  - `albums.title`
  - `albums.enabled`
  - `album_permissions.album_id`
  - `album_permissions.user_id`
  - `album_permissions.created_at`
- Do not select or render:
  - `password_hash`
  - session token hashes
  - `fail_count`
  - `locked_until`
  - `photoprism_album_uid`
  - transform settings
  - `strip_exif`
  - R2 keys or object metadata
  - PhotoPrism URLs/tokens
  - NAS paths/source filenames
- Keep grant/revoke POST route contracts unchanged: they still accept
  `albumId` and `userId`, validate IDs, and use the existing repository
  mutations.
- Pagination may remain as the existing permission pagination for permission
  rows. The user/album option lists may be limited to a conservative safe
  maximum (for this private project, 100 each is acceptable) if the repository
  validates row counts and fails closed when exceeded. Document the chosen
  limit in code/tests.

### Documentation

Update `workers/README.md` to record:

- `POST /admin/users/update-display-name`
- `/admin/permissions` now renders safe user/album labels for assignment forms
  while keeping raw ID route contracts.

## Files To Inspect

- `AGENTS.md`
- `CLAUDE.md`
- `docs/decisions/2026-06-26-admin-browser-management.md`
- `workers/src/services/admin-user-repository.ts`
- `workers/src/services/admin-permission-repository.ts`
- `workers/src/routes/admin.tsx`
- `workers/src/types/admin-user.ts`
- `workers/src/types/admin-permission.ts`
- `workers/src/index.tsx`
- `workers/test/admin-user-repository.test.ts`
- `workers/test/admin-permission-repository.test.ts`
- `workers/test/admin-routes.test.ts`
- `workers/test/helpers/mock-d1.ts`
- `workers/README.md`

## Files To Edit

Only:

- `workers/src/types/admin-permission.ts`
- `workers/src/services/admin-user-repository.ts`
- `workers/src/services/admin-permission-repository.ts`
- `workers/src/routes/admin.tsx`
- `workers/test/admin-user-repository.test.ts`
- `workers/test/admin-permission-repository.test.ts`
- `workers/test/admin-routes.test.ts`
- `workers/README.md`

Do not edit migrations, Docker files, Fable docs, deployment docs, or archived
handoffs in this handoff.

## Constraints

- Do not use `claude -p`.
- No production commands.
- No commit, push, deploy, tag, or handoff archive.
- No D1 migration.
- No user hard delete.
- No album create/delete.
- No R2 reads/writes/deletes.
- No PhotoPrism/NAS/Docker/Portainer access.
- No new dependencies.
- Keep all admin responses `Cache-Control: no-store`.
- Keep errors sanitized: no SQL, ID values, display names, titles, internal D1
  error messages, stack traces, or source identifiers in error responses.
- Do not weaken existing admin guard, same-origin, Content-Type, or form
  validation helpers.
- Keep route ordering before `admin.all('*', ...)`.

## Non Goals

- User hard delete.
- Album creation.
- Album hard delete.
- PhotoPrism album catalog.
- Sync-target catalog.
- R2 orphan report or cleanup.
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
```

Do not run Docker tests unless Docker files were accidentally changed.

## Expected Report

Report in Japanese with:

1. Changed files.
2. User display-name edit behavior:
   - route;
   - SQL and bind order;
   - validation and failure responses.
3. Assignment UI behavior:
   - route/page;
   - selected columns;
   - disabled user/album representation;
   - unchanged grant/revoke contract.
4. Explicit non-exposure proof for:
   - password hashes;
   - session tokens;
   - `photoprism_album_uid`;
   - R2 keys;
   - PhotoPrism/NAS/source data.
5. Verification results.
6. Skipped checks with reason.
7. Any design questions for Codex.
