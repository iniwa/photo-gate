# Operator Documentation Rewrite

Read `AGENTS.md`, `CLAUDE.md`, and this handoff file before implementation.
If implementation would violate constraints or require files outside this
handoff, stop and ask before editing.

## Goal

Rewrite stale and mojibake-corrupted operator documentation into readable,
current, operator-safe Japanese documentation that reflects the deployed
production state.

This is documentation work only. Do not change code, CI, secrets, infrastructure,
R2/D1 data, Docker runtime, or production configuration.

## Background

The Final Hardening audit identified operator documentation as the highest
priority remaining gap. In particular:

- `docs/operations/operator-actions.md` is outdated and mojibake-corrupted.
- `docs/operations/rollback.md` is also mojibake-corrupted.
- Current production differs materially from those documents:
  - Docker sync is `0.4.2`, not `0.2.1`.
  - browser-complete sync is deployed.
  - R2 cleanup dry-run and deletion-preview are deployed, actual R2 deletion is
    still disabled.
  - `R2_CLEANUP_HMAC_KEY` and `HARD_DELETE_HMAC_KEY` are part of current
    operation.
  - user hard delete Phase 3 and album hard delete Phase 4 are deployed.
  - album hard delete removes the matching sync target before deleting the D1
    album row and leaves R2 objects for the separate cleanup flow.
  - preview JPEG download and viewer photo preview pages are deployed.
  - RAW/original download remains deferred and requires a separate ADR.

The audit report file
`docs/handoffs/2026-07-03-final-hardening-audit-report.md` is itself mojibake in
the working tree. Use the repository state and this handoff as the source of
truth; do not copy corrupted prose into rewritten docs.

## Acceptance Criteria

1. `docs/operations/operator-actions.md` is rewritten in readable Japanese.
2. `docs/operations/rollback.md` is rewritten or repaired in readable Japanese.
3. The rewritten docs clearly separate:
   - normal operations;
   - emergency operations;
   - human-approval-only destructive operations;
   - explicitly deferred work.
4. The docs reflect current production state without exposing secrets or real
   sensitive identifiers.
5. The docs include current operator actions for:
   - Worker deployment/CI observation;
   - Worker secret presence checks and re-registration cautions;
   - Docker/Portainer immutable-tag updates;
   - Docker rollback by tag;
   - manual sync and sync status;
   - album catalog publication;
   - browser-managed sync targets;
   - R2 cleanup dry-run and deletion-preview;
   - hard delete controls and their risks;
   - what must not be done without explicit approval.
6. The docs explicitly state:
   - R2 must remain private;
   - Workers do not access NAS or PhotoPrism;
   - Docker does not read D1;
   - RAW/original download is deferred;
   - actual R2 deletion remains disabled until separately approved.
7. Update Fable docs only if needed to point to the rewritten operator docs or
   correct narrow factual drift discovered during the rewrite.
8. No code behavior changes.

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
- `docs/operations/admin-access.md`
- `docs/operations/backup.md`
- `docs/operations/bootstrap.md`
- `docs/operations/deploy-log.md`
- `docs/operations/operator-actions.md`
- `docs/operations/rollback.md`
- `docs/handoffs/2026-07-03-final-hardening-audit-report.md`
- `workers/README.md`
- `docker/README.md`
- `.github/workflows/workers-ci.yml`
- `.github/workflows/docker-ci.yml`

## Files To Edit

Allowed:

- `docs/operations/operator-actions.md`
- `docs/operations/rollback.md`
- `docs/fable/current-state.md`
- `docs/fable/progress.md`
- `docs/fable/roadmap.md`

Do not edit:

- `workers/**`
- `docker/**`
- `workers/migrations/**`
- `.github/workflows/**`
- `docs/decisions/**`
- `docs/iniwa-issues.md`
- archived handoffs

## Constraints

- Documentation-only change.
- Do not print, invent, or record secret values.
- Do not record real user IDs, album IDs, PhotoPrism UIDs, R2 object keys below
  album prefixes, access tokens, account IDs, bucket credentials, or private
  hostnames unless already intentionally documented as non-secret public
  operational labels.
- Do not mutate production or run commands that write to Cloudflare, GitHub,
  GHCR, R2, D1, Portainer, PhotoPrism, NAS, or Docker runtime.
- Do not commit, push, deploy, tag, archive handoffs, rotate secrets, or enable
  R2 deletion.
- Keep instructions actionable for a human operator.
- Prefer current Fable docs and accepted ADRs over corrupted historical text.

## Non Goals

- No code implementation.
- No CI hardening.
- No dependency upgrades.
- No deploy-log version ID backfill.
- No authenticated production smoke.
- No R2 deletion implementation.
- No RAW/original download design.
- No UI redesign.

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

Do not run production-mutating commands. If any check is skipped, report the
exact reason.

## Expected Report

Report in Japanese with these sections:

1. Changed files
2. Rewrite summary
3. Current operator workflow covered
4. Human-approval-only operations documented
5. Deferred/prohibited operations documented
6. Verification results
7. Unchanged areas
8. Follow-up recommendations
9. Questions for Codex

Call out explicitly whether the rewritten documents are free of mojibake and
readable as Japanese.
