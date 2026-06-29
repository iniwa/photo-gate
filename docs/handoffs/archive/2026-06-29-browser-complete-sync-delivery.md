Read AGENTS.md, CLAUDE.md, and this handoff file before implementation.
If implementation would violate constraints or require files outside this
handoff, stop and ask before editing.

## Goal

Prepare and, only when explicitly approved by the operator, deliver the local
A1-A3 browser-complete sync work to production:

- A1: Docker `photo-gate-sync publish-catalog` writes
  `ops/album-catalog.json`.
- A2: Worker writes `ops/sync-targets.json`; Docker consumes sync targets.
- A3: Worker `/admin/albums` reads `ops/album-catalog.json` and renders a safe
  catalog picker.

The next Docker release version is `0.4.0`.

## Background

Current production state:

- Worker production: commit `cd990ae`, version
  `3c4d4f8e-e13f-4ebd-8ab0-213639b7f90b`, deployed 2026-06-26.
- Docker production: `ghcr.io/iniwa/photo-gate-sync:0.3.0`, running in
  Portainer.

Local reviewed commits after production:

- `1e8b2f6 feat: add docker album catalog publisher` (A1)
- `f08a7eb feat: add browser-owned sync targets` (A2)
- `de74227 feat: add admin album catalog picker` (A3)

`docker/pyproject.toml` still says `version = "0.3.0"`. Because A1-A3 add a
new browser-complete operational path and Docker behavior, release this as
`0.4.0`, not `0.3.1`.

`docs/iniwa-issues.md` is an unrelated untracked file. Do not edit, stage, or
commit it.

## Acceptance Criteria

### Phase A - Local Release Preparation

1. Bump Docker package version from `0.3.0` to `0.4.0`.
2. Verify Workers and Docker locally.
3. Confirm no unintended Docker/Worker migration or unrelated file changes.
4. Produce a clear report with:
   - exact changed files;
   - exact verification results;
   - whether Docker Desktop was available for image build/smoke;
   - proposed commit message;
   - proposed delivery commands for the next phases.

Phase A may edit and verify locally. Do not commit, push, deploy, tag, mutate
Cloudflare, mutate R2/D1, or update Portainer during Phase A unless the operator
explicitly approves those actions after seeing the Phase A report.

### Phase B - Commit And Push (Operator Approval Required)

Only after explicit operator approval:

1. Commit the version bump and any required docs/state updates.
2. Push to the canonical remote.
3. Confirm the pushed commit SHA.
4. Watch or ask the operator to watch CI as appropriate.

Do not create the Docker release tag in Phase B unless explicitly approved.

### Phase C - Worker Deploy (Operator Approval Required)

Only after explicit operator approval and after Workers verification is green:

Preferred path:

- Let `workers-ci` deploy from pushed `main`.

Fallback path, only if explicitly requested and credentials are available:

```powershell
Set-Location workers
npx wrangler whoami
npx wrangler deploy
npx wrangler versions list
```

Record the new Worker version ID in `docs/operations/deploy-log.md` and
`docs/fable/current-state.md` / `docs/fable/progress.md`.

Unauthenticated smoke checks:

1. `GET https://share-photo.iniwach.com/` -> 200 viewer login.
2. `GET https://share-photo.iniwach.com/albums` without viewer session -> 303
   to `/`.
3. `GET https://share-photo.iniwach.com/img/probe-nonexistent` without viewer
   session -> 401 with `Cache-Control: no-store`.
4. `GET https://share-photo.iniwach.com/api/probe` -> 401 with
   `Cache-Control: no-store`.
5. `GET https://share-photo.iniwach.com/admin` without Access session ->
   Cloudflare Access intercept or fail-closed admin response; no admin HTML.

Authenticated browser checks are operator-side unless an authenticated browser
session is explicitly available:

1. `/admin/albums` renders.
2. If `ops/album-catalog.json` is missing, each sync-target area shows a safe
   catalog-unavailable message and no free-text `catalogId` input.
3. After the catalog is published in Phase E, `/admin/albums` shows a catalog
   picker.

### Phase D - Docker 0.4.0 Release (Operator Approval Required)

Only after explicit operator approval and after local Docker verification:

1. Confirm no existing tag:

```powershell
git tag --list sync-v0.4.0
```

2. Create and push the immutable release tag:

```powershell
git tag sync-v0.4.0
git push origin sync-v0.4.0
```

3. Confirm docker-ci publishes:

- `ghcr.io/iniwa/photo-gate-sync:0.4.0`
- `ghcr.io/iniwa/photo-gate-sync:sha-<short-sha>`

4. Do not update Portainer until GHCR publication is confirmed.

### Phase E - Portainer Update And Live Smoke (Operator Action Required)

The operator updates the existing Portainer stack:

- Stack: `iniwa-photo-gate`
- Image:
  `ghcr.io/iniwa/photo-gate-sync:0.3.0` ->
  `ghcr.io/iniwa/photo-gate-sync:0.4.0`

Do not add a new stack. Do not change secrets. Do not print secrets.

After Portainer update:

1. Confirm container starts and becomes healthy.
2. Confirm logs show version `0.4.0` starting and do not show PhotoPrism URLs,
   preview tokens, R2 credentials, or source paths.
3. Publish catalog once:

```sh
photo-gate-sync publish-catalog
```

Run this inside the updated container/stack environment so it uses the existing
PhotoPrism and R2 configuration. Do not print environment variables.

Expected output shape:

```text
Published album catalog: count=N
```

4. In authenticated browser `/admin/albums`, confirm:
   - catalog picker appears;
   - catalog entries show safe titles/counts/timestamps;
   - no raw PhotoPrism UID is visible;
   - no free-text catalog ID input remains for sync-target upsert.
5. Configure the new PhotoPrism album's D1 album row as a sync target using the
   picker.
6. Press the existing `/admin/sync` "Sync Now" button.
7. Confirm Docker consumes the request and syncs configured targets.
8. Confirm `/admin/sync` after completion:
   - pending request is gone;
   - failures remain 0;
   - runs completed increases;
   - trigger kind shows manual;
   - status page does not expose raw UID, URLs, tokens, source paths, or raw
     JSON.
9. Confirm the new album is viewable only after the D1 album is enabled and the
   intended user permission exists.

Record Worker deploy, Docker release, Portainer update, and smoke results in:

- `docs/operations/deploy-log.md`
- `docs/fable/current-state.md`
- `docs/fable/progress.md`
- `docs/fable/roadmap.md` if status changes

## Files To Inspect

- `AGENTS.md`
- `CLAUDE.md`
- `FABLE.md`
- `docs/fable/current-state.md`
- `docs/fable/progress.md`
- `docs/fable/roadmap.md`
- `docs/fable/autonomy-contract.md`
- `docs/operations/deploy-log.md`
- `docs/operations/rollback.md`
- `docs/decisions/2026-06-26-browser-complete-sync-and-reupload-phasing.md`
- `.github/workflows/workers-ci.yml`
- `.github/workflows/docker-ci.yml`
- `docker/pyproject.toml`
- `docker/README.md`
- `workers/README.md`

## Files To Edit

Phase A:

- `docker/pyproject.toml`

Phase C/E documentation after real delivery:

- `docs/operations/deploy-log.md`
- `docs/fable/current-state.md`
- `docs/fable/progress.md`
- `docs/fable/roadmap.md` if needed

Do not edit source code beyond the version bump. Do not edit Docker, Worker,
or migration behavior in this delivery handoff unless verification exposes a
release-blocking bug; if that happens, stop and report the bug before editing.

## Constraints

- Do not edit, stage, or commit `docs/iniwa-issues.md`.
- Do not disclose, print, or commit secrets or local configuration.
- Do not run destructive git commands or rewrite history.
- Do not deploy, tag, push, mutate Cloudflare, mutate R2/D1, or update
  Portainer unless explicitly approved for the relevant phase.
- Do not change public R2 access, Access configuration, DNS, D1 schema, R2
  deletion behavior, or Docker secrets.
- Do not use `latest` as the Docker runtime tag.
- Do not create or use a new Portainer stack.
- Preserve rollback paths:
  - Worker rollback: deploy previous known-good commit/version or use documented
    `wrangler rollback`, then verify Worker secrets.
  - Docker rollback: Portainer image tag back to `0.3.0`.

## Non Goals

- No reupload suppression.
- No R2 cleanup or deletion.
- No D1 migration.
- No album/user hard delete.
- No PhotoPrism/NAS/Portainer access from Workers.
- No Docker D1 access.
- No automatic album enablement.
- No new Cloudflare resources.
- No secret rotation.

## Verification

Phase A local verification:

Workers:

```powershell
Set-Location workers
npm run lint
npm run typecheck
npm test
npm run build
npm audit --omit=dev --audit-level=high
```

Docker:

```powershell
Set-Location docker
python -m pytest
python -m compileall src
```

If Docker Desktop is available:

```powershell
docker info
docker build --target test -t photo-gate-sync-test:0.4.0 docker
docker run --rm photo-gate-sync-test:0.4.0
```

If Docker Desktop is not available, run `docker info`, capture the exact error,
and report the image build/smoke as skipped for that exact reason.

Repository:

```powershell
git diff --check
git diff HEAD -- workers/migrations/
git status --short
git tag --list sync-v0.4.0
```

Phase C/E production verification:

- Record exact commands, status codes, headers, version IDs, image tags, and
  smoke results.
- Do not print secrets.

## Expected Report

Report in Japanese.

For Phase A:

1. Executed phase.
2. Changed files.
3. Version decision: old `0.3.0`, new `0.4.0`, rationale.
4. Verification commands and exact results.
5. Docker build/smoke result or exact skip reason.
6. Git status summary, explicitly noting `docs/iniwa-issues.md` was untouched.
7. Whether Phase B/C/D/E are still pending approval.
8. Blockers or questions.

For Phase B/C/D/E, when approved and executed:

1. Executed phase(s).
2. Commit SHA, pushed branch, and CI status.
3. Worker version ID before/after and smoke results.
4. Docker tag/GHCR publication status.
5. Portainer update status.
6. Catalog publication result.
7. Browser smoke result for `/admin/albums` picker and `/admin/sync`.
8. New album sync result.
9. Documentation updates.
10. Rollback instructions for the exact delivered versions.
11. Any skipped checks and exact reasons.
