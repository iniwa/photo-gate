Read AGENTS.md, CLAUDE.md, and this handoff file before implementation.
If implementation would violate constraints or require files outside this
handoff, stop and ask before editing.

## Goal

Implement read-only sync status visibility for admins.

Add a sanitized sync status JSON object written by the Docker sync daemon to
private R2, and add a Worker admin page `GET /admin/sync` that reads that fixed
R2 object, validates it strictly, and renders the status.

This is the first "sync request/status administration" step. It is status-only:
no manual sync trigger, no queue, no Portainer API, no Docker socket access, and
no production operation.

Claude Code may delegate implementation and tests to Sonnet subagents, but the
primary coordinator must review the final diff against the security constraints
before reporting.

## Background

Current state:

- Docker `sync-daemon` already writes a local health JSON file for Docker
  HEALTHCHECK.
- Workers cannot read the Pi local health file and must not access Docker,
  Portainer, PhotoPrism, or NAS.
- R2 is private and already shared by Docker (writer) and Workers (reader).
- D1 is for users/sessions/albums/permissions and later operational state, but
  this handoff should avoid migrations.

The safe bridge for this step is a fixed private R2 object:

```text
ops/sync-status.json
```

The Docker daemon writes a sanitized status object there on a best-effort basis.
The Worker admin page reads exactly that key and validates the JSON before
rendering.

Existing patterns to follow:

- Docker:
  - `docker/src/photo_gate/health.py`
  - `docker/src/photo_gate/main.py`
  - `docker/src/photo_gate/r2_store.py`
  - `docker/tests/test_daemon.py`
  - `docker/tests/test_r2_store.py`
- Workers:
  - `workers/src/routes/admin.tsx`
  - `workers/src/index.tsx`
  - `workers/src/services/admin-ops-repository.ts`
  - `workers/src/services/private-r2-reader.ts`
  - `workers/test/admin-routes.test.ts`
  - `workers/test/private-r2-reader.test.ts`

## Acceptance Criteria

### Docker Status Object

Add a new sanitized sync status schema, emitted as UTF-8 JSON:

```json
{
  "schema": 1,
  "publishedAt": "2026-06-25T00:00:00Z",
  "albumId": "album-id",
  "intervalSeconds": 86400,
  "startedAt": "2026-06-25T00:00:00Z",
  "heartbeatAt": "2026-06-25T00:01:00Z",
  "lastAttemptStartedAt": "2026-06-25T00:00:00Z",
  "lastAttemptCompletedAt": "2026-06-25T00:02:00Z",
  "lastResult": "ok",
  "lastError": null,
  "consecutiveFailures": 0,
  "runsCompleted": 1
}
```

Field mapping from `HealthState`:

- `schema`: fixed `1`
- `publishedAt`: current daemon timestamp at publish time
- `albumId`: `HealthState.album_id`
- `intervalSeconds`: `HealthState.interval_seconds`
- `startedAt`: `HealthState.started_at`
- `heartbeatAt`: `HealthState.heartbeat_at`
- `lastAttemptStartedAt`: `HealthState.last_attempt_started_at`
- `lastAttemptCompletedAt`: `HealthState.last_attempt_completed_at`
- `lastResult`: `HealthState.last_result` (`"ok"`, `"failed"`, or `null`)
- `lastError`: `HealthState.last_error` (already sanitized by `_describe_error`)
- `consecutiveFailures`: `HealthState.consecutive_failures`
- `runsCompleted`: `HealthState.runs_completed`

Do not include:

- PID
- album title
- PhotoPrism album UID
- PhotoPrism URL/token
- Cloudflare Access client ID/secret
- R2 endpoint/bucket/access key
- R2 object keys other than the fixed status key in code/tests/docs
- source photo IDs/titles/hashes
- manifest contents
- stack/container hostname
- environment values

Add a small module, for example:

- `docker/src/photo_gate/sync_status.py`

Responsibilities:

- define fixed key `ops/sync-status.json`;
- build the public status payload from `HealthState`;
- JSON-encode with stable key order or deterministic construction;
- validate that all emitted timestamps are strings in the existing daemon UTC
  shape (`YYYY-MM-DDTHH:MM:SSZ`) or `null` for nullable fields;
- validate counts are non-negative integers;
- validate `lastResult` is `"ok"`, `"failed"`, or `None`;
- reject unsafe `albumId` using the existing model ID rules or equivalent.

### Docker R2 Upload

Extend `docker/src/photo_gate/r2_store.py` key allowlist to permit exactly:

```text
ops/sync-status.json
```

For this key:

- `ContentType` must be `application/json`;
- `CacheControl` must be `private, no-cache`;
- other `ops/*` keys must remain rejected;
- existing album asset key validation must remain unchanged.

Publish the status object from `sync-daemon` best-effort:

- after initial health state is created;
- after each attempt-start state update;
- after each attempt-completed state update;
- heartbeat publishing is optional. If implemented, keep it best-effort and
  ensure failed status publish cannot break daemon heartbeat or sync.

Important failure behavior:

- failure to publish `ops/sync-status.json` must not fail sync, stop the daemon,
  increment `consecutive_failures`, or print secrets;
- if configuration loading fails before an R2 store can be created, the daemon
  may be unable to publish remote status. That is acceptable; local health file
  behavior remains the source of Docker HEALTHCHECK truth.

Implementation guidance:

- Reuse the daemon's existing `config_loader` and `store_factory` injection
  points.
- Avoid constructing a second store inside every heartbeat if you implement
  heartbeat publish; create once where practical.
- If adding helper functions in `main.py`, keep them private and testable.
- Do not change `sync-once` behavior.
- Do not change healthcheck semantics.

### Worker Admin Page

Add `GET /admin/sync`.

Route behavior:

- mounted under the existing admin guard and before `admin.all('*', ...)`;
- `GET /admin` links to `/admin/sync` with Japanese label `同期状態`;
- verified admin + valid status object: `200` no-store SSR page;
- verified admin + missing status object: `200` no-store "未報告" / "status not reported yet" safe empty state;
- verified admin + R2 read failure or malformed JSON/status: `500` no-store fixed sanitized text;
- auth failures: existing `403` guard behavior.

Add Worker types/service, for example:

- `workers/src/types/admin-sync-status.ts`
- `workers/src/services/admin-sync-status-repository.ts`

Repository method:

```ts
getStatus(): Promise<
  | { status: 'missing' }
  | { status: 'found'; value: AdminSyncStatus }
>
```

Use the Worker R2 binding directly or a dedicated injected reader that reads
exactly `ops/sync-status.json`. Do not widen `isStandardPrivateObjectKey()` for
viewer image/manifest reads unless there is a strong reason. The status reader
must not accept a caller-supplied key.

Strictly validate JSON:

```ts
export interface AdminSyncStatus {
  schema: 1
  publishedAt: string
  albumId: string
  intervalSeconds: number
  startedAt: string
  heartbeatAt: string
  lastAttemptStartedAt: string | null
  lastAttemptCompletedAt: string | null
  lastResult: 'ok' | 'failed' | null
  lastError: string | null
  consecutiveFailures: number
  runsCompleted: number
}
```

Validation requirements:

- exact object keys only; reject extra/missing keys;
- `schema === 1`;
- `albumId` passes existing `isValidId`;
- timestamps are canonical UTC. Accept both `YYYY-MM-DDTHH:mm:ssZ` emitted by
  Docker daemon and `YYYY-MM-DDTHH:mm:ss.sssZ` if existing Worker helper only
  supports millisecond ISO. Document which validator is used. Do not accept
  offsets like `+09:00`;
- nullable timestamp fields must be either valid timestamp strings or `null`;
- `intervalSeconds`, `consecutiveFailures`, and `runsCompleted` are safe
  non-negative integers;
- `lastResult` is `"ok"`, `"failed"`, or `null`;
- `lastError` is either `null` or a short sanitized string:
  - type string;
  - length <= 256 code points;
  - no ASCII control characters;
  - no `http://`, `https://`, `token`, `secret`, `password`, `Authorization`,
    `CF_Authorization`, `Cf-Access-Jwt-Assertion`, or R2 credential-like words
    case-insensitively.

The rendered page may show:

- album ID;
- interval seconds;
- published/started/heartbeat/attempt timestamps;
- result;
- sanitized last error;
- consecutive failure count;
- runs completed.

The page must not render:

- admin email or Access claims;
- album title;
- PhotoPrism UID or URL/token;
- R2 endpoint/bucket/object keys;
- manifest/photo data;
- raw JSON blob.

### Documentation

Update:

- `workers/README.md`
- `docker/README.md`

Document:

- fixed status object key `ops/sync-status.json`;
- status-only read-only nature of `/admin/sync`;
- no manual sync trigger yet;
- status object is best-effort and may be missing if the daemon has not
  published or R2 credentials/config are unavailable.

Do not update Fable documents in this handoff. Codex will update durable state
after review.

## Files To Inspect

- `AGENTS.md`
- `CLAUDE.md`
- `docs/fable/project-context.md`
- `docs/fable/current-state.md`
- `docs/fable/roadmap.md`
- `docs/fable/progress.md`
- `docker/src/photo_gate/health.py`
- `docker/src/photo_gate/main.py`
- `docker/src/photo_gate/r2_store.py`
- `docker/src/photo_gate/object_store.py`
- `docker/tests/test_daemon.py`
- `docker/tests/test_r2_store.py`
- `workers/src/routes/admin.tsx`
- `workers/src/index.tsx`
- `workers/src/services/admin-ops-repository.ts`
- `workers/src/services/private-r2-reader.ts`
- `workers/src/services/repository-validation.ts`
- `workers/src/services/safe-id.ts`
- `workers/test/admin-routes.test.ts`
- `workers/README.md`
- `docker/README.md`

## Files To Edit

Docker:

- `docker/src/photo_gate/sync_status.py`
- `docker/src/photo_gate/main.py`
- `docker/src/photo_gate/r2_store.py`
- `docker/tests/test_sync_status.py`
- `docker/tests/test_daemon.py`
- `docker/tests/test_r2_store.py`
- `docker/README.md`

Workers:

- `workers/src/types/admin-sync-status.ts`
- `workers/src/services/admin-sync-status-repository.ts`
- `workers/src/routes/admin.tsx`
- `workers/src/index.tsx`
- `workers/test/admin-sync-status-repository.test.ts`
- `workers/test/admin-routes.test.ts`
- `workers/README.md`

If implementation requires editing files outside this list, stop and report why
before editing.

## Constraints

- Preserve all existing viewer security behavior.
- Preserve all existing admin auth behavior.
- Status is read-only; no sync trigger, no queue, no POST, no mutation route.
- Do not add dependencies.
- Do not add D1 migrations.
- Do not call Cloudflare APIs, Portainer APIs, Docker socket, PhotoPrism, NAS,
  or production R2 during tests.
- Do not log secrets, URLs, tokens, status JSON bodies, raw R2 errors, or env
  values.
- Do not expose PhotoPrism album UID, album title, preview URLs/tokens, source
  photo data, R2 credentials, or Access claims.
- Docker status publish is best-effort and must not change sync success/failure
  semantics.
- Worker status read failure or invalid status must fail closed with sanitized
  `500`; missing object is a safe `200` empty state.
- Keep tests isolated with fakes/mocks.
- Keep edits narrow and consistent with existing style.

## Non Goals

- No manual sync request button.
- No background queue.
- No D1 operational state table.
- No persistent audit log.
- No status for multiple albums unless it naturally falls out of the single
  daemon status object; this deployment currently runs one album.
- No Docker/Portainer production operation.
- No Cloudflare deployment.
- No commit or push.
- No handoff archival.
- No Fable document updates.

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
git status --short
```

Full `npm audit` may still report known Wrangler/Miniflare devDependency
advisories. Do not change dependencies for those in this handoff.

## Expected Report

Report:

- changed files;
- Docker status schema and exact emitted fields;
- exact R2 key, content type, and cache-control;
- where status is published in the daemon lifecycle;
- how status publish failures are isolated from sync/health behavior;
- Worker route behavior for found/missing/invalid/read-failure/auth-failure;
- Worker JSON validation rules;
- proof that forbidden data is not emitted, uploaded, selected, rendered, or
  logged;
- verification command results;
- skipped checks with exact reasons;
- any out-of-scope edits or design questions.
