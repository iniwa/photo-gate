# Current State

Last audited: 2026-06-11.

## Repository Status

- Docker Phase 1 sync CLI foundation is implemented.
- Workers Phase 2 fixture UI and much of the route-independent Phase 3
  security/data foundation are implemented.
- Active Workers viewer pages are still fixture-only; `/api/auth/*`
  login/logout/me routes are active but need a real D1 database.
- `DB` and `PHOTO_BUCKET` bindings are declared in `workers/wrangler.toml`
  (D1 `database_id` is a placeholder until provisioning).
- No real album API, image route, admin route, or Worker deployment is
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
- Manifest-authorized thumb/preview loading with exact photo-ID membership,
  manifest-first read order, and no probing of unlisted/stale objects.
- Login/session policy helpers: fixed seven-day session expiry, five-failure /
  fifteen-minute atomic lockout, fail-closed locked_until handling, PBKDF2
  production iterations fixed at 100,000 (ADR 2026-06-11).
- Active `/api/auth/*` routes: form-only login (uniform 401, dummy-hash timing
  decoy, Origin enforcement, lockout recording, fresh seven-day session with
  digest-only storage), idempotent logout, session-authenticated `me`
  (ADR 2026-06-11 viewer-auth-routes).

## Workers Missing

- Daily expired-session cleanup scheduling (helpers and repository exist; no
  Cron trigger is configured).
- Real authenticated album list/detail routes.
- Real image routes with session, album permission, manifest membership, and
  private R2 reads.
- Migration application and initial data/operator tooling.
- Cloudflare Access admin JWT validation and email allowlist.
- Admin UI/API and sync orchestration.
- Workers CI/CD and deployment.

## Current Active Behavior

- `GET /`, `/albums`, and fixture album details render synthetic data only.
- `/api/auth/login`, `/api/auth/logout`, and `/api/auth/me` are active; they
  read D1 through the `DB` binding and return 503 until a real database is
  provisioned.
- All other `/api/*`, `/img/*`, and `/admin/*` always return 401.
- No active route reads R2, PhotoPrism, or real photo data.

## Current Verification Baseline

The latest recorded Workers verification (2026-06-11, after the viewer auth
routes):

- lint: passed;
- typecheck: passed;
- tests: 827 passed;
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
