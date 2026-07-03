# CI Hardening

Read `AGENTS.md`, `CLAUDE.md`, and this handoff file before implementation.
If implementation would violate constraints or require files outside this
handoff, stop and ask before editing.

## Goal

Harden the CI supply chain after Level 3 completion by pinning GitHub Actions
to immutable commit SHAs and pinning the Docker runtime base image to a digest,
without changing application behavior.

This is a CI / build hardening task only.

## Background

The Final Hardening audit found that the workflows currently use moving tag
references such as:

- `actions/checkout@v4`
- `actions/setup-node@v4`
- `actions/setup-python@v5`
- `docker/setup-buildx-action@v3`
- `docker/build-push-action@v6`
- `docker/setup-qemu-action@v3`
- `docker/login-action@v3`

`docker/Dockerfile` currently uses:

```dockerfile
FROM python:3.12-slim-trixie AS runtime
```

The existing CI permissions are acceptable:

- `workers-ci.yml`: `contents: read`
- `docker-ci.yml`: top-level `contents: read`; release job adds
  `packages: write`

This handoff should preserve those permission boundaries and harden references
only.

## Acceptance Criteria

1. All GitHub Actions `uses:` entries in the two workflows are pinned to full
   commit SHAs.
2. Each pinned action line retains a human-readable tag comment, for example:

   ```yaml
   - uses: actions/checkout@<full-40-char-sha> # v4.x.x
   ```

   Use the exact upstream tag version that the previous major tag resolves to
   at implementation time. Do not invent SHAs.
3. `docker/Dockerfile` pins `python:3.12-slim-trixie` to a manifest digest while
   preserving multi-arch compatibility:

   ```dockerfile
   FROM python:3.12-slim-trixie@sha256:<manifest-list-digest> AS runtime
   ```

4. Preserve the existing trixie/libvips rationale comments.
5. Do not change workflow triggers, job structure, permissions, scripts,
   secrets, package versions, application code, tests, Docker entrypoints,
   Docker healthcheck behavior, or published tags.
6. Add or update documentation recording:
   - action SHA pinning is now in place;
   - Docker base image digest is pinned;
   - future action/base-image updates require an intentional hardening refresh.
7. No production deployment, tag, release, R2/D1 mutation, secret operation, or
   Portainer operation is performed.

## Files To Inspect

- `AGENTS.md`
- `CLAUDE.md`
- `FABLE.md`
- `docs/fable/current-state.md`
- `docs/fable/progress.md`
- `docs/fable/roadmap.md`
- `docs/handoffs/archive/2026-07-03-final-hardening-audit-report.md`
- `.github/workflows/workers-ci.yml`
- `.github/workflows/docker-ci.yml`
- `docker/Dockerfile`
- `docker/README.md`
- `docs/operations/operator-actions.md`

## Files To Edit

Allowed:

- `.github/workflows/workers-ci.yml`
- `.github/workflows/docker-ci.yml`
- `docker/Dockerfile`
- `docker/README.md`
- `docs/fable/current-state.md`
- `docs/fable/progress.md`
- `docs/fable/roadmap.md`

Do not edit:

- `workers/**`
- `docker/src/**`
- `docker/tests/**`
- `workers/migrations/**`
- `docs/decisions/**`
- `docs/operations/**`
- `docs/iniwa-issues.md`

## Constraints

- Do not commit, push, deploy, tag, publish Docker images, mutate production, or
  archive this handoff.
- Do not change CI permissions except to keep them as-is.
- Do not replace tag pins with shorter SHAs. Use full commit SHAs for actions.
- Do not pin Docker to an architecture-specific digest. Use the manifest-list
  digest for `python:3.12-slim-trixie` so both linux/amd64 and linux/arm64
  builds remain valid.
- Do not introduce new CI actions, dependencies, tools, or services unless
  absolutely required to resolve the existing references. If needed, stop and
  ask.
- If network access is unavailable and the exact upstream SHAs/digest cannot be
  verified, stop and report the blocker instead of guessing.
- Keep errors and reports free of tokens and credentials.

## Non Goals

- No application code changes.
- No dependency upgrades.
- No Docker sync version bump.
- No Docker release tag.
- No Worker deploy.
- No workflow trigger changes.
- No R2 deletion or cleanup behavior changes.
- No deploy-log backfill.

## Reference Resolution Guidance

Use read-only network lookups for immutable references. Acceptable examples:

```powershell
git ls-remote https://github.com/actions/checkout.git refs/tags/v4
git ls-remote https://github.com/actions/setup-node.git refs/tags/v4
git ls-remote https://github.com/actions/setup-python.git refs/tags/v5
git ls-remote https://github.com/docker/setup-buildx-action.git refs/tags/v3
git ls-remote https://github.com/docker/build-push-action.git refs/tags/v6
git ls-remote https://github.com/docker/setup-qemu-action.git refs/tags/v3
git ls-remote https://github.com/docker/login-action.git refs/tags/v3
```

For the Python base image digest, prefer a manifest-list digest inspection
command such as:

```powershell
docker buildx imagetools inspect python:3.12-slim-trixie
```

If Docker is unavailable, another read-only registry digest query is acceptable
if already available in the environment. Do not install new tools just for this
handoff without approval.

## Verification

Run at minimum:

```powershell
git status --short
git diff --check
git diff HEAD -- workers/
git diff HEAD -- workers/migrations/
git diff HEAD -- docker/src/
git diff HEAD -- docker/tests/
```

Also verify:

```powershell
rg -n "uses: .*@(v[0-9]+|main|master|latest)" .github/workflows
rg -n "FROM python:3.12-slim-trixie AS runtime" docker/Dockerfile
```

The first command should return no unpinned action references. The second should
return no unpinned base image line.

If Docker is available, run:

```powershell
Set-Location docker
docker build --target test -t photo-gate-sync-test:ci-hardening .
docker run --rm photo-gate-sync-test:ci-hardening
```

If Docker is unavailable, report the exact `docker info` or build error and rely
on syntax/diff review plus CI for final validation.

## Expected Report

Report in Japanese with these sections:

1. Changed files
2. Pinned GitHub Actions table
3. Pinned Docker base image digest
4. Permissions review
5. Verification results
6. Skipped or blocked checks
7. Unchanged areas
8. Follow-up recommendations
9. Questions for Codex

For each action, include:

- original reference;
- pinned SHA;
- retained tag comment;
- lookup command used.
