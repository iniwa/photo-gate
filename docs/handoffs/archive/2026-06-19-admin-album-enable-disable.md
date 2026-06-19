# Admin Album Enable And Disable

Status: completed and reviewed.

Read AGENTS.md, CLAUDE.md, and this handoff file before implementation.
If implementation would violate constraints or require files outside this
handoff, stop and ask before editing.

## Goal

Add narrow administrator controls to enable or disable an existing album
without changing its permissions, source identity, transform configuration,
expiry, download setting, R2 content, or sync behavior.

## Background

- The deployed `/admin` router validates the Cloudflare Access JWT and the
  administrator email allowlist before every admin route.
- `GET /admin/albums` already displays the approved album summary fields.
- The permission grant/revoke task established strict same-origin POST,
  URL-encoded form validation, dependency injection, sanitized no-store
  failures, empty 303 redirects, and D1 run-result validation.
- Viewer album list/detail and image authorization already require
  `albums.enabled = 1`. Disabling an album therefore removes it from normal
  viewing without deleting permissions or R2 data.
- `albums.updated_at` is part of the existing schema and must reflect an actual
  enabled-state transition.

## Acceptance Criteria

- Extend each row in `GET /admin/albums` with exactly one server-rendered form:
  - an enabled album shows a disable form;
  - a disabled album shows an enable form;
  - the form contains only one hidden `albumId` value from the validated row;
  - no client-side JavaScript.
- Add exactly these routes:
  - `POST /admin/albums/enable`
  - `POST /admin/albums/disable`
- The existing admin guard must run before request-shape validation, clock use,
  or repository use. Any Access failure remains the existing generic `403
  Forbidden`, no-store.
- Reuse the permission mutation security contract:
  - require an `Origin` header exactly equal to the request URL origin;
  - absent, literal `null`, malformed, or mismatched Origin returns generic
    `403`, no-store, before body parsing, clock, or repository use;
  - accept only `application/x-www-form-urlencoded`, with optional charset;
  - missing or other Content-Type returns generic `400 Bad Request`, no-store,
    before clock or repository use.
- Parse the album mutation form strictly:
  - require exactly one key named `albumId`;
  - require exactly one string value;
  - reject missing, repeated, file-valued, additional, empty, or invalid IDs;
  - return generic `400 Bad Request`, no-store;
  - never reflect input and never call the clock or repository.
- Resolve `updated_at` only after the request has passed all validation:
  - use the existing injected clock;
  - serialize with `toISOString()`;
  - clock exceptions or invalid dates return the same fixed generic `500
    Internal Server Error`, no-store, without repository use.
- Add one repository method with a narrow contract, for example:
  `setAlbumEnabled(albumId, enabled, updatedAt)`.
- Repository validation must occur before preparing SQL:
  - valid album ID;
  - `enabled` exactly numeric `0` or `1`;
  - canonical UTC `updatedAt`.
- Use one parameterized statement equivalent to:

  ```sql
  UPDATE albums
  SET enabled = ?, updated_at = ?
  WHERE id = ? AND enabled <> ?
  ```

  Bind in this exact order:

  ```text
  enabled, updatedAt, albumId, enabled
  ```

- The mutation must be idempotent and non-disclosing:
  - enabling an already-enabled album is a successful no-op;
  - disabling an already-disabled album is a successful no-op;
  - an unknown album ID is also a successful no-op;
  - do not reveal whether the album exists or whether its state changed.
- A no-op must not change `updated_at`; the `enabled <> ?` condition is
  required for this reason.
- Treat D1 prepare, bind, run, malformed/missing result, or `success !== true`
  as the same sanitized database operation failure.
- On success, both routes return:
  - `303 See Other`;
  - `Location: /admin/albums`;
  - `Cache-Control: no-store`;
  - empty body.
- On mutation failure, both routes return fixed `500 Internal Server Error`,
  no-store, with no ID, timestamp, SQL, binding, existence, prior-state, or D1
  detail.
- Do not log administrator identity, form values, IDs, state transitions, D1
  errors, or operation details.
- Preserve:
  - the existing seven-column album inventory query and validation;
  - album pagination and empty state;
  - permission rows when disabling an album;
  - viewer authorization behavior;
  - every existing admin and viewer route;
  - all security headers and no-store behavior.
- Add focused repository and route tests covering:
  - exact single-table UPDATE SQL shape;
  - only `enabled` and `updated_at` in the SET clause;
  - required `id = ? AND enabled <> ?` predicate;
  - exact bound parameter order;
  - no input literals, SELECT, JOIN, INSERT, DELETE, aggregate, or unrelated
    table mutation;
  - repository validation before D1;
  - success for changed, already-same, and unknown-album run results;
  - sanitized thrown, malformed, and unsuccessful D1 results;
  - admin guard precedence;
  - strict Origin and Content-Type behavior;
  - exact one-field form parsing and rejection of repeated/additional values;
  - clock use only after validation;
  - clock/serialization failure handling;
  - correct enabled/disabled route value passed to the repository;
  - 303 response headers and empty body;
  - row forms contain only the validated album ID and correct action;
  - no permission mutation or forbidden data exposure;
  - preserved GET inventory, pagination, authentication, and failure behavior.
- Update Workers documentation for both POST routes and their effect on viewer
  availability.

## Files To Inspect

- `docs/handoffs/archive/2026-06-18-admin-permission-grant-revoke.md`
- `workers/migrations/0002_albums_permissions.sql`
- `workers/src/index.tsx`
- `workers/src/routes/admin.tsx`
- `workers/src/services/admin-album-repository.ts`
- `workers/src/services/admin-permission-repository.ts`
- `workers/src/services/authorized-album-repository.ts`
- `workers/src/services/repository-validation.ts`
- `workers/test/admin-routes.test.ts`
- `workers/test/admin-album-repository.test.ts`
- `workers/test/helpers/mock-d1.ts`
- `workers/README.md`

## Files To Edit

- `workers/src/index.tsx` (only if dependency wiring requires adjustment)
- `workers/src/routes/admin.tsx`
- `workers/src/services/admin-album-repository.ts`
- `workers/public/styles.css` (only if required for minimal readable forms)
- `workers/test/admin-routes.test.ts`
- `workers/test/admin-album-repository.test.ts`
- `workers/test/helpers/mock-d1.ts` (only if existing run-result modeling is
  insufficient)
- `workers/README.md`

Stop before editing any other file.

## Constraints

- Preserve every Non-Negotiable Invariant in `AGENTS.md`.
- Preserve the existing Cloudflare Access JWT and administrator allowlist.
- Reuse the strict admin mutation helpers where practical. Do not weaken their
  behavior to accommodate the one-field album form.
- Reuse dependency injection and the existing clock.
- Keep the existing `AdminAlbumRepository`; add only the narrow enabled-state
  mutation method.
- Use bound parameters only. Do not use dynamic SQL.
- Do not query before updating and do not inspect affected-row counts to
  distinguish existence or prior state.
- Do not delete or modify permission rows when disabling an album.
- Do not select, update, return, render in new controls, or log
  `photoprism_album_uid`, transform settings, `strip_exif`, R2 keys/objects,
  manifests, PhotoPrism/NAS details, password hashes, sessions, or Access
  identity.
- Do not add mutable module-level request state.
- Do not add dependencies, migrations, JSON APIs, or client-side JavaScript.
- Keep every admin response non-cacheable and every error fixed and sanitized.

## Non Goals

- Creating, deleting, renaming, or expiring albums.
- Editing download settings, PhotoPrism UID, thumbnail/preview settings, or
  `strip_exif`.
- Creating or deleting permissions as part of enable/disable.
- User administration, password/session operations, or lock management.
- Bulk album operations.
- Sync requests, sync status, audit storage/UI, R2 inspection, cleanup, or
  deletion.
- Cloudflare Access application creation or Worker value registration.
- Migrations, dependency updates, deployment, production mutation/smoke tests,
  commit, push, or handoff archival.
- General admin UI redesign.

## Verification

Run from `workers/`:

```powershell
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm audit
```

Also review the final diff for:

- admin guard precedence;
- strict same-origin and exact form handling;
- a single parameterized UPDATE of `albums`;
- only `enabled` and `updated_at` changed;
- no permission mutation, schema change, dependency change, or forbidden data;
- idempotent/non-disclosing behavior;
- fixed no-store errors and empty 303 responses;
- no real IDs, titles, emails, tokens, keys, or secrets.

If full `npm audit` fails only for the tracked Wrangler/Miniflare
devDependency advisories, report the exact result and also run:

```powershell
npm audit --omit=dev --audit-level=high
```

Do not change dependencies solely to silence the tracked advisory.

## Expected Report

Report:

- changed files;
- exact enable/disable request and response behavior;
- exact UPDATE SQL and bound parameter order;
- how no-op, unknown ID, and D1 failures are handled;
- proof that permissions and forbidden album fields are untouched;
- verification commands and results;
- dependency/audit result;
- skipped or blocked checks with exact reasons;
- any required out-of-scope edit or design question.
