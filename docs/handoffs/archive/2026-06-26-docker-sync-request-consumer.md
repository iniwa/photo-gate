Read AGENTS.md, CLAUDE.md, and this handoff file before implementation.
If implementation would violate constraints or require files outside this
handoff, stop and ask before editing.

## Goal

Implement Docker-side consumption of admin manual sync requests.

The Worker already writes a schema-1 request object to private R2 at the fixed
key `ops/sync-request.json`. Add Docker daemon support to poll that object,
validate it strictly, run the configured single-album sync when a valid request
is found, and best-effort delete handled, stale, duplicate, or invalid request
objects.

This is Phase 2 of `docs/decisions/2026-06-25-sync-request-controls.md`.

## Background

Current state:

- `POST /admin/sync/request` writes a four-field JSON object to R2:
  `schema`, `requestId`, `requestedAt`, `kind`.
- The Docker daemon already writes sanitized status to `ops/sync-status.json`
  through `R2ObjectStore.put`.
- `ObjectStore` currently exposes only `put`.
- `R2ObjectStore` currently allows album object keys and the exact status key
  `ops/sync-status.json`.
- The daemon currently runs sync attempts on the fixed interval and sleeps until
  shutdown or the next scheduled run.

Required design:

- Docker is the only component that can talk to PhotoPrism/NAS.
- Worker only writes an R2 request object; it must not reach the Pi, Docker,
  Portainer, PhotoPrism, or NAS.
- Docker must not depend on D1, viewer sessions, Cloudflare Access state, or
  admin identity.
- Request handling must be best-effort and must not compromise the existing
  healthcheck or scheduled sync behavior.

## Acceptance Criteria

1. Add exact-key support for reading and deleting `ops/sync-request.json` from
   R2.
2. Add a strict Docker-side request parser/validator for schema 1.
3. Integrate polling into `sync-daemon` at two points:
   - at the top of each loop iteration before a sync attempt;
   - during the inter-sync sleep, at a bounded polling interval.
4. A valid, non-stale, non-duplicate request triggers exactly one configured
   album sync at the next poll point when no sync is in progress.
5. A sync already in progress is never interrupted.
6. After a valid request is handled, the daemon best-effort deletes the fixed
   request object and records the handled `requestId` in memory.
7. Invalid, malformed, stale, future-skewed, or duplicate requests are skipped
   and best-effort deleted.
8. R2 GET/DELETE failures are logged only as sanitized warnings and do not crash
   the daemon.
9. Manual sync attempts update existing health/status fields exactly like
   scheduled attempts: `runs_completed`, `last_result`,
   `consecutive_failures`, attempt timestamps, local health file, and remote
   status publication.
10. Existing `sync-once` behavior is unchanged.
11. No secrets, URLs, tokens, request field values, PhotoPrism identifiers,
    album titles, R2 credentials, raw JSON, or admin identity are logged,
    returned, committed, or included in status objects.

## Files To Inspect

- `docs/decisions/2026-06-25-sync-request-controls.md`
- `docker/src/photo_gate/object_store.py`
- `docker/src/photo_gate/r2_store.py`
- `docker/src/photo_gate/main.py`
- `docker/src/photo_gate/sync_status.py`
- `docker/src/photo_gate/health.py`
- `docker/tests/test_daemon.py`
- `docker/tests/test_r2_store.py`
- `docker/tests/test_sync_status.py`
- `docker/README.md`

## Files To Edit

- `docker/src/photo_gate/object_store.py`
- `docker/src/photo_gate/r2_store.py`
- `docker/src/photo_gate/sync_request.py` (new)
- `docker/src/photo_gate/main.py`
- `docker/tests/test_sync_request.py` (new)
- `docker/tests/test_daemon.py`
- `docker/tests/test_r2_store.py`
- `docker/README.md`

Do not edit Workers files in this handoff. Do not edit Fable documents,
operation documents, CI files, package metadata, deployment manifests, archived
handoffs, or unrelated Docker modules.

If you discover that a test helper or small protocol adjustment outside this
list is required, stop and report the exact need before editing.

## Constraints

### Request Object

The request key is a fixed literal:

```text
ops/sync-request.json
```

The object schema is exactly:

```json
{
  "schema": 1,
  "requestId": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
  "requestedAt": "2026-06-25T00:00:00.000Z",
  "kind": "sync-now"
}
```

Validation rules:

- raw object size must be `<= 4096` bytes before JSON parsing;
- UTF-8 JSON only;
- JSON root must be an object, not an array or primitive;
- key set must be exactly `schema`, `requestId`, `requestedAt`, `kind`;
- `schema` must be integer `1` (`bool` is not acceptable);
- `requestId` must match `^[0-9a-f]{32}$`;
- `requestedAt` must be a canonical UTC timestamp accepted by the ADR:
  Worker millisecond form `YYYY-MM-DDTHH:mm:ss.sssZ` and Docker second form
  `YYYY-MM-DDTHH:mm:ssZ` are allowed; timezone offsets such as `+09:00` are
  rejected;
- `kind` must be exactly `sync-now`.

The parser should return either a typed safe object or a sanitized reason code.
It must never raise raw JSON, request values, or parser details into logs.

### Staleness And Future Skew

Use the ADR constants unless a local name already exists:

- stale threshold: `3600` seconds;
- future skew tolerance: `60` seconds;
- default request polling interval: `60` seconds.

Behavior:

- `requestedAt` more than 3600 seconds before daemon clock: reason `stale`,
  delete best-effort, skip;
- `requestedAt` more than 60 seconds after daemon clock: reason
  `invalid-timestamp`, delete best-effort, skip;
- duplicate `requestId` equal to the in-memory last handled ID: reason
  `duplicate`, delete best-effort, skip.

### R2 Store

Extend `ObjectStore` with:

```python
async def get(self, key: str) -> bytes | None: ...
async def delete(self, key: str) -> None: ...
```

`R2ObjectStore.get` and `R2ObjectStore.delete` must:

- call the same key validation as `put`;
- allow only existing album key shapes, `ops/sync-status.json`, and the new
  exact key `ops/sync-request.json`;
- return `None` when R2 reports object missing / no such key;
- wrap store failures as `ObjectStoreError`;
- avoid exposing raw boto3 responses to callers;
- avoid logging or returning credentials.

Do not permit arbitrary `ops/*` keys. `ops/other.json` must remain rejected.

### Daemon Integration

Add request handling to `run_sync_daemon` without changing `sync-once`.

Recommended shape:

- create one store instance for sync/status/request when config is available;
  preserve the current best-effort status-store behavior if config loading or
  store creation fails;
- keep `_last_handled_request_id: str | None` in daemon function scope;
- add a small helper that polls the fixed request key and returns a decision:
  missing, valid request, ignored reason, or poll failure;
- add a helper for best-effort delete that logs only `"request delete failed"`;
- add loop-start polling before scheduled sync work;
- replace the single interval sleep with an interruptible polling sleep that
  checks for requests every `REQUEST_POLL_INTERVAL` seconds and breaks early
  when a valid request is found.

A valid manual request should cause a sync attempt using the same
`run_sync_once` path as scheduled attempts. The health/status accounting should
not create a separate counter or schema field in this handoff. Phase 3 will add
trigger-kind status fields and the visible Sync Now button.

When `args.max_runs > 0`, count completed sync attempts, whether scheduled or
manual. Keep existing tests for max-runs green. Do not create an infinite loop
when `sleep_fn` is an instant test fake.

### Logging

Allowed warning messages are fixed strings or fixed reason codes only, for
example:

- `request poll failed`
- `request delete failed`
- `request ignored: malformed`
- `request ignored: unknown-schema`
- `request ignored: stale`
- `request ignored: duplicate`
- `request ignored: invalid-id`
- `request ignored: invalid-timestamp`
- `request ignored: invalid-kind`

Do not include:

- raw request JSON;
- requestId;
- requestedAt;
- album title;
- PhotoPrism UID, URL, or token;
- R2 endpoint, bucket, access key, secret key, or object body;
- Cloudflare Access claims or admin email;
- exception messages from unknown libraries.

### Safety

- Missing request object is a no-op.
- R2 request GET failure is a warning and retry on next poll.
- R2 request DELETE failure is a warning and swallowed.
- Request polling failure must not change local health state or Docker
  HEALTHCHECK result.
- Valid manual sync failure is a normal sync failure and must update
  `consecutive_failures` exactly like scheduled failure.
- Invalid request objects must never start a sync.
- Do not add dependencies.
- Do not add any HTTP server, webhook, queue, D1 call, Cloudflare Access call,
  Portainer call, Docker socket call, or NAS-specific operation.

## Non Goals

- No Worker changes.
- No visible Sync Now button.
- No pending indicator on `/admin/sync`.
- No status schema 2 and no `lastTriggerKind`.
- No multi-album request schema.
- No request persistence outside R2 and in-memory last handled ID.
- No D1 migration or D1 access from Docker.
- No R2 deletion beyond best-effort deletion of the exact request object.
- No production Cloudflare, R2, PhotoPrism, NAS, Portainer, or Docker-stack
  mutation.
- No commit, push, deployment, tag, release, or handoff archival.

## Verification

Run from the repository root unless noted.

```powershell
Set-Location docker
python -m pytest
python -m compileall src
```

Because this is a Docker runtime behavior change, also run a local Docker build
and smoke checks if Docker is available:

```powershell
Set-Location ..
docker build -t photo-gate-sync:local docker
docker run --rm photo-gate-sync:local --help
docker run --rm photo-gate-sync:local sync-daemon --help
docker run --rm --entrypoint python photo-gate-sync:local -c "import pyvips; print(pyvips.version(0))"
docker run --rm --entrypoint python photo-gate-sync:local -c "import os; assert os.getuid() != 0, 'running as root'"
```

Also run:

```powershell
git diff --check
git status --short
```

If Docker is unavailable or libvips/pyvips tests are skipped by the existing
test markers, report the exact reason. Do not perform any production smoke test.

## Expected Report

Report in Japanese with:

1. Changed files.
2. New request schema validation behavior and exact accepted/rejected cases.
3. R2 `get`/`delete` behavior, including missing object and key allowlist.
4. Daemon polling points and how manual sync interacts with scheduled sync and
   in-progress sync.
5. Replay protection: delete-after-handling, in-memory duplicate guard, stale
   threshold, and the remaining documented one-replay edge case after restart
   within one hour if delete failed.
6. Failure isolation: GET/DELETE failure behavior and health/status impact.
7. Logging/privacy proof: confirm no secrets, URLs, request values, raw JSON,
   admin identity, album title, or PhotoPrism UID/token are logged or surfaced.
8. Verification commands and results.
9. Any skipped checks with exact reasons.
10. Any design questions for Codex.
