# Operability Hardening Delivery Report

Date: 2026-08-12

## Outcome

This change set makes the browser-admin flow sufficient to prepare and share a
new album without a Raspberry Pi shell session. It preserves the existing
private-R2 and Docker/Worker boundaries: Workers coordinate safe control objects
and display aggregate state; Docker remains the only component that talks to
PhotoPrism, processes images, and publishes share assets.

## Delivered

### Share readiness

`GET /admin/albums` now shows a `共有準備` status for each displayed album. The
label is derived from only these safe facts:

1. The sanitized catalog is available.
2. A sync target exists and still refers to a current catalog entry.
3. The private manifest object is present, missing, or unknown.
4. The album is not expired and is enabled.
5. The aggregate count of assigned, enabled users is non-zero.

The Worker uses one D1 aggregate query and at most four concurrent R2
`head()` calls for the current page. It never reads a manifest body or image,
lists objects, exposes an R2 key, or renders a source identifier. R2 probe
failure is shown as an unknown state rather than a false missing state.

### Catalog-only admin action

`GET /admin/sync` now provides two independent forms:

- `今すぐ同期`: existing image-sync request at `ops/sync-request.json`.
- `カタログを更新`: catalog-only request at
  `ops/catalog-refresh-request.json`.

The new request has a strict schema-1 body (`schema`, `requestId`,
`requestedAt`, `kind=publish-catalog`) and the same same-origin and exact-form
validation as the existing admin mutation path. It uses its own fixed key, so a
pre-upgrade Docker daemon ignores it instead of starting an image sync.

The Docker daemon validates, deduplicates, and deletes the catalog request
best-effort. Handling it runs `publish-catalog` only: it does not list photos,
download previews, transform images, upload derivatives, or write manifests.

### Aggregate operation result

Docker best-effort publishes `ops/sync-result.json` after normal image syncs
and catalog-only refreshes. The Worker shows only safe aggregate fields:
operation, trigger, result, timestamps, target counters, photo counters, and
whether the catalog was refreshed. The payload deliberately excludes album IDs,
titles, photo IDs, keys, source identities, errors, credentials, and metadata.

Existing `ops/sync-status.json` and `ops/sync-request.json` contracts remain
unchanged.

### Docker reliability and code structure

- R2 operations now have explicit 10-second connect and 60-second read
  timeouts, using standard retries capped at four total attempts.
- A successful `sync_album()` returns safe per-album counters used only for the
  aggregate result. Manifest-last semantics remain unchanged.
- The former large `photo_gate.main` is now a compatibility facade. CLI parsing,
  daemon lifecycle, target processing, request handling, status publication,
  catalog publication, health checks, and shared runtime helpers live in focused
  modules.
- `photo-gate-sync` is prepared as version `0.5.0`.

### Worker maintainability and dependency hygiene

- `admin.tsx` retains guard, validation, and route logic; SSR page components
  now live in `admin-pages.tsx`.
- Added V8 coverage support via `npm run test:coverage`.
- Updated `hono` to `^4.13.1`, `wrangler` to `^4.121.0`, and compatible
  Cloudflare Worker types. `npm audit` reports zero vulnerabilities after the
  update.

## Operator Workflow After Deployment

For a new album, use the following browser-only order:

1. Create the album in `/admin/albums`.
2. Open `/admin/sync` and select **カタログを更新**.
3. Wait for the aggregate result to report a successful catalog update, then
   return to `/admin/albums` and set the sync target.
4. Open `/admin/sync` and select **今すぐ同期**.
5. Wait for a successful image-sync result. The album readiness state changes
   from `同期待ち` once the manifest is present.
6. Enable the album and grant at least one user permission. The state becomes
   `共有可能` when all safe conditions hold.

## Deployment Order

1. Release and deploy Docker `0.5.0` first (immutable `sync-v0.5.0` image tag
   and Portainer update).
2. Confirm the daemon is healthy and can consume the new catalog-only request.
3. Push/deploy the Worker change through the established CI path.
4. Perform an authenticated admin smoke: catalog update, target setting, sync,
   readiness transition, enablement, and permission grant.

The order is important only for operability. Deploying the Worker first is
safe because an older daemon ignores the separate catalog-only key, but that
request will remain pending until Docker `0.5.0` is active.

## Verification

Completed locally:

- Worker: `npm run lint`, `npm run typecheck`, `npm run test:coverage`, and
  `npm run build`.
  - 2,562 tests in 46 files passed.
  - Coverage: 91.32% statements, 89.84% branches, 95.96% functions, 95.48%
    lines.
  - `npm audit` found 0 vulnerabilities after dependency updates.
- Docker source checks in a clean Python 3.12.10 virtual environment:
  `pip install -e ".[dev]"`, `python -m pytest`,
  `python -m compileall -q src`, and `python -m pip check`.
  - 470 passed and 46 skipped locally; the skipped tests require native
    libvips, which is supplied by the release container.
  - The editable install and dependency consistency check passed.
- Docker image verification against the pinned Python 3.12 / Debian trixie
  runtime and libvips 8.16.1:
  - The `test` stage built successfully and all 516 tests passed in the
    container, including the 46 libvips-dependent tests skipped on Windows.
  - The final image built successfully; CLI help, `sync-once --help`, libvips
    import, non-root execution (`uid=1001`, `gid=1001`), entrypoint, default
    command, healthcheck, and absence of exposed ports were verified.
  - A no-push BuildKit build succeeded for both `linux/amd64` and
    `linux/arm64`.
  - No secret-like build-history patterns were found.
- `git diff --check` passed apart from existing CRLF normalization warnings.

## Protected Boundaries Confirmed

- No Worker image processing, original/RAW access, PhotoPrism/NAS access, R2
  public access, R2 cleanup mutation, D1 schema change, or secret change.
- No change to generated derivative object keys, manifest schema, viewer
  authorization, or existing normal sync-request/status compatibility.
- Existing unrelated working-tree changes were left untouched.
