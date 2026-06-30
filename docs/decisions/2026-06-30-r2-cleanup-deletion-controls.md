# R2 Cleanup Deletion Controls Design

Date: 2026-06-30

## 1. Context

### Background

`docs/decisions/2026-06-30-r2-cleanup-dry-run.md` decided the design for a
read-only orphan report (`GET /admin/r2-cleanup`), which is now implemented and
deployed (commit `b3c434c`, CI run `28415678789`). That ADR established:

- actual R2 deletion requires explicit human approval and a separate reviewed
  handoff;
- hard delete of albums must not be implemented until the dry-run report exists
  and is reviewed;
- this document decides the safe deletion design.

This ADR governs deletion controls. It does not authorize implementation, any
R2 mutation, or any production change. Implementation requires a separate
handoff and explicit Codex/operator approval.

### Non-negotiable invariants (from AGENTS.md)

- Workers never access PhotoPrism, NAS, Docker, or Portainer.
- Docker does not read D1 or implement viewer/admin authorization.
- Private R2 remains private; no public access change.
- R2 deletion requires explicitly approved human action and a separately
  reviewed handoff (this document is that ADR; implementation is separate).
- `photoprism_album_uid`, password hashes, session tokens, and NAS source
  identifiers are never selected or rendered.
- Full object keys, photo IDs, manifest contents, raw JSON, bucket names,
  PhotoPrism UID/URL/token, R2 credentials, user identity, and Access claims
  must not be rendered or logged.

---

## 2. Decisions

### 2.1 Whether Deletion Is Permitted At All

**Decided: R2 object deletion is permitted for `orphan` candidates only in the
initial implementation, behind an explicit multi-step confirmation and a
re-scan gate. `malformed` candidates are not deleted in Phase 3; they require a
follow-on decision after real malformed keys have been reviewed. All other
categories are permanently excluded from deletion through this mechanism.**

Rationale:

- Orphan objects have no D1 `albums` row; no album in the system owns them.
  Deleting them carries no risk of breaking an active viewer session.
- Malformed objects do not match any known key shape; they cannot be served by
  the Worker and cannot be part of a valid album. However, because no real
  examples have been reviewed yet, deletion is deferred until a follow-on
  phase decides exact handling.
- `owned-disabled` objects belong to a D1 album row (`enabled = 0`). The album
  can be re-enabled by the operator at any time. Deleting these objects
  irreversibly removes the album's R2 assets without also deleting the D1 row,
  which would leave the system in an inconsistent state. Not permitted.
- `owned-active` objects are in active use by the viewer. Never deletable
  through cleanup.
- `excluded-ops` objects (`ops/` prefix) are operational state (catalogs,
  sync requests, sync status). They are never cleanup orphans and must not be
  touched by any deletion operation.

### 2.2 Category Deletion Policy

| Category | Deletion permitted | Default behaviour |
|----------|--------------------|-------------------|
| `orphan` | Yes — multi-step confirmation + re-scan required | Not deleted unless operator explicitly requests |
| `malformed` | Deferred - not in Phase 3 | Report only until real malformed keys are reviewed |
| `owned-disabled` | No | Excluded; operator must hard-delete the album row first (a separate workflow) |
| `owned-active` | Never | Excluded unconditionally |
| `excluded-ops` | Never | Excluded unconditionally; `ops/` keys are not cleanup candidates |

An operator who wants to remove `owned-disabled` R2 assets must first delete
the D1 `albums` row (a separate hard-delete operation, not designed here),
which turns the prefix into `orphan`, at which point the dry-run report will
classify it as an orphan and the deletion confirmation flow applies.

### 2.3 Deletion Transport

**Decided: Worker admin `POST` route. Not a Docker command. Not a manual
operator script.**

Options considered:

| Option | Assessment |
|--------|-----------|
| Worker admin `POST` route | Preferred. Workers already hold both `DB` (D1) and `PHOTO_BUCKET` (R2) bindings. Re-scan uses the same D1 + R2 paths as the dry-run report. Access JWT + email-allowlist auth is already in place. No new credentials. Same-origin POST, CSRF-resistance via Cloudflare Access, and `Content-Type` validation are all achievable. |
| Docker command (`photo-gate-sync delete-orphans`) | Rejected. Docker must not read D1; granting D1 credentials to Docker violates the Docker-to-D1 boundary invariant in `AGENTS.md`. |
| Manual operator CLI script | Rejected. Requires managing R2 and D1 credentials outside the project boundary. Adds an out-of-band credential surface. Less auditable than a tracked Worker route. |

The Worker route preserves the existing boundary that Docker does not read D1,
and keeps the implementation within the authenticated admin surface already
guarded by Cloudflare Access.

### 2.4 Confirmation Flow

**Decided: no-JavaScript, two-step HTML form flow with a required typed
confirmation phrase.**

Step 1 — Candidate summary (dry-run preview):

- The `POST /admin/r2-cleanup/confirm` route re-runs the full D1/R2
  classification (see Section 2.6).
- The response renders an HTML confirmation page (no JavaScript required)
  showing, for each deletion-candidate category (`orphan`, `malformed`):
  - category label;
  - number of album prefixes (for `orphan`) or object count (for `malformed`);
  - approximate total bytes;
  - a plain-English irreversibility warning.
- The summary must not render full R2 object keys, photo IDs, album titles,
  PhotoPrism UIDs, bucket names, or any other sensitive value.
- Album IDs may be rendered for `orphan` rows because they are non-sensitive
  internal identifiers (the same IDs already shown in the dry-run report).
- A hidden signed token encodes the server-computed candidate fingerprint (see
  Section 2.6); the token is opaque to the browser.

Step 2 — Typed confirmation:

- The operator must type an exact phrase (e.g., `DELETE ORPHANS`) into a text
  field and submit.
- The typed phrase is validated server-side; any mismatch refuses the operation
  with a clear error and does not delete anything.
- The confirmation form must display the confirmation phrase the operator is
  expected to type, the category being deleted, object count, approximate bytes,
  and a warning that the deletion is irreversible.
- No deletion happens until both the typed phrase and the candidate fingerprint
  token are validated.

### 2.5 Scope Narrowing

**Decided: the initial deletion implementation targets `orphan` prefixes only.
`malformed` deletion is deferred to a follow-on phase.**

Rationale: malformed keys are edge-case debris with no consistent structure;
deciding what counts as "safe to delete" requires seeing real examples. The
dry-run report will surface any malformed keys; the operator can review them and
request a follow-on extension.

The confirmation flow is designed to accommodate future `malformed` deletion
without architectural change.

### 2.6 Re-scan Before Delete

**Decided: the delete operation must re-run the full D1/R2 classification
immediately before deletion, not trust stale report HTML or hidden key lists.**

Design:

- When the operator submits Step 2 (typed confirmation), the Worker re-runs
  the same classification logic as `GET /admin/r2-cleanup` and computes a
  deterministic fingerprint of the candidate set (e.g., SHA-256 of sorted
  candidate prefix IDs and object counts).
- This fingerprint is compared against the signed token issued in Step 1.
- If the fingerprints differ (album row added/removed, R2 objects changed since
  Step 1), the operation fails closed with a descriptive error: "Candidate set
  has changed since confirmation was prepared. Please review the current dry-run
  report and restart the confirmation flow."
- No deletion proceeds on fingerprint mismatch.
- The signed token must use HMAC-SHA-256 with a Worker secret and expire after
  a short TTL (e.g., 15 minutes) so stale confirmations cannot be replayed.

### 2.7 Object Selection

**Decided: deletion is based entirely on server-side reclassified candidates.
The browser must not supply object keys.**

- The Worker identifies candidate objects by re-running the classification
  (Section 2.6), not by reading keys from the form body.
- No form field in the confirmation UI encodes object keys, prefixes, or photo
  IDs.
- Only the signed fingerprint token and the typed confirmation phrase are
  accepted from the browser.
- The Worker derives what to delete from its own D1/R2 classification, ensuring
  the browser cannot inject arbitrary key patterns.

### 2.8 Limits and Batching

**Decided: hard limits per deletion run. Exceeding limits refuses the entire
operation and requires a narrower future design.**

| Limit | Value | Behaviour if exceeded |
|-------|-------|----------------------|
| Max R2 list pages | 10 (same as dry-run) | Refuse deletion; show truncation error |
| Max orphan album prefixes per run | 50 | Refuse deletion; operator must reduce scope manually |
| Max total R2 objects to delete per run | 500 | Refuse deletion; split into future phased design |
| Max R2 delete calls in a single Worker request | 500 | Refuse deletion; see above |

If any limit is exceeded during re-scan, the confirmation token is not issued
(in Step 1) or the deletion is refused (in Step 2). The error message must
report counts without full keys, bucket names, or credentials.

Rationale: Cloudflare Worker CPU time and subrequest limits impose a practical
ceiling; exceeding them would cause the request to fail mid-delete, which is
worse than failing before starting. Conservative limits prevent partial-delete
states from becoming the norm.

### 2.9 Failure Behavior

**Decided: stop on first R2 API failure during batch delete. Report sanitized
counts. No bucket names, keys, exception messages, credentials, or stack
traces in any response.**

- The Worker calls `R2Bucket.delete(key)` for each candidate key, in sequence.
- On the first R2 API error, the loop stops and the route returns a `500`
  response with `Cache-Control: no-store`.
- The response body is a sanitized message: "Deletion interrupted after N
  objects. Check the dry-run report for current state."
- `N` is the count of objects that were successfully deleted before the failure.
- The error message must not include the key that triggered the failure, the
  bucket name, the R2 error message, a stack trace, or any credential.
- A subsequent `GET /admin/r2-cleanup` dry-run will reflect the current R2
  state and allow the operator to assess what was and was not deleted.
- Best-effort deletion (continue past failures) is rejected: partial-delete
  leaving some keys and not others in an inconsistent state is harder to reason
  about than a clean stop.

### 2.10 Audit and Recording

**Decided: audit-log the category, object count, approximate bytes, and
timestamp. Do not log full keys, photo IDs, bucket names, credentials, or
Access claims.**

After a successful or partially-interrupted deletion, the Worker appends a
structured audit entry to a `Worker.env` console log (captured by Cloudflare
Logpush or tail workers, not visible to shared viewers):

```json
{
  "event": "r2_cleanup_delete",
  "timestamp": "<ISO 8601>",
  "category": "orphan",
  "prefixCount": 3,
  "objectCount": 124,
  "totalBytes": 18340921,
  "interrupted": false
}
```

- No keys, photo IDs, album titles, PhotoPrism UIDs, bucket names, user email,
  or Access claims appear in the log entry.
- The operator action itself (the confirmation form submission) is implicitly
  audited by Cloudflare Access JWT claims in the incoming request, which
  Cloudflare retains separately.
- No D1 audit table is written by this operation; if a D1 audit log is desired,
  a follow-on ADR must decide schema and retention.

### 2.11 Recovery

**Decided: R2 deletion is irreversible in this design. A mandatory waiting
period and manual backup consideration are required before any deletion is
enabled.**

- R2 `.delete()` is permanent. There is no recycle bin, soft-delete, or
  point-in-time recovery in Cloudflare R2 for objects deleted via the API.
- Before the Phase 3 implementation handoff is created, the operator must
  confirm they have reviewed the dry-run report and are satisfied that the
  listed orphan prefixes no longer correspond to any desired album data.
- The Phase 3 handoff must include an explicit operator confirmation in the
  handoff itself (not just runtime UI confirmation).
- No waiting period is enforced programmatically; this is an operational
  requirement the operator accepts when approving the Phase 3 handoff.
- If a future R2 backup strategy is adopted (e.g., R2 replication or periodic
  snapshot), the Phase 3 handoff should note whether a backup exists and its
  age before deletion is authorized.

### 2.12 Sensitive Data — Absolute Prohibitions

The following must never appear in any HTTP response body, HTML output,
structured log, console log, or error message produced by the deletion routes:

- Full R2 object keys or key fragments below the album-prefix level.
- Photo IDs (`thumbs/<photoId>.webp` fragments, preview IDs).
- Manifest contents or raw manifest JSON.
- Album titles.
- PhotoPrism UIDs, PhotoPrism URLs, or PhotoPrism tokens.
- R2 bucket name.
- R2 access key, secret key, or endpoint URL.
- Cloudflare API token or account ID.
- D1 database ID.
- User email addresses or Access JWT claims.
- Session tokens.
- SQL query text or SQL error messages.
- Stack traces or Worker internal paths.

---

## 3. Implementation Phases

### Phase 1 — ADR only (this document)

Design is decided. No code is written. No production change occurs. This ADR
must be reviewed by Codex and the operator before any implementation begins.

### Phase 2 — Confirmation UI and deletion preview (no actual delete)

**Goal**: build the two-step confirmation HTML flow without wiring any R2
delete calls.

New files:

- `workers/src/routes/admin-r2-cleanup-delete.tsx`: `POST
  /admin/r2-cleanup/confirm` (Step 1 re-scan, token issue, render summary page)
  and `POST /admin/r2-cleanup/delete` stub (validates token + typed phrase,
  renders "deletion not yet enabled" for now).
- `workers/test/admin-r2-cleanup-delete.test.ts`: tests per Section 4.

Edited files:

- `workers/src/routes/admin.tsx`: link to `POST /admin/r2-cleanup/confirm` from
  the dry-run report page.
- `GET /admin/r2-cleanup` response: add a "Request deletion" button that POSTs
  to `/admin/r2-cleanup/confirm`. No delete call, no R2 mutation.

Acceptance: confirmation form renders with correct counts; typed-phrase
validation rejects mismatches; no R2 delete call exists in any handler;
fingerprint token validates and expires correctly; all prohibitions in Section
2.12 are met.

### Phase 3 — Guarded deletion for orphan only, after explicit approval

**Prerequisite**: Phase 2 deployed, dry-run report reviewed by the operator,
explicit operator request in the Phase 3 handoff.

**Goal**: wire R2 `.delete()` calls into `POST /admin/r2-cleanup/delete` for
`orphan` prefixes only, bounded by the limits in Section 2.8.

Edited files:

- `workers/src/routes/admin-r2-cleanup-delete.tsx`: replace the "not yet
  enabled" stub with bounded `R2Bucket.delete()` calls after re-scan + token
  validation + typed-phrase validation.
- `workers/test/admin-r2-cleanup-delete.test.ts`: add mutation tests per
  Section 4.

Acceptance: all tests in Section 4 pass; no `malformed`/`owned-disabled`/
`owned-active`/`ops/` object is deleted in any test path; limits enforced;
failure stops on first error; sanitized counts reported; audit log entry
emitted.

### Phase 4 — Post-delete documentation and smoke

**Goal**: confirm production deletion behaved as expected; update Fable docs
and `deploy-log.md`.

- Run `GET /admin/r2-cleanup` after deletion to confirm orphan prefixes are
  gone.
- Record the deletion run in `docs/operations/deploy-log.md` (category, count,
  bytes, timestamp; no keys/IDs).
- Update `docs/fable/current-state.md` and `docs/fable/progress.md`.
- Archive the Phase 3 handoff.

---

## 4. Verification Expectations for Future Implementation

The Phase 2 and Phase 3 implementation handoffs must include tests for all of
the following.

### Authentication and Authorization

| Test | What it checks |
|------|----------------|
| Unauthenticated POST to `/admin/r2-cleanup/confirm` | Returns 403 (via `requireAdmin`); no body content. |
| Unauthenticated POST to `/admin/r2-cleanup/delete` | Returns 403 (via `requireAdmin`); no body content. |
| Non-admin authenticated POST | Returns 403; email not in allowlist. |
| All responses carry `Cache-Control: no-store` | Success, error, and rejection responses all carry `no-store`. |

### Request Validation

| Test | What it checks |
|------|----------------|
| Same-origin POST enforcement | Cross-origin POST (no Cloudflare Access token or wrong origin) is rejected. |
| Strict `Content-Type` | POST without `application/x-www-form-urlencoded` is rejected with 400. |
| Typed confirmation phrase mismatch | Wrong phrase in Step 2 returns an error; no deletion occurs. |
| Typed confirmation phrase correct | Correct phrase, valid token, fingerprint match → proceeds. |
| Expired fingerprint token | Token older than TTL is rejected; no deletion occurs. |
| Tampered fingerprint token | Forged HMAC rejected; no deletion occurs. |
| Fingerprint mismatch (candidate set changed) | Re-scan result differs from token; operation fails closed with descriptive error. |

### Object Selection Safety

| Test | What it checks |
|------|----------------|
| No hidden key trust | POST body with extra key fields is ignored; only server-derived candidates are used. |
| Object keys from browser rejected | If form body includes an object key or album ID not on the server-derived candidate list, those keys are not deleted. |

### Category Isolation

| Test | What it checks |
|------|----------------|
| Only `orphan` prefixes deleted (Phase 3) | Mocked R2 shows that `.delete()` is called only for keys under orphan album prefixes. |
| `malformed` keys not deleted (Phase 3) | Malformed keys are excluded; no delete call for them. |
| `owned-disabled` keys never deleted | An album with `enabled = 0` is never passed to `.delete()`. |
| `owned-active` keys never deleted | An album with `enabled = 1` is never passed to `.delete()`. |
| `ops/` keys never deleted | Keys under `ops/` are never passed to `.delete()`. |

### Limits

| Test | What it checks |
|------|----------------|
| Orphan prefix count exceeds limit | Operation is refused; no delete call. |
| Total object count exceeds limit | Operation is refused; no delete call. |
| R2 page limit exceeded during re-scan | Operation is refused; truncation error returned. |

### Failure Handling

| Test | What it checks |
|------|----------------|
| R2 `.delete()` fails on first call | Loop stops; sanitized count returned; no further deletes attempted. |
| R2 `.delete()` fails mid-batch | Loop stops; sanitized partial count returned. |
| D1 failure during re-scan | 500 returned; no delete call; no sensitive detail in response. |
| R2 list failure during re-scan | 500 returned; no delete call; no sensitive detail in response. |

### Sensitive Data Prohibition

| Test | What it checks |
|------|----------------|
| No full keys in response | Success, error, and summary responses contain no R2 object key below album-prefix level. |
| No photo IDs in response | No `thumbs/` or `previews/` segments appear in any response. |
| No bucket name in any response | R2 bucket name does not appear in success, error, or partial responses. |
| No SQL text in error response | D1 error does not leak query text or error message. |
| No stack trace in error response | Worker exception does not leak a stack trace. |
| Audit log entry format | Log entry contains only allowed fields (category, counts, bytes, timestamp, interrupted flag). |

### R2 Delete Calls Bounded

| Test | What it checks |
|------|----------------|
| Mock verifies delete count ≤ limit | The number of `.delete()` calls in a single handler invocation does not exceed the configured limit. |
| No `.put()` or `.delete()` in Phase 2 handlers | Phase 2 stub routes contain no write call to R2 or D1; verified by absence in test mocks. |

---

## 5. Security Invariants Confirmed

### Workers never access PhotoPrism / NAS / Docker / Portainer

The deletion route reads D1 and R2 only. No external network call. No
environment variable or binding for PhotoPrism, NAS, or Portainer is read.

### Docker does not read D1 or implement viewer/admin authorization

Docker has no role in deletion. The Worker handles auth, re-scan, and delete
entirely.

### Private R2 remains private

All R2 reads and deletes use the existing private `PHOTO_BUCKET` binding. No
pre-signed URL or public-access change.

### No sensitive data in any response or log

Section 2.12 lists absolute prohibitions. Section 4 includes tests that
enforce them.

### Fail-closed behavior

- Fingerprint mismatch → fail closed; no delete.
- Typed phrase mismatch → fail closed; no delete.
- R2 or D1 error during re-scan → fail closed; no delete.
- R2 error mid-batch → stop; sanitized count returned.
- Limit exceeded → refuse; no delete.
- Expired or tampered token → refuse; no delete.

### Browser cannot inject keys

Object selection is entirely server-side. The browser supplies only the
fingerprint token and the typed phrase; the server re-derives all candidate
keys from D1 and R2.

### R2 deletion disabled until Phase 3 is explicitly authorized

This ADR documents the design. Actual `.delete()` calls are not wired until the
Phase 3 handoff is created and approved.

---

## 6. Rejected Alternatives

**Best-effort delete (continue past failures)**: rejected because partial
deletes leave the bucket in an indeterminate state that is harder to diagnose
than a clean stop. A subsequent dry-run report always reflects current state.

**Accept object keys from the browser**: rejected because it would allow
the operator to delete any R2 key by crafting a form body, bypassing the
category policy entirely. Server-side re-scan is the only safe basis for
deletion.

**Fingerprint in a hidden form field without signing**: rejected because an
unsigned value can be forged or replayed. HMAC-signed token with TTL is
required.

**Delete `owned-disabled` objects**: rejected because disabled albums can be
re-enabled without any new R2 upload. Deleting their objects would make
re-enable non-functional and is a silent irreversible action against data
the operator may still want.

**Delete `malformed` objects in Phase 3**: deferred because no real examples
of malformed keys have been observed. Deferring avoids designing deletion for
a class of objects whose structure is not yet fully understood.

**Docker command for deletion**: rejected; see Section 2.3.

**D1 audit log for deletion events**: deferred; a D1 audit schema and retention
policy require a separate decision. Worker console logs are sufficient for the
initial implementation.
