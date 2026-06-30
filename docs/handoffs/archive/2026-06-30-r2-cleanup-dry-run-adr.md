Read AGENTS.md, CLAUDE.md, and this handoff file before implementation.
If implementation would violate constraints or require files outside this
handoff, stop and ask before editing.

## Goal

Create a design ADR for safe R2 cleanup reporting.

This handoff is documentation-only. It must decide the dry-run/reporting design
that comes before any album hard delete or actual R2 object deletion.

## Background

Level 3 browser-complete sync is now deployed. Docker `0.4.2` reupload
suppression is released, applied in Portainer, and live-smoke verified.

Remaining Level 3 work includes:

- album deletion/depublication;
- R2 orphan object reporting;
- final hardening.

The accepted admin browser management ADR already decided:

- disable/depublish is the normal safe path for albums;
- hard delete is deferred;
- R2 cleanup must start as dry-run/reporting only;
- actual R2 deletion requires explicit human approval and a separate reviewed
  handoff;
- hard delete should not be implemented until a dry-run orphan report exists.

Roadmap item "Safe Cleanup" also requires a separately reviewed R2 cleanup ADR
before implementation.

This handoff creates that ADR. Do not implement cleanup code yet.

## Acceptance Criteria

Create `docs/decisions/2026-06-30-r2-cleanup-dry-run.md`.

The ADR must decide:

1. Scope: dry-run/reporting only. No R2 delete, no object mutation, no public
   R2 access, no Worker-to-PhotoPrism/NAS/Docker/Portainer access, no
   Docker-to-D1 access.
2. Ownership model:
   - D1 `albums.id` is the source of active album namespaces;
   - R2 album assets live under `albums/<albumId>/`;
   - operational objects under `ops/` are not album assets and must be excluded;
   - files outside allowed album asset shapes are reported as suspicious or
     out-of-scope, not deleted.
3. Orphan definition:
   - an R2 album prefix is orphaned when it exists under `albums/<albumId>/`
     and there is no corresponding D1 `albums.id`;
   - disabled albums are not orphaned because the D1 row still exists;
   - incomplete or malformed album prefixes should be reported separately;
   - sync-target records alone must not define active ownership.
4. Read model:
   - Worker admin route is the preferred first implementation because Workers
     already have D1 and R2 bindings;
   - Docker must not read D1;
   - Worker must still not contact PhotoPrism/NAS/Docker/Portainer.
5. Proposed future admin route, without implementing it:
   - suggested route name, e.g. `GET /admin/r2-cleanup`;
   - protected by existing `requireAdmin`;
   - `Cache-Control: no-store`;
   - read-only;
   - no JavaScript requirement;
   - no form that can delete objects.
6. Data selected from D1:
   - select only `albums.id`, and optionally `enabled` if needed to label
     disabled-but-owned prefixes;
   - do not select `title`, `photoprism_album_uid`, transform settings, or user
     data.
7. Data read from R2:
   - list keys or prefixes only under `albums/`;
   - do not read object bodies;
   - do not render full object keys if a prefix-level report is sufficient;
   - object counts and approximate byte totals are acceptable if available from
     R2 metadata;
   - no PhotoPrism URLs, tokens, source hashes, EXIF/GPS, manifest contents, or
     raw JSON should be rendered.
8. Pagination and limits:
   - R2 listing must be paginated and bounded;
   - the route must fail closed or show a partial/truncated report explicitly if
     limits are exceeded;
   - no unbounded in-memory list of all bucket objects.
9. Report categories:
   - owned active prefix;
   - owned disabled prefix if disabled state is selected;
   - orphan album prefix;
   - malformed/suspicious key or prefix;
   - non-album operational keys excluded from cleanup scope.
10. Error behavior:
   - D1/R2 failures return sanitized `500` with `no-store`;
   - no bucket name, R2 key, SQL, stack trace, or credentials in responses;
   - report generation must not mutate state.
11. Relationship to album hard delete:
   - this ADR should state that hard delete remains deferred until dry-run
     reporting exists and is reviewed;
   - hard delete must still require a separate implementation handoff and
     two-step confirmation;
   - actual R2 deletion remains outside this ADR and requires explicit human
     approval.
12. Verification expectations for the future implementation:
   - tests for auth failure, no-store, D1 query shape, R2 list pagination,
     orphan classification, disabled-owned classification, malformed keys,
     excluded `ops/` keys, sanitized failures, and no mutation/delete calls.

The ADR should include a recommended implementation phase plan:

- Phase 1: read-only ADR (this task);
- Phase 2: Worker admin dry-run report implementation;
- Phase 3: optional operator documentation and live report smoke;
- Phase 4: separate deletion design only if the operator explicitly requests
  actual deletion later.

## Files To Inspect

- `AGENTS.md`
- `CLAUDE.md`
- `FABLE.md`
- `docs/fable/current-state.md`
- `docs/fable/roadmap.md`
- `docs/fable/progress.md`
- `docs/fable/autonomy-contract.md`
- `docs/decisions/2026-06-26-admin-browser-management.md`
- `docs/operations/backup.md`
- `docs/operations/rollback.md`
- `workers/src/services/private-r2-reader.ts`
- `workers/src/routes/admin.tsx`
- `workers/src/services/admin-album-repository.ts`
- `workers/test/private-r2-reader.test.ts`
- `workers/test/admin-routes.test.ts`

## Files To Edit

Edit only:

- `docs/decisions/2026-06-30-r2-cleanup-dry-run.md`

Do not edit:

- `workers/`
- `workers/migrations/`
- `docker/`
- `docs/fable/`
- `docs/operations/`
- `docs/handoffs/archive/`
- `.github/`
- `docs/iniwa-issues.md`

## Constraints

- Preserve all non-negotiable invariants in `AGENTS.md`.
- R2 deletion stays disabled.
- No production actions.
- No code implementation.
- No migrations.
- No commits, pushes, deployments, tags, Portainer changes, D1 mutation, R2
  mutation, or handoff archival.
- Do not introduce a design that requires Worker access to PhotoPrism, NAS,
  Docker, or Portainer.
- Do not introduce a design that requires Docker access to D1.
- Do not expose secrets, bucket names beyond already documented non-secret
  project names, raw local config, PhotoPrism tokens, URLs, source paths, EXIF,
  GPS, or manifest contents.
- Preserve unrelated user changes. `docs/iniwa-issues.md`, if present, is
  unrelated and must not be edited, staged, or committed.

## Non Goals

- No R2 object deletion.
- No cleanup implementation.
- No admin route implementation.
- No album hard delete implementation.
- No user hard delete implementation.
- No Docker changes.
- No Worker code changes.
- No D1 migrations.
- No deploy or live smoke.
- No Fable state updates.
- No handoff archival.

## Verification

Run from the repository root:

```powershell
git diff --check
git diff HEAD -- workers/
git diff HEAD -- workers/migrations/
git diff HEAD -- docker/
git status --short
```

Do not run Workers or Docker test suites unless code is changed by mistake.
If code is changed by mistake, stop and report before broadening verification.

## Expected Report

Report in Japanese.

Include:

1. Changed files.
2. ADR summary:
   - dry-run only;
   - no R2 deletion;
   - Worker admin read-only report as preferred future implementation;
   - Docker-to-D1 and Worker-to-PhotoPrism/NAS/Docker/Portainer boundaries
     preserved;
   - disabled albums are owned, not orphaned;
   - `ops/` keys excluded.
3. Proposed future route and report categories.
4. Privacy/security proof: no object bodies, no manifest contents, no raw JSON,
   no PhotoPrism tokens/URLs/source paths, no R2 credentials.
5. Future verification expectations.
6. Verification command results.
7. Confirmation that Workers, Docker, migrations, operations docs, Fable docs,
   production state, and `docs/iniwa-issues.md` were not changed.
8. Any blockers or Codex design questions. If none, say none.
