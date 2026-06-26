# Admin Browser Management

Date: 2026-06-26

## 1. Context

### What exists today

The admin surface at `/admin` is already protected by Cloudflare Access JWT
validation and the admin email allowlist (`requireAdmin` middleware).  The
following capabilities are implemented and deployed:

**User management (partial)**
- `POST /admin/users/create`: create a new user (enabled=1 at creation).
- `POST /admin/users/reset-password`: reset any user's password.
- `POST /admin/users/enable` / `/disable`: toggle `enabled`.
- `GET /admin/users`: keyset-paginated list showing `id`, `display_name`,
  `enabled`, `fail_count`, `locked_until`, `created_at`, `updated_at`.
  Password hash, session tokens, and PhotoPrism source data are never selected.

**Missing user operations**: display-name editing, user deletion/depublication.

**Album management (partial)**
- `GET /admin/albums`: keyset-paginated list showing `id`, `title`, `enabled`,
  `expires_at`, `download_enabled`, `created_at`, `updated_at`.
  `photoprism_album_uid`, transform settings, `strip_exif`, and R2 data are
  never selected.
- `POST /admin/albums/enable` / `/disable`: toggle `enabled`.
- `POST /admin/albums/update-public-metadata`: update `title`, `expires_at`,
  `download_enabled`, `updated_at`.

**Missing album operations**: album creation, album deletion/depublication,
PhotoPrism album discovery.

**Permission management**
- `GET /admin/permissions`: keyset-paginated list of `album_id`, `user_id`,
  `created_at` pairs.
- `POST /admin/permissions/grant` / `/revoke`: idempotent, by raw ID.
  The grant/revoke UI requires the operator to type album IDs and user IDs
  manually; no joined display of album title or user display name exists.

### The problem this ADR solves

The admin console is usable only with prior knowledge of internal IDs.
Grant/revoke cannot be performed browser-friendly without knowing both an
`album_id` and a `user_id` in advance.  There is no album creation or deletion.
User editing (display-name change, deletion) is not implemented.
PhotoPrism album discovery from the browser is not possible within current
boundaries.

This ADR decides the design for a complete browser-based management console and
specifies the phased implementation path.

### Non-negotiable invariants (from AGENTS.md)

These must be satisfied by every decision in this ADR:

- Workers never access PhotoPrism, NAS, Docker, or Portainer.
- Docker does not read D1 or implement viewer/admin authorization.
- Private R2 remains private and is never made publicly accessible.
- R2 deletion requires a separately approved cleanup handoff; any cleanup
  started as dry-run/reporting only.
- Password hashes, session tokens, PhotoPrism UIDs, and NAS source identifiers
  are never selected or rendered in admin pages.
- Every admin mutation route is guarded by `requireAdmin` and the same-origin
  check used by existing admin mutation routes.

---

## 2. Decisions

### 2.1 User management scope

**Decided: implement display-name editing, disable-first depublication, and
deferred hard delete.**

**Edit display name**: a new `POST /admin/users/update-display-name` route
accepts `userId` and `displayName`.  Validation reuses the `isValidNewDisplayName`
guard already used by `createUser`.  Only `display_name` and `updated_at` are
written; no other column is touched.

**Disable vs. hard delete**: prefer `disable` (set `enabled = 0`) as the normal
safe path for retiring a user.  The operator can re-enable a disabled user at
any time.  A disabled user cannot log in because the login route checks
`enabled`; existing sessions expire naturally (seven-day TTL + daily cron
cleanup).  No session invalidation is needed for disable because the session
route checks `enabled` on every authenticated request.

**Hard delete**: a `POST /admin/users/delete` route is deferred to a separate
implementation handoff.  If implemented it must:
- accept a single `userId`;
- execute a D1 `DELETE FROM users WHERE id = ?`;
- rely on `ON DELETE CASCADE` on `album_permissions` to clean up permission rows
  (already defined in the schema);
- not touch sessions separately because `sessions.user_id` already has
  `ON DELETE CASCADE`;
- never write to R2 (user rows carry no R2 state);
- require a separate implementation handoff and a two-step admin confirmation
  guard in the UI:
  - Step 1: display the target user (ID, display name, enabled state) and ask
    the operator to confirm they have selected the correct account.
  - Step 2: warn explicitly that all active sessions will be cascade-deleted
    and all album permissions will be cascade-removed, and ask the operator to
    confirm the irreversible action.

**Session behavior on disable**: the session store references `userId` but does
not cache `enabled`.  Every viewer request that passes session validation
re-reads the user row from D1 and checks `enabled`.  Disabling a user therefore
takes effect on the next request without requiring session invalidation.
Hard delete removes the user row and cascades sessions and permissions through
the existing foreign keys.

**What is never rendered**: password hash, session tokens, fail-count details
beyond what is already shown, locked_until raw value, or any PhotoPrism UID.

### 2.2 Browser-friendly assignment UI

**Decided: admin-only joined views for assignment, no manual ID typing.**

The current `GET /admin/permissions` page returns raw `album_id` / `user_id`
pairs.  Grant/revoke require the operator to submit raw IDs.  This is not
browser-friendly.

**Phase 1 approach**: add a joined assignment view in admin pages that displays
`title` (from `albums`) and `display_name` (from `users`) alongside their IDs.
Joins are safe within admin-only routes because:
- the admin route is protected by `requireAdmin` (Cloudflare Access + email
  allowlist);
- `photoprism_album_uid`, transform settings, password hashes, session data,
  and raw R2 keys are never selected;
- only the same public-safe fields already exposed on list pages are joined:
  `albums.id`, `albums.title`, `albums.enabled`; `users.id`, `users.display_name`,
  `users.enabled`.

**No PhotoPrism UID in joined views**: the join query must explicitly exclude
`photoprism_album_uid` from the SELECT clause.  It is treated as a sensitive
operational source identifier; it must not appear in any HTML, error message,
or log line.

**Assignment form**: the grant/revoke form will present dropdowns or pre-filled
values derived from the joined list, so the operator selects from labeled
entries (album title + user display name) without typing raw IDs.  The route
handler still accepts and validates `album_id` and `user_id` as IDs, not
titles; the UI labels are display-only.

**Disabled albums in assignment views**: disabled albums (enabled = 0) are
included in the assignment dropdown and list, but rendered with a visible
status badge (e.g., "disabled").  This allows the operator to pre-assign users
to a newly created album before sync runs and before calling
`POST /admin/albums/enable`.  Excluding disabled albums would block this
common setup flow.

**Size boundary**: joined queries for assignment views are acceptable only on
the admin surface.  They must not be used on viewer routes.  Page sizes remain
≤ 50 rows per request (matching existing `ADMIN_*_PAGE_SIZE` constants).

### 2.3 Meaning of "create album"

**Decided: Phase 2 creates a D1-only row.  A D1 row does not automatically
become a Docker sync target.**

Creating an album means inserting a row into the `albums` D1 table.  The
Docker sync daemon is configured per-album via Portainer environment variables,
not via D1.  A newly created D1 row is not synced until the operator separately
configures the daemon.

The D1 `albums` table already has all necessary columns for a new album row:
`id`, `title`, `photoprism_album_uid`, `enabled`, `expires_at`,
`thumb_long_edge`, `thumb_format`, `thumb_quality`, `preview_long_edge`,
`preview_format`, `preview_quality`, `strip_exif`, `download_enabled`,
`created_at`, `updated_at`.

Phase 2 creates only a D1 row.  No Docker or Portainer change occurs.  The
operator configures the sync daemon separately via Portainer stack variables.

This decision explicitly defers multi-album sync routing to Phase 3.

### 2.4 Handling of photoprism_album_uid

**Decided: accepted on create only, never rendered or selected back.**

`photoprism_album_uid` is a sensitive operational source identifier.  It links
an album row to a PhotoPrism album and could reveal the PhotoPrism album
structure or UID namespace if exposed.

**On create**: the admin form accepts `photoprism_album_uid` as a text input.
The Worker validates it (non-empty, printable ASCII only, within a safe length
limit).  No PhotoPrism lookup or validation is performed.  The value is written
to D1.

**After creation**: `photoprism_album_uid` is write-only.  It is never:
- selected in any list or detail query;
- rendered in any HTML page, error response, or inline form value;
- logged in Worker or Docker log lines;
- returned in any JSON response;
- editable after creation (no update route for this field).

If the operator makes a mistake, the only recourse is to delete the album row
and recreate it.  This is intentional: once a sync-target relationship is
established, changing `photoprism_album_uid` could desync R2 state and is too
risky to expose as a casual edit.

**Worker-side validation (create path)**:
- type: string;
- non-empty;
- printable non-whitespace ASCII (`/^[\x21-\x7e]+$/`);
- length ≤ 128 characters (same as album `id` max length);
- must not start or end with whitespace (enforced by the regex above).

No lookup against PhotoPrism is performed.  The Worker does not know whether
the UID is valid; the operator is responsible for entering the correct value
from the PhotoPrism admin UI.

### 2.5 PhotoPrism album information in the browser

**Decided: Worker direct access is rejected.  Docker-published sanitized catalog
in private R2 is the preferred future path.  Manual UID entry is the interim path.**

**Worker direct access — rejected**: Workers run in the Cloudflare network and
have no route to the Pi's PhotoPrism instance.  Adding such a route would
expose PhotoPrism credentials at the edge and violate the non-negotiable
Workers-to-PhotoPrism boundary.

**Docker-published sanitized catalog (Phase 3)**: Docker already has authorized
access to PhotoPrism for sync.  In Phase 3, the Docker daemon will publish a
sanitized album catalog to a fixed private R2 key (e.g., `ops/album-catalog.json`).

The display catalog schema must contain only safe, admin-display fields:
- a stable opaque catalog ID (not the raw PhotoPrism UID);
- album title;
- approximate photo count or last-updated timestamp if available.

The display catalog must NOT contain: PhotoPrism URLs, PhotoPrism UIDs,
PhotoPrism API tokens, NAS paths, original filenames, or any source metadata.

The Worker reads this catalog on `GET /admin/albums/create` (or a separate
catalog browse page) and displays the sanitized list so the operator can browse
PhotoPrism album titles without giving the Worker direct PhotoPrism access.
Because the current D1 schema still requires `photoprism_album_uid`, Phase 2
continues to use manual write-only UID entry. Removing that manual step requires
a separate Phase 3 mapping design (for example, a sealed selection token or a
separate sync-target catalog) and must not be assumed by this ADR.

This is fully deferred to Phase 3 and requires a separate design handoff before
implementation.

**Manual UID entry (interim)**: until Phase 3, the create-album form will
accept `photoprism_album_uid` as a plain text input.  The operator is expected
to copy the correct UID from PhotoPrism's admin interface.  No validation
against PhotoPrism is performed by the Worker.

### 2.6 Initial enabled state for a newly created album

**Decided: enabled = 0 (disabled) at creation.  Fail-closed default.**

A newly created album row has no R2 content: no thumbnails, no previews, no
manifest, no cover.  Making it viewer-visible immediately would return empty
or error states to any user who has been granted access before sync runs.

The create route inserts `enabled = 0` explicitly, regardless of any operator
form input.  The `enabled` field is not user-controlled on creation.  The
operator must separately call `POST /admin/albums/enable` after confirming that
sync has run and R2 content is present.

This is consistent with the fail-closed design pattern used throughout the
project (session auth, manifest membership checks, PhotoPrism placeholder
detection).

### 2.7 Docker sync and album creation

**Decided: Docker does not read D1.  No automatic sync-target coupling on
album creation.**

Docker reads only private R2 (shared assets) and writes only private R2
(thumbnails, previews, cover, manifest, and operational objects).  The Docker
daemon cannot be given D1 credentials because:
- D1 is accessible only through Cloudflare Worker bindings;
- granting direct D1 credentials to Docker would require a service-token scope
  outside the agreed autonomy contract;
- coupling sync scheduling to D1 could prevent a sync from running if the
  Cloudflare auth system is unavailable.

The current Portainer-env single-album configuration continues unchanged after
Phase 2.  Creating a D1 album row does not configure a new sync target.

**Phase 3 future**: a private R2 sync catalog written by Docker (or by the
Worker, read by Docker) could allow multi-album sync scheduling without D1
coupling.  This requires a separate design handoff and is explicitly not part
of this ADR.

**Rejected alternatives**:
- Docker reads D1 via Cloudflare REST API: violates the Docker-to-D1 boundary
  invariant; introduces Cloudflare credentials and network dependency into the
  daemon; rejected.
- Worker writes a sync-target file to R2 for Docker to read: possible in
  Phase 3 (private R2 sync catalog), but the schema, lifecycle, and multi-album
  sync logic need a dedicated design handoff first; deferred.
- Worker calls Portainer API to add a stack variable: violates the
  Workers-to-Portainer prohibition; requires Portainer credentials at the edge;
  rejected.

### 2.8 Meaning of "delete album"

**Decided: disable/depublish is the normal safe path.  Hard delete requires a
separate implementation handoff.  R2 cleanup is dry-run only.**

**Disable/depublish (Phase 5 default)**: set `enabled = 0` via the existing
`POST /admin/albums/disable` route.  A disabled album is not viewer-visible;
no user can load its photos.  R2 objects (thumbnails, previews, manifest, cover)
remain in place.

**Hard delete (deferred)**: a `POST /admin/albums/delete` route may be
implemented in a later handoff.  If implemented it must:
- accept a single `albumId`;
- execute a D1 `DELETE FROM albums WHERE id = ?`;
- rely on `ON DELETE CASCADE` on `album_permissions` to remove permission rows
  (already defined in the schema);
- NOT delete any R2 objects; those become orphaned until a separately
  reviewed R2 cleanup dry-run reports and then removes them;
- require a separate implementation handoff, explicit Codex approval, and a
  two-step admin confirmation guard in the UI:
  - Step 1: display the target album (ID, title, enabled state) and ask the
    operator to confirm they have selected the correct album.
  - Step 2: warn explicitly that (a) R2 objects will NOT be deleted and will
    remain orphaned until a separate cleanup is authorized, and (b) the
    operator must confirm they have already removed this album from the
    Portainer sync target; otherwise the Docker daemon will continue writing
    R2 objects after the D1 row is gone.  Ask the operator to confirm the
    irreversible action.

**Permission cascade**: `album_permissions` has `ON DELETE CASCADE` referencing
`albums(id)`.  D1 enforces this with `PRAGMA foreign_keys = ON` (already set
in the migration).  Deleting an album row automatically removes all
`album_permissions` rows for that album.  This is safe and desirable: users
lose access automatically when the album row is removed.

**Active sync guard**: before implementing hard delete, the operator must
confirm that the album's `photoprism_album_uid` is no longer configured in the
Portainer stack.  If the Docker daemon is still configured for this album, it
will continue writing R2 objects after the D1 row is deleted, creating orphaned
R2 objects indefinitely.  The hard-delete handoff must document this check.
Because `photoprism_album_uid` is write-only in the admin UI, the operator
must consult Portainer directly.

### 2.9 Cloud storage treatment

**Decided: private R2 is the only cloud storage for share assets.  R2 cleanup
starts as dry-run/reporting only.  No originals, source metadata, or PhotoPrism
URLs in R2.**

**Private R2 is the boundary**: share assets (thumbnails, previews, cover,
manifest) live in private R2 under `albums/<albumId>/` keys.  No public R2
access is introduced.  Workers access share assets only through authorization
and manifest membership checks.  Docker writes only metadata-stripped,
processed images.

**Orphaned object representation**: when an album is disabled or deleted, its
R2 objects become orphaned.  Before a cleanup mechanism exists, orphaned objects
are identified by listing R2 keys and comparing to D1 album IDs.  No runtime
path discovers or reports this today.

**R2 cleanup (Phase 4, dry-run only)**: a future admin route (e.g.,
`GET /admin/albums/orphaned-report`) will list R2 album key prefixes that have
no corresponding D1 album row.  This is a read-only report.  No R2 delete
operation is implemented in Phase 4.  Actual R2 deletion requires a separately
reviewed handoff with explicit human approval.

**Invariants**:
- Workers may not write originals, NAS source files, PhotoPrism UIDs, or
  source metadata to R2.
- Docker may not write viewer auth tokens, session data, or D1 credentials to R2.
- No pre-signed URLs for private R2 are generated.
- R2 cleanup (beyond dry-run reporting) requires explicit human approval.

### 2.10 Recommended implementation phases

See Section 3 for the full phase plan.

---

## 3. Recommended Implementation Phases

### Phase 1 — Browser-friendly user and assignment management

**Goal**: complete user management and add joined assignment views.

**Routes to add**:
- `POST /admin/users/update-display-name`: edit `display_name` only.
- `GET /admin/users/<userId>` or inline in the user list: show current display
  name with an edit form.
- Joined assignment view: a new admin page showing albums × users with assign/
  unassign buttons; the route queries `albums` and `users` using safe fields
  only (no `photoprism_album_uid`, no hashes, no tokens).

**User disable vs. delete**: implement display-name editing and confirm that
`disable` is already sufficient for the normal retire-user flow.  Hard delete
is deferred.

**Constraints**:
- `photoprism_album_uid` must not appear in any joined query or HTML.
- Password hash, session tokens, fail-count raw values must not be rendered.
- All mutation routes behind `requireAdmin` + same-origin check.
- Joined queries run only on admin routes, never on viewer routes.

### Phase 2 — D1-only album creation

**Goal**: `POST /admin/albums/create` inserts a D1 row with `enabled = 0`.

**Route**: `POST /admin/albums/create`.

**Fields accepted**:
- `albumId`: validated by `isValidId` (same rule as all other album IDs);
  proposed by the operator, not generated by the Worker (operator controls the
  R2 key namespace).
- `title`: validated by `isValidTitle`.
- `photoprismAlbumUid`: validated per Section 2.4 (non-empty printable ASCII,
  ≤ 128 chars).
- `expiresAt`: nullable ISO 8601 UTC timestamp; validated by
  `isCanonicalUtcTimestamp` or null.
- `downloadEnabled`: 0 or 1.

**Columns not user-controlled**:
- `enabled`: always inserted as `0` (fail-closed).
- `thumb_long_edge`, `thumb_format`, `thumb_quality`, `preview_long_edge`,
  `preview_format`, `preview_quality`, `strip_exif`: use schema defaults from
  the `albums` table definition; no UI editing in Phase 2.
- `created_at`, `updated_at`: set by the Worker from its clock.

**On conflict**: `albumId` is a PRIMARY KEY; a duplicate insert returns an
error (not idempotent by design, unlike enable/disable).  The route returns a
suitable error page/redirect without disclosing whether the ID already exists.

**No PhotoPrism validation**: the Worker does not contact PhotoPrism.  The
`photoprism_album_uid` is accepted as typed by the operator.

**No Docker/Portainer change**: creating the D1 row does not configure a sync
target.  The operator must separately configure the Portainer stack to sync this
album.

**No R2 write**: the create route writes only to D1.

### Phase 3 — PhotoPrism album catalog / sync-target design (separate handoff)

**Goal**: Docker publishes a sanitized album catalog to private R2 so the admin
create-album form can show PhotoPrism album titles without the operator typing
raw UIDs.

**Key decisions for the separate handoff**:
- Catalog object key: `ops/album-catalog.json` (fixed, private R2).
- Display catalog schema: opaque stable catalog ID, album title, approximate
  photo count or last-updated. PhotoPrism UIDs and URLs must not appear in the
  display catalog.
- The Worker reads the catalog on admin pages to populate a dropdown for human
  browsing only. It does not derive `photoprism_album_uid` from the display
  catalog in this phase.
- A future mapping from catalog selection to `photoprism_album_uid` requires a
  separate design because the raw UID must remain out of HTML, logs, errors,
  and display-safe R2 objects.
- **Preferred catalog update cadence**: first implement a standalone
  `publish-catalog` subcommand (e.g., `photo-gate-sync publish-catalog`) that
  can be run independently and verified without coupling to daemon internals.
  After the subcommand is validated, integrate best-effort catalog publication
  into the daemon at two points: (a) at daemon startup (to populate an initial
  catalog) and (b) after each successful sync completion (to reflect any newly
  added or removed PhotoPrism albums).  Catalog write failures must be logged
  as warnings and must not affect the sync outcome or daemon health counters.
- Evaluate whether a private R2 sync catalog written by the Worker and read by
  Docker would enable multi-album sync routing without D1 coupling.
- This phase must remain separate and requires a dedicated design handoff.

### Phase 4 — Cloud storage cleanup/reporting (dry-run only, separate handoff)

**Goal**: a read-only admin report of orphaned R2 album key prefixes.

- List R2 key prefixes under `albums/` that have no corresponding D1 album row.
- Return a report page or JSON (admin-only route, no public access).
- No R2 delete operation.
- Actual R2 deletion requires explicit human approval and a separate handoff.

### Phase 5 — D1-only album delete/depublish (separate handoff)

**Goal**: safe album depublication; hard delete deferred further.

**Disable/depublish (safe default)**: `POST /admin/albums/disable` already
exists.  This remains the recommended operator action for retiring an album.

**Hard delete (deferred, requires separate handoff)**:
- Accepted only after Phase 4 dry-run report is available.
- D1 `DELETE FROM albums WHERE id = ?`; cascade removes `album_permissions`.
- R2 objects become orphaned and are reported by Phase 4 cleanup.
- Requires two-step admin confirmation guard (see Section 2.8).
- Requires Portainer check to confirm the album is no longer a sync target;
  the two-step UI must surface this requirement explicitly.
- Requires explicit Codex-authored handoff with security review before any
  implementation.

**User hard delete (separate handoff)**:
- Same deferred treatment as album hard delete.
- Requires explicit Codex-authored handoff.
- Requires two-step admin confirmation guard (see Section 2.1).
- Cascade via `album_permissions.user_id` and `sessions.user_id` foreign keys
  already defined.

---

## 4. Security Invariants Confirmed

### Workers never access PhotoPrism / NAS / Docker / Portainer

No route in this ADR causes the Worker to contact PhotoPrism, NAS, Docker, or
Portainer.  The only new network operations are D1 reads/writes and, in Phase 3,
a private R2 read of a catalog written by Docker.

### Docker does not read D1 or implement viewer/admin authorization

Docker's only new obligation in Phase 3 is writing a sanitized catalog to a
fixed private R2 key.  No D1 credential, viewer session, or authorization logic
is added to Docker.

### photoprism_album_uid is write-only after creation

Never selected, rendered, logged, or editable after the initial INSERT.

### User delete vs. disable

Disable is the default safe path.  Hard delete is deferred and requires a
separate handoff.  Session behavior on disable: the existing session-validation
path re-checks `enabled` per request, so disable takes effect immediately on
the next authenticated request.

### User-album assignment UI

Safe admin-only joined queries are used.  No `photoprism_album_uid`, password
hash, session token, or source identifier is selected in any join.

### Cloud storage / R2 object ownership

Private R2 is the only cloud storage for share assets.  No public access is
introduced.  Orphaned objects (after disable/delete) are represented in a
future dry-run report only.

### R2 cleanup / deletion

Dry-run reporting only (Phase 4).  Actual R2 deletion requires explicit human
approval and a separately reviewed handoff.

---

## 5. Rejected Alternatives

**Worker calls PhotoPrism directly**: violates the Workers-to-PhotoPrism
invariant; credentials would be exposed at the edge; no network route exists.

**Docker reads D1 via Cloudflare REST API**: violates the Docker-to-D1 boundary
invariant; introduces Cloudflare service-token credentials into the daemon.

**Worker calls Portainer API to configure sync targets**: violates the
Workers-to-Portainer prohibition.

**enabled = 1 on album creation**: rejected because newly created albums have
no R2 content; viewer-visible albums with no manifest return errors to users.
Fail-closed (enabled = 0) is consistent with the project-wide defensive posture.

**photoprism_album_uid editable after creation**: rejected because changing the
UID after sync has run would desync the existing R2 content namespace; the old
R2 objects would become orphaned silently.

**Hard delete in Phase 2/3**: rejected; requires Phase 4 orphan reporting to be
safe, and requires a separate implementation handoff with Codex review.

**Automatic R2 object deletion on album disable/delete**: rejected; R2 deletion
requires explicit human approval per the project safety rules.
