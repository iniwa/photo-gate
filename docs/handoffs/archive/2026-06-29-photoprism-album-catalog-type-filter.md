Read AGENTS.md, CLAUDE.md, and this handoff file before implementation.
If implementation would violate constraints or require files outside this
handoff, stop and ask before editing.

## Goal

Fix the Docker `photo-gate-sync publish-catalog` catalog publisher so
`ops/album-catalog.json` contains only user-created PhotoPrism albums, not
PhotoPrism virtual groupings such as folders, location buckets, date/month
groupings, states, countries, labels, or other non-album collection types.

This is a production hotfix for the 0.4.0 browser-complete sync path. The
operator deployed Docker 0.4.0 and confirmed that `/admin/albums` now shows the
catalog picker, but the picker lists many non-album PhotoPrism entries.

## Background

Track A1 implemented `PhotoPrismClient.list_albums()` using:

```text
GET /api/v1/albums?count=...&offset=...
```

It validated UID/title/count/timestamp and then published every returned entry
into the sanitized catalog. In the real PhotoPrism environment, this endpoint
returns more than manually created albums. The admin browser must only offer
real PhotoPrism album choices for sync-target binding.

The Worker picker is behaving correctly: it renders exactly what Docker
published to `ops/album-catalog.json`. The fix belongs in Docker catalog
publication, not in Workers.

The exact PhotoPrism response field name may vary by version/casing. Inspect the
existing test patterns and implement a conservative client-side filter that
accepts only response entries whose collection type is explicitly album. Likely
field names to support are `Type` and `type`; include `AlbumType` only if tests
document why it is needed. Do not infer album type from title, UID shape, photo
count, or absence of location fields.

Server-side filtering may also be added by sending `type=album` to
`/api/v1/albums`, but it is not sufficient by itself. Keep the client-side
response filter as the enforcement point.

## Acceptance Criteria

1. `PhotoPrismClient.list_albums()` includes only entries whose response type is
   exactly `"album"` after strict type extraction.
2. Entries with type values such as `"folder"`, `"month"`, `"state"`,
   `"country"`, `"city"`, `"label"`, `"moment"`, empty string, `null`, missing,
   or non-string are skipped before UID/title/photo-count/timestamp validation.
3. Malformed fields on skipped non-album entries do not fail catalog publication.
   Example: a folder entry with an unsafe UID or empty title is skipped, not
   raised.
4. Malformed fields on accepted `"album"` entries still fail closed exactly as
   before.
5. Raw PhotoPrism UIDs, URLs, tokens, preview tokens, location metadata, source
   paths, and response bodies are still not printed or published.
6. Published catalog schema stays `schema: 1`; do not add new JSON fields.
7. `publish-catalog` output shape may stay `Published album catalog: count=N`.
   If you add a skipped count, keep it aggregate only and do not print skipped
   types, titles, UIDs, or raw response data.
8. No Worker code, D1 schema, R2 public access, Portainer configuration, or
   sync target schema changes.

## Files To Inspect

- `AGENTS.md`
- `CLAUDE.md`
- `docs/decisions/2026-06-26-browser-complete-sync-and-reupload-phasing.md`
- `docs/handoffs/2026-06-29-browser-complete-sync-delivery.md`
- `docker/src/photo_gate/photoprism_client.py`
- `docker/src/photo_gate/album_catalog.py`
- `docker/src/photo_gate/main.py`
- `docker/tests/test_photoprism_client.py`
- `docker/tests/test_album_catalog.py`
- `docker/tests/test_main.py`
- `docker/README.md`

## Files To Edit

- `docker/src/photo_gate/photoprism_client.py`
- `docker/tests/test_photoprism_client.py`
- `docker/tests/test_main.py` if publish-catalog behavior or output changes
- `docker/README.md` if catalog behavior documentation needs clarification

Do not edit `workers/`, `workers/migrations/`, R2 cleanup code, sync-target
schema, or Portainer/deployment files in this handoff.

Do not edit, stage, or commit `docs/iniwa-issues.md`.

## Constraints

- Docker may talk to PhotoPrism; Workers still must not.
- Docker must not read D1 or implement admin/viewer authorization.
- R2 remains private.
- Do not include raw PhotoPrism UIDs in catalog output, logs, errors, or tests
  that would normalize leaking real values.
- Do not print secrets or environment variables.
- Do not change `ops/album-catalog.json` key or schema.
- Do not bump the Docker package version, create tags, push, deploy, update
  Portainer, or publish catalog from this handoff.
- Preserve fallback behavior in sync target resolution unless directly affected
  by the same `list_albums()` filter.

## Non Goals

- No reupload suppression.
- No catalog-based D1 album creation.
- No R2 object deletion or cleanup.
- No Worker UI redesign.
- No raw UID emergency input changes.
- No PhotoPrism/NAS/Portainer access from Workers.
- No Docker D1 access.
- No new Cloudflare resources.

## Verification

Run from `docker/`:

```powershell
python -m pytest tests/test_photoprism_client.py tests/test_main.py
python -m pytest
python -m compileall src
```

Run from repo root:

```powershell
git diff --check
git diff HEAD -- workers/
git diff HEAD -- workers/migrations/
```

If Docker Desktop is available, optionally run:

```powershell
docker build --target test -t photo-gate-sync-test:catalog-filter docker
docker run --rm photo-gate-sync-test:catalog-filter
```

If Docker Desktop is unavailable, report the exact `docker info` error and mark
image build/smoke as skipped.

## Expected Report

Report in Japanese.

Include:

1. Changed files.
2. Exact filtering rule implemented and which response field names are accepted.
3. Whether `type=album` is sent as a request parameter.
4. Tests added for:
   - accepted real album entry;
   - skipped folder/location/date/grouping entries;
   - skipped malformed non-album entry;
   - malformed `"album"` entry still fails closed;
   - secrets/raw UID not exposed in error output.
5. Verification command results.
6. Confirmation that Workers, migrations, sync-target schema, R2 access policy,
   and Portainer config were not changed.
7. Any uncertainty about the real PhotoPrism response shape that needs operator
   confirmation.
