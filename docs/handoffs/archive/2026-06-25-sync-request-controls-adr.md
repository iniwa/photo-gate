Read AGENTS.md, CLAUDE.md, and this handoff file before implementation.
If implementation would violate constraints or require files outside this
handoff, stop and ask before editing.

## Goal

Create a design ADR for manual sync request controls.

This is a documentation/design handoff only. Do not implement the feature yet.
The goal is to decide the safest architecture for an admin-initiated sync
request after the already-reviewed read-only `/admin/sync` status work.

The ADR must be concrete enough that Codex can create a follow-up implementation
handoff without re-litigating the protocol, schema, failure behavior, or security
boundaries.

Claude Code may use Sonnet subagents for inspection and drafting, but the
primary coordinator must review the final ADR against the non-negotiable
invariants before reporting.

## Background

Current state:

- Docker `sync-daemon` runs on the Raspberry Pi and owns PhotoPrism/NAS access,
  image generation, manifest upload, and the scheduled sync loop.
- Workers own viewer/admin HTTP routes, D1 auth/authorization, and private R2
  reads/writes through bindings.
- Workers must not access PhotoPrism, NAS, Docker, Portainer, or the Docker
  socket.
- Docker must not implement viewer authentication, viewer pages, or D1
  authorization.
- R2 is private and is already the only cross-component bridge used by both
  Docker and Workers.
- Read-only sync status is implemented:
  - Docker publishes sanitized status to `ops/sync-status.json`.
  - Worker admin page `GET /admin/sync` reads that fixed key.
  - There is no manual trigger, queue, POST route, or sync request protocol yet.

The remaining roadmap item is "sync request/status administration"; status is
done, request controls remain.

This feature spans two trust boundaries:

1. Admin browser -> Worker admin POST.
2. Worker -> private R2 -> Docker daemon.

Because a bad design can cause repeated syncs, replay, stale request execution,
credential exposure, or a hidden dependency from Worker to Docker/PhotoPrism,
write the ADR first.

## Acceptance Criteria

Create:

- `docs/decisions/2026-06-25-sync-request-controls.md`

The ADR must include the following sections.

### 1. Context

Explain:

- what is already implemented for `/admin/sync` status;
- why manual sync request controls are useful;
- why Workers cannot call PhotoPrism, NAS, Docker, Portainer, or the Docker
  socket directly;
- why Docker cannot depend on D1/admin auth state;
- why private R2 is the preferred bridge unless the ADR explicitly rejects it
  with a stronger alternative.

### 2. Decision

Choose one concrete design.

The expected default is an R2-backed single pending request object, but the ADR
must justify the choice:

```text
ops/sync-request.json
```

At minimum, decide:

- whether the Worker writes a fixed private R2 object for a manual request;
- whether Docker polls that object from the daemon loop;
- whether Docker deletes, overwrites, or leaves the request object after
  handling;
- whether Docker acknowledges handled requests through `ops/sync-status.json`,
  a second fixed object, or local daemon state;
- how duplicate requests and stale requests are handled;
- how an in-progress scheduled sync interacts with a manual request;
- whether the first implementation is single-album only or future-compatible
  with multiple albums.

If the ADR chooses anything other than fixed private R2 objects, it must explain
why that alternative is safer and how it preserves all existing boundaries.

### 3. Request Schema

Define a versioned request JSON schema.

The schema must avoid secrets and unnecessary identity data. Do not include
admin email, Access claims, browser details, IP address, PhotoPrism UID, album
title, R2 credentials, object key lists, or raw status JSON.

Recommended starting point:

```json
{
  "schema": 1,
  "requestId": "safe-id-or-random-token",
  "requestedAt": "2026-06-25T00:00:00.000Z",
  "kind": "sync-now"
}
```

The ADR must decide:

- exact fields;
- allowed values;
- timestamp format;
- request ID format and length;
- whether `albumId` is included now or deferred;
- maximum object size;
- exact validation behavior on Worker write and Docker read.

### 4. Worker Admin Behavior

Specify the future Worker behavior without implementing it.

Include:

- future route name, recommended `POST /admin/sync/request`;
- existing `requireAdmin` guard remains first;
- strict same-origin Origin check;
- exact `application/x-www-form-urlencoded` Content-Type rule;
- exact form fields, if any;
- when request IDs and timestamps are generated;
- R2 write behavior and fixed key;
- success response, recommended `303 Location: /admin/sync`;
- failure responses and sanitized error policy;
- no display, storage, or logging of admin email/Access claims/request body
  values beyond what the ADR explicitly permits.

### 5. Docker Daemon Behavior

Specify the future Docker behavior without implementing it.

Include:

- how often the daemon checks for a request;
- whether checking happens only while sleeping between scheduled runs or also
  during heartbeat;
- how the daemon behaves when a sync is already running;
- how it validates the request object before acting;
- how it determines "already handled" to prevent replay after restart;
- where the last handled request ID/timestamp is recorded;
- how request handling affects `runsCompleted`, `lastResult`,
  `consecutiveFailures`, and Docker HEALTHCHECK;
- how status publication reports a manual request without leaking data;
- what happens when R2 request read/write/delete fails.

### 6. Failure And Replay Model

Define fail-closed behavior for:

- missing request object;
- malformed request JSON;
- unknown `schema`;
- stale request;
- duplicate `requestId`;
- future `requestedAt`;
- request while a sync is running;
- Worker R2 write failure;
- Docker R2 read failure;
- Docker restart after a request was already handled;
- clock skew between Worker and Docker;
- status publish failure.

The design must avoid an infinite sync loop caused by a persistent request
object.

### 7. Security And Privacy

Prove that the design preserves:

- normal viewing uses Workers, D1, and private R2 only;
- shared users never access PhotoPrism or NAS;
- Workers do not access PhotoPrism, NAS, Docker, Portainer, or local files;
- Docker does not implement viewer auth, viewer pages, or D1 authorization;
- R2 remains private;
- secrets are not stored in request/status objects or logs;
- PhotoPrism UID/title/token/URL and source photo data are not exposed;
- admin email/Access claims are not persisted or rendered unless the ADR
  explicitly justifies a safer alternative;
- errors are sanitized.

### 8. Operational Notes

Document:

- how an operator can tell a manual request was accepted and later handled;
- how the read-only `/admin/sync` page should evolve to show manual-request
  state;
- how the protocol behaves when R2 credentials are broken;
- what manual recovery looks like if a bad request object is present;
- why no Cloudflare Queue, Durable Object, D1 table, Portainer API, or Docker
  socket is being introduced in the first implementation.

### 9. Follow-Up Implementation Plan

End the ADR with a concrete phased implementation plan:

1. Worker-only request writer and tests.
2. Docker request reader/handler and tests.
3. Status page additions.
4. Documentation and deployment/smoke steps.

For each phase, list likely files to edit and core tests to add. This is a
planning section only; do not edit those implementation files in this handoff.

## Files To Inspect

- `AGENTS.md`
- `CLAUDE.md`
- `FABLE.md`
- `docs/fable/project-context.md`
- `docs/fable/current-state.md`
- `docs/fable/roadmap.md`
- `docs/fable/progress.md`
- `docs/decisions/2026-06-12-native-sync-scheduler-and-health.md`
- `docs/handoffs/archive/2026-06-25-admin-sync-status.md`
- `docker/src/photo_gate/main.py`
- `docker/src/photo_gate/sync_status.py`
- `docker/src/photo_gate/r2_store.py`
- `docker/src/photo_gate/object_store.py`
- `workers/src/routes/admin.tsx`
- `workers/src/services/admin-sync-status-repository.ts`
- `workers/README.md`
- `docker/README.md`

## Files To Edit

- `docs/decisions/2026-06-25-sync-request-controls.md`

Do not edit code, tests, package files, lockfiles, Fable state, operations
docs, archived handoffs, or this handoff.

If the design cannot be completed without editing another file, stop and report
the reason before editing.

## Constraints

- Design only; no implementation.
- Preserve all non-negotiable invariants in `AGENTS.md`.
- Do not add dependencies.
- Do not add D1 migrations.
- Do not introduce public R2 access.
- Do not introduce Workers-to-PhotoPrism, Workers-to-NAS, Workers-to-Docker,
  Workers-to-Portainer, or Workers-to-Docker-socket access.
- Do not introduce Docker-to-D1/admin-auth dependencies.
- Do not include or invent real secrets, real user IDs, real album IDs, real
  PhotoPrism UIDs, real tokens, bucket credentials, or production object
  contents.
- Do not call Cloudflare, R2, Portainer, PhotoPrism, NAS, Docker, or production
  services.
- Keep the ADR concrete and implementation-ready. Avoid vague alternatives
  without a decision.
- Use ASCII unless the surrounding document requires otherwise.

## Non Goals

- No code changes.
- No tests.
- No Worker route implementation.
- No Docker daemon implementation.
- No schema migration.
- No R2 object mutation.
- No production operation.
- No deployment.
- No commit or push.
- No handoff archival.
- No Fable document updates.
- No R2 cleanup design.
- No album creation/deletion design.

## Verification

Run:

```powershell
git diff --check
git status --short
```

Also run targeted text checks:

```powershell
rg -n "ops/sync-request.json|POST /admin/sync/request|PhotoPrism|Portainer|Docker socket|admin email|Access claims" docs/decisions/2026-06-25-sync-request-controls.md
```

Do not run Workers or Docker test suites for this documentation-only handoff
unless you changed code by mistake. If code changed, stop and report.

## Expected Report

Report:

- changed files;
- the chosen request transport and exact fixed key, if any;
- request schema fields and validation rules;
- Worker future behavior summary;
- Docker future behavior summary;
- replay/duplicate/stale request handling;
- how the design prevents infinite sync loops;
- security/privacy proof;
- follow-up implementation phases;
- verification command results;
- any skipped checks with exact reasons;
- any design questions that remain unresolved.
