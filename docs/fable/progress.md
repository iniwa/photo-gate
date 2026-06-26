# Progress

Last updated: 2026-06-26.

## Current Completion Level

**Level 2: Operable — COMPLETE (2026-06-23).** Level 1 production viewing,
automated checks/releases, scheduled operation, health and sanitized logs,
backup procedures, and Worker rollback verification are complete. By operator
decision, a production Docker rollback exercise is not required; the documented
immutable-tag Portainer procedure remains available for incident use.

## Current Task

There is no active implementation handoff.

The manual sync release is deployed and live-smoke verified in production:

- DONE: Worker commit `a1a5c2e` is deployed as version`r`n  `b30250aa-0289-4758-b1fe-3376beba0afe` (2026-06-26).
- DONE: Docker sync `0.3.0` is published and running in the Portainer stack`r`n  (2026-06-26).
- DONE: the operator pressed the manual sync button from `/admin/sync`; the`r`n  daemon consumed the request, synced 234/234, uploaded cover and manifest, and`r`n  reported success in 136.5s.
- DONE: `/admin/sync` reported no pending request, 0 failures, 1 completed`r`n  run, manual trigger kind, and a non-null handled request ID.

The fifteenth Level 3 implementation handoff is reviewed, deployed, and smoke-tested in production:

- DONE: D1-only admin album creation via `POST /admin/albums/create` is deployed in Worker version `3c4d4f8e` (commit `cd990ae`).
- The route uses the existing admin guard, strict same-origin check, exact
  URL-encoded Content-Type check, exact five-field validation, canonical
  timestamps from the Worker clock, and a single parameterized `albums` INSERT.
- The INSERT explicitly sets `enabled = 0`, accepts `photoprism_album_uid` only
  on create, and omits transform/EXIF columns so schema defaults apply.
- The create path does not select or render stored PhotoPrism UIDs and does not
  access PhotoPrism, NAS, Docker, Portainer, R2, permissions, users, or sessions.
- DONE: local verification on 2026-06-26 passed Workers lint, typecheck, build,
  2041 tests / 32 files, production dependency audit, `git diff --check`, and
  confirmed no Docker or migration diff. Production deploy on 2026-06-26 succeeded with unauthenticated smoke checks: `/` 200, `/albums` 303 to `/`, `/img/probe-nonexistent` 401 no-store, `/api/probe` 401 no-store, and `/admin` Cloudflare Access 302.

The fourteenth Level 3 implementation handoff is reviewed and complete locally:

- DONE: admin user display-name editing via `POST /admin/users/update-display-name`.
- DONE: browser-friendly permission assignment UI on `GET /admin/permissions`
  with safe user and album dropdowns.
- The display-name mutation uses the existing admin guard, strict same-origin
  check, exact URL-encoded Content-Type check, exact two-field validation,
  canonical `updated_at`, and a single parameterized `users` UPDATE touching
  only `display_name` and `updated_at`.
- The assignment UI reads only `users.id/display_name/enabled`,
  `albums.id/title/enabled`, and paginated `album_permissions.album_id/user_id/created_at`.
  Disabled users and albums remain selectable and are marked in the option label
  so newly created disabled albums can be pre-assigned before enablement.
- Lists are capped at 100 users and 100 albums and fail closed on overflow.
  Password hashes, session tokens, PhotoPrism UIDs, transform settings, R2 keys,
  and source photo details are not selected or rendered.
- DONE: local verification on 2026-06-26 passed Workers lint, typecheck, build,
  1958 tests / 32 files, production dependency audit, `git diff --check`, and
  confirmed no Docker diff.

The thirteenth Level 3 implementation handoff is reviewed and complete in production:

- DONE: manual sync admin UI and status schema 2.
- Docker remote sync status now publishes schema 2 with `lastTriggerKind` and
  `lastHandledRequestId`, while the local health file remains schema 1 and
  unchanged for Docker HEALTHCHECK.
- Worker sync status parsing accepts both schema 1 and schema 2; schema 1 is
  normalized with null trigger metadata, and schema 2 trigger fields are
  strictly validated.
- `GET /admin/sync` now reads pending request state from the fixed private R2
  key `ops/sync-request.json`, renders a boolean-only pending indicator, and
  exposes a no-JS form that posts `kind=sync-now` to the already-reviewed
  `POST /admin/sync/request` route.
- Pending request IDs/timestamps/raw JSON, R2 details, admin identity, album
  titles, PhotoPrism UIDs/URLs/tokens, and source photo data are not rendered or
  logged. The existing POST guard/content-type/form validation was not weakened.
- DONE: local verification on 2026-06-26 passed Workers lint, typecheck, build,
  1844 tests / 32 files, production dependency audit, Docker pytest with
  265 passed / 34 expected libvips/pyvips skips, `python -m compileall src`,
  and `git diff --check`. Docker build/smoke was skipped locally because Docker
  Desktop was not running; docker-ci later built and published `sync-v0.3.0`.

The twelfth Level 3 implementation handoff is reviewed and complete locally:

- DONE: Docker-side consumer for manual sync requests at the fixed private R2
  key `ops/sync-request.json`.
- The daemon polls at loop start and during inter-sync sleep, validates schema-1
  request objects strictly, triggers the configured single-album sync without
  interrupting an in-flight sync, and best-effort deletes handled, stale,
  duplicate, or invalid request objects.
- R2 request GET/DELETE failures are isolated to sanitized warnings and do not
  affect scheduled sync behavior, local health state, or Docker HEALTHCHECK.
- Codex review added regression coverage proving sleep-time polling breaks the
  interval early when a request appears, and proving duplicate delete is retried
  when a handled request remains after delete failure.
- DONE: local verification on 2026-06-26 passed Docker pytest with 253 passed /
  34 expected libvips/pyvips skips, `python -m compileall src`, and
  `git diff --check`. Docker build/smoke was skipped because Docker Desktop was
  not running.

The eleventh Level 3 implementation handoff is reviewed and complete locally:

- DONE: admin-only `POST /admin/sync/request` writes a schema-1 manual sync
  request object to the fixed private R2 key `ops/sync-request.json`.
- The route uses the existing admin guard, strict same-origin check, exact
  URL-encoded Content-Type check, exact `kind=sync-now` form validation,
  Worker-generated 32-hex `requestId`, and `clock().toISOString()` for
  `requestedAt`.
- No visible Sync Now button or pending indicator is exposed yet because the
  Docker consumer is not implemented. Docker polling/deletion/status schema 2
  remain future work.
- Codex review tightened repository timestamp validation to require the exact
  Worker ISO shape (`YYYY-MM-DDTHH:mm:ss.sssZ`) and added clock-not-called
  regression tests for cheap validation failures.
- DONE: local verification on 2026-06-25 passed Workers lint, typecheck, build,
  1790 tests / 32 files, and production dependency audit.
The sync request controls design ADR is reviewed and accepted:

- DONE: `docs/decisions/2026-06-25-sync-request-controls.md` records the
  fixed private R2 request-object design for future manual sync controls.
- The future request key is `ops/sync-request.json`; the Worker will generate a
  four-field schema-1 payload and write it only after the existing admin guard,
  strict same-origin check, exact URL-encoded Content-Type check, and exact
  `kind=sync-now` form validation.
- The Docker daemon will poll the fixed key, validate strictly, run the
  configured single-album sync without interruption of in-flight syncs, and
  best-effort delete handled, stale, duplicate, or invalid request objects.
- The ADR explicitly preserves the no Workers-to-PhotoPrism/NAS/Docker/
  Portainer boundary and the no Docker-to-D1/admin-auth boundary.

The tenth Level 3 implementation handoff is reviewed and complete locally:

- DONE: read-only admin `GET /admin/sync` status page behind the existing
  Access guard.
- DONE: Docker `sync-daemon` publishes sanitized best-effort status JSON to the
  fixed private R2 key `ops/sync-status.json` after startup, attempt start, and
  attempt completion. Publish failure does not affect sync result,
  `consecutive_failures`, or Docker HEALTHCHECK.
- The status schema excludes PID, album title, PhotoPrism UID/URL/token,
  Cloudflare Access credentials, R2 credentials, source photo data, manifest
  contents, container hostnames, and environment values.
- Worker-side parsing reads only the fixed key, treats a missing object as a
  safe 200 empty state, and fails closed with sanitized 500 on R2, JSON, or
  validation failure.
- Codex review tightened Docker status validation to reject impossible daemon
  timestamps and Python `bool` values where non-negative integers are required,
  and added a Worker regression test proving the fixed R2 key is used.
- DONE: local verification on 2026-06-25 passed Workers lint, typecheck, build,
  1726 tests / 31 files, and production dependency audit. Docker verification
  passed 190 tests with 34 expected libvips/pyvips skips and
  `python -m compileall src`.

The ninth Level 3 implementation handoff is reviewed and complete locally:

- DONE: admin-only read-only `GET /admin/ops` operational summary behind the
  existing Access guard.
- The page displays only aggregate D1 counts for users, albums, permissions,
  and sessions. It does not select, return, render, or log row-level IDs,
  display names, titles, password hashes, session token hashes, PhotoPrism UIDs,
  transform settings, R2 keys, or manifest/photo data.
- The repository uses four parameterized aggregate queries, validates canonical
  UTC timestamps before D1, validates every returned aggregate as a safe
  non-negative integer, and fails closed with sanitized errors.
- Codex review tightened aggregate validation from integer to safe integer and
  added a regression test for unsafe large counts.
- DONE: local verification on 2026-06-25 passed lint, typecheck, build, and
  1676 tests / 30 files. `npm audit --omit=dev --audit-level=high` reported
  0 vulnerabilities.

The sixth Level 3 implementation handoff is reviewed and complete:

- DONE: idempotent `POST /admin/users/enable` and
  `POST /admin/users/disable` behind the existing Access guard.
- The single parameterized UPDATE changes only `users.enabled` and
  `updated_at`; same-state and unknown IDs are successful no-ops.
- Passwords, lockout state, sessions, permissions, albums, and R2 data remain
  untouched. Existing sessions fail while disabled through `u.enabled = 1`;
  an unexpired retained session may work again after re-enable.
- DONE: implementation commit `63ec185` was included in CI-deployed commit
  `42a7b56`; unauthenticated GET/enable/disable production smoke checks all
  returned the expected 403 with `Cache-Control: no-store`, without performing
  a D1 mutation.

The seventh Level 3 implementation handoff is reviewed and complete locally:

- DONE: admin-only `POST /admin/users/create` and
  `POST /admin/users/reset-password` behind the existing Access guard.
- Both mutations require strict same-origin POST, exact URL-encoded form
  Content-Type, exact field validation, existing PBKDF2 hashing after cheap
  validation, parameterized D1 writes, and sanitized no-store failures.
- `createUser` inserts only a `users` row with `enabled=1`, `fail_count=0`,
  `locked_until=NULL`, and canonical timestamps. `resetPassword` updates only
  `password_hash`, `fail_count`, `locked_until`, and `updated_at`; sessions,
  permissions, albums, and R2 data are untouched.
- Codex review tightened repository-level display-name validation so direct
  repository calls reject empty, leading/trailing whitespace, and ASCII control
  characters before D1.
- DONE: local verification on 2026-06-24 passed lint, typecheck, build, and
  1521 tests / 29 files. `npm audit --omit=dev --audit-level=high` reported
  0 vulnerabilities; full `npm audit` still reports existing Wrangler/Miniflare
  devDependency advisories.

The eighth Level 3 implementation handoff is reviewed and complete locally:

- DONE: admin-only `POST /admin/albums/update-public-metadata` behind the
  existing Access guard.
- The mutation requires strict same-origin POST, exact URL-encoded form
  Content-Type, exact four-field validation, parameterized D1 write, and
  sanitized no-store failures.
- The single UPDATE writes only `title`, `expires_at`, `download_enabled`, and
  `updated_at`. It never touches `photoprism_album_uid`, transform settings,
  `strip_exif`, `enabled`, `created_at`, permissions, users, sessions, R2,
  PhotoPrism, or NAS.
- Codex review added route tests proving repeated fields are rejected and an
  invalid form does not call the clock or repository.
- DONE: local verification on 2026-06-24 passed lint, typecheck, build, and
  1594 tests / 29 files. `npm audit --omit=dev --audit-level=high` reported
  0 vulnerabilities; full `npm audit` still reports existing Wrangler/Miniflare
  devDependency advisories.

The fifth Level 3 implementation handoff is reviewed and complete:

- DONE: idempotent `POST /admin/albums/enable` and
  `POST /admin/albums/disable` behind the existing Access guard.
- The single parameterized UPDATE changes only `albums.enabled` and
  `updated_at`; same-state and unknown IDs are successful no-ops, while
  permissions and all R2 data remain untouched.
- Codex review tightened the shared admin mutation Content-Type check so only
  the URL-encoded media type with an optional single `charset` parameter is
  accepted.
- DONE: implementation commit `1c4974c` was included in CI-deployed commit
  `729dc72`; unauthenticated GET/enable/disable production smoke checks all
  returned the expected 403 with `Cache-Control: no-store`, without performing
  a D1 mutation.

The fourth Level 3 implementation handoff is reviewed and complete:

- DONE: idempotent `POST /admin/permissions/grant` and
  `POST /admin/permissions/revoke` behind the existing Access guard.
- Both mutations require an exact same-origin POST, strict URL-encoded
  two-field input, parameterized D1 statements, and sanitized no-store
  failures without disclosing user or album existence.
- Codex review fixed the grant clock/serialization failure path so it also
  returns the fixed no-store 500 response before repository use.
- DONE: commit `2e12f08` passed workers-ci and deployed the mutations;
  unauthenticated GET/grant/revoke production smoke checks all returned the
  expected 403 with `Cache-Control: no-store`, without performing a D1 mutation.

The third Level 3 implementation handoff is reviewed and complete:

- DONE: read-only, keyset-paginated `GET /admin/albums` and
  `GET /admin/permissions` inventories behind the reviewed Access boundary.
- The album repository selects only seven approved album fields and strictly
  excludes PhotoPrism identifiers, transform settings, R2 data, and mutation
  operations.
- The permission repository selects only `album_id`, `user_id`, and
  `created_at` from `album_permissions`, with no joins to users or albums.

The second Level 3 implementation handoff is reviewed and complete:

- DONE: read-only, keyset-paginated `GET /admin/users` inventory behind the
  reviewed Access boundary.
- The repository selects only seven approved user fields and strictly excludes
  password hashes, sessions, mutation operations, albums, and permissions.

The first Level 3 implementation handoff is reviewed and complete:

- DONE: `/admin` Worker-side Cloudflare Access JWT verification, strict
  `*.cloudflareaccess.com` JWKS origin validation, admin email allowlist,
  minimal protected SSR page, fail-closed tests, and operator documentation.
- DONE: commit `e72de73` passed workers-ci and deployed the admin boundary plus
  user inventory; production `/admin` and `/admin/users` both return the
  expected fail-closed 403 with `Cache-Control: no-store`.
- DONE: commit `127c887` passed workers-ci and deployed the read-only album and
  permission inventories; production `/admin/albums` and `/admin/permissions`
  both return the expected fail-closed 403 with `Cache-Control: no-store` while
  Access configuration is absent.
- DONE 2026-06-23: the path-scoped Cloudflare Access application is configured,
  `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, and `ADMIN_EMAILS` are registered,
  and the operator verified an allowlisted authenticated session reaches the
  admin console at `https://share-photo.iniwach.com/admin`.
- Album creation/deletion and PhotoPrism-coupled album operations, sync
  operations, audit UI, and cleanup remain unimplemented.

Recent Level 2 execution:

- DONE: CI auto-deploy verified end to end (workers-ci c884256 ran
  every deploy step with the registered secrets; live smoke passed;
  workflow_dispatch deploys from main enabled).
- DONE: docs/operations/ deploy-log.md, rollback.md, backup.md.
- DONE: sync `0.2.0` implemented and tagged (`sync-v0.2.0`):
  sync-daemon native scheduler, atomic health file + healthcheck
  subcommand + Dockerfile HEALTHCHECK, sanitized INFO progress logs.
  Sonnet subagent implementation, audited in the main session with
  three fixes (heartbeat waiter leak via asyncio.shield, unwired
  sleep_fn, last_error hardcoded None). 182 tests in 2 s on WSL.
  docker-ci for the tag green; GHCR `0.2.0` published — covers + daemon
  land together when the stack is bumped to `0.2.0` (0.1.7 skipped).
- DROPPED by operator decision: Portainer stack auto-update webhook
  (Business Edition feature; running Community Edition). Manual tag
  bumps are the documented path.
- DONE: sync `0.2.1` implemented, tagged, and published multi-arch. It
  restores the root logger to WARNING so httpx cannot expose PhotoPrism
  preview URLs/tokens while retaining `photo_gate.*` INFO logs.
- DONE: the operator confirmed the existing Portainer stack is running sync
  `0.2.1` on 2026-06-23.

Level 2 closure: Worker version rollback verified 2026-06-23 — `wrangler rollback`
with OAuth session, both directions, unauthenticated smoke checks passed.
Rollback removed the Access secrets; they were re-registered, the AUD was
corrected from the dashboard value, and authenticated `/admin` was restored on
version `08e567cf`. A production Docker rollback exercise was removed from the
completion requirements by operator decision; its Portainer procedure remains
documented.

## Last Completed Work (Level 1 closure, 2026-06-11..12)

- End-to-end sync of 234 photos with sync `0.1.6` +
  `PHOTOPRISM_PREVIEW_SIZE=fit_1920`; manifest uploaded last; sampled
  production thumb and preview verified metadata-free.
- Browser login was broken for every real browser (403 Forbidden): with
  `Referrer-Policy: no-referrer` browsers serialize the login form POST's
  Origin header as `Origin: null` (Fetch spec), which the origin check
  correctly rejects; curl smoke tests don't apply referrer policy and
  missed it. Diagnosed with Playwright (request showed `origin: null`),
  fixed to `Referrer-Policy: same-origin` + value-asserting regression
  test (894 tests). `Origin: null` stays rejected by design.
- Deploying that fix exposed that workers-ci's deploy job had silently
  skipped all steps (secret gate: Cloudflare secrets absent on GitHub).
  Deployed manually (version `131a0632`, live header + browser flow
  re-verified). Operator registered the GitHub repository secrets
  2026-06-12; first real CI deploy still unobserved.
- Earlier iterations recorded in roadmap item 3: Portainer
  `${VAR:-default}` mis-expansion (0.1.1), bookworm libvips 8.14
  synthesizing EXIF at save time -> trixie base + CI container-test gate
  (0.1.2-0.1.5), PhotoPrism placeholder previews -> fail-closed size
  check + `--photoprism-preview-size` (0.1.6).

## Latest Known Verification

- Workers: 894 tests / 24 files, lint, typecheck, build, audit green
  in the production baseline (2026-06-12). The reviewed `/admin`
  authentication foundation, read-only inventories, permission mutations,
  album and user enable/disable controls, user create/password-reset controls,
  album public metadata update controls, read-only admin ops summary, read-only
  admin sync status, manual sync UI/status-schema additions, user display-name
  editing, browser-friendly permission assignment UI, and D1-only album creation
  pass lint, typecheck, build, production dependency audit, and 2041 tests / 32
  files locally (2026-06-26). Full devDependency audit may still report
  Wrangler/Miniflare transitive advisories; production dependency audit reports
  0 vulnerabilities.
  Production Worker commit `cd990ae` is deployed as version `3c4d4f8e`; live
  includes manual sync controls, user display-name editing, permission assignment
  dropdowns, and D1-only album creation.
- Docker: sync `0.3.0` is published multi-arch and running in production. The`r`n  admin sync-status handoff
  passed 190 tests with 34 expected libvips/pyvips skips and
  `python -m compileall src` locally (2026-06-25). The Docker-side sync request
  consumer passed 253 tests with 34 expected libvips/pyvips skips and
  `python -m compileall src` locally (2026-06-26). The status schema 2 /
  admin sync UI handoff passed 265 tests with 34 expected libvips/pyvips skips
  and `python -m compileall src` locally (2026-06-26); Docker build/smoke was
  skipped locally because Docker Desktop was not running. The operator confirmed
  the production Pi is running `0.3.0` on 2026-06-26 and live manual sync
  completed successfully: 234/234 synced, cover and manifest uploaded, pending
  state cleared, failures stayed 0, and trigger kind showed manual.
- Live security posture (2026-06-11/12): unauthenticated pages 303 to
  `/`; `/img` + reserved routes 401 `no-store`; cross-origin and
  `Origin: null` POSTs 403; direct R2 refused; no URL/token/EXIF/GPS/XMP
  in manifest or sampled images.

## Operational Notes

- Cloudflare API token: `~\.photo-gate-cf-token` (outside repo, never
  printed) and GitHub Actions secrets (registered 2026-06-12).
- Real user/album identifiers exist only in D1 and Portainer env.
- Cloudflare REST API caches R2 object GET bodies; verify object
  contents via fresh keys or listing etag/size, not re-downloads.

## Current Blockers / Required Human Actions

See `docs/operations/operator-actions.md` for the operator-facing
action list and full status snapshot.

1. DONE 2026-06-23: the Portainer stack image is running `0.2.1`. 0.2.1
   fixes a log leak found in production on
   2026-06-15: the 0.2.0 daemon configured the *root* logger at INFO,
   which enabled httpx's `HTTP Request: GET <url>` lines on stdout —
   and that URL embeds the PhotoPrism preview token + hostname. 0.2.1
   keeps root at WARNING and logs only `photo_gate.*` at INFO. The
   leaked tokens are short-lived (re-fetched each sync) so no emergency
   revocation is needed (operator-actions.md A-0).
2. DONE 2026-06-15: R2 `Unauthorized` blocker resolved. The R2 S3 key
   had been invalidated by the 2026-06-12 token roll; the operator
   issued a new photo-gate-scoped Object Read & Write key and updated
   the Portainer env. Production 0.2.0 then synced 234/234, uploaded
   cover + manifest, "sync attempt 1 succeeded in 134.1s". Fail-closed
   meant nothing was corrupted while the key was bad.
3. DONE 2026-06-12: stack updated to `0.2.0` sync-daemon command block.
4. DONE 2026-06-12: local token refreshed; D1 export verified (D1
   permission only — see operator-actions.md A-2 for the optional
   Workers-scope edit).

## Next Priority

Level 2 is complete. Manual sync deployment and smoke are complete. The next
Level 3 priority is ADR Phase 3 planning: safe PhotoPrism album catalog
publication by Docker to private R2, followed by admin UI integration. Worker
must still not contact PhotoPrism, NAS, Docker, or Portainer directly.
