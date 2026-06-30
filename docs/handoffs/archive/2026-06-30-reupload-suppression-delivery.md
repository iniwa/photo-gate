Read AGENTS.md, CLAUDE.md, and this handoff file before implementation.
If implementation would violate constraints or require files outside this
handoff, stop and ask before editing.

## Goal

Prepare the Docker sync release that contains reupload suppression.

Execute Phase A only: bump the Docker package version from `0.4.1` to `0.4.2`
and run local verification. Do not push, tag, deploy, update Portainer, mutate
R2, or archive this handoff.

## Background

Reupload suppression was implemented and reviewed in commit:

```text
2f84f84 feat: suppress unchanged photo reuploads
```

The feature changes Docker sync behavior only:

- manifest schema changes from `schemaVersion: 1` to `schemaVersion: 2`;
- each manifest photo entry includes `sourceHash`;
- unchanged thumb/preview pairs are skipped only when the previous schema 2
  manifest proves the same album/source/settings/photo/hash/output keys;
- `cover.webp` and `manifest.json` are still uploaded after successful album
  sync;
- R2 key shape, Workers, D1, viewer routes, and R2 deletion behavior are
  unchanged.

The currently deployed Docker image is `ghcr.io/iniwa/photo-gate-sync:0.4.1`.
The next patch release should be `0.4.2` because this is a narrowly scoped
Docker optimization and hotfix-style delivery of the already accepted Track B
phase 1 behavior.

## Acceptance Criteria

1. `docker/pyproject.toml` version is changed from `0.4.1` to `0.4.2`.
2. No source code changes are made in this handoff.
3. No Workers files, migrations, CI workflows, Fable docs, deployment logs, or
   operation docs are changed in Phase A.
4. Verification confirms the committed reupload suppression code still passes
   local checks.
5. Docker image build/smoke is attempted only if Docker Desktop is available.
   If Docker Desktop is unavailable, report the exact `docker info` error and
   skip image build/smoke.
6. `sync-v0.4.2` tag does not already exist locally.
7. Production state is not changed.

## Files To Inspect

- `AGENTS.md`
- `CLAUDE.md`
- `FABLE.md`
- `docs/fable/current-state.md`
- `docs/fable/roadmap.md`
- `docs/operations/operator-actions.md`
- `docs/decisions/2026-06-29-reupload-suppression.md`
- `docker/pyproject.toml`
- `docker/src/photo_gate/manifest.py`
- `docker/src/photo_gate/reupload.py`
- `docker/src/photo_gate/sync.py`
- `docker/tests/test_manifest.py`
- `docker/tests/test_reupload.py`
- `docker/tests/test_sync.py`

## Files To Edit

Phase A may edit only:

- `docker/pyproject.toml`

Do not edit any other file. In particular, do not edit:

- `workers/`
- `workers/migrations/`
- `docker/src/`
- `docker/tests/`
- `docs/fable/`
- `docs/operations/`
- `docs/handoffs/archive/`
- `.github/workflows/`
- `docs/iniwa-issues.md`

## Constraints

- Preserve all non-negotiable invariants in `AGENTS.md`.
- Do not change runtime behavior in this handoff.
- Do not commit, push, tag, deploy, update Portainer, mutate R2/D1, or archive
  this handoff.
- Do not print secrets, environment values, tokens, R2 credentials, PhotoPrism
  URLs, or local configuration.
- Preserve unrelated user changes. `docs/iniwa-issues.md`, if present, is
  unrelated and must not be edited, staged, or committed.

## Non Goals

- No implementation changes.
- No Worker deploy.
- No Docker release tag.
- No GHCR publication.
- No Portainer stack update.
- No live PhotoPrism/R2 smoke test.
- No Fable state or deploy-log update.
- No handoff archival.

## Verification

From the repository root:

```powershell
git status --short
git log -5 --oneline
git tag --list sync-v0.4.2
git diff --check
git diff HEAD -- workers/
git diff HEAD -- workers/migrations/
```

From `docker/`:

```powershell
python -m pytest tests/test_manifest.py tests/test_reupload.py
python -m pytest
python -m compileall src
```

Run:

```powershell
docker info
```

If Docker Desktop is available, run the repository's Docker image build/smoke
check. If it is not available, report the exact `docker info` connection error
and skip Docker image build/smoke.

Do not run Workers checks unless you accidentally change Workers files.

## Expected Report

Report in Japanese.

Include:

1. Executed phase: Phase A only.
2. Changed files.
3. Version decision:
   - old version `0.4.1`;
   - new version `0.4.2`;
   - reason: patch release for Docker-only reupload suppression.
4. Verification command results with exit status where useful.
5. Docker build/smoke result or exact skip reason.
6. Git status summary, explicitly noting `docs/iniwa-issues.md` if it remains
   unrelated and untracked.
7. Confirmation that Workers, migrations, Docker source/tests, Fable docs,
   operation docs, CI workflows, R2/D1, Portainer, and production state were not
   changed.
8. Proposed next commands for Codex/operator approval:
   - commit version bump;
   - push main;
   - create and push `sync-v0.4.2`;
   - wait for docker-ci and confirm GHCR tags;
   - update Portainer to `0.4.2`;
   - run live smoke: first sync may process all photos once to publish schema 2,
     second sync should skip unchanged thumb/preview pairs while still uploading
     cover and manifest.
9. Any blockers or design questions. If none, say none.
