Read AGENTS.md, CLAUDE.md, and this handoff file before implementation.
If implementation would violate constraints or require files outside this
handoff, stop and ask before editing.

## Goal

Implement Track A1 from
`docs/decisions/2026-06-26-browser-complete-sync-and-reupload-phasing.md`:
Docker publishes a sanitized PhotoPrism album catalog to private R2.

Add a Docker CLI subcommand:

```powershell
photo-gate-sync publish-catalog
```

The command reads PhotoPrism albums, builds a safe display catalog, and writes
it to the fixed private R2 key:

```text
ops/album-catalog.json
```

This handoff must not change Worker UI, D1, sync targets, manual sync request
schema, Portainer deployment, or reupload behavior.

## Background

Current production behavior:

- `sync-daemon` syncs one album configured via Portainer variables:
  `ALBUM_ID`, `ALBUM_TITLE`, and `PHOTOPRISM_ALBUM_UID`.
- Browser-created D1 albums do not automatically become Docker sync targets.
- The manual sync button triggers the currently configured daemon target only.
- Re-running sync for the same album overwrites stable R2 keys; it does not
  create unbounded duplicate objects, but it does reprocess and re-PUT all
  images. Reupload suppression is a separate future phase, not this handoff.

This handoff creates only the safe catalog artifact needed by later browser UI
and multi-target sync phases.

## Acceptance Criteria

### Catalog Schema

Publish exactly one JSON object to `ops/album-catalog.json`:

```ts
interface AlbumCatalog {
  schema: 1
  publishedAt: string
  albums: Array<{
    catalogId: string
    title: string
    photoCount: number | null
    updatedAt: string | null
  }>
}
```

Validation rules:

- `schema`: literal `1`.
- `publishedAt`: Docker UTC seconds format `YYYY-MM-DDTHH:mm:ssZ`.
- `catalogId`: lowercase SHA-256 hex digest of the raw PhotoPrism album UID,
  exactly 64 chars, `/^[0-9a-f]{64}$/`.
- `title`: string, non-empty, no leading/trailing whitespace, no ASCII control
  characters, <= 1024 Unicode code points.
- `photoCount`: `null` or safe non-negative integer.
- `updatedAt`: `null` or canonical UTC timestamp. Accept PhotoPrism second or
  millisecond UTC forms and normalize to Docker seconds form if needed.
- `albums`: sorted by `title` then `catalogId` for deterministic output.
- Duplicate `catalogId` values fail closed before R2 write.

The published JSON must not include:

- raw PhotoPrism album UID;
- PhotoPrism URL;
- PhotoPrism API token;
- PhotoPrism preview token;
- NAS paths;
- original filenames;
- location metadata;
- R2 endpoint, bucket, access key, or secret;
- admin identity or Cloudflare Access claims;
- source photo rows.

### PhotoPrism Client

Add a method to `PhotoPrismClient` to list albums.

Expected behavior:

- Use the PhotoPrism album API endpoint appropriate for the existing API style.
  Start from `GET /api/v1/albums`; if implementation discovers this endpoint is
  incompatible with the current PhotoPrism API shape, stop and report before
  switching to a materially different API.
- Reuse existing auth headers and Cloudflare Access service-token headers.
- Paginate if the endpoint exposes the same `count` / `offset` and
  `X-Count` / `X-Limit` pattern used by `list_album_photos`.
- Validate each returned album before returning it to catalog code:
  - raw UID: existing safe UID shape;
  - title: valid display title;
  - photo count: missing -> null, otherwise safe non-negative integer;
  - updated timestamp: missing -> null, otherwise canonical UTC.
- Errors must be sanitized. No URL, token, raw UID, response body, or album
  title should appear in exception messages.

### Catalog Builder

Add a small Docker-side module, for example
`docker/src/photo_gate/album_catalog.py`.

Responsibilities:

- Convert validated PhotoPrism album rows to the published schema.
- Compute `catalogId = sha256(rawPhotoPrismUid).hexdigest()`.
- Validate output before serialization.
- Serialize deterministic UTF-8 JSON.
- Reject malformed rows before any R2 write.
- Never expose the raw UID in the returned JSON.

### R2 Store

Extend the fixed `ops/*` allowlist to permit exactly:

```text
ops/album-catalog.json
```

Requirements:

- Content-Type must be `application/json`.
- Cache-Control must be `private, no-cache`.
- Other unknown `ops/*` keys must remain rejected.
- Existing `ops/sync-status.json`, `ops/sync-request.json`, and album asset
  key behavior must remain unchanged.

### CLI

Add:

```powershell
photo-gate-sync publish-catalog
```

Behavior:

- Load config through the existing config loader.
- Instantiate `PhotoPrismClient` and `R2ObjectStore` through the same factory
  pattern used by `sync-once` / `sync-daemon`, so tests can inject fakes.
- Use the command clock for `publishedAt`.
- Write the catalog to `ops/album-catalog.json`.
- On success, print a sanitized operator line such as:
  `Published album catalog: count=N`.
- On config/runtime failure, return non-zero and print only sanitized details.
- Do not print raw UID, token, PhotoPrism URL, R2 endpoint, bucket, or titles.

### Documentation

Update `docker/README.md` with:

- the new `publish-catalog` command;
- the fixed R2 key;
- the safe schema fields;
- an explicit statement that this does not change daemon sync targets yet;
- an explicit statement that reupload suppression is not part of this change.

## Files To Inspect

- `AGENTS.md`
- `CLAUDE.md`
- `docs/decisions/2026-06-26-browser-complete-sync-and-reupload-phasing.md`
- `docs/decisions/2026-06-26-admin-browser-management.md`
- `docker/src/photo_gate/photoprism_client.py`
- `docker/src/photo_gate/r2_store.py`
- `docker/src/photo_gate/object_store.py`
- `docker/src/photo_gate/main.py`
- `docker/src/photo_gate/models.py`
- `docker/tests/test_photoprism_client.py`
- `docker/tests/test_r2_store.py`
- `docker/tests/test_main.py`
- `docker/README.md`

## Files To Edit

Only:

- `docker/src/photo_gate/album_catalog.py` (new)
- `docker/src/photo_gate/photoprism_client.py`
- `docker/src/photo_gate/r2_store.py`
- `docker/src/photo_gate/main.py`
- `docker/tests/test_album_catalog.py` (new)
- `docker/tests/test_photoprism_client.py`
- `docker/tests/test_r2_store.py`
- `docker/tests/test_main.py`
- `docker/README.md`

If another file appears necessary, stop and ask before editing.

## Constraints

- Do not use `claude -p`.
- No production commands.
- No commit, push, deploy, tag, or handoff archive.
- No Worker code changes.
- No D1 changes or migrations.
- No Portainer or Docker stack changes.
- No sync target behavior changes.
- No manual sync request schema changes.
- No reupload suppression, object HEAD optimization, deletion, or key-shape
  changes.
- No R2 deletion or listing.
- No public R2 access.
- No new dependencies unless impossible without them; prefer Python stdlib.
- Do not log or print raw PhotoPrism UIDs, PhotoPrism URLs, tokens, R2 endpoint,
  bucket, access keys, titles, raw JSON, or response bodies in error paths.
- Preserve existing sync-once, sync-daemon, healthcheck, sync-status, and
  sync-request behavior.

## Non Goals

- Browser UI integration.
- Creating albums from the catalog.
- Multi-album daemon sync.
- Replacing Portainer album variables.
- Reupload suppression or deduplication.
- R2 cleanup or orphan reporting.
- D1 hard delete.
- Production deployment or smoke.

## Verification

Run from `docker/`:

```powershell
python -m pytest
python -m compileall src
```

Run from repo root:

```powershell
git diff --check
git diff HEAD -- workers/
git diff HEAD -- workers/migrations/
```

Do not run Workers tests unless Worker files were accidentally changed.
Do not run Docker build/smoke unless Docker Desktop is available; if skipped,
report the exact reason.

## Expected Report

Report in Japanese with:

1. Changed files.
2. New command behavior for `photo-gate-sync publish-catalog`.
3. Exact R2 key, Content-Type, and Cache-Control.
4. Published JSON schema and validation rules.
5. Proof that raw PhotoPrism UID, URLs, tokens, R2 credentials, NAS paths,
   original filenames, and source photo rows are not written, logged, or printed.
6. Confirmation that sync target behavior and manual sync request behavior did
   not change.
7. Confirmation that reupload suppression was not implemented in this handoff.
8. Tests added/updated.
9. Verification results.
10. Skipped checks with exact reason.
11. Any design questions for Codex.