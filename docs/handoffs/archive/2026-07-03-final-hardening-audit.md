# Final Hardening Audit Phase 1

Read `AGENTS.md`, `CLAUDE.md`, and this handoff file before implementation.
If implementation would violate constraints or require files outside this
handoff, stop and ask before editing.

## Goal

Audit the project against the remaining Level 3 / Final Hardening requirements
and produce a concrete, operator-safe gap report. Make only low-risk
documentation corrections when they are clearly factual and directly supported
by the current repository state.

This is an audit and documentation handoff, not a feature implementation
handoff.

## Background

`photo-gate` has completed Level 2 and most Level 3 administration work. The
current production Worker includes:

- browser-complete sync management;
- Docker sync `0.4.2` with reupload suppression;
- R2 cleanup dry-run and deletion-preview routes, with actual R2 deletion still
  disabled;
- preview JPEG download from existing private R2 derivatives;
- viewer photo preview page;
- viewer UI cleanup Phase 1;
- admin hard-delete confirmation preview;
- user hard delete Phase 3;
- album hard delete Phase 4.

The remaining roadmap area is Final Hardening:

- complete deployment, security, recovery, and operator documentation;
- run end-to-end authorization and privacy review;
- review dependency, supply-chain, and GitHub Actions permissions;
- confirm every Definition of Done item.

`docs/operations/operator-actions.md` and `docs/operations/rollback.md` contain
older mojibake text. Do not infer new requirements from corrupted text. Use
`AGENTS.md`, `FABLE.md`, and `docs/fable/` as source of truth, and treat
mojibake docs as candidates for replacement or follow-up cleanup.

## Acceptance Criteria

1. Final hardening coverage is audited against:
   - `docs/fable/definition-of-done.md`;
   - `docs/fable/roadmap.md`;
   - `docs/fable/current-state.md`;
   - `docs/fable/progress.md`;
   - `docs/fable/autonomy-contract.md`;
   - `docs/operations/*.md`;
   - GitHub Actions workflows;
   - Workers and Docker package/dependency configuration.
2. Produce a new Markdown report under `docs/handoffs/` or `docs/operations/`
   summarizing:
   - completed Final Hardening items;
   - missing or stale documentation;
   - security/privacy review gaps;
   - deployment/rollback/recovery gaps;
   - dependency and CI permission observations;
   - recommended next handoffs, ordered by risk and value.
3. If obviously stale facts exist in Fable docs and can be corrected without
   design decisions, update them narrowly. Examples:
   - outdated latest Worker commit/version/test count;
   - a pending item that is now clearly completed and already recorded
     elsewhere;
   - references that say album hard delete is pending after it is deployed.
4. If `docs/operations/operator-actions.md` or `docs/operations/rollback.md`
   is too mojibake-corrupted to be reliable, do not rewrite it wholesale in
   this handoff. Instead, record a follow-up recommendation for a dedicated
   operator-doc rewrite.
5. Confirm that no code behavior changed.

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
- `.github/workflows/*`
- `workers/package.json`
- `workers/package-lock.json`
- `workers/wrangler.jsonc`
- `docker/pyproject.toml`
- `docker/Dockerfile`
- `docker/docker-compose.yml` if present
- active files directly under `docs/handoffs/`

## Files To Edit

Allowed:

- `docs/handoffs/2026-07-03-final-hardening-audit-report.md`
- `docs/fable/current-state.md`
- `docs/fable/roadmap.md`
- `docs/fable/progress.md`

Only edit Fable docs for narrow factual corrections directly supported by the
audit. If a larger rewrite is needed, report it as a follow-up instead of
performing it.

Do not edit:

- `workers/**`
- `docker/**`
- `workers/migrations/**`
- `.github/workflows/**`
- `docs/decisions/**`
- `docs/operations/**`
- `docs/iniwa-issues.md`

## Constraints

- Preserve all non-negotiable invariants in `AGENTS.md`.
- Do not enable actual R2 deletion.
- Do not run destructive commands.
- Do not mutate D1, R2, Cloudflare, GitHub, GHCR, Portainer, PhotoPrism, or NAS.
- Do not commit, push, deploy, tag, archive handoffs, or register/rotate
  secrets.
- Do not print secrets or real token values.
- Do not infer requirements from mojibake historical text when current Fable
  documents provide a clear rule.
- Keep changes documentation-only.
- Prefer evidence-based findings with file references and exact command results.

## Non Goals

- No Workers feature implementation.
- No Docker feature implementation.
- No R2 object deletion.
- No hard-delete behavior changes.
- No RAW/original download design or implementation.
- No UI redesign.
- No dependency upgrades.
- No CI workflow changes.
- No production smoke requiring an authenticated browser session.

## Verification

Run at minimum:

```powershell
git status --short
git diff --check
git diff HEAD -- workers/
git diff HEAD -- docker/
git diff HEAD -- workers/migrations/
git diff HEAD -- .github/workflows/
npm audit --omit=dev --audit-level=high
```

Also inspect dependency and workflow configuration without changing it:

```powershell
Get-ChildItem .github\workflows -File
Get-Content workers\package.json
Get-Content docker\pyproject.toml
```

If you run additional non-mutating checks, report them. Do not run commands that
require network or production credentials unless they are read-only and already
work in the local environment. If a check is skipped, report the exact reason.

## Expected Report

Report in Japanese with these sections:

1. Changed files
2. Audit scope
3. Final Hardening status table
4. Findings, ordered by severity
5. Recommended next handoffs, ordered
6. Verification results
7. Skipped or blocked checks
8. Confirmation of unchanged areas
9. Questions for Codex

For findings, include:

- file and section reference when available;
- risk;
- recommended action;
- whether the action is documentation-only, code, CI, production config, or
  human/operator work.

If no high-severity issues are found, say that clearly and focus the next
handoff recommendations on documentation cleanup, E2E security smoke, and
supply-chain review.
