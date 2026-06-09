Read `AGENTS.md`, `CLAUDE.md`, `photo-gate-design.md`, the existing Phase 1 handoffs, the Docker sync implementation, and this handoff file before implementation.
If implementation would violate constraints or require files outside this handoff, stop and ask before editing.

## Goal

Package the existing one-shot sync CLI as a production-oriented Docker image that includes `libvips`, runs as a non-root user, supports `linux/amd64` and `linux/arm64`, and is safe when started without explicit sync arguments.

This completes the container-runtime portion of Phase 1. It does not add a server, scheduler, deployment configuration, or CI workflow.

## Background

The Docker sync implementation currently provides:

- PhotoPrism preview download
- metadata-stripped thumb/preview generation with `pyvips`
- Cloudflare R2 upload
- manifest-last sync orchestration
- `photo-gate-sync sync-once` with explicit `--confirm-upload`

Development on Windows cannot execute the `libvips`-dependent tests because the shared library is not installed. The container image must provide a reproducible Linux runtime with `libvips`, and its smoke checks must prove the CLI and image-processing dependency load successfully.

The Dockerfile example in `photo-gate-design.md` is only an early proposal and is now outdated: there is no `serve` command and no HTTP port. Do not copy its `EXPOSE 8080` or `CMD ... serve` behavior.

## Files To Inspect

- `AGENTS.md`
- `CLAUDE.md`
- `photo-gate-design.md`
- `.gitignore`
- `docs/handoffs/2026-06-09-phase-1-photoprism-preview-sync-core.md`
- `docs/handoffs/2026-06-09-phase-1-r2-object-store.md`
- `docs/handoffs/2026-06-09-phase-1-sync-once-cli.md`
- `docker/pyproject.toml`
- `docker/README.md`
- `docker/scripts/sync-once.sh`
- `docker/src/photo_gate/main.py`
- `docker/src/photo_gate/image_processor.py`

## Files To Create Or Edit

- `docker/Dockerfile`
- `docker/.dockerignore`
- `docker/README.md`

Do not edit application source, Python tests, repository-level ignore files, compose files, workflows, or design documents in this handoff. Ask before making a design change.

## Required Dockerfile Contract

Use a Debian Bookworm-based official Python 3.12 slim image suitable for both `linux/amd64` and `linux/arm64`.

The final runtime image must:

- install the minimum required OS packages for runtime:
  - `libvips`
  - `ca-certificates`
- install the local `photo-gate-sync` Python package from `docker/`
- not install development-only Python dependencies
- not copy tests, caches, local media, `.env`, secrets, credentials, Git metadata, or AI/tool state into the image
- create and run as a dedicated non-root user
- set a stable application working directory owned or usable by that user
- set `PYTHONUNBUFFERED=1`
- use exec-form `ENTRYPOINT ["photo-gate-sync"]`
- use a safe default `CMD ["--help"]`
- not declare an HTTP port
- not add a healthcheck that contacts PhotoPrism, R2, or any external service
- not bake configuration or secrets into `ENV`, `ARG`, labels, files, or layers

Starting the image without arguments must only display CLI help and exit successfully. A real upload must still require an explicit command equivalent to:

```text
docker run --rm [environment options] IMAGE \
  sync-once \
  --album-id ALBUM_ID \
  --album-title "Album Title" \
  --photoprism-album-uid UID \
  --confirm-upload
```

Do not add a shell entrypoint that silently injects `sync-once` or `--confirm-upload`.

## `.dockerignore` Contract

Create `docker/.dockerignore` to keep the build context publishable and small.

At minimum exclude:

- `.env` and `.env.*`, while allowing example files if any are later added
- secret/key/certificate/credential patterns already protected by the repository `.gitignore`
- `.git`, `.github`, `.serena`, `.claude`, `.codex`
- Python caches, virtual environments, test caches, coverage, build, dist, and egg-info
- `tests/`
- runtime media/cache/data/log/upload/R2-dump directories
- editor and OS files

Do not exclude files required to install and run the package:

- `pyproject.toml`
- `src/`
- `scripts/`
- `README.md`

## README Changes

Document:

- local image build command
- safe no-argument/help smoke command
- `libvips` import/version smoke command
- one-shot `docker run` usage using environment variable names only
- that secrets must be injected at runtime and must not be committed or baked into the image
- that no port is exposed because the current image is a one-shot CLI, not an HTTP service
- multi-platform build verification command for `linux/amd64,linux/arm64`

Do not include real-looking credential values or recommend passing secret values directly in command history. For usage examples, prefer `--env-file` as an operator mechanism while clearly stating that the referenced file is local, ignored, and never copied into the image. The application itself must continue to read only process environment variables.

## Security And Runtime Requirements

- The container must run as non-root by default.
- The build must not require real credentials or network access to PhotoPrism/R2.
- Docker image history and inspect output must not contain application secrets.
- The image must not perform a sync during build or default startup.
- Do not mount or copy NAS originals, RAW files, or user photos as part of build or smoke tests.
- Do not weaken `--confirm-upload`.
- Do not add `.env` loading to Python.
- Keep the runtime image focused on the one-shot CLI.

## Constraints

- Preserve all architecture and security invariants in `AGENTS.md`.
- Use only the existing Python package dependencies.
- Do not add an HTTP API/server or `serve` command.
- Do not add scheduling, background workers, job state, retries, cleanup, or deletion.
- Do not add Docker Compose, Portainer, Cloudflare Tunnel, or deployment files.
- Do not add GitHub Actions or other CI configuration.
- Do not publish or push images.
- Do not contact real PhotoPrism, R2, or Cloudflare services.
- Do not touch real secrets, credentials, `.env`, or local settings.
- Do not commit automatically.

## Non Goals

- Docker Compose or Portainer stack
- sync API server
- health endpoint
- container healthcheck
- scheduled sync
- R2 cleanup/deletion
- image publishing or GHCR
- CI/CD
- Workers implementation

## Verification

From the repository root, run:

```powershell
docker build -t photo-gate-sync:local docker
docker run --rm photo-gate-sync:local --help
docker run --rm photo-gate-sync:local sync-once --help
docker run --rm --entrypoint python photo-gate-sync:local -c "import pyvips; print(pyvips.version(0))"
docker run --rm --entrypoint python photo-gate-sync:local -c "import os; assert os.getuid() != 0"
docker image inspect photo-gate-sync:local
docker history --no-trunc photo-gate-sync:local
git diff --check
git status --short
```

Inspect output manually enough to confirm:

- default user is non-root
- entrypoint and default command match the required contract
- no port is exposed
- no application secrets or credentials are embedded

Also verify multi-platform build compatibility without pushing:

```powershell
docker buildx build --platform linux/amd64,linux/arm64 --output type=cacheonly docker
```

If Docker Desktop, BuildKit, QEMU, or network/package registry access prevents a check, report the exact blocked command and reason. Do not weaken the Dockerfile or verification requirements to make the local environment pass.

## Expected Report

- Changed files
- Dockerfile/runtime summary
- Default entrypoint/CMD behavior
- Non-root user details
- Verification results, including `libvips` version
- Multi-platform build result
- Image size
- Any blocked checks with exact reasons
- Any container/runtime/security questions that should return to Codex
