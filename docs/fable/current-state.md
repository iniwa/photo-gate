# Current State

Last audited: 2026-07-02.

## Level

**Level 2 (Operable) is complete.** A real family album is served
end-to-end in production: PhotoPrism -> Docker sync on the Pi -> private
R2 -> Workers viewer, with a human-confirmed browser login, album list,
thumbnail grid, and preview display (2026-06-12). Delivery, scheduled
operation, observability, backup procedures, and Worker rollback verification
are in place. By operator decision on 2026-06-23, a production Docker rollback
exercise is not required; the immutable-tag Portainer procedure remains
documented for incident use.

## Production Topology

- Workers viewer: https://share-photo.iniwach.com
  (commit `2260c2e`; active version ID `1f567a03-33e3-47ac-8fbe-20c6e525010d`; latest observed Workers CI run `28570581091`;
  cron 18:00 UTC session cleanup).
  Includes manual sync request writer, admin sync UI, status schema 2, user display-name editing, permission assignment dropdowns, D1-only album creation, browser-owned sync-target routes, the `/admin/albums` catalog picker, `/admin/r2-cleanup` dry-run plus deletion-preview routes (actual deletion disabled), preview JPEG download, manifest schema 2 viewing support, unique preview download filenames, the authenticated viewer photo preview page, viewer UI cleanup Phase 1, admin hard-delete confirmation-preview Phase 2, and user hard delete Phase 3 (users only; album hard delete remains preview-only).
  The former `photo-gate.iniwaiwana.workers.dev` route is disabled and returns 404.
- D1 `photo-gate` (APAC, id `de77cb73-497a-4a41-bd1c-151fd907be3f`),
  2 migrations applied. One user, one album, one permission row (real
  identifiers live only in D1/Portainer, never in the repo).
- R2 `photo-gate`, private. Current live sync covers two browser-managed album targets with 256 total published photo entries (thumb WebP + preview JPEG pairs) plus covers and schema 2 manifests, all generated derivatives intended to be metadata-free. Real album identifiers live only in D1/Portainer/R2 and are not recorded here.
- Sync: Portainer stack `iniwa-photo-gate` on a Raspberry Pi 4 running
  `ghcr.io/iniwa/photo-gate-sync:0.4.2` with the native sync daemon,
  healthcheck, and
  `PHOTOPRISM_PREVIEW_SIZE=fit_1920`, scheduled at the default 86400-second
  interval.
- Sync `0.4.2` is published and deployed in Portainer from tag `sync-v0.4.2`
  (commit `fb57196`), replacing `0.4.1`. It includes reupload suppression:
  the first successful sync publishes manifest schema 2 with per-photo
  `sourceHash`, and later unchanged photo thumb/preview pairs can be skipped
  while cover and manifest continue to upload. The previous `0.4.1` catalog
  type-filter hotfix and `0.2.1` log leak fix remain in place.
- PhotoPrism serves static thumbs up to 1920 px; dynamic previews stay
  disabled by operator choice (Pi load).

## Delivery

- Gitea is canonical; GitHub `iniwa/photo-gate` mirrors within ~1 minute
  and runs CI.
- docker-ci: host-libvips tests + container-test (suite inside the
  published image's libvips, gates release) + `sync-v*` multi-arch GHCR
  release. Stack updates are manual tag bumps in Portainer: automated
  stack webhooks were dropped 2026-06-12 (Business Edition feature;
  this deployment runs Community Edition).
- workers-ci: checks green; the secret-gated deploy job was verified end to
  end on 2026-06-12, including migrations, deploy, and live smoke checks.

## Key Operational Lessons (details in docs/fable/progress.md)

- Portainer mis-expands `${VAR:-default}`; the stack file forbids that
  syntax and normalizes junk values in the container shell.
- Debian bookworm libvips 8.14 synthesizes EXIF at save time; the image
  is pinned to trixie (libvips 8.16) and CI tests inside the container.
- PhotoPrism answers an unservable size with a 200 placeholder; sync
  fails closed on undersized sources (`--photoprism-preview-size`).
- `Referrer-Policy: no-referrer` makes browsers send `Origin: null` on
  form POSTs; the viewer uses `same-origin` and a value-asserting test.

## Missing / Next (see roadmap)

- Level 2 is complete. Worker version rollback was verified 2026-06-23 —
  `wrangler rollback` (OAuth session) rolled back and restored production between version IDs
  `0fa7821a` and `495c9ae6`; unauthenticated smoke checks passed both ways.
  The exercise revealed that rollback did not restore Worker secrets; the
  three Access secrets were re-registered and production recovered on version
  `08e567cf`, with authenticated `/admin` confirmed by the operator.
  Docker rollback remains documented as an immutable-tag Portainer operation,
  but its production exercise is intentionally not required.
- Level 3: `/admin` Worker-side Cloudflare Access JWT validation plus admin
  email allowlist and the read-only, keyset-paginated user, album, and
  permission inventories and idempotent permission grant/revoke mutations are
  implemented and deployed. Idempotent album enable/disable controls are also
  implemented and deployed. Idempotent user enable/disable controls are also
  implemented and deployed. Admin user creation/password reset, album public
  metadata update controls, read-only operational summary, and read-only sync
  status, user display-name editing, and browser-friendly permission assignment
  UI are implemented and reviewed locally. The path-scoped Cloudflare
  Access application is configured, and the three Worker values
  (`CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `ADMIN_EMAILS`) are registered and
  operator-verified on 2026-06-23; the production admin surface is usable.
  Sync request controls have an accepted ADR (`docs/decisions/2026-06-25-sync-request-controls.md`)
  and the Worker-side manual sync administration surface is deployed to production:
  request writer (`POST /admin/sync/request`), status schema 2 rendering,
  pending indicator, and no-JS Sync Now form (`GET /admin/sync`). Production
  Worker deploy completed 2026-06-29 (version `b1874993`, commit `de74227`);
  unauthenticated smoke checks pass. Docker sync `0.3.0` is released and running
  in Portainer, and live manual-sync smoke completed 2026-06-26: the admin
  request was consumed by the daemon, sync completed 234/234, cover and manifest
  uploaded, pending state cleared, failures remained 0, runs completed reached 1,
  and trigger kind showed manual. ADR Phase 1 admin browser management is
  implemented and reviewed locally: display-name editing and dropdown-based
  permission assignment. ADR Phase 2 admin album creation is implemented and
  reviewed locally: `POST /admin/albums/create` inserts a D1-only row with
  `enabled = 0`, accepts `photoprism_album_uid` only on create, and does not
  touch PhotoPrism, NAS, Docker, Portainer, or R2. Track A1 for
  browser-complete sync is implemented and reviewed locally: Docker
  `photo-gate-sync publish-catalog` writes a sanitized album catalog to private
  R2 at `ops/album-catalog.json`, using hashed catalog IDs and excluding raw
  PhotoPrism UIDs, URLs, tokens, credentials, and source photo data. Track A2
  is implemented and reviewed locally: Worker admin routes write safe
  `ops/sync-targets.json` records and Docker consumes them to sync resolved
  targets while falling back to the Portainer-configured album during migration.
  Track A3 is deployed in the Worker: `GET /admin/albums` reads the safe
  private R2 catalog and renders a no-JS catalog picker for sync-target
  selection, while `POST /admin/albums/sync-target-upsert` verifies the selected
  catalog ID exists before D1 reads or sync-target writes. Docker `0.4.2` is released and deployed in Portainer; it includes reupload
  suppression based on schema 2 manifests and per-photo `sourceHash`. Catalog
  publication and picker smoke passed after the `0.4.1` type-filter hotfix.
  Album deletion and final hardening remain; dry-run R2 cleanup report is
  deployed (CI run `28415678789`, commit `b3c434c`, 2026-06-30); reupload
  suppression is live-smoke verified. Viewer preview download is deployed (`c9409c1`), schema 2 manifests are accepted by Workers (`84bcbcf`), preview download filenames include photo IDs (`8ef26a4`), and the viewer photo preview page with previous/next navigation is deployed (`797682e`, CI run `28428506984`). Viewer UI cleanup Phase 1 is deployed (`2b0941f`, CI run `28558926039`) and changes presentation only. Admin hard-delete confirmation-preview Phase 2 is deployed (`ea39fc4`, CI run `28560281394`); user hard delete Phase 3 is deployed (`2260c2e`, CI run `28570581091`), `HARD_DELETE_HMAC_KEY` is registered, active version is `1f567a03-33e3-47ac-8fbe-20c6e525010d`, authenticated disposable-user delete is confirmed, and album hard delete remains preview-only. RAW/original download is explicitly deferred pending a separate ADR because it would change current privacy boundaries.

## Verification Baseline

- Workers: 2416 tests / 40 files, lint, typecheck, build, audit green
  in the last production baseline (2026-06-12). The reviewed `/admin`
  authentication foundation, read-only inventories, permission mutations,
  album and user enable/disable controls, user create/password-reset controls,
  album public metadata update controls, read-only admin ops summary, read-only
  admin sync status, the manual sync UI/status-schema additions, user display-name
  editing, browser-friendly permission assignment UI, D1-only album creation, and
  the `/admin/r2-cleanup` dry-run report plus deletion-preview Phase 2, preview JPEG download, manifest schema 2 viewing support, unique preview download filenames, viewer photo preview page, and viewer UI cleanup Phase 1 pass lint, typecheck, build, production
  dependency audit, and 2370 tests / 38 files locally (2026-07-02).
  Production audit is clean; full `npm audit` remains blocked by devDependency
  advisories in Wrangler/Miniflare. Workers CI deployed commit `ea39fc4` as
  CI run `28558926039` (2026-07-02); unauthenticated production smoke confirms
  viewer login page, /albums 303 redirect, /img 401 no-store, /api 401 no-store,
  `/download/probe-album/preview/probe-photo` 401 no-store, `/albums/probe-album/photos/probe-photo` 303 to `/`, /admin Cloudflare Access 302 intercept, and /admin/r2-cleanup Cloudflare Access
  302 intercept. Authenticated `/admin/r2-cleanup` browser check passed: the
  report link is visible, the dry-run page renders, no delete control is shown,
  and full R2 keys, photo IDs, bucket name, PhotoPrism UID/URL/token, and
  credentials are not visible.
- Docker: sync `0.4.2` is running in production; sync `0.4.0` was superseded
  by the catalog type-filter hotfix before completing live use. sync`r`n  `0.2.1` reports 183 tests green in the previous published baseline;
  the admin sync-status handoff passed 190 tests with 34 expected libvips/pyvips
  skips plus `python -m compileall src` locally (2026-06-25). The Docker-side
  sync request consumer passed 253 tests with 34 expected libvips/pyvips skips
  plus `python -m compileall src` locally (2026-06-26). The status schema 2 /
  admin sync UI handoff passed 265 tests with 34 expected libvips/pyvips skips
  plus `python -m compileall src` locally (2026-06-26); Docker image build was
  skipped locally because Docker Desktop was not running, then docker-ci built and
  published `sync-v0.3.0`. Production live smoke on 2026-06-26 confirmed
  manual sync success: 234/234 synced, cover and manifest uploaded, and
  `/admin/sync` reported no pending request, 0 failures, 1 run completed,
  manual trigger, and a non-null handled request ID. The local Docker
  album-catalog publisher passed 333 tests with 34 expected libvips/pyvips skips
  plus `python -m compileall src` on 2026-06-26; it is not yet released or
  deployed. The local sync-target consumer/publisher path passed Workers lint,
  typecheck, build, audit, and 2125 tests / 33 files; Docker pytest with 394
  passed / 34 expected skips plus `python -m compileall src` on 2026-06-29. The
  local Worker catalog picker path passed Workers lint, typecheck, build,
  production dependency audit, and 2186 tests / 34 files on 2026-06-29. Docker `0.4.0` was released by docker-ci run `28350063100`, then superseded by `0.4.1` after live catalog smoke showed PhotoPrism non-album groupings in the picker. Docker `0.4.1` was released by docker-ci run `28353237481`: host tests, container-test, and release succeeded, and GHCR published both `0.4.1` and `sha-61d0278` multi-arch manifests. Portainer was updated to `0.4.1`; the operator reran `photo-gate-sync publish-catalog`, and `/admin/albums` picker output looked correct. Docker `0.4.2` was later pushed, deployed, and applied in Portainer on 2026-06-30 at commit `fb57196`; it adds manifest schema 2 reupload suppression. Local verification for the feature passed 441 tests with 46 expected skips plus `python -m compileall src`; Docker Desktop image smoke was skipped locally because the daemon was unavailable. Live second-run skip behavior is confirmed: an unchanged follow-up sync skipped 256/256 photo thumb/preview pairs across two targets while still uploading covers and manifests, and the sync attempt succeeded.
- Live security posture verified 2026-06-11/12: unauthenticated pages
  303 to `/`; `/img` and reserved routes 401 `no-store`; cross-origin
  and `Origin: null` POSTs 403; direct R2 access refused; manifest and
  sampled images carry no URLs, tokens, EXIF, GPS, or XMP.

## Documentation Condition

Some older Japanese documents (e.g. `photo-gate-design.md`, old ADRs) are
mojibake in the working tree; preserve as historical evidence. Use
`FABLE.md`, `AGENTS.md`, and `docs/fable/` as the operational source of
truth.
