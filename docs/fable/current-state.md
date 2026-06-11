# Current State

Last audited: 2026-06-11.

## Repository Status

- Docker Phase 1 sync CLI foundation is implemented.
- Workers Phase 2 fixture UI and much of the route-independent Phase 3
  security/data foundation are implemented.
- Active Workers routes are still fixture-only.
- No real D1 or R2 binding is configured in `workers/wrangler.toml`.
- No real login, album API, image route, admin route, or Worker deployment is
  active.
- No GitHub Actions workflow is implemented; `.github/workflows/` contains only
  a placeholder.

## Docker Implemented

- PhotoPrism async client and generated-preview retrieval.
- Optional Cloudflare Access service-token headers.
- pyvips re-encoding, resize, autorotation, metadata stripping, and output
  validation.
- Deterministic schemaVersion 1 manifest generation.
- Concurrent sync with manifest uploaded last.
- Cloudflare R2 S3-compatible object store with strict key validation.
- Environment configuration and `photo-gate-sync sync-once` CLI.
- Explicit `--confirm-upload` safety gate.
- Production non-root Docker image based on Python 3.12 slim Bookworm.

## Docker Missing

- Scheduled/long-running sync operation.
- HTTP sync job API and health endpoint.
- Safe cleanup implementation; R2 deletion must remain dry-run.
- Portainer compose/stack delivery files and automated release/update workflow.
- CI/CD and GHCR publication.
- Production integration verification against operator-provided services.

## Workers Implemented

- Hono + JSX fixture pages and security headers.
- Reserved `/api`, `/img`, and `/admin` routes that fail closed with 401.
- D1 migrations for users, sessions, albums, and album permissions.
- PBKDF2-SHA256 password primitives and session token/digest/cookie primitives.
- Auth, session, and permission repositories.
- Session authentication and album authorization middleware.
- Safe-ID validation, standard R2 key builders, strict manifest validator.
- Private object loaders and safe private image response helpers.
- Private R2 reader adapter with strict standard-key allowlist.
- Authorized album catalog repository with keyset pagination.

## Workers Missing

- The active handoff:
  `docs/handoffs/2026-06-09-phase-3-manifest-authorized-photo-loading.md`.
- Approved production policy wiring: fixed seven-day sessions, five failures
  causing a fifteen-minute lockout, daily expired-session cleanup.
- Real login/logout/me routes.
- Real authenticated album list/detail routes.
- Real image routes with session, album permission, manifest membership, and
  private R2 reads.
- `DB` and `PHOTO_BUCKET` bindings and environment type wiring.
- Migration application and initial data/operator tooling.
- Cloudflare Access admin JWT validation and email allowlist.
- Admin UI/API and sync orchestration.
- Workers CI/CD and deployment.

## Current Active Behavior

- `GET /`, `/albums`, and fixture album details render synthetic data only.
- `/api/*`, `/img/*`, and `/admin/*` always return 401.
- No active route reads D1, R2, PhotoPrism, or real photo data.

## Current Verification Baseline

The latest recorded Workers verification before this document set:

- lint: passed;
- typecheck: passed;
- tests: 680 passed;
- build dry-run: passed;
- npm audit: zero vulnerabilities.

Docker verification previously passed unit tests available on the Windows
development host, with pyvips-dependent tests skipped when system libvips was
not installed. Re-establish the current baseline before changing Docker.

## Documentation Condition

Some older Japanese documents, including `photo-gate-design.md` and older ADR
content, are mojibake in the working tree. Preserve them as historical evidence.
Use `FABLE.md`, `AGENTS.md`, and `docs/fable/` as the current operational source
of truth. Correct historical documents only when needed for an active task and
without losing recoverable meaning.
