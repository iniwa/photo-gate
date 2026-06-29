# Reupload Suppression

Date: 2026-06-29

## Context

The browser-complete sync path is now deployed through Docker sync `0.4.1`.
An operator can publish a sanitized PhotoPrism album catalog, choose a catalog
entry in `/admin/albums`, write browser-owned sync targets to private R2, and
trigger sync from `/admin/sync`.

Manual sync currently reprocesses every photo in every configured target. R2
object keys are stable:

```text
albums/<albumId>/thumbs/<photoUid>.webp
albums/<albumId>/previews/<photoUid>.jpg
albums/<albumId>/cover.webp
albums/<albumId>/manifest.json
```

Therefore repeated syncs overwrite the same keys rather than creating duplicate
objects. The problem is cost and latency: each unchanged photo is downloaded
from PhotoPrism, decoded, re-encoded, metadata-validated, and PUT to R2 again.

The current manifest schema is not enough to make a safe skip decision. It
contains photo UID, relative object paths, display metadata, dimensions, and
image settings, but it does not contain the PhotoPrism source hash that
identifies the source image version. A reupload suppression design must avoid
skipping a changed source or changed transform.

## Decision

Implement reupload suppression as a Docker-only optimization based on a new
manifest schema version. Keep R2 key shape unchanged for this phase.

The first implementation phase will:

1. Read the existing `albums/<albumId>/manifest.json` at the start of an album
   sync.
2. Treat a missing manifest, unreadable manifest, schema 1 manifest, malformed
   manifest, different album/source/settings, or any object-store read error as
   a safe cache miss for that album.
3. Add manifest schema 2 with per-photo source hashes and a transform signature.
4. For each photo, skip thumb/preview processing only when the previous schema 2
   manifest proves that the same photo UID, PhotoPrism source hash, output keys,
   and image settings were already published.
5. Continue to upload `cover.webp` and `manifest.json` after the album pass
   completes successfully.
6. Keep all failure semantics fail-closed: if a skip decision cannot be proven,
   reprocess and overwrite.

Workers, D1, permissions, viewer authorization, and R2 access policy are not
changed.

## Manifest Schema 2

`build_manifest` will emit `schemaVersion: 2`.

The existing fields stay present for viewer compatibility. Each photo entry gains
`sourceHash`, copied from `PhotoPrismPhoto.hash`:

```json
{
  "schemaVersion": 2,
  "albumId": "my-album",
  "title": "My Album",
  "source": {
    "type": "photoprism",
    "albumUid": "photoPrismAlbumUid"
  },
  "generatedAt": "2026-06-29T00:00:00+00:00",
  "images": {
    "thumb": {"longEdge": 640, "format": "webp", "quality": 80},
    "preview": {"longEdge": 3840, "format": "jpg", "quality": 88},
    "stripExif": true
  },
  "photos": [
    {
      "id": "photoUid",
      "sourceHash": "40 lowercase hex PhotoPrism hash",
      "title": "Display title",
      "thumb": "thumbs/photoUid.webp",
      "preview": "previews/photoUid.jpg",
      "takenAt": "2026-06-01T10:00:00+00:00",
      "width": 3840,
      "height": 2560
    }
  ]
}
```

Schema 2 does not add raw paths, PhotoPrism URLs, preview tokens, R2 absolute
URLs, NAS paths, filenames, EXIF, GPS, or source metadata beyond the existing
PhotoPrism UID and the already-used 40-hex source hash.

## Skip Key

A photo output may be skipped only if all of the following are true:

- previous manifest is schema 2;
- previous manifest `albumId` equals the current album ID;
- previous manifest `source.type` is `photoprism`;
- previous manifest `source.albumUid` equals the current PhotoPrism album UID;
- previous manifest `images` equals the current requested thumb/preview settings
  and `stripExif: true`;
- previous manifest contains exactly one previous entry for the current photo
  UID;
- previous entry `sourceHash` equals the current `PhotoPrismPhoto.hash`;
- previous entry `thumb` equals `thumbs/<photoUid>.webp`;
- previous entry `preview` equals `previews/<photoUid>.jpg`.

If any condition is false or unverifiable, process and PUT the outputs normally.

No R2 HEAD/list operation is required in the first implementation. The manifest
is the sole proof of previously completed publication. This is valid because
the sync process only writes the manifest after all image uploads and cover
upload have succeeded.

## Missing Object Edge Case

If an image object is manually deleted after a schema 2 manifest is published,
manifest-only skip would not detect it. This is acceptable for the first phase
because:

- manual R2 deletion is outside the supported operation model;
- actual R2 deletion remains disabled by project policy;
- avoiding R2 list/HEAD keeps the first implementation simple and constrained;
- a future hardening phase can add optional object existence checks if needed.

Recovery remains straightforward: delete or invalidate the manifest through an
approved operator procedure, or run a future `--force` sync option once designed.
Do not add R2 deletion in this phase.

## Cover Handling

`cover.webp` remains derived from the first photo in the current PhotoPrism list.

For the first implementation, always regenerate and PUT the cover for non-empty
albums. It is a single object, so the cost is small and it avoids subtle
correctness issues when the first photo changes.

An optional later phase may skip cover upload when the first photo UID, first
photo source hash, thumb settings, and cover key are unchanged.

## Manifest Handling

Always upload a fresh manifest after a successful album pass, even if every
photo image was skipped. The manifest records the new `generatedAt` and the
current PhotoPrism ordering/details.

The manifest is still the final upload. If any required image processing or
upload fails, do not upload the manifest.

## Cache And Key Strategy

Keep stable keys in this phase.

Rationale:

- the current viewer uses authenticated Worker routes and no shared public R2
  URLs;
- R2 remains private;
- reupload suppression reduces unnecessary overwrites, making immutable object
  cache semantics less problematic;
- changing key shape would require Worker manifest consumption review,
  orphan-object handling, and cleanup design.

Do not introduce content-hash keys, versioned prefixes, or R2 cleanup in Track B
phase 1.

## Status And Logs

Add aggregate counters to Docker sync logs and remote sync status only after the
implementation has a stable internal result model. The preferred counters are:

- `uploaded`: number of photo image pairs processed and PUT;
- `skipped`: number of photo image pairs skipped by manifest proof;
- `failed`: number of photo image pairs that failed before manifest upload.

If status schema changes are needed, use a separate handoff and keep it
backward-compatible for Workers. The first implementation may log a safe
aggregate line such as:

```text
album my-album: uploaded=3 skipped=231 total=234
```

Do not log raw PhotoPrism UIDs, hashes, R2 keys beyond existing safe album/photo
IDs, URLs, tokens, source paths, or raw manifest JSON.

## Security And Privacy

- Workers still never access PhotoPrism, NAS, Docker, or Portainer.
- Docker still does not read D1 or implement viewer/admin authorization.
- R2 remains private.
- No RAW/original/location-bearing source data is written to R2.
- Skip decisions are local to Docker and do not weaken Worker viewer
  authorization or manifest membership checks.
- Errors remain sanitized.
- R2 deletion remains out of scope.

## Rollout

Schema 1 manifests become cache misses and are replaced by schema 2 manifests on
the next successful sync. This means the first sync after the feature ships is
expected to process all photos once. Subsequent syncs can skip unchanged photos.

Rollback is safe: older Docker versions can still publish schema 1 manifests,
and Workers already consume the manifest fields they need for viewing. If an
unexpected issue occurs, revert Portainer to the previous immutable Docker tag.

## Non Goals

- No R2 deletion or cleanup.
- No R2 object listing.
- No public R2 access.
- No Worker-to-PhotoPrism/NAS/Docker/Portainer access.
- No Docker-to-D1 access.
- No viewer route changes.
- No content-hash key migration.
- No album/user hard delete.
- No automatic album enablement.
