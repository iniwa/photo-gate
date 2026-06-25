Read AGENTS.md, CLAUDE.md, and this handoff file before implementation.
If implementation would violate constraints or require files outside this
handoff, stop and ask before editing.

## Goal

Implement Phase 1 of sync request controls: the Worker-side request writer only.

Add an admin-only `POST /admin/sync/request` route that validates a tiny form,
generates a schema-1 sync request object, and writes it to the fixed private R2
key:

```text
ops/sync-request.json
```

This handoff must not implement Docker polling, Docker deletion, status schema
changes, a pending indicator, or a visible "Sync Now" button. The route is the
write primitive for a later Docker-side implementation.

Claude Code may delegate mechanical implementation and tests to Sonnet
subagents, but the primary coordinator must review the final diff against the
security constraints before reporting.

## Background

The design is accepted in:

- `docs/decisions/2026-06-25-sync-request-controls.md`

Read-only sync status is already implemented:

- Docker publishes sanitized status to `ops/sync-status.json`.
- Worker admin `GET /admin/sync` reads that fixed key.
- There is no sync request writer or Docker consumer yet.

This handoff implements only the Worker write side of the ADR.

Important safety consequence: because Docker does not yet consume
`ops/sync-request.json`, do not add a visible button or link that encourages
production use. The route can be tested locally and documented as not connected
until the Docker consumer phase lands.

## Acceptance Criteria

### Request Object Contract

Add a small Worker-side type and repository for the request object.

Recommended files:

- `workers/src/types/admin-sync-request.ts`
- `workers/src/services/admin-sync-request-repository.ts`

The request object is exactly:

```ts
interface AdminSyncRequest {
  schema: 1
  requestId: string
  requestedAt: string
  kind: 'sync-now'
}
```

Repository behavior:

- writes only the fixed key `ops/sync-request.json`;
- accepts no caller-supplied key;
- writes UTF-8 JSON with exactly the four fields above;
- sets `httpMetadata.contentType` to `application/json`;
- sets `httpMetadata.cacheControl` to `private, no-cache`;
- validates before R2 write:
  - `requestId` matches `/^[0-9a-f]{32}$/`;
  - `requestedAt` is canonical Worker ISO with milliseconds
    (`new Date(...).toISOString() === requestedAt`);
  - `kind === 'sync-now'`;
  - no extra fields are written;
- maps R2 failures to a sanitized fixed error, for example
  `sync request write failed`, with no key, bucket, request ID, timestamp, or
  underlying message.

Do not read, list, delete, or inspect R2 objects in this handoff.

### Route Behavior

Add:

```text
POST /admin/sync/request
```

Route order:

- mounted under the existing `admin.use('*', guard)`;
- placed before `admin.all('*', ...)`;
- no public or viewer route changes.

Processing order must be:

1. existing admin guard;
2. strict `isSameOrigin`;
3. existing `isFormContentType`;
4. strict form parsing with `parseBody({ all: true })`;
5. generate `requestId`;
6. call `clock().toISOString()` for `requestedAt`;
7. repository write;
8. `303 Location: /admin/sync` with `Cache-Control: no-store`.

Form validation:

- Content-Type must be accepted by the existing admin `isFormContentType`
  helper;
- body must contain exactly one field:
  - `kind=sync-now`;
- missing, repeated, file-valued, extra, or wrong-value fields return
  `400 Bad Request` with `Cache-Control: no-store`;
- input values are never reflected.

Failure behavior:

| Condition | Response | Side effects |
|---|---|---|
| auth failure | existing 403 no-store | no body parse, no clock, no repository |
| Origin missing/null/mismatch | 403 no-store | no body parse, no clock, no repository |
| Content-Type invalid | 400 no-store | no body parse, no clock, no repository |
| form invalid | 400 no-store | no request ID, no clock, no repository |
| request ID generation failure | 500 no-store | no clock, no repository |
| clock/toISOString failure | 500 no-store | no repository |
| repository/R2 failure | 500 no-store | sanitized body only |
| success | 303 no-store, empty body | writes one fixed R2 object |

Use `crypto.randomUUID().replaceAll('-', '')` for `requestId`.

Important: route tests must prove clock and repository are not called before all
cheap validation succeeds.

### Admin Page

Do not add a visible "Sync Now" button yet.

Reason: the Docker consumer is not implemented in this handoff, so exposing a
button would create request objects that production cannot handle yet.

`GET /admin/sync` may remain visually unchanged. It may link or mention no
manual request control.

### Wiring

Wire the repository through `AdminRouteDeps` and `workers/src/index.tsx` using
the existing `PHOTO_BUCKET` binding.

The route must fail closed with sanitized `500` if the binding/repository write
fails. Do not add explicit binding-detection branches that reveal configuration
state.

### Documentation

Update `workers/README.md` only.

Document:

- `POST /admin/sync/request`;
- it writes `ops/sync-request.json` to private R2;
- it is admin-only and validates exact `kind=sync-now` form input;
- Docker consumption is not implemented yet in this phase;
- no visible admin button is exposed yet.

Do not update Fable documents in this handoff. Codex will update durable state
after review.

## Files To Inspect

- `AGENTS.md`
- `CLAUDE.md`
- `FABLE.md`
- `docs/decisions/2026-06-25-sync-request-controls.md`
- `docs/fable/current-state.md`
- `docs/fable/progress.md`
- `workers/src/routes/admin.tsx`
- `workers/src/index.tsx`
- `workers/src/services/admin-sync-status-repository.ts`
- `workers/src/types/admin-sync-status.ts`
- `workers/src/types/env.ts`
- `workers/test/admin-routes.test.ts`
- `workers/test/admin-sync-status-repository.test.ts`
- `workers/README.md`

## Files To Edit

- `workers/src/types/admin-sync-request.ts`
- `workers/src/services/admin-sync-request-repository.ts`
- `workers/src/routes/admin.tsx`
- `workers/src/index.tsx`
- `workers/test/admin-sync-request-repository.test.ts`
- `workers/test/admin-routes.test.ts`
- `workers/README.md`

If implementation requires editing files outside this list, stop and report why
before editing.

## Constraints

- Preserve all existing viewer security behavior.
- Preserve all existing admin auth behavior.
- Do not add dependencies.
- Do not add D1 migrations.
- Do not change Docker code.
- Do not implement request polling, deletion, stale handling, pending display,
  or sync execution.
- Do not add a visible button/form to `GET /admin/sync` yet.
- Do not call Cloudflare APIs, R2, Docker, Portainer, PhotoPrism, NAS, or any
  production service during tests.
- Do not log or render request IDs, timestamps, admin email, Access claims, R2
  keys, bucket names, R2 errors, secrets, PhotoPrism data, album titles, or
  source photo data.
- Request object content is allowed only inside the R2 `put` test double; it
  must not appear in HTML or error responses.
- Keep tests isolated with fakes/mocks.
- Keep edits narrow and consistent with existing admin mutation patterns.

## Non Goals

- No Docker request reader.
- No `R2ObjectStore.get` or `delete`.
- No pending request indicator.
- No status schema 2.
- No visible "Sync Now" button.
- No D1 operational state table.
- No Cloudflare Queue or Durable Object.
- No production operation.
- No deployment.
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
- exact request object schema and fixed R2 key;
- request ID and timestamp generation behavior;
- R2 `put` metadata (`Content-Type`, `Cache-Control`);
- route behavior for auth/origin/content-type/form/request-id/clock/repo
  failure and success;
- proof that no visible button was added;
- proof that forbidden data is not rendered, logged, or included in responses;
- verification command results;
- skipped checks with exact reasons;
- any out-of-scope edits or design questions.
