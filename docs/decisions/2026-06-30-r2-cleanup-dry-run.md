# R2 Cleanup Dry-Run Design

Date: 2026-06-30

## 1. Context

### Background

R2 album assets live under `albums/<albumId>/` keys. When an album is disabled
or deleted, its R2 objects are not automatically removed. Before any actual
object deletion can happen, a read-only orphan report must exist so the operator
can see what would be deleted.

The `2026-06-26-admin-browser-management.md` ADR established:

- disable/depublish is the normal safe path for albums;
- hard delete is deferred;
- R2 cleanup must start as dry-run/reporting only;
- actual R2 deletion requires explicit human approval and a separate reviewed
  handoff;
- hard delete should not be implemented until a dry-run orphan report exists and
  is reviewed.

This ADR decides the design for that dry-run/reporting mechanism. It does not
authorize implementation, R2 deletion, or any production change.

### Non-negotiable invariants (from AGENTS.md)

- Workers never access PhotoPrism, NAS, Docker, or Portainer.
- Docker does not read D1 or implement viewer/admin authorization.
- Private R2 remains private and is never made publicly accessible.
- R2 deletion requires explicitly approved human action and a separately reviewed
  handoff.
- photoprism_album_uid, password hashes, session tokens, and NAS source
  identifiers are never selected or rendered.

---

## 2. Decisions

### 2.1 Scope

**Decided: dry-run/reporting only. No R2 object deletion, no object mutation,
no public R2 access.**

This ADR governs only a read-only admin report. The report:

- reads D1 to enumerate active album namespaces;
- lists R2 key prefixes under `albums/` to identify orphaned, owned, and
  malformed prefixes;
- does not delete, move, or overwrite any R2 object;
- does not mutate D1;
- does not contact PhotoPrism, NAS, Docker, or Portainer.

Actual R2 deletion is explicitly out of scope for this ADR and all phases below
except Phase 4, which requires a separate ADR and explicit human approval before
any implementation.

### 2.2 Ownership Model

**Decided: D1 `albums.id` is the source of active album namespaces. `ops/` is
excluded. Files outside expected shapes are reported as suspicious.**

- D1 `albums.id` is the authoritative list of known album identifiers.
- R2 album assets live under `albums/<albumId>/` where `<albumId>` is a D1
  album ID.
- Operational objects under `ops/` (e.g., `ops/album-catalog.json`,
  `ops/sync-request.json`, `ops/sync-status.json`) are not album assets and must
  be explicitly excluded from cleanup scope. They are reported as non-album
  operational keys, not as orphans.
- Files outside the expected album asset shapes
  (`manifest.json`, `cover.webp`, `thumbs/<photoId>.webp`,
  `previews/<photoId>.jpg`) are reported as malformed or suspicious, not deleted.
- Sync-target records alone must not define active ownership. A sync-target
  entry whose album ID has no corresponding D1 `albums` row does not make that
  prefix "owned."

The known valid album asset shapes are defined by `r2-object-key.ts`
(`isStandardPrivateObjectKey`). The cleanup report uses the same key-shape
knowledge to classify keys.

### 2.3 Orphan Definition

**Decided: an R2 album prefix is orphaned when `albums/<albumId>/` exists but
there is no corresponding D1 `albums.id`. Disabled albums are not orphaned.**

- **Orphaned**: an `albums/<albumId>/` prefix exists in R2 but there is no
  row in D1 `albums` where `id = albumId`.
- **Owned (active)**: an `albums/<albumId>/` prefix exists and the D1 row has
  `enabled = 1`.
- **Owned (disabled)**: an `albums/<albumId>/` prefix exists and the D1 row has
  `enabled = 0`. Disabled albums still have a D1 row; they are not orphaned.
  Their R2 objects are intentionally preserved (operator retains the option to
  re-enable the album). The report labels them as owned-disabled to distinguish
  from orphans.
- **Malformed prefix**: a top-level R2 key or prefix does not start with
  `albums/` or `ops/` (e.g., a key written to the bucket root). Reported
  separately.
- **Incomplete album prefix**: an `albums/<albumId>/` prefix that exists but the
  `<albumId>` segment does not pass the same ID validation used elsewhere in the
  project (`isValidId`). Reported as suspicious or malformed rather than
  attempting to match it against D1.

The report must not infer active ownership from sync-target records or manifest
presence. The D1 `albums` table is the sole authority.

### 2.4 Read Model

**Decided: Worker admin route is the preferred implementation. Docker must not
read D1.**

- **Worker admin route (preferred)**: Workers already have both D1 (`DB` binding)
  and R2 (`PHOTO_BUCKET` binding). No new binding, credential, or external
  service access is needed. The Worker reads `albums.id` and optionally `enabled`
  from D1, lists R2 prefixes under `albums/`, and classifies each prefix.
- **Docker must not read D1**: D1 is accessible only through Cloudflare Worker
  bindings. Granting D1 credentials to Docker would violate the Docker-to-D1
  boundary invariant established in `AGENTS.md` and confirmed by the
  `2026-06-26-admin-browser-management.md` ADR.
- **Worker must not contact PhotoPrism, NAS, Docker, or Portainer**: the report
  is derived entirely from D1 and R2.

### 2.5 Proposed Future Admin Route

**Decided: `GET /admin/r2-cleanup`, protected by existing `requireAdmin`,
read-only, no JavaScript requirement, no delete form.**

Route design (not yet implemented):

- **Method**: `GET` only.
- **Path**: `/admin/r2-cleanup`.
- **Auth**: `requireAdmin` middleware (Cloudflare Access JWT + email allowlist),
  the same guard used by all existing admin routes.
- **Cache-Control**: `no-store` on every response, including errors.
- **Response**: HTML report (no JavaScript required). JSON format could be
  offered as a future option but the first implementation uses plain HTML for
  simplicity and browser compatibility.
- **No mutation**: the route must not include any form that can submit a delete
  or mutate request. If a future deletion flow is designed, it must be a
  separate route behind its own confirmed approval step.
- **Partial/truncated report**: if the R2 listing exceeds configured limits,
  the response includes a visible truncation notice rather than silently
  returning an incomplete report.
- **Error page**: D1 or R2 failures return a generic `500 Internal Server Error`
  with `Cache-Control: no-store`. No bucket name, R2 key, SQL query, stack
  trace, or credential appears in any error response.

### 2.6 Data Selected from D1

**Decided: select only `albums.id` and optionally `albums.enabled`. No title,
photoprism_album_uid, transform settings, or user data.**

```sql
SELECT id, enabled FROM albums ORDER BY id ASC
```

- `id` is the only column needed to identify owned prefixes.
- `enabled` may be selected to label disabled-but-owned prefixes in the report.
- `title`, `photoprism_album_uid`, `thumb_*`, `preview_*`, `strip_exif`,
  `expires_at`, `download_enabled`, `created_at`, and `updated_at` must not be
  selected. They are not needed for prefix classification and their inclusion
  would expand the sensitive data surface of the report.
- No join to `album_permissions`, `users`, or `sessions`.

### 2.7 Data Read from R2

**Decided: list keys or prefixes under `albums/` only. Do not read object
bodies. Report counts and byte totals from R2 metadata only.**

- **Listing scope**: `R2Bucket.list({ prefix: 'albums/' })` with pagination.
  Optionally use `delimiter: '/'` to list album-level prefixes rather than
  individual object keys, reducing the volume of data processed for large albums.
  Operational keys under `ops/` are excluded by default because they are outside
  the `albums/` prefix. If the UI wants to show an informational `excluded-ops`
  count, it may perform a separate bounded `R2Bucket.list({ prefix: 'ops/' })`
  and aggregate only the count; those keys must never be classified as album
  orphans.
- **No object body reads**: `.get()` must not be called. Only `.list()` is used.
  `R2Object.size` is available directly from list results without reading the
  body.
- **Key rendering**: at prefix-level reporting (`albums/<albumId>/`), the report
  must not render full per-object keys unless a per-object detail view is
  explicitly needed and approved. Rendering individual full object keys exposes
  photo IDs at the reporting surface; aggregate per-album counts and totals are
  sufficient for the initial cleanup report.
- **Acceptable metadata**: object count per album prefix and approximate total
  bytes (sum of `R2Object.size`) from list metadata. These carry no sensitive
  content.
- **Must not appear in any report output**: PhotoPrism URLs, PhotoPrism tokens,
  source hashes, EXIF/GPS data, manifest contents, raw manifest JSON, album
  title, or any object body content.

### 2.8 Pagination and Limits

**Decided: R2 listing must be paginated and bounded. Fail closed or show a
partial/truncated report explicitly if limits are exceeded.**

- **Pagination**: use `R2Bucket.list()` cursor-based pagination. Process pages
  in a loop; aggregate per-album prefix statistics across pages.
- **Hard limit on processed pages or objects**: define a maximum page count or
  object count constant (e.g., 10 pages × 1000 objects = up to 10,000 objects).
  If the listing reaches this limit before exhausting all keys, stop and render
  a visible truncation notice: "Report is partial — bucket listing exceeded the
  configured limit. Re-run or contact the operator."
- **No unbounded in-memory accumulation**: do not collect all R2 object keys
  into an in-memory array before classification. Classify during iteration and
  accumulate only per-album aggregate totals.
- **Fail closed on any R2 pagination error**: a mid-listing R2 error returns
  `500 Internal Server Error` with `no-store`. The partial result is not
  rendered.

### 2.9 Report Categories

**Decided: five categories; ops/ keys explicitly excluded.**

| Category | Description |
|----------|-------------|
| `owned-active` | `albums/<albumId>/` prefix exists; D1 `albums` row exists with `enabled = 1`. |
| `owned-disabled` | `albums/<albumId>/` prefix exists; D1 `albums` row exists with `enabled = 0`. |
| `orphan` | `albums/<albumId>/` prefix exists; no D1 `albums` row with this `albumId`. |
| `malformed` | A key or prefix under `albums/` whose `<albumId>` segment fails ID validation, or a top-level key that is neither `albums/` nor `ops/`. |
| `excluded-ops` | Keys under `ops/`. Not album assets; excluded from cleanup scope. Usually excluded by not listing `ops/`; if a separate bounded `ops/` list is added, report count only as informational context, not as orphans or malformed. |

The report should render each album prefix as one row (category, album ID, object
count, approximate total bytes). The full list of individual object keys within
an album must not be rendered.

### 2.10 Error Behavior

**Decided: sanitized `500 Internal Server Error` with `no-store`. No sensitive
data in error responses. Report generation must not mutate state.**

- Any D1 or R2 failure returns `500 Internal Server Error` with
  `Cache-Control: no-store`.
- Error responses must not include: bucket name, R2 object keys, SQL query text,
  SQL error messages, stack traces, Cloudflare credentials, Worker environment
  variable names, or any object content.
- The error pattern matches the existing admin route convention:
  `c.header('Cache-Control', 'no-store'); return c.text('Internal Server Error', 500)`.
- Report generation must not call `.put()`, `.delete()`, or any write operation
  on D1 or R2. The implementation must be verified by checking that no write
  calls exist in the report handler and its dependencies.

### 2.11 Relationship to Album Hard Delete

**Decided: hard delete remains deferred until dry-run reporting exists and is
reviewed. Hard delete requires a separate implementation handoff and two-step
confirmation. Actual R2 deletion requires explicit human approval.**

- Album hard delete (`POST /admin/albums/delete`) must not be implemented until
  Phase 2 (dry-run report) exists and the report has been reviewed by the
  operator.
- If hard delete is later implemented, it must:
  - accept a single `albumId`;
  - execute a D1 `DELETE FROM albums WHERE id = ?`;
  - rely on `ON DELETE CASCADE` on `album_permissions` (already defined);
  - NOT delete any R2 objects — those become orphaned and are identified by the
    Phase 2 dry-run report;
  - require a separate implementation handoff, explicit Codex approval, and a
    two-step admin confirmation guard in the UI (Step 1: display target album;
    Step 2: warn that R2 objects will remain orphaned and Portainer sync must be
    removed first).
- Actual R2 deletion (removing orphaned R2 objects) requires:
  - the dry-run report (Phase 2) to be deployed and reviewed;
  - explicit human approval;
  - a separate ADR or implementation handoff with its own security review;
  - this document does not authorize R2 deletion.

---

## 3. Recommended Implementation Phases

### Phase 1 — Read-only ADR (this task)

Design is decided. No code is written. No production change occurs.

### Phase 2 — Worker admin dry-run report implementation

**Goal**: implement `GET /admin/r2-cleanup` behind `requireAdmin`.

**New files**:
- `workers/src/services/r2-cleanup-repository.ts`: encapsulates D1 query and
  R2 listing + classification logic. Returns a typed report result without
  rendering or mutating.
- `workers/test/r2-cleanup-repository.test.ts`: unit tests per Section 4.

**Edited files**:
- `workers/src/routes/admin.tsx`: add `GET /admin/r2-cleanup` handler and
  `AdminR2CleanupPage` template component. Wire `r2CleanupRepo` into
  `AdminRouteDeps`.
- `workers/test/admin-routes.test.ts`: add route-level tests per Section 4.
- `workers/src/index.tsx` (or equivalent binding wiring): instantiate
  `r2CleanupRepo` from `PHOTO_BUCKET` and `DB`.

**No migration**: no D1 schema change. The query uses only the existing
`albums` table.

**No new binding**: `DB` and `PHOTO_BUCKET` are already bound.

### Phase 3 — Optional operator documentation and live report smoke

**Goal**: verify the deployed report matches design; add operator runbook entry
if useful.

- Deploy Phase 2 Worker.
- Run `GET /admin/r2-cleanup` against production.
- Confirm: report renders owned, disabled, and orphan categories correctly;
  `ops/` keys appear as excluded; no sensitive data in the HTML.
- Add a note to `docs/operations/` if the operator needs specific guidance.

### Phase 4 — Separate deletion design (only if operator explicitly requests)

**Goal**: decide whether and how to delete orphaned R2 objects.

This phase requires:
- Phase 2 report deployed and reviewed by the operator;
- explicit operator request to proceed with deletion;
- a new ADR or implementation handoff with full security review;
- explicit human approval per `autonomy-contract.md` before any deletion
  implementation.

This phase is not authorized by the current document.

---

## 4. Verification Expectations for Future Implementation

The Phase 2 implementation handoff must include tests for:

| Test | What it checks |
|------|---------------|
| Auth failure | Unauthenticated request to `GET /admin/r2-cleanup` returns 403 (via `requireAdmin`). |
| `Cache-Control: no-store` | Every response (success, partial, error) carries `no-store`. |
| D1 query shape | Only `id` and `enabled` are selected; `photoprism_album_uid`, `title`, transform settings, and other columns are not present in any query. |
| R2 list pagination | When `truncated = true`, the next page is fetched; when the page limit is reached, a truncation notice is rendered instead of crashing. |
| Orphan classification | An `albums/<albumId>/` prefix with no D1 row is classified as `orphan`. |
| Disabled-owned classification | An `albums/<albumId>/` prefix with D1 row `enabled = 0` is classified as `owned-disabled`, not `orphan`. |
| Malformed key | A key that starts with `albums/` but whose album-ID segment fails `isValidId` is classified as `malformed`. |
| Excluded `ops/` keys | Keys starting with `ops/` are not classified as orphans or malformed. If the implementation performs the optional separate `ops/` list, they are counted only as `excluded-ops`. |
| Sanitized D1 failure | A D1 error returns `500 Internal Server Error` with `no-store`; no SQL or internal detail appears in the response. |
| Sanitized R2 failure | An R2 `.list()` error returns `500 Internal Server Error` with `no-store`; no key, bucket name, or internal detail appears. |
| No mutation/delete calls | The handler and its repository do not call `.put()`, `.delete()`, or any D1 write. Verified by inspecting the implementation and by tests that would fail if such calls were made. |

---

## 5. Security Invariants Confirmed

### Workers never access PhotoPrism / NAS / Docker / Portainer

The report reads only D1 and lists R2. No external network call is made.

### Docker does not read D1 or implement viewer/admin authorization

Docker has no role in this report. The Worker reads D1 directly using its
existing binding.

### Private R2 remains private

R2 listing uses the existing private `PHOTO_BUCKET` binding. No pre-signed URL,
no public access change.

### No sensitive data in report output

- `photoprism_album_uid` is not selected from D1.
- Full R2 object keys are not rendered individually; only per-album prefix
  aggregate counts and byte totals are shown.
- Object bodies are never read.
- Error responses are sanitized to `500 Internal Server Error` with no-store.

### R2 deletion remains disabled

No deletion, mutation, or cleanup operation is authorized by this ADR.
Actual R2 deletion requires explicit human approval and a separate reviewed
handoff, per `autonomy-contract.md`.

### Fail-closed behavior

- D1 or R2 failures return `500` with `no-store`.
- Truncation is surfaced explicitly, not silently ignored.
- Malformed prefixes are reported separately rather than silently matched.

---

## 6. Rejected Alternatives

**Docker reads D1 to produce the report**: violates the Docker-to-D1 boundary
invariant. Docker has no D1 credential path that does not also violate the
autonomy contract. Rejected.

**A standalone CLI script reads R2 and compares against a D1 export**: requires
exporting D1 data outside the Worker boundary. Adds an out-of-band credential
surface. Rejected in favor of the Worker admin route which already has both
bindings.

**Render full per-object R2 keys in the report**: photo IDs embedded in
object keys (`thumbs/<photoId>.webp`) would be exposed. Per-album aggregate
counts are sufficient for cleanup decisions. Rendering full keys deferred until
a specific need is established.

**Delete orphans automatically after listing**: violates the R2 deletion
approval requirement in `autonomy-contract.md`. Rejected. Deletion requires
its own separately reviewed handoff.

**Use R2 object metadata or custom metadata for ownership tracking**: adds
a write-time dependency on R2 metadata being correctly set. The authoritative
source of album ownership is D1 `albums.id`. Rejected.
