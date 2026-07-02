# Progress

Last updated: 2026-07-02.

## Current Completion Level

**Level 2: Operable — COMPLETE (2026-06-23).** Level 1 production viewing,
automated checks/releases, scheduled operation, health and sanitized logs,
backup procedures, and Worker rollback verification are complete. By operator
decision, a production Docker rollback exercise is not required; the documented
immutable-tag Portainer procedure remains available for incident use.

## Current Task

There is no active implementation handoff.

Viewer photo download, preview-page, and first UI cleanup work is deployed:

- DONE: Commit `c9409c1` added safe preview JPEG downloads from existing private
  R2 derivatives only, gated by session, album permission, manifest membership,
  and `download_enabled`.
- DONE: Commit `84bcbcf` fixed Worker manifest parsing for Docker `0.4.2`
  schema 2 manifests with per-photo `sourceHash`; `sourceHash` remains
  non-rendered and non-exposed.
- DONE: Commit `8ef26a4` made preview download filenames unique by including
  the manifest photo ID.
- DONE: Commit `797682e` added the authenticated viewer photo preview page
  (`GET /albums/:albumId/photos/:photoId`) with existing `/img` preview
  embedding, previous/next navigation, back-to-album link, and conditional
  download link. Workers CI run `28428506984` succeeded, and unauthenticated
  production smoke passed.
- DONE: Commit `2b0941f` completed viewer UI cleanup Phase 1 for the login page,
  album list, album detail grid, photo preview page, and shared viewer controls.
  It is presentation-only: no route, auth, D1, R2, manifest, image response, or
  download response behavior changed. Workers CI run `28558926039` succeeded, and
  unauthenticated production smoke passed.
- DEFERRED: RAW/original download is not implemented. It requires a separate
  ADR because it would change the current no-originals/no-NAS/no-PhotoPrism
  viewer boundary.
Admin hard delete controls are partially implemented:

- DONE: ADR `docs/decisions/2026-06-30-admin-hard-delete-controls.md` decides
  user and album hard-delete safety boundaries.
- DONE: Phase 2 confirmation-preview routes are deployed at commit `ea39fc4`
  with 15-minute HMAC tokens and exact typed phrases.
- DONE: `HARD_DELETE_HMAC_KEY` is registered in production.
- DONE: Phase 3 user hard delete is deployed at commit `2260c2e`, Worker version
  `6c017227-9d7d-47f8-b40b-e6392684269a`, workers-ci run `28570581091`. It
  deletes only `users` after the existing two-step guard and relies on D1
  cascade for sessions and album permissions.
- PENDING: Album hard delete remains separate and, if later approved, must
  remove the matching browser-owned sync-target entry from `ops/sync-targets.json`
  before deleting the D1 album row, and must not delete R2 album assets.

The R2 cleanup deletion-preview Phase 2 handoff is reviewed, committed, pushed by
the operator, and partially runtime-checked:

- DONE: Commit `d57ba95` adds `POST /admin/r2-cleanup/confirm` and
  `POST /admin/r2-cleanup/delete` as HMAC-signed confirmation-preview routes.
  Actual R2 deletion remains disabled; the delete route only renders a "not yet
  enabled" result after validation.
- DONE: Local verification passed Workers lint, typecheck, build, production
  dependency audit, and 2285 tests / 37 files; `git diff --check` was clean;
  Docker, migrations, Fable, and operations files were not changed by the
  implementation commit.
- DONE: Operator pushed `d57ba95` and registered the Worker secret
  `R2_CLEANUP_HMAC_KEY`.
- DONE: Authenticated `/admin/r2-cleanup` browser check found no orphan
  prefixes, so the Phase 2 preview form is hidden as expected.
- PENDING: Worker version ID / CI run ID for `d57ba95` can be backfilled if the
  operator retrieves it from Cloudflare or GitHub Actions.
- NOTE: The positive confirm/delete-preview path was not exercised in production
  because there are currently no orphan candidates. No R2/D1 mutation occurred.

The nineteenth Level 3 delivery handoff (`2026-06-30-r2-cleanup-dry-run-delivery`)
is complete except for Worker version ID backfill. CI deployed commit `b3c434c`
(workers-ci run `28415678789`, success). Unauthenticated smoke passed.
Authenticated `/admin/r2-cleanup` browser check passed.

Docker `0.4.2` reupload suppression is pushed, released, operator-applied in
Portainer, and live-smoke verified. The unchanged follow-up sync skipped 256/256
photo thumb/preview pairs across two targets while still uploading covers and
manifests, and the sync attempt succeeded.

The manual sync release is deployed and live-smoke verified in production:

- DONE: Worker commit `a1a5c2e` is deployed as version`r`n  `b30250aa-0289-4758-b1fe-3376beba0afe` (2026-06-26).
- DONE: Docker sync `0.3.0` is published and running in the Portainer stack`r`n  (2026-06-26).
- DONE: the operator pressed the manual sync button from `/admin/sync`; the`r`n  daemon consumed the request, synced 234/234, uploaded cover and manifest, and`r`n  reported success in 136.5s.
- DONE: `/admin/sync` reported no pending request, 0 failures, 1 completed`r`n  run, manual trigger kind, and a non-null handled request ID.

The nineteenth Level 3 delivery handoff (`2026-06-30-r2-cleanup-dry-run-delivery`) is complete through CI:

- DONE: Implementation commit `b3c434c` (R2 cleanup dry-run report, reviewed and
  ops/-truncation regression fixed) is pushed to Gitea main and mirrored to GitHub.
- DONE: CI workers-ci run `28415678789` completed with `success`; both `checks` and
  `deploy` jobs concluded `success`. Worker version ID pending (log access requires
  admin rights; Wrangler auth scope insufficient - operator can retrieve from
  Cloudflare dashboard or `wrangler deployments list` with a full-scoped token).
- DONE: Unauthenticated production smoke passed: `/` 200, `/albums` 303 to `/`,
  `/img/probe-nonexistent` 401 no-store, `/api/probe` 401 no-store, `/admin`
  Cloudflare Access 302, `/admin/r2-cleanup` Cloudflare Access 302.
- DONE: Authenticated browser check passed. `/admin` contains the R2 cleanup
  report link, `/admin/r2-cleanup` renders the dry-run report, no delete
  button/form is present, and no R2 keys, photo IDs, bucket name, PhotoPrism
  UID/URL/token, or credentials are visible.
- PENDING: Worker version ID - to be recorded in `deploy-log.md` once retrieved.
- No code, migrations, Docker files, R2/D1 data, Portainer stack, secrets, or
  public access settings were changed by this delivery handoff.

The eighteenth Level 3 implementation handoff is reviewed, deployed, released, and live-smoke corrected with Docker `0.4.1`:

- DONE: Worker `GET /admin/albums` reads the fixed private R2 key
  `ops/album-catalog.json` and renders a no-JS `<select name="catalogId">`
  picker for each album row when the safe catalog is available.
- DONE: Missing or empty catalogs render a safe catalog-unavailable message and
  no free-text catalog ID input. Malformed catalogs and R2 read errors fail
  closed with sanitized 500 responses.
- DONE: `POST /admin/albums/sync-target-upsert` now verifies the submitted
  `catalogId` exists in the current validated catalog before calling the clock,
  D1 `getAlbumForSync`, or sync-target writes. Syntactically valid but absent
  IDs return 400 with no mutation.
- The picker renders only catalog title, optional photo count, optional
  timestamp, and the opaque 64-hex catalog ID. It does not render raw
  PhotoPrism UIDs, URLs, tokens, raw JSON, R2 credentials, admin identity, or
  Cloudflare Access claims.
- This is Track A3 for browser-complete sync. The Worker-side picker is deployed
  in production version `b1874993` (commit `de74227`); it does not add
  catalog-based D1 album creation, change Docker, change sync request schema,
  implement reupload suppression.
- DONE: local verification on 2026-06-29 passed Workers lint, typecheck, build,
  production dependency audit, and 2186 tests / 34 files; `git diff --check`;
  and confirmed no Docker or `workers/migrations` diff. DONE: production
  Worker deployment is active as version `b1874993-7876-4120-a6cf-fe03c44ad4eb`;
  unauthenticated smoke passed `/` 200, `/albums` 303 to `/`, `/img` 401
  no-store, `/api` 401 no-store, and `/admin` Cloudflare Access 302. DONE:
  Docker `sync-v0.4.0` tag was pushed at commit `2c17c83`; docker-ci run
  `28350063100` passed host tests, container-test, and release; GHCR published
  `ghcr.io/iniwa/photo-gate-sync:0.4.0` and `sha-2c17c83` for linux/amd64 and
  linux/arm64. LIVE FIX: after Portainer 0.4.0 deployment, the picker showed
  PhotoPrism folders/location/date groupings. Docker `0.4.1` added a
  `Type`/`type == "album"` catalog filter, docker-ci run `28353237481` passed,
  GHCR published `0.4.1` and `sha-61d0278`, Portainer was updated to `0.4.1`,
  and rerunning `photo-gate-sync publish-catalog` made the picker list real
  PhotoPrism albums only.
The seventeenth Level 3 implementation handoff is reviewed and complete locally:

- DONE: Worker admin routes `POST /admin/albums/sync-target-upsert` and
  `POST /admin/albums/sync-target-remove` read/write the fixed private R2 key
  `ops/sync-targets.json` using schema 1. Missing objects are treated as an
  empty target list; malformed existing objects fail closed with sanitized 500s.
- DONE: Docker daemon reads `ops/sync-targets.json`, resolves each safe
  `catalogId` by listing PhotoPrism albums and hashing raw UIDs in memory, and
  syncs resolved targets sequentially. Missing/empty/malformed target objects,
  or a target list with no resolvable catalog IDs, fall back to the existing
  Portainer-configured album for migration safety.
- Codex review added Worker-side oversized-object rejection before JSON parse
  and connected Docker multi-target failures to the existing sanitized
  `last_error` health/status path.
- Raw PhotoPrism UIDs are not selected by the new Worker query, not rendered,
  not written to sync-target JSON, and not logged. Docker uses raw UIDs only
  in memory after resolving catalog IDs.
- This is Track A2 for browser-complete sync. It does not add the catalog picker
  UI, does not extend the manual sync request schema, does not deploy or tag a
  Docker release, and does not implement reupload suppression.
- DONE: local verification on 2026-06-29 passed Workers lint, typecheck, build,
  production dependency audit, and 2125 tests / 33 files; Docker pytest with
  394 passed / 34 expected libvips/pyvips skips; `python -m compileall src`;
  `git diff --check`; and confirmed no `workers/migrations` diff. Docker
  build/smoke was skipped because Docker Desktop daemon was not running.
The sixteenth Level 3 implementation handoff is reviewed and complete locally:

- DONE: Docker `photo-gate-sync publish-catalog` builds a sanitized PhotoPrism
  album catalog and writes it to the fixed private R2 key
  `ops/album-catalog.json`.
- The catalog exposes only schema, publishedAt, hashed `catalogId`, title,
  optional photo count, and optional updatedAt. Raw PhotoPrism album UIDs,
  tokens, URLs, R2 credentials, and source photo data are not written or logged.
- Codex review tightened album `UpdatedAt` parsing so offset timestamps and
  timezone-less timestamps are rejected; only UTC `Z` timestamps are accepted
  and normalized to Docker seconds form.
- This is Track A1 for browser-complete sync. It does not change Worker UI,
  sync target selection, Portainer configuration, production Docker image tags,
  or reupload suppression.
- DONE: local verification on 2026-06-26 passed Docker pytest with 333 passed /
  34 expected libvips/pyvips skips, `python -m compileall src`,
  `git diff --check`, and confirmed no Workers or migration diff.

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
  Production Worker commit `de74227` is deployed as version `b1874993`; live
  includes manual sync controls, user display-name editing, permission assignment
  dropdowns, D1-only album creation, browser-owned sync-target routes, and the
  `/admin/albums` catalog picker.
- Docker: sync `0.4.2` is running in production. sync `0.4.0` was published
  but superseded by the catalog type-filter hotfix before final browser-complete
  smoke closure. The`r`n  admin sync-status handoff
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

Level 2 is complete. Manual sync deployment and smoke are complete. Track A1/A2/A3
browser-complete sync is deployed. Track B reupload suppression is implemented,
released as Docker `0.4.2`, applied in Portainer, and live-smoke verified. The
next priority is the remaining Level 3 administration/cleanup work: album
deletion design, R2 dry-run cleanup reporting, and final hardening.

## 2026-07-02 — Admin hard-delete preview flow deployed

Implemented, verified, committed, pushed, and deployed Admin Hard Delete Controls Phase 2 preview-only flow.
Commit `ea39fc4` added HMAC-signed 15-minute confirmation tokens, four admin POST routes (`/admin/users/confirm-delete`, `/admin/users/delete`, `/admin/albums/confirm-delete`, `/admin/albums/delete`), read-only D1 target summaries, admin list preview buttons, tests, README updates, and archived the handoff.

Verification: Workers lint/typecheck/test/build/audit passed locally; test count is 2403 tests across 40 files. GitHub workers-ci run `28560281394` completed success. Production unauthenticated smoke passed for `/`, `/albums`, `/img/probe-nonexistent`, `/download/probe-album/preview/probe-photo`, `/albums/probe-album/photos/probe-photo`, `/admin`, and `/admin/users`.

Important: actual hard delete remains disabled. No D1 DELETE, R2 delete, session/permission cascade, or sync-target mutation is implemented. Production use of the confirmation-preview forms requires registering `HARD_DELETE_HMAC_KEY`; without it, preview POST routes fail closed with 500.

## 2026-07-02 — Admin user hard delete Phase 3 deployed

Implemented, verified, committed, pushed, and deployed Admin Hard Delete Controls Phase 3 for users only.
Commit `2260c2e` adds `AdminUserRepository.deleteUser`, wires `POST /admin/users/delete` to execute `DELETE FROM users WHERE id = ?` after admin Access, same-origin, strict form parsing, valid HMAC token, exact `DELETE USER` phrase, and D1 target re-read. Album hard delete remains preview-only.

Verification: Workers lint/typecheck/test/build/audit passed locally; test count is 2416 tests across 40 files. GitHub workers-ci run `28570581091` completed success and deployed Worker version `6c017227-9d7d-47f8-b40b-e6392684269a`. Production unauthenticated smoke passed for `/`, `/admin`, `/admin/users`, and `/api/probe`.

Important: This enables real D1 user-row deletion in production. Sessions and album permissions are removed by existing D1 cascade. No R2 deletion, album deletion, sync-target mutation, Docker/PhotoPrism/NAS/Portainer path, or migration was added.
