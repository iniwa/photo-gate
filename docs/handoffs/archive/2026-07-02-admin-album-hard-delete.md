Read AGENTS.md, CLAUDE.md, and this handoff file before implementation.
If implementation would violate constraints or require files outside this
handoff, stop and ask before editing.

## Goal

Implement Admin Hard Delete Controls Phase 4 for albums only.

`POST /admin/albums/delete` must become destructive only after the existing
admin hard-delete two-step guard succeeds. It must remove the matching
browser-owned sync target first, then delete the D1 album row.

Do not implement R2 album asset deletion, R2 cleanup deletion, Docker/
PhotoPrism/NAS/Portainer access, deployment, commits, pushes, secret
registration, or handoff archival.

## Background

Design source:

- `docs/decisions/2026-06-30-admin-hard-delete-controls.md`

Current production state:

- Phase 2 confirmation-preview routes are deployed.
- Phase 3 user hard delete is deployed and live-smoke confirmed.
- `HARD_DELETE_HMAC_KEY` is registered.
- Album delete remains preview-only before this handoff.

ADR requirements for album hard delete:

- remove matching `ops/sync-targets.json` entry before D1 delete;
- then execute exactly `DELETE FROM albums WHERE id = ?`;
- rely on `album_permissions.album_id ON DELETE CASCADE`;
- never delete R2 objects under `albums/<albumId>/`;
- never select or render `photoprism_album_uid`.

## Acceptance Criteria

1. Add `AdminAlbumRepository.deleteAlbum(albumId)`.

   SQL must be exactly one parameterized statement:

   ```sql
   DELETE FROM albums
   WHERE id = ?
   ```

   Bind order must be `[albumId]`.

2. `deleteAlbum` must validate `albumId` before D1, require
   `result.success === true`, treat `meta.changes === 0` as fail-closed DB
   failure, return no data, and sanitize D1 exceptions as the existing generic
   database operation error.

3. `POST /admin/albums/delete` must call mutations only after all existing
   guards pass:

   - `requireAdmin` inherited from admin router;
   - same-origin check;
   - exact form content-type;
   - strict body fields;
   - phrase `DELETE ALBUM`;
   - valid `HARD_DELETE_HMAC_KEY`;
   - valid unexpired HMAC token;
   - token category `album-delete`;
   - target re-read via `getAlbumForHardDelete`;
   - target exists at delete time.

4. Mutation order must be:

   1. `getAlbumForHardDelete(albumId)`
   2. `clock().toISOString()`
   3. `syncTargetRepo.removeTarget(albumId, publishedAt)`
   4. `albumRepo.deleteAlbum(albumId)`

   If sync-target removal fails, do not call D1 delete.

5. If no sync-target entry exists, rely on existing `removeTarget` repository
   behavior to succeed and continue to D1 delete.

6. Success response must be HTML + `Cache-Control: no-store`, and may display
   only album ID, title, previous enabled state, a note that album permissions
   are removed by D1 cascade, and a note that R2 objects were not deleted and
   may appear as orphaned prefixes in `/admin/r2-cleanup`.

7. Failure behavior remains fail-closed: missing target, re-read failure, clock
   failure, sync-target removal failure, D1 delete failure, bad phrase, bad
   token, bad form, missing/short secret all must avoid unsafe mutation and
   return sanitized no-store responses.

8. User hard delete remains unchanged: `POST /admin/users/delete` must not call
   sync-target removal or album delete.

9. No sensitive data may be selected, rendered, logged, or returned:
   password hashes, session token material, `photoprism_album_uid`, R2 object
   keys below album-prefix level, bucket names, SQL text, stack traces,
   Cloudflare credentials, Access JWT details, or sync-target JSON contents.

## Files To Inspect

- `docs/decisions/2026-06-30-admin-hard-delete-controls.md`
- `workers/src/routes/admin-hard-delete.tsx`
- `workers/src/routes/admin.tsx`
- `workers/src/services/admin-hard-delete-token.ts`
- `workers/src/services/admin-album-repository.ts`
- `workers/src/services/admin-sync-target-repository.ts`
- `workers/test/admin-hard-delete.test.ts`
- `workers/test/admin-album-repository.test.ts`
- `workers/test/admin-sync-target-repository.test.ts`
- `workers/test/admin-routes.test.ts`
- `workers/README.md`
- `workers/migrations/0002_albums_permissions.sql`

## Files To Edit

Edit only these files unless you stop and get explicit approval:

- `workers/src/services/admin-album-repository.ts`
- `workers/src/routes/admin-hard-delete.tsx`
- `workers/src/routes/admin.tsx`
- `workers/test/admin-album-repository.test.ts`
- `workers/test/admin-hard-delete.test.ts`
- `workers/test/admin-routes.test.ts`
- `workers/README.md`

Do not edit migrations, Docker files, Fable docs, operations docs, decisions,
archived handoffs, CI workflows, package files, or production configuration.

## Constraints

- Preserve every invariant in `AGENTS.md`.
- This handoff authorizes local implementation only. It does not authorize
  production use, commit, push, deploy, or live deletion.
- Keep album disable/depublish as the normal safe path.
- Do not change HMAC token format or secret name.
- Do not weaken same-origin, content-type, or strict form validation.
- Do not select `photoprism_album_uid`.
- Do not delete, list, or read R2 album asset keys under `albums/<albumId>/`.
- The only R2 operation allowed here is existing `syncTargetRepo.removeTarget`
  against `ops/sync-targets.json`.
- Do not manually delete `album_permissions`; rely on D1 cascade.

## Non Goals

- No user hard delete changes.
- No R2 album asset deletion.
- No R2 cleanup deletion execution.
- No Docker, PhotoPrism, NAS, or Portainer access.
- No D1 migration.
- No UI redesign beyond minimal album-delete success page.
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

Run from repo root:

```powershell
git diff --check
git diff HEAD -- docker/
git diff HEAD -- workers/migrations/
git diff HEAD -- docs/fable/
git diff HEAD -- docs/operations/
git diff HEAD -- docs/decisions/
```

Expected: all Workers checks pass; no Docker, migration, Fable, operations, or
decision diff; only files listed in "Files To Edit" are modified.

## Required Tests

Repository:

- `deleteAlbum` uses `DELETE FROM albums WHERE id = ?`.
- bind order is `[albumId]`.
- invalid album ID is rejected before D1.
- success resolves.
- `success !== true`, `meta.changes === 0`, null result, and D1 exception reject
  with sanitized database operation error.
- SQL does not select/reference `photoprism_album_uid`, users, sessions,
  permissions, R2, or sync-targets.

Route:

- valid album token + exact phrase + existing target calls sync-target removal
  once, then D1 album delete once, and returns success page.
- prove mutation order: sync-target removal before D1 delete.
- success page is no-store and includes only allowed summary and R2 orphan note.
- missing target calls neither mutation.
- re-read failure calls neither mutation and returns sanitized 500.
- clock failure calls neither mutation and returns sanitized 500.
- sync-target removal failure does not call D1 delete.
- D1 album delete failure returns sanitized 500.
- wrong phrase, malformed/expired/wrong-category/tampered token, bad form, and
  missing/short secret call no mutation.
- user delete still calls only user delete and never sync-target removal or
  album delete.
- no R2 album asset delete/list/get is called.

## Expected Report

Report in Japanese:

1. Changed files.
2. Implementation summary.
3. Exact album delete SQL and bind order.
4. Confirmation that sync-target removal runs before D1 album delete.
5. Confirmation that user delete remains unchanged.
6. Confirmation that no R2 album asset deletion and no Docker/PhotoPrism/NAS/
   Portainer path was added.
7. Confirmation that no sensitive data is selected or rendered.
8. Test additions and the main cases they cover.
9. Verification commands and results.
10. Skipped or blocked checks with exact reason.
11. Unexpected findings or follow-up questions for Codex.