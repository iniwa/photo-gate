Read AGENTS.md, CLAUDE.md, and this handoff file before implementation.
If implementation would violate constraints or require files outside this
handoff, stop and ask before editing.

## Goal

Implement Track A2 of browser-complete sync: a private R2 sync-target object
owned by the Worker admin surface and consumed by the Docker daemon, so Docker
can sync browser-configured albums without adding album IDs to Portainer
environment variables.

This is an incremental step. It may expose a temporary admin text field for a
safe `catalogId`, but it must not render or require raw PhotoPrism UIDs. A later
A3 handoff will replace the text field with a picker sourced from
`ops/album-catalog.json`.

## Background

Current production still syncs the single Portainer-configured album. A newly
created D1 album does not become a Docker sync target. Track A1 added
`photo-gate-sync publish-catalog`, which writes a sanitized PhotoPrism album
catalog to private R2:

```text
ops/album-catalog.json
```

Each catalog entry exposes `catalogId`, a lowercase SHA-256 hex digest of the
raw PhotoPrism album UID. The raw UID remains known only to Docker, because
Docker can list PhotoPrism albums and recompute `catalogId`.

Track A2 adds a second private R2 object:

```text
ops/sync-targets.json
```

The Worker writes safe target records containing only admin-safe data. Docker
reads the object, maps each `catalogId` back to the current PhotoPrism UID by
listing PhotoPrism albums, and syncs each configured target sequentially.

## Acceptance Criteria

### Sync-Targets Object

Use exactly this R2 key:

```text
ops/sync-targets.json
```

The object is private R2 only and uses:

- `Content-Type: application/json`
- `Cache-Control: private, no-cache`

Schema 1:

```json
{
  "schema": 1,
  "publishedAt": "2026-06-29T00:00:00.000Z",
  "targets": [
    {
      "albumId": "ise-ryokou-id",
      "catalogId": "64 lowercase hex sha256 of the PhotoPrism album UID",
      "title": "Ise ryokou",
      "expiresAt": null,
      "downloadEnabled": 0,
      "thumb": { "longEdge": 640, "format": "webp", "quality": 80 },
      "preview": { "longEdge": 3840, "format": "jpg", "quality": 88 },
      "stripExif": 1
    }
  ]
}
```

Validation rules:

- Top-level keys are exactly `schema`, `publishedAt`, `targets`.
- `schema === 1`.
- `publishedAt` is canonical Worker ISO milliseconds
  `YYYY-MM-DDTHH:mm:ss.sssZ`.
- `targets` is an array of at most 100 entries.
- `albumId` matches the existing safe ID rule:
  `/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/`.
- `catalogId` matches `/^[0-9a-f]{64}$/`.
- `title` is non-empty, has no leading/trailing whitespace, has no ASCII
  control characters, and is at most 1024 code points.
- `expiresAt` is `null` or canonical Worker ISO milliseconds.
- `downloadEnabled` is numeric `0` or `1`.
- `thumb.longEdge === 640`, `thumb.format === "webp"`, `thumb.quality === 80`.
- `preview.longEdge === 3840`, `preview.format === "jpg"`,
  `preview.quality === 88`.
- `stripExif === 1`.
- Duplicate `albumId` or duplicate `catalogId` fails closed before write/read.

Do not include raw PhotoPrism UIDs, PhotoPrism URLs, PhotoPrism tokens, preview
tokens, NAS paths, original filenames, source photo rows, R2 object keys, admin
emails, Access claims, passwords, or session data.

### Worker Admin Surface

Add a Worker repository for `ops/sync-targets.json`.

Required behavior:

- Read missing object as an empty target list.
- Reject malformed existing objects with a sanitized fixed error.
- Upsert one target by `albumId`.
- Remove one target by `albumId`.
- Preserve all other valid targets.
- Write the full schema-1 object back with a fresh `publishedAt` from
  `clock().toISOString()`.
- Never select or render `photoprism_album_uid`.

Add D1 read support for the target form:

- Select only `id`, `title`, `expires_at`, and `download_enabled` for a single
  album ID.
- Do not select `photoprism_album_uid`, transform settings, `enabled`,
  permissions, users, sessions, or R2 keys.

Add admin routes:

- `POST /admin/albums/sync-target-upsert`
- `POST /admin/albums/sync-target-remove`

Both routes must follow the existing admin mutation security chain:

```text
requireAdmin guard -> strict same-origin Origin -> exact form Content-Type ->
parseBody({ all: true }) -> exact field validation -> clock -> repository work
```

`sync-target-upsert` accepts exactly:

- `albumId`
- `catalogId`

`sync-target-remove` accepts exactly:

- `albumId`

Success:

- `303`
- `Location: /admin/albums`
- `Cache-Control: no-store`
- empty body

Failure:

- Auth/origin failure: existing `403 no-store`.
- Content-Type/body validation failure: `400 no-store`.
- D1/R2/clock failure, unknown album, malformed existing object, duplicate
  target state: `500 no-store` with fixed text only.

Update `GET /admin/albums`:

- Render a temporary no-JS per-album form for `catalogId`.
- Render a remove-target form.
- Do not display target request IDs, raw JSON, R2 keys, bucket names, or raw
  PhotoPrism UIDs.
- It is acceptable that the operator must paste a safe `catalogId` in this A2
  handoff. A3 will replace this with a catalog picker.

### Docker Consumer

Add Docker support for `ops/sync-targets.json`.

Required behavior:

- `R2ObjectStore` allows exact key `ops/sync-targets.json`.
- `get` returns `None` for missing key, as with existing request handling.
- Unknown `ops/*` keys remain rejected.
- Target object validation mirrors the Worker schema.
- Missing object or an empty `targets` array keeps the existing
  Portainer-configured single-album fallback.
- Valid non-empty targets replace the fallback for that sync attempt.
- Malformed target object logs a fixed warning and falls back to the configured
  single album. Do not log raw JSON, catalog IDs, PhotoPrism UIDs, bucket names,
  endpoints, credentials, or exception messages.
- To resolve targets, Docker lists PhotoPrism albums and computes
  `sha256(raw_uid.encode()).hexdigest()` for each album. The resolved raw UID is
  used only in memory to build `AlbumIdentity`.
- If one target's `catalogId` cannot be resolved, log a fixed warning code and
  skip that target. If no targets can be resolved, fall back to the configured
  single album for migration safety.
- Sync resolved targets sequentially using the existing sync pipeline. Do not
  parallelize downloads or uploads in this handoff.
- A failure in one resolved target should be recorded as an attempt failure, but
  the daemon should still attempt remaining resolved targets where practical.
- Existing manual sync request behavior remains unchanged: pressing Sync Now
  triggers the next daemon attempt; that attempt uses sync targets when a valid
  non-empty target object exists.
- Existing `sync-once` CLI behavior may remain single-album only. The daemon is
  the production path for browser-triggered sync.

### Status And Logs

Do not change the Worker sync request schema in this handoff.

Do not bump the remote sync status schema unless strictly necessary. If you must
represent multiple albums in logs/status, prefer sanitized aggregate text such
as target counts. Never publish raw PhotoPrism UID, raw target JSON, catalog raw
mapping data, or source photo metadata.

### Reupload Suppression

Do not implement reupload suppression here. Re-syncing a target may still
download, re-encode, and PUT all objects using the existing stable keys. Track B
will handle unchanged-photo suppression separately.

## Files To Inspect

- `AGENTS.md`
- `CLAUDE.md`
- `docs/decisions/2026-06-26-browser-complete-sync-and-reupload-phasing.md`
- `docs/decisions/2026-06-26-admin-browser-management.md`
- `docs/fable/current-state.md`
- `docs/fable/progress.md`
- `docker/src/photo_gate/main.py`
- `docker/src/photo_gate/r2_store.py`
- `docker/src/photo_gate/photoprism_client.py`
- `docker/src/photo_gate/album_catalog.py`
- `docker/src/photo_gate/models.py`
- `docker/src/photo_gate/sync.py`
- `workers/src/routes/admin.tsx`
- `workers/src/services/admin-album-repository.ts`
- `workers/src/services/admin-sync-request-repository.ts`
- `workers/src/index.tsx`
- `workers/README.md`
- `docker/README.md`

## Files To Edit

Expected files:

- `workers/src/types/admin-sync-target.ts` (new)
- `workers/src/services/admin-sync-target-repository.ts` (new)
- `workers/src/services/admin-album-repository.ts`
- `workers/src/routes/admin.tsx`
- `workers/src/index.tsx`
- `workers/test/admin-sync-target-repository.test.ts` (new)
- `workers/test/admin-album-repository.test.ts`
- `workers/test/admin-routes.test.ts`
- `workers/README.md`
- `docker/src/photo_gate/sync_targets.py` (new)
- `docker/src/photo_gate/r2_store.py`
- `docker/src/photo_gate/main.py`
- `docker/tests/test_sync_targets.py` (new)
- `docker/tests/test_r2_store.py`
- `docker/tests/test_daemon.py`
- `docker/README.md`

If another file is required, stop and report the reason before editing.

## Constraints

- Workers must not contact PhotoPrism, NAS, Docker, Portainer, or a Docker
  socket.
- Docker must not read D1 or implement viewer/admin authorization.
- R2 remains private. No public bucket, public URL, or signed URL.
- Do not expose raw PhotoPrism UID in Worker HTML, responses, logs, tests
  snapshots, README examples, sync-target JSON, or error text.
- Do not select `photoprism_album_uid` from D1 in any new Worker query.
- Do not store admin identity or Cloudflare Access claims in sync-target JSON.
- Do not add R2 deletion.
- Do not add destructive D1 migrations or any schema migration in this handoff.
- Do not change viewer routes or authorization logic.
- Do not change album enable/disable semantics.
- Do not deploy, tag, push, mutate production, or archive this handoff.

## Non Goals

- No catalog picker UI from `ops/album-catalog.json`; that is A3.
- No automatic D1 album creation from catalog entries.
- No removal of the existing manual raw-UID create path.
- No sync request schema extension for selecting a single album.
- No reupload suppression or object-diffing.
- No R2 cleanup or deletion.
- No Portainer API integration.
- No Docker image build/push or production rollout.

## Verification

Workers:

```powershell
Set-Location workers
npm run lint
npm run typecheck
npm test
npm run build
npm audit --omit=dev --audit-level=high
```

Docker:

```powershell
Set-Location docker
python -m pytest
python -m compileall src
```

Repository:

```powershell
git diff --check
git diff HEAD -- workers/migrations/
```

The `workers/migrations` diff must be empty.

If Docker Desktop is available, also run a Docker image build/smoke check. If it
is not available, report the exact reason and rely on pytest/compileall.

## Expected Report

Report in Japanese:

1. Changed files.
2. Exact `ops/sync-targets.json` schema and validation rules implemented.
3. Worker route behavior and failure matrix for:
   - `POST /admin/albums/sync-target-upsert`
   - `POST /admin/albums/sync-target-remove`
4. Proof that Worker never selects/renders/logs `photoprism_album_uid`.
5. Docker target resolution behavior:
   - missing/empty object fallback;
   - valid object multi-target sync;
   - malformed object behavior;
   - unresolved `catalogId` behavior.
6. Proof that raw PhotoPrism UID, raw JSON, R2 credentials, admin identity, and
   source photo data are not logged, rendered, or written to sync-target JSON.
7. Verification command results.
8. Skipped checks and exact reasons.
9. Any design questions for Codex.
