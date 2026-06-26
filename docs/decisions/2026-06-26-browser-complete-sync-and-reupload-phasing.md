# Browser-Complete Album Sync And Reupload Phasing

Date: 2026-06-26

## Context

The admin browser can now create D1 album rows, but Docker sync still runs a
single album configured through Portainer environment variables. Pressing the
manual sync button therefore re-syncs the currently configured album; it does
not discover or sync newly created D1 albums.

A second issue was observed during manual sync: running sync again for the same
album performs a full pass over all photos. R2 object keys are stable, so this
is an overwrite of the same keys, not unbounded duplicate object creation. It
is still inefficient because every photo is downloaded, re-encoded, and PUT to
R2 again.

These two problems are related operationally but should not be implemented in a
single change. Browser-complete album lifecycle changes the sync target model.
Reupload suppression changes sync correctness and cache behavior. Mixing them
would make review and rollback harder.

## Decision

Split the work into two independent tracks.

## Track A: Browser-Complete Album Sync

Goal: an operator can use the browser to work with PhotoPrism albums without
editing Portainer album variables for each new album.

The Worker still must not contact PhotoPrism, NAS, Docker, Portainer, or a
Docker socket. Docker remains the only component that talks to PhotoPrism.
Docker still must not read D1.

### A1. Docker Publishes A Sanitized Album Catalog

Docker adds a `publish-catalog` command that calls PhotoPrism, builds a
sanitized display catalog, and writes it to private R2 at:

```text
ops/album-catalog.json
```

The object is private R2 only and uses:

- Content-Type: `application/json`
- Cache-Control: `private, no-cache`

Schema 1:

```json
{
  "schema": 1,
  "publishedAt": "2026-06-26T00:00:00Z",
  "albums": [
    {
      "catalogId": "64 lowercase hex sha256 of the PhotoPrism album UID",
      "title": "Album title for admin display",
      "photoCount": 234,
      "updatedAt": "2026-06-26T00:00:00Z"
    }
  ]
}
```

`photoCount` and `updatedAt` may be `null` when PhotoPrism does not provide a
safe value.

The catalog must not contain PhotoPrism UIDs, PhotoPrism URLs, API tokens,
preview tokens, NAS paths, original filenames, location metadata, R2 keys,
admin identity, or any source-photo row data. `catalogId` is stable and opaque
from the browser's point of view; Docker can recompute it from the real UID
when it needs to resolve a sync target later.

This phase does not change Worker UI and does not change sync target behavior.
It only creates the safe catalog artifact.

### A2. Docker Reads Browser-Owned Sync Targets

A later handoff will define a private R2 sync-target object, likely:

```text
ops/sync-targets.json
```

The Worker may write safe target records such as `albumId`, `catalogId`, title,
image settings, expiry, and download flag. It must not write raw PhotoPrism
UIDs. Docker reads this object, lists PhotoPrism albums, maps `catalogId` back
to the current PhotoPrism UID, and syncs the targets. This replaces the current
single-album Portainer variables as the normal path.

This phase must preserve the ability to run one configured album during
migration.

### A3. Worker Browser UI Uses The Catalog

A later Worker handoff will read `ops/album-catalog.json` and render a safe
catalog picker in admin pages. Creating an album from the picker will create a
D1 row disabled by default and update the safe sync-target object. The operator
will not type a raw PhotoPrism UID in normal operation.

The existing manual UID create path may remain as an emergency/operator path
until the catalog flow is proven in production.

### A4. Manual Sync Targets

A later handoff will extend `ops/sync-request.json` so manual sync can request:

- all configured sync targets; or
- a single `albumId` / `catalogId` target.

The request object must not include raw PhotoPrism UIDs or source URLs.

## Track B: Reupload Suppression

Goal: avoid re-downloading, re-encoding, and re-PUTing unchanged images during
scheduled or manual sync.

This track is intentionally separate from Track A.

Candidate approach:

1. Add object metadata inspection to the Docker object store, without listing
   or deleting unrelated prefixes.
2. Use the existing manifest and PhotoPrism photo identifiers/hashes to decide
   whether a photo output is already current for the requested transform
   settings.
3. Skip unchanged thumb/preview PUTs.
4. Continue to write `cover.webp` and `manifest.json` only after the album pass
   completes successfully.
5. Add status counters such as `uploaded`, `skipped`, and `failed` only after
   the correctness model is reviewed.

Important cache note: current image objects use immutable cache headers. Because
R2 keys are stable, overwriting an existing image key may not invalidate cached
browser copies. Track B must explicitly decide whether to keep stable keys,
include a content/version component in future keys, or rely on no shared caching
for authenticated image responses. Do not change key shape without a separate
review.

## Non Goals For Track A

- No R2 deletion.
- No duplicate/reupload optimization.
- No Worker-to-PhotoPrism/NAS/Docker/Portainer access.
- No Docker-to-D1 access.
- No public R2 access.
- No browser rendering of raw PhotoPrism UID.
- No automatic enablement of newly created albums.

## Immediate Next Step

Implement Track A1 only: Docker `publish-catalog` command and private R2
`ops/album-catalog.json` publication, with tests proving that raw PhotoPrism
UIDs and secrets do not appear in the published catalog or logs.