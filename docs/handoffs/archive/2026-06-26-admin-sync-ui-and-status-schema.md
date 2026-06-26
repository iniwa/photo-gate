Read AGENTS.md, CLAUDE.md, and this handoff file before implementation.
If implementation would violate constraints or require files outside this
handoff, stop and ask before editing.

## Goal

Finish the manual sync administration loop locally:

- Docker publishes sync status schema 2 with trigger metadata.
- Worker accepts both sync status schema 1 and schema 2.
- `GET /admin/sync` shows a no-JS "Sync Now" form.
- `GET /admin/sync` shows a pending indicator when a valid
  `ops/sync-request.json` object exists.

This is Phase 3 of `docs/decisions/2026-06-25-sync-request-controls.md`.

## Background

Already implemented and reviewed:

- Docker publishes sanitized sync status to private R2 at
  `ops/sync-status.json`.
- Worker renders read-only `GET /admin/sync` from that fixed status key.
- Worker writes manual sync requests to private R2 at
  `ops/sync-request.json` via `POST /admin/sync/request`.
- Docker consumes that request key, validates it, runs the configured
  single-album sync, and best-effort deletes handled/stale/duplicate/invalid
  request objects.

Remaining gap:

- The admin page still has no visible button.
- The admin page cannot show whether a request is pending.
- The status object cannot distinguish scheduled vs manual trigger.

## Acceptance Criteria

1. Docker `build_sync_status` emits schema 2 with two additional fields:
   `lastTriggerKind` and `lastHandledRequestId`.
2. Docker local health file remains unchanged at schema 1. Do not add trigger
   fields to `HealthState` or the healthcheck contract.
3. Docker status publication remains best-effort and sanitized. Publish
   failures still never affect sync result, health state, or Docker
   HEALTHCHECK.
4. Docker marks each sync attempt as either `scheduled` or `manual` for remote
   status publication.
5. Worker `AdminSyncStatusRepository` accepts both schema 1 and schema 2:
   - schema 1: old 12-key payload, normalized to trigger fields `null`;
   - schema 2: 14-key payload with strict trigger field validation.
6. Worker can read the fixed request key `ops/sync-request.json` to determine
   whether a valid pending request exists.
7. `GET /admin/sync` fetches both status and pending request state behind the
   existing admin guard, returns `no-store`, and renders:
   - current sync status, including trigger metadata when available;
   - a pending indicator when a valid request object exists;
   - a form that posts `kind=sync-now` to `/admin/sync/request`.
8. The new form has no client-side JavaScript and uses the same existing
   `POST /admin/sync/request` route. Do not create a second trigger route.
9. Pending request read failures or invalid pending request objects fail closed
   with sanitized `500 Internal Server Error` on `GET /admin/sync`; missing
   request object is a safe "not pending" state.
10. No request body, pending request ID, admin email, Cloudflare Access claims,
    R2 key details, bucket name, raw JSON, PhotoPrism UID/title/token/URL, or
    source photo data is rendered or logged.

## Files To Inspect

- `docs/decisions/2026-06-25-sync-request-controls.md`
- `docker/src/photo_gate/sync_status.py`
- `docker/src/photo_gate/main.py`
- `docker/src/photo_gate/health.py`
- `docker/src/photo_gate/sync_request.py`
- `docker/tests/test_sync_status.py`
- `docker/tests/test_daemon.py`
- `workers/src/types/admin-sync-status.ts`
- `workers/src/types/admin-sync-request.ts`
- `workers/src/services/admin-sync-status-repository.ts`
- `workers/src/services/admin-sync-request-repository.ts`
- `workers/src/routes/admin.tsx`
- `workers/src/index.tsx`
- `workers/test/admin-sync-status-repository.test.ts`
- `workers/test/admin-sync-request-repository.test.ts`
- `workers/test/admin-routes.test.ts`
- `workers/README.md`
- `docker/README.md`

## Files To Edit

- `docker/src/photo_gate/sync_status.py`
- `docker/src/photo_gate/main.py`
- `docker/tests/test_sync_status.py`
- `docker/tests/test_daemon.py`
- `docker/README.md`
- `workers/src/types/admin-sync-status.ts`
- `workers/src/types/admin-sync-request.ts` (only if a read/pending type is useful)
- `workers/src/services/admin-sync-status-repository.ts`
- `workers/src/services/admin-sync-request-repository.ts`
- `workers/src/routes/admin.tsx`
- `workers/src/index.tsx` (only if dependency shape changes)
- `workers/test/admin-sync-status-repository.test.ts`
- `workers/test/admin-sync-request-repository.test.ts`
- `workers/test/admin-routes.test.ts`
- `workers/README.md`

Do not edit migrations, D1 repositories, viewer routes, auth routes, deployment
workflows, package metadata, Fable documents, operation documents, archived
handoffs, or unrelated modules.

If you need to edit a test helper outside this list, stop and report the exact
need first.

## Constraints

### Docker Status Schema 2

Schema 2 payload must contain exactly 14 keys:

```json
{
  "schema": 2,
  "publishedAt": "2026-06-25T00:02:05Z",
  "albumId": "my-album",
  "intervalSeconds": 86400,
  "startedAt": "2026-06-25T00:00:00Z",
  "heartbeatAt": "2026-06-25T00:01:00Z",
  "lastAttemptStartedAt": "2026-06-25T00:00:00Z",
  "lastAttemptCompletedAt": "2026-06-25T00:02:00Z",
  "lastResult": "ok",
  "lastError": null,
  "consecutiveFailures": 0,
  "runsCompleted": 1,
  "lastTriggerKind": "manual",
  "lastHandledRequestId": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4"
}
```

Validation rules:

- `lastTriggerKind` is `"scheduled"`, `"manual"`, or `null`.
- `lastHandledRequestId` is a 32-character lowercase hex string or `null`.
- At daemon startup before any attempt, both fields should be `null`.
- Scheduled attempts publish `lastTriggerKind: "scheduled"`.
- Manual attempts publish `lastTriggerKind: "manual"`.
- When a manual request has been handled, publish its request ID as
  `lastHandledRequestId`.
- A later scheduled attempt may keep the last handled manual request ID; it
  should not invent a new ID or clear it unless the implementation has a clear
  reason and tests.

Do not include these fields in the local health JSON. They are remote status
metadata only.

Recommended implementation:

- Extend `build_sync_status` with keyword-only parameters:
  `last_trigger_kind: str | None = None`,
  `last_handled_request_id: str | None = None`.
- Extend `_publish_sync_status` with the same keyword-only parameters and pass
  them through.
- In `run_sync_daemon`, maintain function-scope trigger metadata. For each
  attempt, compute `current_trigger_kind = "manual"` if `_pending_req` is not
  `None`, otherwise `"scheduled"`. Use it for attempt-start and
  attempt-completion status publications.
- Set `_last_handled_request_id` after a manual attempt finishes and before the
  completion status publication.

### Worker Status Parser

`AdminSyncStatusRepository` must accept:

- schema 1: exactly the current 12 keys; return a normalized value with
  `lastTriggerKind: null` and `lastHandledRequestId: null`;
- schema 2: exactly 14 keys; validate all existing fields plus trigger fields.

Reject:

- schema 2 missing either new field;
- schema 2 with extra fields;
- schema 1 with schema 2 fields mixed in;
- invalid `lastTriggerKind`;
- uppercase, short, long, or non-hex `lastHandledRequestId`;
- boolean, number, or object values for trigger fields;
- all existing invalid timestamp/count/lastError cases.

Errors must remain sanitized as `sync status read failed`.

### Worker Pending Request Reader

Add a read method to the existing sync request repository or a narrowly scoped
helper in the same service:

```ts
getPendingRequest(): Promise<
  | { status: 'missing' }
  | { status: 'found'; value: AdminSyncRequest }
>
```

It must read exactly `ops/sync-request.json`.

Validation rules should match the Worker-written request object:

- object missing: `{ status: 'missing' }`;
- root object only, no arrays/primitives;
- exact four keys: `schema`, `requestId`, `requestedAt`, `kind`;
- `schema === 1`;
- `requestId` matches `^[0-9a-f]{32}$`;
- `requestedAt` is exact Worker ISO form
  `YYYY-MM-DDTHH:mm:ss.sssZ` and `new Date(value).toISOString() === value`;
- `kind === "sync-now"`;
- object size must be `<= 4096` bytes before text parsing when the R2 object
  exposes a `size` property.

Failure behavior:

- R2 `get` throws: throw sanitized `sync request read failed`;
- object `.text()` throws: throw sanitized `sync request read failed`;
- malformed JSON or validation failure: throw sanitized
  `sync request read failed`;
- do not return or log the request ID or raw JSON.

### Admin Route Behavior

`GET /admin/sync` remains behind `requireAdmin`.

Order:

1. Existing admin guard.
2. Read sync status.
3. Read pending request state.
4. Render page with `Cache-Control: no-store`.

Failure:

- status read failure: current sanitized 500 behavior;
- pending request read/validation failure: sanitized 500;
- missing status object: render safe "未報告" state;
- missing pending request object: render no pending indicator.

Render:

- Existing status fields.
- `lastTriggerKind` as Japanese text:
  - `scheduled` -> `定期実行`
  - `manual` -> `手動実行`
  - `null` -> `未報告`
- `lastHandledRequestId`, if present, may be rendered as an admin-only
  operational value. It is not a secret, but do not render the pending request
  ID from `ops/sync-request.json`.
- Pending indicator should be boolean only, for example
  `同期リクエスト処理待ち`. Do not display pending request ID or timestamp.
- Add a form:

```html
<form method="post" action="/admin/sync/request">
  <input type="hidden" name="kind" value="sync-now">
  <button type="submit">今すぐ同期</button>
</form>
```

No JavaScript. Do not add a confirmation bypass header, dev bypass, or alternate
route. Existing POST guard/content-type/form validation must remain unchanged.

### Security And Privacy

- Do not read or render admin email or Cloudflare Access claims.
- Do not render pending request ID, pending timestamp, raw JSON, R2 key, bucket,
  or error detail.
- Do not render album title, PhotoPrism UID, PhotoPrism URL/token, NAS path,
  source photo data, or manifest contents.
- Do not add logs containing request values or secrets.
- Do not add module-level request-scoped mutable state in the Worker.
- Do not add dependencies.
- Do not use Cloudflare REST API from the Worker; use existing R2 binding only.

## Non Goals

- No production deployment.
- No commit, push, tag, release, or handoff archival.
- No Portainer stack update.
- No real R2, D1, PhotoPrism, NAS, or Cloudflare mutation.
- No multi-album request schema.
- No queue, Durable Object, D1 pending request table, webhook, Portainer API,
  Docker socket, or Worker-to-Pi network path.
- No change to viewer routes, auth routes, album/user/permission admin routes,
  image delivery, D1 schema, or migrations.
- No R2 deletion from the Worker.
- No Docker image version bump in this handoff.

## Verification

Run Workers checks:

```powershell
Set-Location workers
npm run lint
npm run typecheck
npm test
npm run build
npm audit --omit=dev --audit-level=high
```

Run Docker checks:

```powershell
Set-Location ..\docker
python -m pytest
python -m compileall src
```

Because Docker runtime status publication changes, also run Docker build/smoke
if Docker is available:

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

If Docker is unavailable, report the exact `docker info` or equivalent error.
Do not run any production smoke test.

## Expected Report

Report in Japanese with:

1. Changed files.
2. Docker schema 2 payload shape, validation rules, and how schema 1 local
   health remains unchanged.
3. How scheduled/manual trigger metadata is computed and published.
4. Worker schema 1/2 compatibility behavior.
5. Pending request read behavior, including exact key, validation, missing,
   invalid, and R2 failure behavior.
6. `/admin/sync` rendering behavior: button, pending indicator, trigger
   metadata, and no-JS form.
7. Proof that existing `POST /admin/sync/request` guard and validation were not
   weakened.
8. Privacy proof: no pending request ID, raw JSON, R2 details, admin identity,
   album title, PhotoPrism UID/URL/token, or source photo data rendered/logged.
9. Verification commands and results.
10. Skipped checks with exact reasons.
11. Any design questions for Codex.
