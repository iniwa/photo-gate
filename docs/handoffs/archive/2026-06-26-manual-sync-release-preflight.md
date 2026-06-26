Read AGENTS.md, CLAUDE.md, and this handoff file before implementation.
If implementation would violate constraints or require files outside this
handoff, stop and ask before editing.

## Goal

Prepare the manual sync feature for production rollout without performing
unapproved production changes.

This handoff has three phases:

1. Phase A: local release-preflight work. This phase is authorized.
2. Phase B: Workers production deployment and smoke checks. This phase is not
   authorized unless the operator explicitly approves it during the Claude Code
   session.
3. Phase C: Docker image release / Portainer stack update / live sync smoke.
   This phase is not authorized unless the operator explicitly approves it
   during the Claude Code session.

The expected next stable Docker sync release version is `0.3.0`, because the
manual sync request/status/admin UI loop is a user-visible operational feature
added after the deployed `0.2.1` sync daemon.

## Background

The manual sync loop is implemented and reviewed locally:

- Worker request writer: `POST /admin/sync/request` writes
  `ops/sync-request.json`.
- Docker daemon request consumer: polls `ops/sync-request.json`, validates it,
  runs a normal sync path, then best-effort deletes the request.
- Worker admin sync UI/status: `GET /admin/sync` shows sync status, trigger
  metadata, pending-request boolean, and a no-JS manual "sync now" form.

Recent commits on `main`:

- `281375c feat: add admin sync request writer`
- `f4b3922 feat: consume manual sync requests`
- `ec6aa02 feat: add manual sync admin UI`

Current documented production state still says:

- Worker production is code-equivalent to commit `42a7b56`.
- Docker production runs `ghcr.io/iniwa/photo-gate-sync:0.2.1`.
- Manual sync production deploy/release/smoke remains incomplete.

Known environment issue:

- Docker Desktop has not been running locally in recent Codex checks. If Docker
  is still unavailable, report that and do not fake container build/smoke
  results.

## Acceptance Criteria

Phase A must:

- Confirm the working tree state before editing.
- Confirm whether `docker/pyproject.toml` is still at `0.2.1`.
- If still `0.2.1`, bump it to `0.3.0`.
- Do not change Worker or Docker feature behavior.
- Run the required local verification listed below.
- Produce exact Phase B and Phase C proposed commands/checks, but do not run
  production-mutating commands without explicit operator approval.
- Keep documentation honest: do not mark production deploy/release/smoke as
  complete unless it was actually completed in this session.

If Phase B is explicitly approved, it must:

- Confirm Cloudflare/Wrangler authentication without printing tokens or secret
  values.
- Confirm the active Worker deployment before changing it.
- Deploy the current `main` Worker code only through the existing approved
  deployment path.
- Confirm `GET /admin/sync` is available behind Cloudflare Access.
- Confirm unauthenticated viewer/admin boundary smoke checks still behave as
  expected.
- Record the deployed Worker version ID and commit in operations docs.

If Phase C is explicitly approved, it must:

- Confirm the release commit includes the `0.3.0` version bump.
- Build/smoke the Docker image locally if Docker is available.
- Prepare or execute the `sync-v0.3.0` tag only if explicitly authorized.
- Confirm GHCR publishes `ghcr.io/iniwa/photo-gate-sync:0.3.0` before any
  Portainer update.
- Provide exact Portainer stack update instructions for changing the image tag
  from `0.2.1` to `0.3.0`.
- After the stack update, verify the remote status object and admin UI reflect
  the new daemon behavior.

## Files To Inspect

- `AGENTS.md`
- `CLAUDE.md`
- `FABLE.md`
- `docs/fable/current-state.md`
- `docs/fable/progress.md`
- `docs/fable/roadmap.md`
- `docs/fable/autonomy-contract.md`
- `docs/operations/operator-actions.md`
- `docs/operations/deploy-log.md`
- `docs/operations/rollback.md`
- `.github/workflows/workers-ci.yml`
- `.github/workflows/docker-ci.yml`
- `workers/wrangler.toml`
- `workers/README.md`
- `docker/pyproject.toml`
- `docker/README.md`
- `deploy/portainer-stack.yml`

## Files To Edit

Phase A may edit only:

- `docker/pyproject.toml`
- `docker/README.md` if the version or release instructions are stale

If Phase B or Phase C is explicitly approved and completed, documentation edits
may also include only:

- `docs/fable/current-state.md`
- `docs/fable/progress.md`
- `docs/fable/roadmap.md`
- `docs/operations/operator-actions.md`
- `docs/operations/deploy-log.md`

Do not edit feature code in this handoff. If a real bug is discovered, stop and
report it instead of broadening scope.

## Constraints

- Do not use `claude -p`.
- Keep Cloudflare tokens, Access values, GHCR credentials, R2 credentials, and
  Portainer credentials secret. Do not print or commit them.
- Do not run `wrangler secret put`, `wrangler rollback`, `wrangler deploy`,
  workflow dispatch, git tag, git push, Portainer stack update, or any command
  that mutates production unless the operator explicitly approves that phase.
- Do not mutate D1 data, R2 objects, Access settings, DNS, or Cloudflare secrets
  as part of Phase A.
- Do not run manual sync against production until Phase C is approved and the
  operator understands that it may read PhotoPrism/NAS inputs and write share
  outputs to private R2 through the normal sync path.
- Preserve the invariant that Workers never access NAS/PhotoPrism and Docker
  never implements viewer/admin authorization.
- If Docker Desktop is unavailable, skip Docker build/smoke with the exact
  observed reason and still run Python tests/compile checks.
- If GitHub/Gitea/Cloudflare network access or authentication is unavailable,
  report the blocker and provide the exact command the operator should run.

## Non Goals

- No new product feature work.
- No schema, D1, R2, Access, DNS, or secret changes during Phase A.
- No Worker code changes.
- No Docker sync behavior changes.
- No production deployment, image release, Portainer update, live manual sync,
  commit, push, tag, or handoff archival unless separately and explicitly
  approved.
- No broad documentation cleanup.

## Verification

Phase A:

```powershell
git status --short
git log --oneline -5

Set-Location workers
npm run lint
npm run typecheck
npm test
npm run build
npm audit --omit=dev --audit-level=high

Set-Location ..\docker
python -m pytest
python -m compileall src

Set-Location ..
git diff --check
docker info
```

If `docker info` succeeds and Docker is available, also run a local image build
and a minimal container smoke check using the existing Dockerfile/test approach
from `.github/workflows/docker-ci.yml`. If it fails because Docker Desktop is not
running, report the exact error and do not treat it as a code failure.

Phase B, only after explicit approval:

```powershell
Set-Location workers
npx wrangler whoami
npx wrangler versions list
npx wrangler deploy
npx wrangler versions list
```

Then run smoke checks against `https://share-photo.iniwach.com`:

- `GET /` returns the viewer login page.
- unauthenticated `GET /albums` redirects to `/`.
- unauthenticated `GET /img/probe-nonexistent` returns `401` and `Cache-Control:
  no-store`.
- unauthenticated `GET /api/probe` returns `401` and `Cache-Control: no-store`.
- unauthenticated `GET /admin` is intercepted by Cloudflare Access.
- authenticated browser check: `/admin/sync` renders the status page and the
  manual "sync now" form.

Phase C, only after explicit approval:

```powershell
git status --short
git tag --list sync-v0.3.0
```

If the operator authorizes tag creation and push:

```powershell
git tag sync-v0.3.0
git push origin sync-v0.3.0
```

Then confirm docker-ci publishes:

- `ghcr.io/iniwa/photo-gate-sync:0.3.0`
- `ghcr.io/iniwa/photo-gate-sync:sha-<short-sha>`

After the operator updates the Portainer stack image tag to `0.3.0`, smoke:

- container starts cleanly;
- health file remains healthy;
- `ops/sync-status.json` is published;
- `/admin/sync` shows schema 2 trigger fields;
- pressing the manual "sync now" button creates a pending request, the daemon consumes it, and
  the final status shows manual trigger completion without exposing secrets.

## Expected Report

Report in Japanese with these sections:

1. Phase executed: Phase A only, or Phase A+B, or Phase A+B+C.
2. Changed files.
3. Version decision: old Docker version, new Docker version, and why.
4. Verification results, including exact skipped/blocked checks.
5. Worker deployment status:
   - not executed, or deployed version ID + commit + smoke results.
6. Docker release status:
   - not executed, or tag/GHCR image + Portainer update + smoke results.
7. Production state changes:
   - explicitly state none if Phase B/C were not approved.
8. Any blockers or design questions for Codex.

Do not archive this handoff. Do not commit, push, deploy, tag, or mutate
production unless that action was explicitly approved under this handoff.
