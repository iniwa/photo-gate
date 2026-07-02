Read AGENTS.md, CLAUDE.md, and this handoff file before implementation.
If implementation would violate constraints or require files outside this
handoff, stop and ask before editing.

## Goal

Implement Admin Hard Delete Controls Phase 3 for users only.

Wire the already-deployed, two-step hard-delete confirmation flow so
`POST /admin/users/delete` performs the actual D1 user delete after all
existing guards pass.

This handoff must not implement album hard delete, R2 deletion, sync-target
mutation, deployment, commits, pushes, secret registration, or handoff
archival.

## Background

The accepted design is recorded in:

- `docs/decisions/2026-06-30-admin-hard-delete-controls.md`

Phase 2 is already implemented and deployed:

- `workers/src/services/admin-hard-delete-token.ts`
- `workers/src/routes/admin-hard-delete.tsx`
- `POST /admin/users/confirm-delete`
- `POST /admin/users/delete`
- `POST /admin/albums/confirm-delete`
- `POST /admin/albums/delete`

Phase 2 validates:

- admin access through the admin router;
- same-origin `Origin`;
- exact form content type;
- strict form fields;
- `HARD_DELETE_HMAC_KEY` presence and minimum length;
- HMAC token signature, schema, category, target ID, and TTL;
- exact typed phrase (`DELETE USER` or `DELETE ALBUM`);
- target re-read from D1.

Phase 2 currently renders a "hard delete not enabled" page after successful
validation and performs no mutation.

The operator has confirmed that `HARD_DELETE_HMAC_KEY` is registered in the
production Worker environment and the authenticated preview forms render.

For Phase 3, implement only the user delete path:

- `POST /admin/users/delete` becomes destructive after validation.
- `POST /admin/albums/delete` remains preview-only and must not mutate anything.

Existing schema assumptions from the ADR:

- `sessions.user_id` has `ON DELETE CASCADE`.
- `album_permissions.user_id` has `ON DELETE CASCADE`.
- Deleting a user must not touch albums, R2, Docker, PhotoPrism, NAS, or
  Portainer.

## Acceptance Criteria

1. Add a repository method that deletes a user by ID with exactly one
   parameterized D1 statement:

   ```sql
   DELETE FROM users
   WHERE id = ?
   ```

2. The repository method must:

   - validate `userId` with the existing ID validator before D1;
   - use a parameterized bind;
   - require `result.success === true`;
   - treat `meta.changes === 0` as a fail-closed database operation failure;
   - return no user data;
   - sanitize D1 exceptions by throwing the existing generic database operation
     error.

3. `POST /admin/users/delete` must perform the actual delete only after all
   Phase 2 guards and checks already pass:

   - admin guard inherited from admin router;
   - same-origin check;
   - form content type check;
   - exact body fields;
   - exact phrase `DELETE USER`;
   - valid `HARD_DELETE_HMAC_KEY`;
   - valid HMAC token;
   - token category `user-delete`;
   - token target ID re-read from D1;
   - target exists at delete time.

4. The delete handler must re-read the user before deletion using
   `getUserForHardDelete`, then call the new delete method for the same
   target ID.

5. The success response must be an HTML page with `Cache-Control: no-store`
   that states the user hard delete completed. It may display only:

   - user ID;
   - display name;
   - previous enabled state;
   - a note that sessions and album permissions are removed by D1 cascade.

6. Failure behavior must remain fail-closed:

   - missing target at delete time renders the existing sanitized target-missing
     page and does not call delete;
   - repository re-read failure returns sanitized `500 Internal Server Error`;
   - delete failure returns sanitized `500 Internal Server Error`;
   - wrong phrase, malformed/expired/wrong-category token, and bad form return
     the existing rejection behavior;
   - all responses carry `Cache-Control: no-store`.

7. Album hard-delete remains Phase 2 preview-only:

   - `POST /admin/albums/delete` still renders the not-enabled result after
     successful validation;
   - no album D1 delete is added;
   - no sync-target update is added;
   - no R2 write/delete/list is added for hard delete.

8. No sensitive data may be selected, rendered, logged, or included in error
   responses:

   - password hashes;
   - session tokens or token hashes;
   - `photoprism_album_uid`;
   - R2 keys;
   - bucket names;
   - SQL text;
   - stack traces;
   - Cloudflare credentials or Access JWT details.

9. Tests must prove the user delete mutation is reachable only through the
   fully validated path and that no unrelated mutation occurs.

## Files To Inspect

- `docs/decisions/2026-06-30-admin-hard-delete-controls.md`
- `workers/src/routes/admin-hard-delete.tsx`
- `workers/src/routes/admin.tsx`
- `workers/src/services/admin-hard-delete-token.ts`
- `workers/src/services/admin-user-repository.ts`
- `workers/src/services/admin-album-repository.ts`
- `workers/test/admin-hard-delete.test.ts`
- `workers/test/admin-user-repository.test.ts`
- `workers/test/admin-routes.test.ts`
- `workers/README.md`
- `workers/src/types/env.ts`
- `workers/migrations/0001_users_sessions.sql`
- `workers/migrations/0002_albums_permissions.sql`

## Files To Edit

Edit only these files unless you stop and get explicit approval:

- `workers/src/services/admin-user-repository.ts`
- `workers/src/routes/admin-hard-delete.tsx`
- `workers/src/routes/admin.tsx`
- `workers/test/admin-user-repository.test.ts`
- `workers/test/admin-hard-delete.test.ts`
- `workers/test/admin-routes.test.ts`
- `workers/README.md`

Do not edit migrations, Docker files, Fable docs, operations docs, decisions,
archived handoffs, CI workflows, package files, or production configuration.

## Constraints

- Preserve every invariant in `AGENTS.md`.
- This is a destructive D1 user-row operation, but it is explicitly authorized
  by this handoff only for the local implementation path. This handoff does not
  authorize production use, commit, push, deploy, or live deletion.
- Keep the normal safe path as user disable. Do not remove or weaken existing
  enable/disable controls.
- Do not change the token format or HMAC secret name.
- Do not introduce a second confirmation model.
- Do not weaken same-origin or content-type validation.
- Do not select `password_hash` for confirmation or result pages.
- Do not count sessions or permissions unless you can do so without expanding
  the allowed edit scope. Counts are not required.
- Do not add logs for target IDs or deletion details.
- The user delete method must not attempt to manually delete sessions or
  permissions; rely on existing D1 foreign-key cascade.
- If a test framework mock cannot model D1 cascade directly, test that the
  route/repository issues exactly the user-row delete and document that cascade
  is a schema-level assumption from the migrations and ADR.

## Non Goals

- No album hard delete implementation.
- No sync-target removal.
- No R2 deletion or cleanup execution.
- No R2 list/get/put/delete in the hard-delete user path.
- No Docker, PhotoPrism, NAS, or Portainer access.
- No D1 migration.
- No UI redesign beyond the minimal user-delete success result page.
- No Worker secret registration.
- No production deploy, commit, push, or handoff archival.
- No update to `docs/fable/` or `docs/operations/`.

## Verification

Run from `workers/`:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm audit --omit=dev --audit-level=high
```

Also run from the repository root:

```powershell
git diff --check
git diff HEAD -- docker/
git diff HEAD -- workers/migrations/
git diff HEAD -- docs/fable/
git diff HEAD -- docs/operations/
git diff HEAD -- docs/decisions/
```

Expected:

- all Workers checks pass;
- no Docker diff;
- no migration diff;
- no Fable/operations/decision diff;
- only files listed in "Files To Edit" are modified.

## Required Tests

Add or update tests covering at least:

### Repository

- `deleteUser` uses `DELETE FROM users WHERE id = ?`.
- bind order is exactly `[userId]`.
- invalid user ID is rejected before D1.
- successful D1 result resolves.
- `result.success !== true` rejects.
- `meta.changes === 0` rejects.
- D1 exception is sanitized as the generic database operation error.
- no SQL selects or references `password_hash`, sessions, permissions, albums,
  R2, or `photoprism_album_uid`.

### Route

- valid user token + exact phrase + existing target calls delete once and
  returns the success page.
- success page has `Cache-Control: no-store`.
- success page includes only allowed target summary data.
- success page does not include `password_hash`, session token material,
  `photoprism_album_uid`, R2 keys, SQL, or stack traces.
- missing target at delete time does not call delete.
- target re-read failure does not call delete and returns sanitized 500.
- delete failure returns sanitized 500.
- wrong phrase does not call delete.
- malformed, expired, wrong-category, or tampered token does not call delete.
- missing/short `HARD_DELETE_HMAC_KEY` does not call delete.
- album delete route remains preview-only and does not call any delete method.
- no R2 mutation is called by user delete.

## Expected Report

Report in Japanese:

1. Changed files.
2. Implementation summary.
3. Exact user delete SQL and bind order.
4. Confirmation that album delete remains preview-only.
5. Confirmation that no R2/Docker/PhotoPrism/NAS/Portainer path was added.
6. Confirmation that no sensitive data is selected or rendered.
7. Test additions and the main cases they cover.
8. Verification commands and results.
9. Skipped or blocked checks with exact reason.
10. Unexpected findings or follow-up questions for Codex.
