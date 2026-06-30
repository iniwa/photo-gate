Read AGENTS.md, CLAUDE.md, and this handoff file before implementation.
If implementation would violate constraints or require files outside this
handoff, stop and ask before editing.

## Goal

Create an ADR for browser-admin hard delete controls for users and albums.

This is a design-only task. Do not implement routes, repositories, migrations,
tests, deployment, secret changes, or production actions.

The ADR must decide how future admin hard delete flows should work for:

- users;
- albums;
- related D1 cascade behavior;
- browser confirmation guards;
- sync-target implications;
- R2 orphaning and cleanup boundaries.

## Background

The admin browser surface already supports many safe operations:

- user create, password reset, display-name update, enable/disable;
- album create, public metadata update, enable/disable;
- permission grant/revoke with browser-friendly assignment UI;
- browser-owned sync-target upsert/remove;
- read-only R2 cleanup report;
- R2 cleanup deletion-preview Phase 2 with actual R2 deletion still disabled.

Current accepted design documents:

- `docs/decisions/2026-06-26-admin-browser-management.md`
- `docs/decisions/2026-06-30-r2-cleanup-dry-run.md`
- `docs/decisions/2026-06-30-r2-cleanup-deletion-controls.md`

Important existing decisions:

- Disable/depublish is the normal safe path for users and albums.
- User hard delete and album hard delete were deferred to separate handoffs.
- Album hard delete must not delete R2 objects. R2 assets become orphaned and
  are handled only by the separate R2 cleanup process.
- Actual R2 deletion remains disabled until explicit human approval.
- Workers must not access PhotoPrism, NAS, Docker, or Portainer.
- Docker must not read D1.
- `photoprism_album_uid` is write-only after album creation and must not be
  selected or rendered in admin pages.

## Acceptance Criteria

Create `docs/decisions/2026-06-30-admin-hard-delete-controls.md`.

The ADR must cover these decisions clearly:

1. User hard delete policy:
   - disable remains the normal safe path;
   - hard delete is allowed only behind a separate multi-step confirmation;
   - D1 delete target and cascade behavior are explicit;
   - sessions and album permissions are removed via existing foreign-key cascade;
   - R2 is never touched by user deletion.
2. Album hard delete policy:
   - disable/depublish remains the normal safe path;
   - hard delete is allowed only behind a separate multi-step confirmation;
   - D1 delete target and cascade behavior are explicit;
   - album permissions are removed via existing foreign-key cascade;
   - R2 objects are not deleted and become orphaned;
   - the operator must understand that R2 cleanup is a separate process.
3. Sync-target and Docker implications:
   - Worker must not call Docker, Portainer, PhotoPrism, or NAS;
   - Docker must not read D1;
   - album hard delete must account for browser-owned sync-target records in
     `ops/sync-targets.json`;
   - decide whether album hard delete should remove the matching sync target
     entry, require prior sync-target removal, or block if one exists;
   - explain why the chosen behavior preserves boundaries and prevents Docker
     from recreating orphaned R2 content.
4. Confirmation UI model:
   - no JavaScript requirement;
   - at least two steps before any actual D1 delete;
   - Step 1: server-side fresh lookup and target summary;
   - Step 2: exact typed phrase;
   - browser must not supply destructive target facts beyond the stable ID;
   - server must re-read the target before deletion.
5. Candidate summary / displayed data:
   - what may be displayed for user targets;
   - what may be displayed for album targets;
   - what must never be displayed, including password hashes, session tokens,
     PhotoPrism UID, R2 keys, bucket names, Access claims, SQL, exception text,
     and stack traces.
6. Missing target and race behavior:
   - target deleted between Step 1 and Step 2;
   - target changed between Step 1 and Step 2;
   - sync-target changed between Step 1 and Step 2;
   - all ambiguous cases fail closed or restart confirmation.
7. Route / implementation phasing recommendation:
   - Phase 1 ADR only;
   - Phase 2 delete-preview UI only, no D1 DELETE;
   - Phase 3 user hard delete, if approved;
   - Phase 4 album hard delete, if approved;
   - Phase 5 documentation/deployment/smoke;
   - make clear that production actions, commits, pushes, and archival are not
     authorized by this ADR.
8. Verification expectations for future implementation:
   - auth and same-origin checks;
   - strict content-type and body validation;
   - typed phrase mismatch;
   - stale/changed target guard;
   - D1 cascade assumptions;
   - no R2 mutation;
   - no Worker-to-Docker/Portainer/PhotoPrism/NAS calls;
   - sanitized error responses;
   - tests proving sensitive data is not rendered.
9. Explicit non-goals:
   - no R2 deletion;
   - no R2 object listing beyond already-approved cleanup report if not needed;
   - no D1 migration unless future implementation proves schema is insufficient;
   - no PhotoPrism UID exposure;
   - no automatic Docker/Portainer control;
   - no production changes.
10. Relationship to R2 cleanup:
    - album hard delete may create orphan R2 prefixes;
    - orphan prefixes are visible in `/admin/r2-cleanup`;
    - actual R2 deletion stays governed by the separate R2 cleanup deletion
      controls ADR and requires explicit human approval.

The ADR must make a concrete recommendation for sync-target behavior. Preferred
starting point unless you find a strong reason otherwise:

- Album hard delete must remove the matching browser-owned sync-target entry
  from `ops/sync-targets.json` in the same admin workflow before deleting the D1
  album row, or fail closed if the sync-target update cannot be completed.
- This is not Docker access; it is Worker read-modify-write of an existing
  private R2 ops object that the Worker already owns.
- If the matching sync target is absent, album hard delete may proceed after
  confirmation.
- This prevents Docker from continuing to sync an album whose D1 row no longer
  exists.

If you reject this recommendation, document the alternative and rationale.

## Files To Inspect

- `AGENTS.md`
- `CLAUDE.md`
- `FABLE.md`
- `docs/fable/current-state.md`
- `docs/fable/roadmap.md`
- `docs/fable/progress.md`
- `docs/decisions/2026-06-26-admin-browser-management.md`
- `docs/decisions/2026-06-30-r2-cleanup-dry-run.md`
- `docs/decisions/2026-06-30-r2-cleanup-deletion-controls.md`
- `workers/README.md`
- `workers/migrations/0001_users_sessions.sql`
- `workers/migrations/0002_albums_permissions.sql`

## Files To Edit

Edit only:

- `docs/decisions/2026-06-30-admin-hard-delete-controls.md` (new)

Do not edit:

- `workers/`
- `workers/migrations/`
- `docker/`
- `docs/fable/`
- `docs/operations/`
- `docs/handoffs/`
- `docs/handoffs/archive/`
- `.github/`
- `docs/iniwa-issues.md`

## Constraints

- Preserve every non-negotiable invariant in `AGENTS.md`.
- This is ADR-only. No implementation.
- R2 deletion remains disabled.
- Worker must not access PhotoPrism, NAS, Docker, or Portainer.
- Docker must not read D1.
- R2 remains private; do not introduce public URLs or signed URLs.
- Do not expose `photoprism_album_uid`, password hashes, session tokens,
  full R2 keys, photo IDs, bucket names, credentials, Cloudflare Access claims,
  SQL text, stack traces, or exception messages.
- Do not add migrations or change schemas.
- Do not commit, push, deploy, mutate production, register secrets, or archive
  this handoff.
- Preserve unrelated user changes. `docs/iniwa-issues.md`, if present, is
  unrelated and must not be edited, staged, or committed.

## Non Goals

- No code implementation.
- No route or repository changes.
- No tests.
- No D1 DELETE.
- No R2 mutation or deletion.
- No D1 migration.
- No Docker, PhotoPrism, NAS, or Portainer integration.
- No Fable or operations docs update.
- No deployment or live smoke.

## Verification

Run from repository root:

```powershell
git diff --check
git diff HEAD -- workers/
git diff HEAD -- workers/migrations/
git diff HEAD -- docker/
git diff HEAD -- docs/fable/
git diff HEAD -- docs/operations/
git status --short
```

No npm, Python, Docker, or Wrangler verification is required because this is a
single documentation ADR task. If any code files change, stop and report.

## Expected Report

Report in Japanese.

Include:

1. Changed files.
2. ADR decision summary.
3. User hard delete policy.
4. Album hard delete policy.
5. Sync-target/Docker boundary decision.
6. Confirmation flow summary.
7. Sensitive data / privacy proof.
8. R2 cleanup relationship.
9. Future implementation phases.
10. Verification command results.
11. Confirmation that Workers, migrations, Docker, Fable docs, operations docs,
    handoffs/archive, production state, and `docs/iniwa-issues.md` were not
    changed.
12. Any blockers or Codex design questions. If none, say none.