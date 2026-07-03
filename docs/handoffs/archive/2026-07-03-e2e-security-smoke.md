# E2E Security Smoke Review

Read `AGENTS.md`, `CLAUDE.md`, and this handoff file before implementation.
If implementation would violate constraints or require files outside this
handoff, stop and ask before editing.

## Goal

Define and execute a non-destructive end-to-end security smoke review for the
current production deployment, then record the results in project state.

This handoff is primarily verification and documentation. It must not create,
delete, or mutate production user, album, permission, R2, D1, Docker, or
Cloudflare resources.

## Background

Final Hardening still requires an end-to-end authorization and privacy review.
The current production Worker includes:

- viewer login, album list, album detail grid, photo preview page, and preview
  JPEG downloads;
- admin surfaces for users, albums, permissions, sync, ops, R2 cleanup, and hard
  delete controls;
- R2 cleanup dry-run and deletion-preview routes with actual R2 deletion still
  disabled;
- user hard delete Phase 3 and album hard delete Phase 4, already deployed.

The goal here is to prove current security boundaries still hold without
performing destructive actions. Do not hard-delete a real user or album during
this handoff. Do not enable R2 deletion.

## Acceptance Criteria

1. Unauthenticated smoke confirms:
   - `GET /` returns the login page.
   - `GET /albums` redirects to `/`.
   - `GET /img/probe-album/preview/probe-photo` returns unauthenticated failure
     with `Cache-Control: no-store`.
   - `GET /download/probe-album/preview/probe-photo` returns unauthenticated
     failure with `Cache-Control: no-store`.
   - `GET /albums/probe-album/photos/probe-photo` redirects to `/`.
   - `GET /api/probe` returns unauthenticated failure with
     `Cache-Control: no-store`.
   - `GET /admin` is intercepted by Cloudflare Access.
   - `GET /admin/r2-cleanup` is intercepted by Cloudflare Access.
2. Authenticated operator browser smoke is documented as a checklist for the
   human operator. If the operator is available in the same session, record the
   results; otherwise leave the checklist as pending human action.
3. Authenticated checklist must cover:
   - `/admin` loads and does not show secrets.
   - `/admin/users`, `/admin/albums`, and `/admin/permissions` load.
   - `/admin/sync` loads and shows sanitized sync status.
   - `/admin/r2-cleanup` loads, remains dry-run, and does not expose full R2
     keys, photo IDs, bucket credentials, PhotoPrism UIDs, URLs, or tokens.
   - hard-delete preview controls are visible only behind admin auth and still
     require the existing two-step confirmation flow.
   - viewer album list, album detail grid, photo preview page, and preview JPEG
     download work for an authorized viewer.
   - unauthorized or disabled-album checks are not performed destructively; if
     not safely testable, mark them as not exercised and explain why.
4. Document whether any production action was skipped because it would require
   mutation or destructive setup.
5. Update Fable state narrowly to reflect the smoke result.
6. No code behavior changes.

## Files To Inspect

- `AGENTS.md`
- `CLAUDE.md`
- `FABLE.md`
- `docs/fable/project-context.md`
- `docs/fable/current-state.md`
- `docs/fable/roadmap.md`
- `docs/fable/progress.md`
- `docs/fable/definition-of-done.md`
- `docs/fable/autonomy-contract.md`
- `docs/operations/operator-actions.md`
- `docs/operations/rollback.md`
- `docs/operations/deploy-log.md`
- `workers/README.md`
- existing active files under `docs/handoffs/`

## Files To Edit

Allowed:

- `docs/handoffs/2026-07-03-e2e-security-smoke-report.md`
- `docs/fable/current-state.md`
- `docs/fable/progress.md`
- `docs/fable/roadmap.md`

Do not edit:

- `workers/**`
- `docker/**`
- `workers/migrations/**`
- `.github/workflows/**`
- `docs/decisions/**`
- `docs/operations/**`
- `docs/iniwa-issues.md`

## Constraints

- Do not create, delete, enable, disable, or mutate users, albums, permissions,
  sessions, R2 objects, sync targets, D1 rows, secrets, Cloudflare resources,
  GitHub resources, GHCR packages, Portainer stacks, PhotoPrism data, or NAS
  files.
- Do not press or automate actual hard-delete final submit actions.
- Do not enable actual R2 deletion.
- Do not print secrets, cookies, JWTs, session tokens, R2 keys, or private
  object keys.
- Do not commit, push, deploy, tag, archive handoffs, or rotate secrets.
- Browser-authenticated checks may require operator action. If they cannot be
  performed from the agent environment, record them as pending human action
  instead of attempting to bypass auth.
- Use no-store / redirect / Access-intercept behavior as evidence for
  unauthenticated checks.

## Non Goals

- No feature implementation.
- No UI redesign.
- No CI hardening.
- No dependency upgrades.
- No deploy-log version ID backfill.
- No R2 deletion implementation.
- No RAW/original download design.

## Verification

Run at minimum:

```powershell
git status --short
git diff --check
git diff HEAD -- workers/
git diff HEAD -- docker/
git diff HEAD -- workers/migrations/
git diff HEAD -- .github/workflows/
```

For unauthenticated production smoke, use read-only HTTP requests only. Do not
include cookies, credentials, or authorization headers in logs or output.

## Expected Report

Report in Japanese with these sections:

1. Changed files
2. Unauthenticated smoke results
3. Authenticated operator checklist results
4. Security/privacy observations
5. Skipped or pending checks
6. Fable documentation updates
7. Verification results
8. Unchanged areas
9. Follow-up recommendations
10. Questions for Codex

If any smoke check suggests a possible authorization, privacy, or data-integrity
regression, stop and report it before continuing with unrelated work.
