# Sync Request Controls

Date: 2026-06-25

## 1. Context

### What is already implemented

`GET /admin/sync` is a read-only Worker admin route implemented and reviewed on
2026-06-25.  The Docker sync daemon publishes a sanitized 12-field status object
to the fixed private R2 key `ops/sync-status.json` at three lifecycle points:
daemon start, each attempt start, and each attempt completion.  The Worker reads
that object, validates it strictly, and renders it without exposing album titles,
PhotoPrism UIDs, R2 credentials, or raw JSON.  No trigger, queue, POST route, or
request protocol exists yet.

### Why manual sync request controls are useful

The daemon runs on a 86400-second (24-hour) interval.  An operator who updates a
PhotoPrism album mid-day currently has no way to start a sync without SSH-ing
into the Pi or restarting the Portainer stack.  A "Sync Now" button on the admin
page removes that friction while keeping the operation behind Cloudflare Access
authentication.

### Why Workers cannot call PhotoPrism, NAS, Docker, Portainer, or the Docker socket directly

The non-negotiable invariant from `AGENTS.md` is:

> Normal viewing must use Cloudflare Workers, D1, and private R2 only.
> Docker sync must not implement viewer authentication, viewer pages, or D1
> authorization.

Workers run in the Cloudflare network and have no network route to the Raspberry
Pi's internal Docker socket, Portainer API, or PhotoPrism instance.  Adding such
a route would expose production credentials to the edge, violate the trust
boundary that keeps NAS originals and PhotoPrism tokens off the public network,
and couple the Worker deployment lifecycle to a specific Pi IP address.

### Why Docker cannot depend on D1 or admin auth state

D1 is a Cloudflare-managed database accessible only through Worker bindings.
The Docker daemon runs on a Raspberry Pi with no Cloudflare account access.
Giving it direct D1 credentials would require a service-token scope that is out
of the agreed autonomy contract, and it would couple sync scheduling to
Cloudflare's authentication system in a way that could prevent a sync from
running if the auth system is unavailable.

### Why private R2 is the preferred bridge

Private R2 is already the only cross-component bridge between Docker and Workers:
Docker writes processed images and manifests; Workers reads them.  Using a second
R2 object for request signalling:

- introduces no new infrastructure or credentials;
- reuses the existing `R2ObjectStore` / Worker R2 binding pattern;
- keeps the Raspberry Pi's only external dependency as the R2 S3-compatible
  endpoint, which it already uses for every sync;
- is auditable: the object is readable, writable, and deletable with standard
  S3 operations and no new service accounts.

Alternatives considered and rejected are documented in Section 2.

---

## 2. Decision

**Transport**: a single private R2 object at the fixed key `ops/sync-request.json`.

- The Worker writes this object on `POST /admin/sync/request`.
- The Docker daemon polls this object during the inter-sync sleep interval and
  at the start of each main loop iteration.
- Docker deletes the object after successfully handling the request, and records
  the handled `requestId` in daemon memory to prevent double-execution within
  the same process lifetime.
- Docker acknowledges handling through the existing `ops/sync-status.json`
  publication (Phase 3 will add trigger-kind fields to that schema).
- Staleness is detected by comparing `requestedAt` to the current daemon clock;
  requests older than `STALENESS_THRESHOLD` (3600 seconds) are deleted and
  ignored.
- A duplicate `requestId` (same ID seen again in memory) is deleted and ignored.
- The first implementation is **single-album only**.  The request schema carries
  no `albumId`; the daemon syncs its configured album.  Multi-album support is
  explicitly deferred.

### How duplicate and stale requests are handled

When the operator submits two rapid requests, the second PUT overwrites the first
at the fixed key.  The daemon reads whichever object is present when it next
polls; only one request is ever in flight.  Staleness (>3600 s) causes the
daemon to delete the object and skip the sync.  The `lastHandledRequestId` field
in daemon memory prevents re-execution of the same ID if R2 deletion fails
transiently.

### How an in-progress scheduled sync interacts with a manual request

The request check runs at two points: (a) at the top of each main loop iteration
(before starting any sync attempt) and (b) during the inter-sync sleep at
`REQUEST_POLL_INTERVAL` (default 60 seconds, same as heartbeat).  A sync is
never interrupted mid-run.  A manual request submitted during an in-progress sync
is picked up at the next poll point after the sync completes.  This is safe and
deliberate: a partial sync upload is already idempotent (whole-object PUTs,
manifest last), so back-to-back syncs produce consistent state.

### Alternatives rejected

**Cloudflare Queue / Durable Object**: introduces paid tier features not in the
current project infrastructure and couples the Raspberry Pi to a new binding
type with no existing configuration.

**D1 table for pending requests**: requires the Docker daemon to hold Cloudflare
D1 service credentials and adds a database migration; rejected by the
Docker-to-D1 boundary invariant.

**Portainer API / Docker socket webhook**: requires the Worker to reach the Pi's
internal network and exposes infrastructure credentials at the edge.  Violates
the Workers-to-Docker prohibition.

**Long-polling or WebSocket from Pi to Workers**: introduces a persistent
outbound connection from the Pi, requires a new Worker route class, and adds
reconnection/timeout complexity with no benefit over R2 polling at 60-second
intervals.

---

## 3. Request Schema

### Schema definition

```json
{
  "schema": 1,
  "requestId": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
  "requestedAt": "2026-06-25T00:00:00.000Z",
  "kind": "sync-now"
}
```

### Field specification

| Field | Type | Constraint |
|---|---|---|
| `schema` | integer | must equal `1` |
| `requestId` | string | exactly 32 lowercase hex characters (`[0-9a-f]{32}`) |
| `requestedAt` | string | ISO 8601 UTC timestamp with milliseconds: `YYYY-MM-DDTHH:mm:ss.sssZ`; same format as Worker clock (`new Date().toISOString()`) |
| `kind` | string | must equal `"sync-now"`; only value in schema 1 |

**No other fields are permitted.**  The exact-key-count check (4 keys) rejects
extra fields on both the Worker write path and the Docker read path.

### What is excluded and why

- `albumId`: daemon is single-album in v1; album identity comes from daemon args
- `adminEmail`, `accessClaims`, IP address: admin identity is not persisted or
  logged beyond what the Cloudflare Access log already records
- `albumTitle`, `photoprismUid`, R2 credentials, object key lists: secrets and
  internal identifiers must not appear in any published object
- `requestedBy`, browser details: unnecessary and privacy-relevant

### Timestamp format

`requestedAt` uses the Worker clock (`new Date().toISOString()`) which always
emits `YYYY-MM-DDTHH:mm:ss.sssZ`.  Docker validates this with the same dual-format
validator already used by `admin-sync-status-repository.ts` (accepts both the
millisecond Worker form and the second-precision Docker form; rejects timezone
offsets).  In practice Worker always emits millisecond form.

### Request ID format and generation

The Worker generates `requestId` as `crypto.randomUUID().replaceAll('-', '')`,
yielding 32 lowercase hex characters derived from 16 bytes of cryptographic
randomness.  This provides collision-free IDs with no admin identity or
sequential structure.

Docker validates `requestId` against `/^[0-9a-f]{32}$/` (exact length 32,
lowercase hex only).

### Maximum object size

The 4-field schema produces a JSON object of approximately 100-150 bytes.  Docker
rejects any object whose raw byte length exceeds 4096 bytes before attempting
JSON parsing (fail-closed against oversized payloads).

### Worker write validation

Before writing to R2 the Worker constructs the payload in code from typed values;
it does not accept user-supplied JSON.  `requestId` and `requestedAt` are
generated by the Worker itself; `schema` and `kind` are constants.  No user input
appears in the request object.

### Docker read validation

Docker validates in order:

1. Object size <= 4096 bytes.
2. Valid UTF-8 JSON, parses to an object (not array, not primitive).
3. Exactly 4 keys, all present in `EXPECTED_KEYS`.
4. `schema === 1`.
5. `requestId` matches `/^[0-9a-f]{32}$/`.
6. `requestedAt` is a valid UTC timestamp (dual-format validator).
7. `kind === "sync-now"`.

Any failure: log a sanitized warning (key name only, no value), delete the object
(best-effort), and skip the sync.

---

## 4. Worker Admin Behavior

### Route

`POST /admin/sync/request`

### Guards (applied in order, matching existing admin route pattern)

1. `requireAdmin` middleware (Cloudflare Access JWT validation + admin email
   allowlist) - identical to all other admin mutation routes; fail closed with
   403 `no-store`.
2. `isSameOrigin` check - same helper already used by all admin POST routes;
   absent, `null`, or mismatched `Origin` -> 403 `no-store`.
3. Content-Type check: must be `application/x-www-form-urlencoded` (exact match,
   case-insensitive, with the same optional `charset` handling as existing admin
   mutation routes); anything else -> 400 `no-store`.

The form body carries exactly one field in v1:

| Field | Constraint |
|---|---|
| `kind` | single string, exactly `sync-now` |

Missing, repeated, file-valued, or extra fields are rejected with `400`
`no-store`.  The Worker still writes `"sync-now"` as a constant after
validation; no caller-supplied value is copied into the request object.

### Request ID and timestamp generation

Generated by the Worker after all cheap request validation succeeds and before
any R2 write:

```typescript
const requestId = crypto.randomUUID().replaceAll('-', '')
const requestedAt = new Date().toISOString()
```

Neither value is derived from user input or request headers.

### R2 write

```typescript
await env.PHOTO_BUCKET.put(
  'ops/sync-request.json',
  JSON.stringify({ schema: 1, requestId, requestedAt, kind: 'sync-now' }),
  { httpMetadata: { contentType: 'application/json', cacheControl: 'private, no-cache' } }
)
```

The key is a string literal in the handler; it is never caller-supplied.

### Responses

| Condition | Response |
|---|---|
| R2 write succeeded | `303 Location: /admin/sync` with `Cache-Control: no-store` |
| R2 write threw | `500 Internal Server Error` plain text, `Cache-Control: no-store` |
| Any guard/body failure | 400 or 403 `no-store` (no 5xx) |

Error responses contain only the fixed text `"Internal Server Error"`.  R2
error details, bucket name, object key, and admin identity are not included.

### Privacy / logging

- Admin email and Cloudflare Access claims are not read, stored, logged, or
  included in the request object.
- The request body is not logged.
- The `requestId` and `requestedAt` generated by the Worker appear only in the
  R2 object, not in any log or response body.

---

## 5. Docker Daemon Behavior

### How often the daemon checks for a request

Two check points:

1. **Loop start**: at the top of each main loop iteration, before any sync
   attempt (scheduled or triggered).  This costs one R2 GET per scheduled
   interval but ensures a request is never missed at loop start.

2. **Sleep polling**: during the inter-sync sleep the daemon wakes every
   `REQUEST_POLL_INTERVAL` seconds (default 60, same as `heartbeat_period`) to
   check for a pending request.  If a valid, non-stale request is found, the
   sleep is interrupted and the sync runs immediately.

Polling uses the same `asyncio.wait` pattern as the current shutdown/sleep race:
the sleep task is replaced with a polling loop that competes against the shutdown
event.

R2 reads during polling use the existing `R2ObjectStore.get` method (to be added
in Phase 2; see Section 9).

### Behavior when a sync is already running

The daemon cannot be interrupted mid-sync.  The `run_sync_once` call is
awaited to completion.  A request submitted during this window is picked up at
the next loop-start check (immediately after the in-progress sync completes) or
at the next sleep poll if the sync completes before the next scheduled run.
The maximum latency between submission and execution is bounded by the current
sync duration plus one `REQUEST_POLL_INTERVAL`.

### Request validation

See Section 3 (Docker read validation).  All validation errors produce a
sanitized log line: `"request ignored: <reason>"` where `<reason>` is one of
`malformed`, `unknown-schema`, `stale`, `duplicate`, `invalid-id`,
`invalid-timestamp`, `invalid-kind`.  No field value is logged.

### "Already handled" check

The daemon keeps `_last_handled_request_id: str | None` in module-level or
function-scope memory (not in `HealthState`, not in any file).  After handling a
request (after R2 delete attempt), this field is set to the handled `requestId`.

On the next poll, if `object.requestId == _last_handled_request_id`, the object
is deleted (best-effort) and the check returns "already handled."  This prevents
double-execution within the same process lifetime if R2 deletion fails
transiently.

On daemon restart, `_last_handled_request_id` is `None`.  If the R2 object was
deleted before the restart, no replay occurs.  If deletion failed and the same
object remains, the staleness check (`requestedAt` > 3600 s old) catches it
provided the daemon restarts more than an hour after the request was submitted.
For restarts within the first hour, one re-execution is possible; this is
documented in Section 6.

### Effect on daemon health counters

A manual sync is treated identically to a scheduled sync:

- `runsCompleted` increments by 1 on completion (success or failure).
- `lastResult` is set to `"ok"` or `"failed"`.
- `consecutiveFailures` is reset to 0 on success, incremented on failure.
- `lastAttemptStartedAt` and `lastAttemptCompletedAt` are updated.
- Docker HEALTHCHECK reads `consecutive_failures` and `heartbeat_at`; it is
  unaffected by whether the trigger was manual or scheduled.

### Status publication reporting

After a manual sync, `_publish_sync_status` is called identically to the
scheduled case.  In Phase 3, the sync status schema will be bumped to 2 and two
new fields added to allow the admin page to distinguish triggers:
`lastTriggerKind` (`"scheduled"` | `"manual"`) and `lastHandledRequestId`
(32-char hex | null).  Until Phase 3, the status page reflects sync results only,
not trigger source.

### R2 request object lifecycle from Docker's side

1. Read `ops/sync-request.json` (best-effort GET).
2. If not found: no-op, continue sleep or loop.
3. If found but invalid / stale / duplicate: best-effort DELETE, no-op.
4. If found and valid: run sync, then best-effort DELETE, set
   `_last_handled_request_id`.

"Best-effort DELETE" means any R2 exception from the delete is logged as a
warning and swallowed; the sync has already run and the outcome is recorded in
the status object.

### R2 object operation failures

| Failure | Behavior |
|---|---|
| GET fails (exception) | Log warning `"request poll failed"`, skip, retry next poll |
| DELETE fails after handling | Log warning `"request delete failed"`, set `_last_handled_request_id` anyway, continue |
| DELETE fails after ignore | Log warning `"request delete failed"`, continue |

The sync loop and Docker HEALTHCHECK are never affected by R2 request-object
failures.

---

## 6. Failure And Replay Model

| Scenario | Behavior |
|---|---|
| Missing object | GET returns `None`; no-op |
| Malformed JSON or non-object | Warn `malformed`, best-effort DELETE, skip |
| Unknown `schema` | Warn `unknown-schema`, best-effort DELETE, skip |
| Stale request (`requestedAt` more than 3600 s before daemon clock) | Warn `stale`, best-effort DELETE, skip |
| Duplicate `requestId` (matches `_last_handled_request_id`) | Warn `duplicate`, best-effort DELETE, skip |
| Future `requestedAt` (more than 60 s after daemon clock) | Warn `invalid-timestamp`, treat as invalid, best-effort DELETE, skip |
| Request while a sync is running | Sync cannot be interrupted; request is picked up at next loop-start check after sync completes |
| Worker R2 write failure | 500 to admin browser; no R2 object created |
| Docker R2 read failure | Warn `"request poll failed"`, skip, retry next poll |
| Docker restart after handled request, delete succeeded | Object gone; no replay |
| Docker restart after handled request, delete failed | Object present; if >3600 s old, staleness catches it and skips; if <3600 s old, one re-execution may occur (documented acceptable behavior for v1) |
| Clock skew between Worker and Docker | Up to 60 s skew is tolerated; staleness threshold is 3600 s, which dominates |
| Status publish failure | Existing `_publish_sync_status` isolation unchanged; sync outcome is unaffected |

### Preventing an infinite sync loop

The design avoids infinite loops by three independent mechanisms:

1. **Delete-after-handling (primary)**: the daemon deletes the request object
   after every handling decision (valid+synced, stale, duplicate, invalid).
   A persistent object cannot re-trigger a sync loop.

2. **`_last_handled_request_id` (fallback within daemon lifetime)**: if deletion
   fails, the same `requestId` is skipped on the next poll.

3. **Staleness threshold (fallback across restart)**: a request that persists
   through a restart is ignored once it is older than 3600 seconds.  The daemon
   cannot be driven into continuous sync by a fixed request object for more than
   one cycle per restart within the first hour.

No design can provide a zero-replay guarantee if both deletion and the staleness
window are simultaneously defeated (e.g., daemon restarts every 59 minutes with a
persistent malformed object that passes size validation but fails field
validation); in that pathological case the object would be deleted on the first
validated read.

---

## 7. Security And Privacy

### Invariants and proofs

**Normal viewing uses Workers, D1, and private R2 only.**
The new route is a POST admin route behind `requireAdmin`.  Viewer routes are
unchanged.  The request object is in private R2; no public access is introduced.

**Shared users never access PhotoPrism or NAS directly.**
The request object contains no PhotoPrism UID, URL, or token; no NAS path.  The
Worker that writes the object has no PhotoPrism or NAS access.  The Docker daemon
that reads it already has PhotoPrism access by design; no new access is granted.

**Workers do not access PhotoPrism, NAS, Docker, Portainer, or local files.**
The Worker's only new operation is an R2 PUT at a fixed key.  No new network
dependency is introduced.

**Docker does not implement viewer auth, viewer pages, or D1 authorization.**
The daemon reads and deletes a fixed R2 key.  No D1 credential, viewer session,
or HTTP listener is added.

**R2 remains private.**
The request object is written through the Worker's private R2 binding and read
through the daemon's existing R2 credentials.  No new bucket, no new public
access, no pre-signed URL.

**Secrets are not stored in request or status objects or logs.**
The request object contains only `schema`, `requestId`, `requestedAt`, and
`kind`.  None of these is a secret.  `requestId` is a random hex string with no
admin identity.  Logs emit only sanitized reason codes, never field values.

**PhotoPrism UID, title, token, URL, and source photo data are not exposed.**
None of these fields appear in the request schema or in any Worker log or
response.

**Admin email and Cloudflare Access claims are not persisted or rendered.**
The Worker handler does not read or store the admin identity beyond what
`requireAdmin` validates and discards.  The `requestedBy` field is absent from
the schema by design.

**Errors are sanitized.**
Worker errors are fixed-text `"Internal Server Error"`.  Docker log lines emit
only a reason code.  R2 exception messages are not propagated to any user-visible
surface.

### New R2 key allowlist entry

`r2_store.py` currently allows:
- `albums/<albumId>/manifest.json`
- `albums/<albumId>/cover.webp`
- `albums/<albumId>/thumbs/<uid>.webp`
- `albums/<albumId>/previews/<uid>.jpg`
- `ops/sync-status.json` (exact match, added in previous handoff)

Phase 2 adds `ops/sync-request.json` as a second exact-match entry using the
same pattern as `ops/sync-status.json`.  The daemon will need `get` and `delete`
methods on `R2ObjectStore` / `ObjectStore` in addition to `put`.

The `get` method must apply the same key safety checks as `put`.  The `delete`
method must also apply the same key safety checks.  Neither method exposes the
raw boto3 response to callers.

---

## 8. Operational Notes

### How an operator tells a request was accepted and later handled

**Accepted**: the `POST /admin/sync/request` form returns a `303` redirect to
`/admin/sync`.  The admin page reload will show the sync status object; in Phase
3 it will indicate a pending request is present (if polling has not yet consumed
it) or that the last trigger was manual.

Until Phase 3 the operator must infer handling from the status page timestamps:
if `lastAttemptStartedAt` advances after the manual request, the request was
handled.  `runsCompleted` also increments.

### How the read-only `/admin/sync` page should evolve

Phase 3 should add:

- A "Sync Now" button visible to admins (rendered in the `AdminSyncPage`
  component; targets `POST /admin/sync/request`).
- A "Pending" indicator when a valid request object is present in R2 (Worker
  reads `ops/sync-request.json` on the same `GET /admin/sync` request).
- `lastTriggerKind` (scheduled / manual) and `lastHandledRequestId` derived from
  the updated status schema.

The status schema bumps from 1 to 2 in Phase 3; the Worker parser must accept
both schema 1 and schema 2 objects during the transition period.

### Behavior when R2 credentials are broken

If the Worker's R2 binding is broken (misconfigured bucket), `PUT` throws and
the admin sees a 500 response.  If the daemon's R2 credentials are broken,
request polls fail with an `ObjectStoreError`; the daemon logs a warning and
continues the daemon loop.  Scheduled sync attempts still follow the existing
behavior and may fail independently when uploads require the same broken R2
credentials.  Neither path exposes credentials or causes a crash.

### Manual recovery if a bad request object is present

An operator with R2 access (Cloudflare dashboard or AWS CLI with R2 credentials)
can delete `ops/sync-request.json` directly.  This unblocks the daemon if a
persistent invalid object is somehow not being auto-deleted (e.g., the daemon
validation logic has a bug that prevents reaching the delete call).  No code
change or restart is required.

### Why no Cloudflare Queue, Durable Object, D1 table, Portainer API, or Docker socket

These alternatives are rejected for the reasons given in Section 2.  The
decisive constraints are:

- Cloudflare Queue and Durable Object require paid-tier features.
- D1 from Docker violates the Docker-to-D1 boundary invariant.
- Portainer API and Docker socket from Workers violate the
  Workers-to-Docker prohibition.

Private R2 is already the cross-component bridge; one additional fixed key is the
narrowest possible extension.

---

## 9. Follow-Up Implementation Plan

This section is a planning guide only.  No files listed here are edited as part
of this handoff.

### Phase 1 — Worker request writer and tests

**Goal**: implement `POST /admin/sync/request` in the Worker; no Docker changes.

**Files to edit**:

| File | Change |
|---|---|
| `workers/src/routes/admin.tsx` | Add `POST /admin/sync/request` route; guard, same-origin check, R2 write, 303 redirect |
| `workers/src/routes/admin.tsx` | Add `syncRequestRepo` to `AdminRouteDeps` (or write directly via `PHOTO_BUCKET`) |
| `workers/src/index.tsx` | Wire R2 write dependency if extracted to a repo |
| `workers/test/admin-routes.test.ts` | Add 15-20 tests: auth guard (403), same-origin (403), content-type (400), exact `kind=sync-now` form validation, R2 write success (303+redirect), R2 write failure (500) |

**Core tests to add**:

- Auth guard rejects unauthenticated (403, no-store).
- Same-origin guard rejects missing/null/cross-origin `Origin` (403, no-store).
- Wrong Content-Type -> 400 no-store.
- Missing, repeated, file-valued, or extra form fields -> 400 no-store.
- Valid POST with exactly `kind=sync-now` -> 303 to `/admin/sync`, no-store.
- R2 write failure -> 500 no-store, no bucket/key/credentials in body.
- Admin email not in request object written to R2.
- `requestId` is 32-char hex; `requestedAt` is ISO Z with milliseconds.
- `kind` is always written as the constant `"sync-now"` after form validation.

### Phase 2 — Docker request reader/handler and tests

**Goal**: daemon reads and acts on `ops/sync-request.json`; deletes after handling.

**Files to edit**:

| File | Change |
|---|---|
| `docker/src/photo_gate/object_store.py` | Add `get(key) -> bytes | None` and `delete(key) -> None` to `ObjectStore` protocol |
| `docker/src/photo_gate/r2_store.py` | Implement `get` and `delete` on `R2ObjectStore`; add `ops/sync-request.json` exact-match to `_validate_key`; add `private, no-cache` cache entry |
| `docker/src/photo_gate/sync_request.py` | New module: `SYNC_REQUEST_KEY`, `validate_sync_request(data: bytes) -> dict | None` (returns parsed object or `None`), `is_stale(req, clock) -> bool` |
| `docker/src/photo_gate/main.py` | Add `_poll_request(store, clock, last_handled_id) -> dict | None`; integrate poll into daemon sleep loop; add `_last_handled_request_id` tracking; delete after handling |
| `docker/tests/test_sync_request.py` | New test file |
| `docker/tests/test_daemon.py` | Add daemon polling tests |
| `docker/tests/test_r2_store.py` | Add `get`/`delete` method tests; request key allowed; other ops keys still rejected |

**Core tests to add**:

- `validate_sync_request`: valid payload returns parsed dict; missing field returns `None`; extra field returns `None`; wrong schema returns `None`; requestId not hex returns `None`; unknown kind returns `None`; oversized payload returns `None`.
- `is_stale`: request older than threshold is stale; recent request is not stale; future timestamp >60 s is invalid.
- Daemon: valid request triggers immediate sync; stale request is deleted and skipped; duplicate requestId (in memory) is deleted and skipped; R2 GET failure does not crash daemon; R2 DELETE failure does not crash daemon; `runsCompleted` increments for manual sync.
- `r2_store.get`: returns `None` for missing key; returns bytes for present key; rejects non-request key.
- `r2_store.delete`: deletes request key; rejects non-allowed key.

### Phase 3 — Status page additions

**Goal**: admin page shows pending request indicator and trigger kind; schema 2.

**Files to edit**:

| File | Change |
|---|---|
| `docker/src/photo_gate/sync_status.py` | Bump schema to 2; add `lastTriggerKind` (`"scheduled"` | `"manual"` | `None`) and `lastHandledRequestId` (`str | None`) to `build_sync_status` and payload |
| `docker/src/photo_gate/main.py` | Pass trigger kind through `_publish_sync_status` call; update schema 2 field after each sync |
| `workers/src/types/admin-sync-status.ts` | Add `lastTriggerKind` and `lastHandledRequestId` fields; update schema union to `1 | 2` |
| `workers/src/services/admin-sync-status-repository.ts` | Accept schema 1 (legacy) and schema 2; validate new fields; `lastTriggerKind` in `{"scheduled","manual",null}`; `lastHandledRequestId` matches `/^[0-9a-f]{32}$/` or `null` |
| `workers/src/routes/admin.tsx` | Read `ops/sync-request.json` (best-effort) on `GET /admin/sync`; render "Pending" indicator; add "Sync Now" button form |
| `workers/test/admin-sync-status-repository.test.ts` | Add schema 2 validation tests; schema 1 still accepted |
| `workers/test/admin-routes.test.ts` | Add pending indicator render tests; button presence |

### Phase 4 — Documentation and deployment/smoke steps

**Goal**: update README files, operator docs, and confirm end-to-end behavior.

**Files to edit**:

| File | Change |
|---|---|
| `workers/README.md` | Add `POST /admin/sync/request` to active surface table |
| `docker/README.md` | Document request polling, `ops/sync-request.json`, delete-after-handling |
| `docs/operations/operator-actions.md` | Add "Trigger manual sync" operator procedure |
| `docker/src/photo_gate/` | Bump package version to 0.3.0 |

**Deployment/smoke steps**:

1. Deploy updated Worker (CI or `wrangler deploy`).
2. Smoke: `POST /admin/sync/request` from browser returns 303; admin page shows Pending indicator.
3. Bump Portainer stack to new Docker image tag.
4. Smoke: Portainer logs show "handling manual sync request"; status page shows `lastTriggerKind: "manual"` after completion.
5. Confirm `ops/sync-request.json` is absent from R2 after handling (Cloudflare dashboard).
