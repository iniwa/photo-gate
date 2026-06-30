# Admin Hard Delete Controls

Date: 2026-06-30

## 1. Context

### What exists today

The admin surface at `/admin` is protected by Cloudflare Access JWT validation
and the admin email allowlist (`requireAdmin` middleware). The following
management operations are implemented:

- User: create, password reset, display-name update, enable, disable.
- Album: create (D1 row only, `enabled = 0`), public metadata update,
  enable, disable.
- Permission: grant/revoke with dropdown-based assignment UI.
- Sync-target: upsert and remove browser-owned `ops/sync-targets.json`
  entries via Worker read-modify-write of private R2.
- R2 cleanup: read-only orphan dry-run report (`GET /admin/r2-cleanup`).
- R2 cleanup deletion-preview (Phase 2): HMAC-signed confirmation and
  deletion-preview flow; actual R2 deletion remains disabled until explicitly
  authorized.

Disable is the currently implemented safe path for retiring users and albums.
Hard delete for users and albums is deferred to separate implementation
handoffs. This ADR decides the design and constraints for those future
hard-delete flows.

### The problem this ADR solves

Disable is sufficient for most operator actions. However, an operator may
occasionally need to permanently remove a user or album row from D1 — for
example, to clean up test accounts, or to retire an album that has no further
use. This ADR decides:

- when hard delete is permitted and what guards are required;
- what D1 rows and cascades are in scope;
- how sync-target entries in `ops/sync-targets.json` are handled for album
  hard delete;
- what the multi-step browser confirmation flow must look like;
- what data may and must not be displayed during confirmation;
- how race conditions and missing targets are handled;
- the phased implementation path.

### Non-negotiable invariants (from AGENTS.md)

The following invariants constrain every decision in this ADR and must not be
weakened in any future implementation derived from it:

- Workers never access PhotoPrism, NAS, Docker, or Portainer.
- Docker does not read D1 or implement viewer/admin authorization.
- Private R2 remains private and is never made publicly accessible.
- R2 deletion requires explicitly approved human action and a separately
  reviewed handoff; this ADR does not authorize R2 deletion.
- `photoprism_album_uid`, password hashes, session tokens, and NAS source
  identifiers are never selected or rendered in any admin page, response, or
  log line.
- Every admin mutation route is guarded by `requireAdmin` and a same-origin
  check.
- Secrets and real local configuration are never committed or printed.

---

## 2. Decisions

### 2.1 User Hard Delete Policy

**Decided: disable remains the normal safe path. Hard delete is allowed only
behind a separate multi-step confirmation, after an explicit Codex-authored
implementation handoff. When executed, it deletes the D1 `users` row and
relies on existing foreign-key cascades. R2 is never touched.**

**Disable (normal path)**: `POST /admin/users/disable` sets `enabled = 0`.
A disabled user cannot log in because the login route checks `enabled`.
Existing sessions are not invalidated explicitly; each session-authenticated
request re-reads the user row and checks `enabled`, so the disable takes
effect immediately on the next request without a session sweep. The operator
can re-enable the user at any time.

**Hard delete (deferred)**:

A future `POST /admin/users/delete` route, if implemented, must:

- be guarded by `requireAdmin`, the same-origin check, and a valid
  `Content-Type: application/x-www-form-urlencoded` assertion;
- accept only a single `userId` from the browser;
- re-read the user row from D1 immediately before any delete to confirm the
  target still exists and matches the user's Step 1 summary;
- execute exactly one D1 statement: `DELETE FROM users WHERE id = ?`;
- rely on `ON DELETE CASCADE` already defined on `sessions.user_id` (migration
  `0001_users_sessions.sql`) to remove all session rows;
- rely on `ON DELETE CASCADE` already defined on
  `album_permissions.user_id` (migration `0002_albums_permissions.sql`) to
  remove all album permission rows;
- never write to, read keys from, or list R2 (users carry no R2 state);
- never call `R2Bucket.delete()` or `R2Bucket.put()` because users carry no R2 state;
- never select `password_hash`, `session tokens`, or `photoprism_album_uid`
  from D1 at any point during the confirmation or delete flow;
- require a two-step browser confirmation as described in Section 2.4.

**D1 cascade behavior**:

| Table | Cascade behavior on `DELETE FROM users WHERE id = ?` |
|-------|------------------------------------------------------|
| `sessions` | All rows where `user_id = deletedUserId` are deleted by `ON DELETE CASCADE`. |
| `album_permissions` | All rows where `user_id = deletedUserId` are deleted by `ON DELETE CASCADE`. |
| `albums` | Not affected. Albums belong to no specific user in the schema. |

**Session behavior after delete**: because `sessions.user_id` cascades, all
active sessions for the deleted user are removed from D1 immediately. Any
in-flight request using a token from one of those sessions will fail at the
session lookup and be treated as unauthenticated.

**What is never rendered**: password hash, raw session tokens, fail count
beyond what is already shown in the user list, `locked_until` raw value,
`photoprism_album_uid`, R2 keys, bucket name, SQL text, stack traces.

### 2.2 Album Hard Delete Policy

**Decided: disable/depublish remains the normal safe path. Hard delete is
allowed only behind a separate multi-step confirmation, after an explicit
Codex-authored implementation handoff. When executed, it removes the matching
sync-target entry from `ops/sync-targets.json` first, then deletes the D1
`albums` row and relies on existing foreign-key cascades. R2 objects are not
deleted; they become orphaned and are handled by the separate R2 cleanup
process.**

**Disable (normal path)**: `POST /admin/albums/disable` sets `enabled = 0`.
A disabled album is not viewer-visible; no user can load its photos. R2
objects remain in place and can be served again if the album is re-enabled.

**Hard delete (deferred)**:

A future `POST /admin/albums/delete` route, if implemented, must:

- be guarded by `requireAdmin`, the same-origin check, and a valid
  `Content-Type: application/x-www-form-urlencoded` assertion;
- accept only a single `albumId` from the browser;
- follow the sync-target pre-check described in Section 2.3 before any D1
  delete;
- re-read the album row from D1 immediately before deletion to confirm the
  target still exists and matches the operator's Step 1 summary;
- execute exactly one D1 statement: `DELETE FROM albums WHERE id = ?`;
- rely on `ON DELETE CASCADE` already defined on
  `album_permissions.album_id` (migration `0002_albums_permissions.sql`) to
  remove all permission rows for the album;
- never call `R2Bucket.delete()` or `R2Bucket.put()` for any R2 object under
  the album's prefix;
- never select `photoprism_album_uid` from D1 at any point during the
  confirmation or delete flow;
- require a two-step browser confirmation as described in Section 2.4.

**R2 objects after album hard delete**: R2 objects under
`albums/<albumId>/` are NOT deleted. They become orphaned prefixes, visible
in `GET /admin/r2-cleanup`, and may be cleaned up through the separate R2
cleanup deletion flow (which itself requires explicit human approval per
`docs/decisions/2026-06-30-r2-cleanup-deletion-controls.md`).

**D1 cascade behavior**:

| Table | Cascade behavior on `DELETE FROM albums WHERE id = ?` |
|-------|-------------------------------------------------------|
| `album_permissions` | All rows where `album_id = deletedAlbumId` are deleted by `ON DELETE CASCADE`. |
| `users` | Not affected. |
| `sessions` | Not affected directly; users who had access via the deleted permission rows retain valid sessions but lose access when any subsequent album authorization check returns not-found. |

### 2.3 Sync-Target and Docker Boundary Decision

**Decided: album hard delete must remove the matching browser-owned sync-target
entry from `ops/sync-targets.json` in the same admin workflow before
deleting the D1 album row, or fail closed if the sync-target update cannot be
completed. If no matching sync-target entry exists, album hard delete may
proceed after confirmation.**

**Why**: Docker reads `ops/sync-targets.json` to resolve sync targets. If the
D1 `albums` row is deleted before the sync-target entry is removed, Docker may
continue to read the entry and attempt to sync an album that no longer exists in
D1. This would cause Docker to write R2 objects under a prefix with no D1 row
indefinitely, creating a steady stream of orphaned R2 objects with no automatic
recovery path. Removing the sync-target entry before the D1 delete prevents
Docker from discovering the target on the next sync cycle.

**Implementation boundary**: `ops/sync-targets.json` is a Worker-owned private
R2 ops object. The Worker already performs read-modify-write on it via the
existing sync-target upsert and remove routes. Updating it during album hard
delete is the same Worker R2 operation class and does not cross any system
boundary. This is not Docker access, PhotoPrism access, NAS access, or
Portainer access.

**Ordered steps in the hard-delete handler** (if implemented):

1. Re-read the album row from D1 to confirm the target exists and matches
   the operator's Step 1 summary.
2. Read `ops/sync-targets.json` from private R2.
3. If a sync-target entry exists for `albumId`, compute the updated object
   with the entry removed and write it back to R2. Fail closed with `500` if
   the R2 read or write fails.
4. Execute `DELETE FROM albums WHERE id = ?` in D1. Fail closed with `500`
   if the D1 delete fails.
5. Return a success confirmation page showing counts only (no R2 keys, no
   album titles, no `photoprism_album_uid`).

**If sync-target entry is absent**: after reading the current sync-target file, skip
the write-back and proceed directly to step 4. Document in the Step 1 summary
that no sync-target entry was found.

**If the D1 delete fails after the sync-target was removed** (partial
failure): the sync-target entry is already gone; Docker will not attempt to
sync the album. The D1 album row still exists so existing sessions and
permissions remain intact. The operator may retry the album hard delete. This
failure mode leaves the system in a degraded-but-consistent state: the album
is inaccessible to sync but still exists in D1. The operator must re-add the
sync-target entry manually via the sync-target upsert route if they want to
restore sync before deciding to retry the delete.

**Why not require prior sync-target removal from the operator**:
Requiring the operator to manually remove the sync-target entry before
initiating album hard delete is an error-prone human step. The Worker can
perform this within the same guarded delete workflow. Making the Worker
responsible for sync-target removal is safer.

**Why not block album hard delete if a sync-target exists**:
Blocking rather than removing would force the operator to navigate away from
the hard-delete flow to remove the sync target, then return to complete the
delete. This adds unnecessary friction and increases the chance the operator
deletes the D1 row without removing the sync target (e.g., if they forget to
return). Automatic removal in the same request is both safer and simpler.

**Docker does not read D1**: Docker cannot and must not be given D1
credentials. Docker reads only `ops/sync-targets.json` from private R2 to
resolve targets. Removing the sync-target entry before the D1 delete is
sufficient to prevent Docker from recreating orphaned R2 content.

**Workers do not call Docker, Portainer, PhotoPrism, or NAS**: the sync-target
update is a Worker R2 operation only. No call to an external service is made.

### 2.4 Confirmation UI Model

**Decided: no-JavaScript, server-side two-step HTML form flow with an HMAC-
signed fingerprint token and a required exact typed phrase.**

The confirmation model mirrors the design in
`docs/decisions/2026-06-30-r2-cleanup-deletion-controls.md` to maintain
consistent security properties across all destructive admin workflows.

**Step 1 — Target summary (preview)**:

- A `POST /admin/users/confirm-delete` or `POST /admin/albums/confirm-delete`
  route (exact paths to be decided in the implementation handoff).
- The route re-reads the target from D1 immediately. If the target is not
  found, render a "Target not found" error page with no delete option.
- The response is an HTML page (no JavaScript required) showing the target
  summary (see Section 2.5) and a plain-English irreversibility warning.
- The page includes a hidden HMAC-SHA-256 signed fingerprint token encoding
  the stable target ID, a timestamp, and a TTL (15 minutes). The token is
  opaque to the browser.
- The page displays the exact typed phrase the operator must enter in Step 2.
- The form action POSTs to the Step 2 route.

**Step 2 — Typed confirmation and delete**:

- A `POST /admin/users/delete` or `POST /admin/albums/delete` route.
- The route validates the HMAC token (signature, schema, TTL, target ID
  binding).
- The route validates the typed confirmation phrase (exact match; case-
  sensitive; no trimming). Mismatch returns an error page with no delete.
- The route re-reads the target from D1 to confirm the target still exists
  and matches the token's target ID. If absent or changed, fail closed.
- For album delete: check and update sync-target before the D1 delete
  (Section 2.3).
- Execute the D1 delete.
- Return a sanitized success or error page.

**What the browser must not supply**: destructive target facts beyond the
stable ID (`userId` or `albumId`). Object counts, album titles, display names,
sync-target contents, R2 keys, and `photoprism_album_uid` must not be form
fields; they are re-derived by the server on every step.

**HMAC token structure** (matches pattern established in R2 cleanup controls):

```
base64url(JSON(payload)).base64url(hmac_sha256_signature)
```

Payload fields:

```json
{
  "schema": 1,
  "issuedAt": <ms>,
  "expiresAt": <ms>,
  "category": "user-delete" | "album-delete",
  "targetId": "<userId or albumId>"
}
```

A new Worker secret `HARD_DELETE_HMAC_KEY` (minimum 32 characters) must be
registered before the Phase 3 or Phase 4 implementation handoff. If the key
is absent or shorter than 32 characters, the route must fail closed with 500.

**Typed confirmation phrases**:

| Operation | Required typed phrase |
|-----------|-----------------------|
| User hard delete | `DELETE USER` |
| Album hard delete | `DELETE ALBUM` |

### 2.5 Candidate Summary / Displayed Data

**Step 1 for user delete may display**:

- User ID (the stable primary key, already shown in the user list).
- Display name (safe, non-sensitive label already shown in the user list).
- Enabled state (`enabled = 1` or `enabled = 0`).
- A warning that all active sessions will be removed (session count may be
  shown if it does not expose session token material).
- A warning that all album permissions will be removed (permission count may
  be shown).

**Step 1 for album delete may display**:

- Album ID (the stable primary key, already shown in the album list).
- Title (safe, non-sensitive label already shown in the album list; allowed
  because it is operator-entered display text, not a sensitive source
  identifier).
- Enabled state.
- Whether a sync-target entry exists for this album (yes/no; no entry content).
- A warning that R2 objects will NOT be deleted and will remain orphaned.
- A warning that the sync-target entry (if present) will be removed from
  `ops/sync-targets.json` before the D1 delete.

**What must never be displayed in any step, page, error message, or log**:

- Password hashes.
- Session tokens or session token hashes.
- `photoprism_album_uid`.
- R2 object keys (any key below the album prefix level, e.g.,
  `thumbs/<photoId>.webp`).
- R2 bucket name, R2 access key, R2 secret key, R2 endpoint URL.
- Cloudflare account ID, D1 database ID, API tokens.
- Access JWT claims or user email addresses (other than the admin's own, which
  Cloudflare Access controls).
- SQL query text, SQL error messages.
- Stack traces or Worker internal paths.
- Contents of `ops/sync-targets.json` beyond a yes/no presence indicator.
- PhotoPrism URLs, PhotoPrism tokens, NAS paths.

### 2.6 Missing Target and Race Behavior

All ambiguous conditions must fail closed. No destructive action may proceed
when the target's state is uncertain.

| Scenario | Behavior |
|----------|----------|
| Target deleted between Step 1 and Step 2 | Step 2 re-reads the target; if absent, render "Target not found — no action taken". Do not treat as success. |
| Target `display_name` or `title` changed between Step 1 and Step 2 | Step 2 re-reads but the token encodes only the `targetId`, not the display text. Proceed normally; the changed display field does not affect delete safety. Render updated values on the result page. |
| Target `enabled` state changed between Step 1 and Step 2 | Proceed. `enabled` state does not affect whether hard delete is permitted. |
| Sync-target entry removed externally between Step 1 and Step 2 | For album delete: re-read `ops/sync-targets.json` in Step 2. If the entry is absent, skip the sync-target write and proceed to D1 delete. |
| Sync-target entry added externally between Step 1 and Step 2 | Step 2 always reads the current sync-targets file. The new entry will be detected and removed before D1 delete. |
| HMAC token expired (TTL exceeded) | Return "Confirmation expired — please start again." No delete. |
| HMAC token tampered or signature invalid | Return 400. No delete. |
| Typed phrase mismatch | Return "Confirmation phrase did not match." No delete. |
| R2 read or write failure during sync-target update | Fail closed with 500. No D1 delete. |
| D1 delete failure | Return 500 with sanitized message. No retry is attempted automatically. |

### 2.7 Route Structure and Security Guards

Every new route derived from this ADR must:

- be mounted inside `createAdminRoutes` and inherit the `requireAdmin` guard;
- enforce the same-origin check (Origin header must exactly match the request
  origin; absent or `"null"` Origin → 403);
- enforce `Content-Type: application/x-www-form-urlencoded` for POST routes;
- use `parseBody({ all: true })` and reject any extra form fields beyond the
  declared schema;
- carry `Cache-Control: no-store` on every response including errors;
- not call `R2Bucket.delete()` or `R2Bucket.put()` for album assets during
  Phase 2 (preview-only) routes;
- not execute any D1 `DELETE` or `UPDATE` during Phase 2 routes.

---

## 3. Recommended Implementation Phases

### Phase 1 — ADR Only (this document)

Design is decided. No code is written. No production change occurs. No
secrets are registered. No commits, pushes, or deployments occur.

This ADR must be reviewed by Codex before any implementation begins.

### Phase 2 — Delete-Preview UI (no D1 DELETE)

**Goal**: build the two-step confirmation HTML flow for both user delete and
album delete without wiring any D1 delete or R2 delete calls.

New files:

- `workers/src/services/admin-hard-delete-token.ts`: HMAC-SHA-256 token
  signing and verification functions for `user-delete` and `album-delete`
  categories. Mirrors the pattern in `admin-r2-cleanup-delete-token.ts`.
- `workers/src/routes/admin-hard-delete.tsx`: handlers for
  `POST /admin/users/confirm-delete`, `POST /admin/users/delete`,
  `POST /admin/albums/confirm-delete`, `POST /admin/albums/delete` — all
  stubs that validate guards and render "deletion not yet enabled" after
  successful token and typed-phrase validation.
- `workers/test/admin-hard-delete-token.test.ts`: unit tests for token
  signing and verification.
- `workers/test/admin-hard-delete.test.ts`: route integration tests per
  Section 4.

Edited files:

- `workers/src/routes/admin.tsx`: mount Phase 2 routes; add confirm-delete
  buttons on user and album detail/list pages, visible only when appropriate.
- `workers/src/types/env.ts`: add `HARD_DELETE_HMAC_KEY?: string`.
- `workers/README.md`: document the four new routes.

Acceptance: confirmation forms render with correct summaries; typed-phrase and
token validation reject mismatches; no D1 DELETE or R2 delete call exists in
any handler; all prohibitions in Section 2.5 are met; tests pass.

Production actions, commits, pushes, and secret registration are NOT
authorized by the Phase 2 implementation handoff alone.

### Phase 3 — User Hard Delete (if approved)

**Prerequisite**: Phase 2 deployed and reviewed by Codex and the operator.
`HARD_DELETE_HMAC_KEY` secret registered in the Worker environment. Explicit
operator request in the Phase 3 handoff.

**Goal**: wire D1 `DELETE FROM users WHERE id = ?` into
`POST /admin/users/delete` for the authenticated, token-validated, phrase-
confirmed path. No R2 delete.

Edited files:

- `workers/src/routes/admin-hard-delete.tsx`: replace the user-delete stub
  with the D1 delete after re-read and validation.
- `workers/test/admin-hard-delete.test.ts`: add mutation tests.

Acceptance: D1 delete executed only when all guards pass; cascade removes
sessions and permissions; no R2 delete; no sensitive data in responses; all
race behaviors pass; tests pass.

### Phase 4 — Album Hard Delete (if approved)

**Prerequisite**: Phase 3 reviewed (or Phase 2 if user delete is not needed
first). Explicit operator request in the Phase 4 handoff. Operator has
reviewed `GET /admin/r2-cleanup` and understands that R2 objects will remain
orphaned.

**Goal**: wire the sync-target update and D1 `DELETE FROM albums WHERE id = ?`
into `POST /admin/albums/delete` for the authenticated, token-validated, phrase-
confirmed path. No R2 delete.

Edited files:

- `workers/src/routes/admin-hard-delete.tsx`: replace the album-delete stub
  with the sync-target R2 read-modify-write followed by D1 delete.
- `workers/test/admin-hard-delete.test.ts`: add mutation tests.

Acceptance: sync-target entry removed before D1 delete; D1 delete executed
only when all guards pass; cascade removes album permissions; no R2 delete;
orphaned prefix visible in `GET /admin/r2-cleanup` report after delete; no
sensitive data in responses; all race behaviors pass; tests pass.

### Phase 5 — Documentation, Deployment, Smoke

**Goal**: confirm production deletion behaved as expected; update Fable docs
and operations log.

- Run `GET /admin/r2-cleanup` after album hard delete to confirm the former
  album's prefix now appears as an orphan.
- Record the action in `docs/operations/deploy-log.md` (category, target type,
  timestamp; no IDs or sensitive data).
- Update `docs/fable/current-state.md` and `docs/fable/progress.md`.
- Archive completed handoffs.

Production actions, commits, and deployments are authorized only by the
explicit Phase 5 handoff.

---

## 4. Verification Expectations for Future Implementation

The Phase 2, Phase 3, and Phase 4 implementation handoffs must include tests
for all of the following.

### Authentication and Authorization

| Test | What it checks |
|------|----------------|
| Unauthenticated POST to confirm-delete routes | 403 via `requireAdmin`; no body. |
| Unauthenticated POST to delete routes | 403 via `requireAdmin`; no body. |
| Non-admin authenticated POST | 403; email not in allowlist. |
| All responses carry `Cache-Control: no-store` | Success, error, and rejection responses. |

### Same-Origin and Request Validation

| Test | What it checks |
|------|----------------|
| Origin header absent | 403. |
| Origin header `"null"` | 403. |
| Origin header cross-origin | 403. |
| POST without `application/x-www-form-urlencoded` | 400. |
| Extra form fields | Rejected or silently ignored; no delete occurs. |
| Missing required field (`userId` or `albumId`) | 400. |

### HMAC Token Validation (delete routes)

| Test | What it checks |
|------|----------------|
| `HARD_DELETE_HMAC_KEY` absent from env | 500; no delete. |
| `HARD_DELETE_HMAC_KEY` shorter than 32 chars | 500; no delete. |
| Malformed token (no dot separator) | 400; no delete. |
| Expired token | Error page; no delete. |
| Tampered token (signature modified) | Error page; no delete. |
| Wrong category in token (e.g., `album-delete` submitted to user-delete route) | Error page; no delete. |
| Token targeting a different ID than the submitted `userId`/`albumId` | Error page; no delete. |

### Typed Phrase Validation

| Test | What it checks |
|------|----------------|
| Wrong phrase | Error page; no delete. |
| Wrong case | Error page; no delete. |
| Empty phrase | Error page; no delete. |
| Correct phrase + valid token | Proceeds to re-read phase. |

### Target Re-Read and Race Behavior

| Test | What it checks |
|------|----------------|
| Target absent at delete time | "Target not found" error; no delete. |
| Target exists but `targetId` in token does not match submitted ID | Error; no delete. |
| D1 re-read failure | 500; no delete; no sensitive detail in response. |

### Sync-Target Handling (album delete only)

| Test | What it checks |
|------|----------------|
| Sync-target entry absent | Skip R2 write; proceed to D1 delete. |
| Sync-target entry present | Remove entry; then D1 delete. |
| R2 read failure during sync-target check | 500; no D1 delete. |
| R2 write failure during sync-target update | 500; no D1 delete. |
| Sync-target entry added externally since Step 1 | Step 2 detects and removes it. |

### D1 CASCADE Assumptions (Phase 3 and 4)

| Test | What it checks |
|------|----------------|
| User delete removes `sessions` rows | Mock D1 confirms the cascade (or integration test confirms row absence). |
| User delete removes `album_permissions` rows | Same. |
| Album delete removes `album_permissions` rows | Same. |
| Album delete does not delete `users` or `sessions` rows | Same. |

### R2 Safety

| Test | What it checks |
|------|----------------|
| No `R2Bucket.delete()` for album asset keys in any phase | Mock verifies delete is not called on keys under `albums/`. |
| No `R2Bucket.put()` for album asset keys in any phase | Same. |
| Phase 2 stub routes contain no D1 DELETE | Stub handler returns preview page; no delete call in mock. |

### Sensitive Data Prohibition

| Test | What it checks |
|------|----------------|
| No password hash in any response | Confirm hash value does not appear in HTML. |
| No session token in any response | Same. |
| No `photoprism_album_uid` in any response | Same. |
| No R2 object key below album-prefix level in any response | Same. |
| No bucket name in any response | Same. |
| No SQL text in error response | D1 error does not leak query text. |
| No stack trace in error response | Worker exception does not leak a trace. |

---

## 5. Security Invariants Confirmed

### Workers never access PhotoPrism / NAS / Docker / Portainer

No route derived from this ADR contacts PhotoPrism, NAS, Docker, or Portainer.
All operations are D1 reads/deletes and private R2 reads/writes of the
Worker-owned `ops/sync-targets.json` object.

### Docker does not read D1

Docker has no role in hard delete. Docker reads `ops/sync-targets.json` to
determine sync targets. Removing the entry from `ops/sync-targets.json` before
D1 delete prevents Docker from reading a target whose D1 row no longer exists.

### photoprism_album_uid is write-only after album creation

`photoprism_album_uid` is never selected from D1 during the confirmation or
delete flow. It does not appear in any Step 1 summary, Step 2 confirmation, or
result page.

### Private R2 remains private

All R2 operations use the existing private `PHOTO_BUCKET` binding. No
pre-signed URL and no public-access change.

### R2 album assets are never deleted by hard delete

`R2Bucket.delete()` is never called on keys under `albums/<albumId>/` by the
user or album hard-delete routes. Orphaned R2 objects resulting from album hard
delete are handled only through the separately authorized R2 cleanup flow.

### Fail-closed behavior

Every ambiguous or error condition returns an error page or 500 with no delete.
The only paths that execute a D1 delete are those where all of the following
hold simultaneously:

- `requireAdmin` passed;
- same-origin check passed;
- `Content-Type` is correct;
- form body contains no unexpected fields;
- `HARD_DELETE_HMAC_KEY` is present and ≥ 32 characters;
- HMAC signature is valid;
- token is not expired;
- token `category` matches the route;
- token `targetId` matches the submitted ID;
- typed phrase matches exactly;
- D1 target re-read succeeds and target exists;
- for album delete: sync-target R2 operation succeeded (or entry was absent).

---

## 6. Relationship to R2 Cleanup

Album hard delete does not delete R2 objects. After an album is hard-deleted:

- The prefix `albums/<albumId>/` still exists in R2.
- `GET /admin/r2-cleanup` will classify it as `orphan` on the next run
  because no D1 `albums` row with that ID exists.
- The orphaned prefix may be cleaned up through the R2 cleanup deletion flow
  (`docs/decisions/2026-06-30-r2-cleanup-deletion-controls.md`), which
  requires its own multi-step confirmation and explicit human approval.

No code path in the user or album hard-delete routes interacts with the R2
cleanup route or its HMAC tokens. The two confirmation systems are independent.

The operator should understand:

1. After album hard delete, the R2 cleanup dry-run report will show the former
   album's prefix as an orphan.
2. Removing the orphaned R2 prefix requires a separate operator action through
   the R2 cleanup deletion flow.
3. Actual R2 deletion remains disabled until the R2 cleanup Phase 3 handoff
   is explicitly created and approved.

---

## 7. Non-Goals

- No R2 object deletion by user or album hard-delete routes.
- No R2 object listing beyond the already-approved R2 cleanup report.
- No D1 schema migration (the existing schema provides sufficient cascade
  behavior).
- No `photoprism_album_uid` exposure in any response, log, or form field.
- No automatic Docker or Portainer control; the sync-target update is a
  Worker R2 write only.
- No production changes authorized by this ADR.
- No commit, push, deploy, secret registration, or handoff archival authorized
  by this ADR.
- No implementation of Phase 2, 3, 4, or 5; those require separate handoffs.

---

## 8. Rejected Alternatives

**Require the operator to remove the sync-target entry manually before album
hard delete**: rejected because it adds a fragile out-of-band step that is easy
to forget. The Worker can perform the R2 read-modify-write in the
same request. Making it automatic is both safer and less error-prone.

**Block album hard delete if a sync-target entry exists**: rejected because the
operator then needs to navigate away and return, increasing the chance that the
D1 delete is performed without removing the sync target (e.g., if they remove
the sync target and then delete the D1 row manually via a different path).

**Hard delete without a two-step confirmation**: rejected. Hard delete is
irreversible. A single-step POST with only an ID is too easy to trigger by
mistake or by a replayed form submission. Two-step HMAC token with typed phrase
is the required guard for all destructive operations.

**Unsigned fingerprint token in hidden field**: rejected. An unsigned value can
be forged or replayed. HMAC-SHA-256 with a Worker secret and a short TTL is
required, matching the pattern established in the R2 cleanup deletion controls.

**Display `photoprism_album_uid` in the Step 1 summary**: rejected. It is a
sensitive operational source identifier. It must never be selected from D1
after album creation and must not appear in any admin page.

**Delete R2 objects as part of album hard delete**: rejected per the non-
negotiable invariant: R2 deletion requires explicitly approved human action and
a separately reviewed handoff.

**Worker calls Portainer API to remove the sync target from the Portainer stack
environment**: rejected. Workers must not access Portainer. The browser-owned
`ops/sync-targets.json` mechanism is the correct boundary-preserving path for
Worker-managed sync targets.
