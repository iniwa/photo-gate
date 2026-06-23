Read AGENTS.md, CLAUDE.md, and this handoff file before implementation.
If implementation would violate constraints or require files outside this
handoff, stop and ask before editing.

## Goal

Update current documentation to record that the production Workers URL is
`https://share-photo.iniwach.com`, the path-scoped Cloudflare Access
application is configured and working, and the former
`photo-gate.iniwaiwana.workers.dev` route is disabled.

## Background

On 2026-06-23, Codex independently verified:

- `GET https://share-photo.iniwach.com/` returns `200`.
- Unauthenticated requests to `/admin` and `/admin/users` are redirected to
  the Cloudflare Access login.
- The operator confirmed that an allowlisted authenticated session reaches the
  admin console after configuring `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, and
  `ADMIN_EMAILS`.
- Both `/` and `/admin` on
  `https://photo-gate.iniwaiwana.workers.dev` return `404`.

Several documents still name the old URL or state that Access configuration is
pending.

## Acceptance Criteria

- Current operational and Fable documents use
  `https://share-photo.iniwach.com` as the production viewer URL.
- Current-state text records that the old `workers.dev` route is disabled and
  returns 404.
- Current-state and progress text record that the Access application and all
  three Worker values are configured and operator-verified.
- The admin Access runbook uses the custom domain in its concrete example and
  no longer claims that all management functionality is unimplemented.
- Historical commit IDs, version IDs, and security behavior are preserved.
- No secret value, administrator email address, Access audience value, token,
  or identity data is added.

## Files To Inspect

- `docs/operations/operator-actions.md`
- `docs/operations/rollback.md`
- `docs/operations/deploy-log.md`
- `docs/operations/admin-access.md`
- `docs/fable/current-state.md`
- `docs/fable/progress.md`
- `docs/fable/roadmap.md`
- `workers/README.md`

## Files To Edit

- `docs/operations/operator-actions.md`
- `docs/operations/rollback.md`
- `docs/operations/deploy-log.md`
- `docs/operations/admin-access.md`
- `docs/fable/current-state.md`
- `docs/fable/progress.md`
- `docs/fable/roadmap.md`
- `workers/README.md`

## Constraints

- Documentation-only change.
- Preserve existing language and formatting style in each file.
- Treat old deployment records as historical evidence; update URLs where they
  function as current operator targets, without rewriting unrelated history.
- Do not expose or invent secret/configuration values.
- Do not change code, dependencies, Worker configuration, CI, or tests.
- Do not commit, push, deploy, or archive this handoff.

## Non Goals

- Disabling or re-enabling any Cloudflare route.
- Changing the Access application or Worker variables.
- Selecting or implementing the next Level 3 feature.
- Broad documentation cleanup or mojibake repair.

## Verification

Run from the repository root:

```powershell
rg -n "photo-gate\.iniwaiwana\.workers\.dev|share-photo\.iniwach\.com|Access configuration is absent|not yet done|PENDING HUMAN" docs workers/README.md
git diff --check
git diff -- docs/operations docs/fable workers/README.md
```

Confirm remaining old-domain references, if any, are explicitly historical and
not presented as the current production target.

## Expected Report

- Changed files.
- Exact current URL and Access-state statements updated.
- Any deliberately retained old-domain references and why.
- Verification results.
- Any ambiguity or required out-of-scope change.
