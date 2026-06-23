Read AGENTS.md, CLAUDE.md, and this handoff file before implementation.
If implementation would violate constraints or require files outside this
handoff, stop and ask before editing.

## Goal

Verify that the production Cloudflare Worker can be rolled back to a recent
known-good version and restored to the current version without changing D1,
R2, Access, DNS, secrets, or application data.

This handoff has two phases. **Only Phase A is currently authorized.** Stop and
report after Phase A. Codex will review the exact version IDs and compatibility
evidence before authorizing any production change in Phase B.

## Background

- Production URL: `https://share-photo.iniwach.com`.
- Current reviewed application commit: `42a7b56`, including user
  enable/disable controls.
- The custom domain and path-scoped Cloudflare Access application are active.
- D1 has two additive migrations; no migration rollback is permitted.
- R2 is private and must not be modified by this verification.
- `docs/operations/rollback.md` documents `wrangler rollback`, but the path has
  not yet been exercised.
- Cloudflare documents that rollback immediately creates a deployment using the
  selected prior Worker version across deployed routes/domains. Connected
  resources are not rolled back, so target compatibility must be established
  before execution.

## Acceptance Criteria

### Phase A: Read-Only Preflight (Authorized)

- Confirm the working tree state and do not discard user changes.
- Confirm the installed Wrangler version.
- Confirm Cloudflare authentication without printing any credential.
- Run read-only Wrangler commands to list current/recent Worker deployments and
  versions for `photo-gate`.
- Identify:
  - the exact currently active version ID;
  - one immediately preceding, recent known-good rollback candidate;
  - the candidate's creation/deployment time and any available annotation or
    source metadata;
  - the exact version ID that will restore the current deployment.
- Correlate candidate/current versions with repository commits and
  `docs/operations/deploy-log.md` as far as available evidence permits.
- Confirm there were no D1 schema changes, Durable Object migrations, deleted
  bindings, or resource-name changes between the candidate and current code.
- Record a proposed Phase B command sequence and smoke checklist in the report,
  but do not run any rollback/deploy command and do not edit files.
- If authentication or Workers Scripts permission is unavailable, stop and
  report the exact command and sanitized error. Do not run `wrangler login`, do
  not request or print a token, and do not attempt an alternate credential.

### Phase B: Production Exercise (Not Authorized Yet)

Do not execute this phase until Codex edits this handoff to name both exact
version IDs and explicitly marks Phase B authorized.

When later authorized, Phase B must:

- capture the active deployment immediately before mutation;
- roll back only to the approved candidate version;
- verify the custom domain still routes correctly;
- run the approved unauthenticated smoke checks;
- obtain operator confirmation for authenticated browser checks;
- immediately restore the approved current version;
- repeat all smoke checks after restoration;
- stop on any unexplained response, binding error, Access failure, or
  data-integrity concern;
- update only the approved operational/Fable documents with timestamps,
  version IDs, commands used, and sanitized results.

## Files To Inspect

- `AGENTS.md`
- `CLAUDE.md`
- `docs/fable/autonomy-contract.md`
- `docs/fable/current-state.md`
- `docs/fable/progress.md`
- `docs/fable/roadmap.md`
- `docs/operations/operator-actions.md`
- `docs/operations/rollback.md`
- `docs/operations/deploy-log.md`
- `.github/workflows/workers-ci.yml`
- `workers/wrangler.toml`
- `workers/migrations/`

## Files To Edit

Phase A:

- None.

Phase B, only after Codex authorization:

- `docs/operations/rollback.md`
- `docs/operations/deploy-log.md`
- `docs/operations/operator-actions.md`
- `docs/fable/current-state.md`
- `docs/fable/progress.md`
- `docs/fable/roadmap.md`

## Constraints

- Run Wrangler from `workers/` using the repository-installed version through
  `npx wrangler`.
- Phase A is strictly read-only locally and remotely.
- Never print, inspect, copy, rotate, or modify secret values or credentials.
- Do not use `claude -p`.
- Do not perform a Worker rollback, deploy, version upload, traffic change,
  Access change, DNS change, route change, secret change, D1 command, R2
  command, or migration command during Phase A.
- Do not use the Cloudflare dashboard as an unreported alternate mutation path.
- Do not change code, dependencies, tests, CI, Worker configuration, or
  generated output.
- Do not infer commit-to-version mapping without evidence; label uncertainty.
- Do not commit, push, deploy, archive this handoff, or start unrelated work.

## Non Goals

- Docker/Portainer image rollback verification.
- D1 backup, restore, migration, or data inspection.
- R2 reads, writes, listing, cleanup, or deletion.
- Testing admin mutation actions against production.
- Changing the custom domain or disabling Cloudflare Access.
- Fixing feature bugs found during preflight.

## Verification

Phase A, from the repository root unless noted:

```powershell
git status --short
git log -12 --oneline
Set-Location workers
npx wrangler --version
npx wrangler whoami
npx wrangler deployments list
npx wrangler versions list
```

If this Wrangler release requires an explicit Worker name for a read-only
command, use only the documented `photo-gate` name and report the final command.
Do not guess additional flags that could mutate production.

Inspect migration and binding history locally with read-only Git commands. Do
not query or modify D1 or R2.

## Phase B Smoke Checklist (Proposal Only)

The Phase A report must propose exact commands and expected results for:

- `GET https://share-photo.iniwach.com/` returns the viewer login page with
  expected security headers.
- Unauthenticated `GET /albums` redirects to `/`.
- Unauthenticated private `/img` and reserved `/api` requests fail closed with
  `401` and `Cache-Control: no-store`.
- Unauthenticated `GET /admin` is intercepted by Cloudflare Access.
- Operator browser check confirms login, album list, thumbnail, preview, and
  authenticated `/admin` behavior.
- The same checks pass again after restoring the current version.

The checklist must not submit login credentials, admin mutations, D1 writes, or
R2 writes.

## Expected Report

- Phase executed (`Phase A` only).
- Working tree status.
- Wrangler version and sanitized authentication/permission result.
- Current active deployment/version ID.
- Proposed rollback candidate version ID and evidence it is known-good.
- Proposed restore version ID.
- Binding/migration compatibility assessment and uncertainties.
- Exact proposed Phase B commands, in order, without executing them.
- Smoke-check plan and expected status/header behavior.
- Every skipped or blocked command with the exact sanitized reason.
- Confirmation that no local files or production state changed.
## Phase B Authorization Amendment

This amendment supersedes the earlier Phase B authorization status. Phase B is
now authorized only with these exact version IDs:

- rollback target: `0fa7821a-850f-46d5-bddb-7f2a8c6d009a`
- restore target: `495c9ae6-3cf5-4a04-a8f0-d93017468811`

Codex verified through read-only `wrangler versions view` that both versions
have the same script etag
`59bf6539e8ab085536fa5c4b68ada1d3927386d9c302b4a18eb37cbdd409ae03`,
handlers, compatibility date, runtime configuration, and D1/R2/assets bindings.
Do not use `01c96d15-5565-451f-98ba-f1071decfbcc`; it contains older code.

Execute from `workers/`:

```powershell
npx wrangler deployments list --name photo-gate
npx wrangler rollback 0fa7821a-850f-46d5-bddb-7f2a8c6d009a --name photo-gate --yes --message "rollback verification 2026-06-23"
npx wrangler deployments list --name photo-gate
```

Run the unauthenticated smoke checklist. Whether it passes or fails, immediately
restore without waiting for operator input:

```powershell
npx wrangler rollback 495c9ae6-3cf5-4a04-a8f0-d93017468811 --name photo-gate --yes --message "restore after rollback verification 2026-06-23"
npx wrangler deployments list --name photo-gate
```

Repeat the unauthenticated smoke checklist after restoration. Then request the
operator's browser confirmation for viewer login, album list, thumbnail,
preview, and authenticated `/admin`.

The only authorized production mutations are the two exact rollback commands
above. Do not run `wrangler deploy`, change traffic percentages, or modify
Access, DNS, routes, secrets, D1, R2, bindings, migrations, or application
data. Production must end on restore target
`495c9ae6-3cf5-4a04-a8f0-d93017468811`.

Phase B may edit only the Phase B documentation files already listed above.
Do not commit, push, deploy new code, or archive this handoff.
## Completion Note

Phase B completed on 2026-06-23. Rollback to `0fa7821a` and restore to
`495c9ae6` succeeded and both unauthenticated smoke runs passed. The exercise
then revealed that the rollback did not restore the three Access secrets.
After re-registering them and correcting `CF_ACCESS_AUD` from the Cloudflare
One dashboard value, the operator confirmed authenticated `/admin` recovery.
The final active version is `08e567cf-76a8-4151-8f76-d92783b73af0`, which has
the same reviewed script etag and all three Access secret bindings.