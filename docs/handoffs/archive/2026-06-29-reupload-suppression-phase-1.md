Read AGENTS.md, CLAUDE.md, and this handoff file before implementation.
If implementation would violate constraints or require files outside this
handoff, stop and ask before editing.

## Goal

Implement Track B phase 1 reupload suppression for the Docker sync tool.

Repeated manual or scheduled syncs must stop re-downloading, re-encoding, and
re-uploading unchanged photo thumb/preview pairs when the previous manifest
proves that the exact same source photo and image settings were already
published.

This is a Docker-only optimization. It must not change Worker routes, D1,
viewer authorization, R2 access policy, object key shape, or deployment state.

## Background

The accepted design is `docs/decisions/2026-06-29-reupload-suppression.md`.

Current sync behavior overwrites stable R2 keys on every run:

```text
albums/<albumId>/thumbs/<photoUid>.webp
albums/<albumId>/previews/<photoUid>.jpg
albums/<albumId>/cover.webp
albums/<albumId>/manifest.json
```

This does not create multiple R2 objects, but it does waste time and bandwidth:
unchanged photos are downloaded from PhotoPrism, decoded, re-encoded,
metadata-validated, and PUT to R2 again.

The current manifest is `schemaVersion: 1` and does not contain a per-photo
PhotoPrism source hash. Therefore schema 1 manifests must be treated as cache
misses. The first sync after this feature ships is expected to process every
photo once and replace the manifest with `schemaVersion: 2`. Later syncs can
skip unchanged photo image pairs.

## Acceptance Criteria

1. `build_manifest` emits `schemaVersion: 2`.
2. Existing viewer-compatible manifest fields remain present and unchanged in
   meaning.
3. Every manifest photo entry includes `sourceHash`, copied from
   `PhotoPrismPhoto.hash`.
4. `sync_album` reads `albums/<albumId>/manifest.json` before processing album
   photos.
5. Missing manifest, object-store read error, invalid UTF-8/JSON, non-object
   JSON, schema other than 2, malformed schema 2, duplicate previous photo
   entries, mismatched album/source/settings, or any unverifiable field is a
   safe cache miss, not a sync failure.
6. A photo thumb/preview pair is skipped only when all of these are proven from
   the previous schema 2 manifest:
   - manifest `albumId` equals the current album ID;
   - manifest `source.type` is `photoprism`;
   - manifest `source.albumUid` equals the current PhotoPrism album UID;
   - manifest `images` exactly matches current thumb/preview settings and
     `stripExif: true`;
   - the manifest contains exactly one entry for the current photo UID;
   - previous entry `sourceHash` equals current `PhotoPrismPhoto.hash`;
   - previous entry `thumb` equals `thumbs/<photoUid>.webp`;
   - previous entry `preview` equals `previews/<photoUid>.jpg`.
7. When a photo is skipped, Docker does not call `download_preview`, image
   processing, metadata validation, or `store.put` for that photo's thumb and
   preview outputs.
8. When a photo cannot be proven unchanged, Docker processes and PUTs its thumb
   and preview exactly as before.
9. `cover.webp` is still regenerated and PUT for every successful non-empty
   album sync, even when all photo thumb/preview pairs were skipped.
10. A fresh schema 2 manifest is always PUT last after a successful album pass,
    even when all photo thumb/preview pairs were skipped.
11. If any required non-skipped image processing/upload or cover upload fails,
    the manifest is not uploaded.
12. Empty albums still PUT only a schema 2 empty manifest and no cover.
13. R2 key shape stays unchanged. Do not add content-hash keys, versioned
    prefixes, object listing, HEAD checks, or deletion.
14. Logs may add a safe aggregate line such as
    `album my-album: uploaded=3 skipped=231 total=234`, but must not log raw
    PhotoPrism source hashes, PhotoPrism URLs, tokens, source paths, raw
    manifest JSON, R2 credentials, or secrets.
15. Existing behavior for browser-owned sync targets and Portainer fallback
    remains intact because they both call the same sync path.

## Files To Inspect

- `AGENTS.md`
- `CLAUDE.md`
- `FABLE.md`
- `docs/decisions/2026-06-29-reupload-suppression.md`
- `docs/fable/current-state.md`
- `docker/src/photo_gate/manifest.py`
- `docker/src/photo_gate/sync.py`
- `docker/src/photo_gate/object_store.py`
- `docker/src/photo_gate/r2_store.py`
- `docker/src/photo_gate/photoprism_client.py`
- `docker/tests/test_manifest.py`
- `docker/tests/test_sync.py`
- `docker/tests/test_daemon.py`
- `docker/README.md`

## Files To Edit

Edit only the files required for this Docker-only feature:

- `docker/src/photo_gate/manifest.py`
- `docker/src/photo_gate/sync.py`
- `docker/tests/test_manifest.py`
- `docker/tests/test_sync.py`
- `docker/README.md`

Optional, if it keeps parsing/skip-proof logic clean and well tested:

- `docker/src/photo_gate/reupload.py` or `docker/src/photo_gate/sync_cache.py`
- `docker/tests/test_reupload.py` or `docker/tests/test_sync_cache.py`

Do not edit Workers files, Workers migrations, deployment docs, Fable state,
handoff archive, Docker version files, or CI workflow files in this handoff.

## Constraints

- Preserve all non-negotiable invariants in `AGENTS.md`.
- Docker must not read D1 or implement viewer/admin authorization.
- Workers must not be changed and must not gain PhotoPrism/NAS/Docker/Portainer
  access.
- R2 remains private.
- Do not add R2 delete/list/HEAD behavior.
- Do not change object key shape.
- Do not change PhotoPrism API credentials, config loading, Portainer behavior,
  or sync target schema.
- Do not weaken metadata stripping, metadata validation, image plausibility
  checks, or manifest-final upload semantics.
- Treat previous manifest parsing as untrusted input. Fail closed by
  reprocessing, not by trusting partial or malformed data.
- Error messages and logs must remain sanitized.
- Keep implementation narrow and compatible with the existing async sync
  structure and tests.
- Preserve user changes. `docs/iniwa-issues.md`, if present, is unrelated and
  must not be edited, staged, or committed.

## Non Goals

- No Worker changes.
- No D1 changes or migrations.
- No viewer route changes.
- No admin UI changes.
- No status schema changes.
- No R2 cleanup, deletion, listing, or HEAD existence checks.
- No content-hash object key migration.
- No force-sync option.
- No Docker version bump.
- No image build, release tag, Portainer update, deployment, commit, push, or
  handoff archival.
- No attempt to suppress `cover.webp` upload in this phase.

## Verification

Run from `docker/`:

```powershell
python -m pytest tests/test_manifest.py tests/test_sync.py
python -m pytest
python -m compileall src
```

Run from the repository root:

```powershell
git diff --check
git diff HEAD -- workers/
git diff HEAD -- workers/migrations/
git status --short
```

If Docker Desktop is available, also run the Docker image build/smoke check
used by this repository's Docker workflow. If Docker Desktop is unavailable,
run `docker info` and report the exact connection error, then skip the
image-level smoke test.

Do not run Workers test suites unless you accidentally changed Workers files.

## Expected Report

Report in Japanese.

Include:

1. Changed files.
2. Manifest schema 2 summary:
   - `schemaVersion: 2`;
   - existing viewer fields preserved;
   - per-photo `sourceHash` added;
   - no URLs, tokens, source paths, EXIF/GPS, raw source metadata, or R2
     credentials added.
3. Skip-proof rules implemented and where they live.
4. Cache-miss behavior for:
   - missing manifest;
   - schema 1 manifest;
   - malformed JSON;
   - malformed schema 2;
   - mismatched album/source/settings;
   - duplicate previous photo entries;
   - object-store read exception.
5. Upload behavior:
   - skipped photo thumb/preview pairs are not downloaded, processed, validated,
     or PUT;
   - changed or unproven photos are processed normally;
   - cover is always regenerated for non-empty albums;
   - manifest is always final upload after success;
   - manifest is withheld after image or cover failure.
6. Test additions and notable assertions.
7. Verification command results.
8. Skipped checks with exact reasons.
9. Confirmation that Workers, migrations, deployment/version files, R2 deletion
   behavior, and object key shape were not changed.
10. Any design questions for Codex. If there are none, say none.
