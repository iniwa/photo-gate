# Admin User Enable And Disable

Status: active.

Read AGENTS.md, CLAUDE.md, and this handoff file before implementation.
If implementation would violate constraints or require files outside this
handoff, stop and ask before editing.

This handoff is intentionally explicit for direct Sonnet execution. Follow the
specified contract and existing admin mutation patterns; do not redesign the
authentication, session, or administration architecture.

## Goal

Add narrow administrator controls to enable or disable an existing viewer user
without changing the user's password, permissions, login-failure state,
sessions, display name, or any album/R2 data.

## Background

- The deployed `/admin` router validates the Cloudflare Access JWT and the
  administrator email allowlist before every admin route.
- `GET /admin/users` already displays the approved seven-field user summary.
- Album enable/disable established the current strict one-field admin mutation
  contract: admin guard first, exact same-origin POST, exact URL-encoded
  Content-Type with an optional single charset parameter, strict body parsing,
  injected clock, sanitized no-store failures, empty 303 redirect, and
  validated D1 run results.
- Viewer login already fetches only `users.enabled = 1`.
- Every existing session lookup joins `users` and requires
  `u.enabled = 1`. Album and permission authorization also require the user to
  be enabled. Disabling a user therefore blocks login and makes existing
  sessions unusable on their next request without deleting session rows.
- This task deliberately preserves session rows. Re-enabling a user may make an
  otherwise unexpired preserved session usable again. Do not silently change
  that behavior in this handoff; session revocation is a separate operation.
- `users.updated_at` must change only when the enabled state actually changes.

## Acceptance Criteria

- Extend each row in `GET /admin/users` with exactly one server-rendered form:
  - an enabled user shows a disable form;
  - a disabled user shows an enable form;
  - the form contains only one hidden `userId` value from the validated row;
  - no client-side JavaScript.
- Add exactly these routes:
  - `POST /admin/users/enable`
  - `POST /admin/users/disable`
- The existing admin guard must run before request-shape validation, clock use,
  or repository use. Any Access failure remains the existing generic `403
  Forbidden`, no-store.
- Reuse the existing strict admin mutation security contract:
  - require an `Origin` header exactly equal to the request URL origin;
  - absent, literal `null`, malformed, or mismatched Origin returns generic
    `403 Forbidden`, no-store, before body parsing, clock, or repository use;
  - accept only `application/x-www-form-urlencoded`, either without parameters
    or with exactly one valid `charset` parameter;
  - reject missing Content-Type, other media types, non-charset parameters, or
    additional parameters with generic `400 Bad Request`, no-store, before
    body parsing, clock, or repository use.
- Parse the user mutation form strictly:
  - require exactly one key named `userId`;
  - require exactly one string value;
  - reject missing, repeated, file-valued, additional, empty, or invalid IDs;
  - return generic `400 Bad Request`, no-store;
  - never reflect input and never call the clock or repository.
- Do not weaken the existing permission or album form parsers. A separate
  `parseUserIdField` is acceptable. A small shared exact-single-ID helper is
  acceptable only if focused tests prove album and permission behavior remains
  unchanged.
- Resolve `updated_at` only after all request validation succeeds:
  - use the existing injected clock;
  - serialize with `toISOString()`;
  - clock exceptions or invalid dates return fixed `500 Internal Server Error`,
    no-store, before repository use.
- Extend `AdminUserRepository` with one narrow method:
  `setUserEnabled(userId, enabled, updatedAt)`.
- Repository validation must occur before preparing SQL:
  - valid user ID;
  - `enabled` exactly numeric `0` or `1`;
  - canonical UTC `updatedAt`.
- Use one parameterized statement equivalent to:

  ```sql
  UPDATE users
  SET enabled = ?, updated_at = ?
  WHERE id = ? AND enabled <> ?
  ```

  Bind in this exact order:

  ```text
  enabled, updatedAt, userId, enabled
  ```

- The mutation must be idempotent and non-disclosing:
  - enabling an already-enabled user is a successful no-op;
  - disabling an already-disabled user is a successful no-op;
  - an unknown user ID is also a successful no-op;
  - do not reveal whether the user exists or whether its state changed.
- A no-op must not change `updated_at`; retain the `enabled <> ?` predicate.
- Do not pre-query the user and do not inspect affected-row counts.
- Treat D1 prepare, bind, run, malformed/missing result, or `success !== true`
  as the same sanitized database operation failure.
- On success, both routes return:
  - `303 See Other`;
  - `Location: /admin/users`;
  - `Cache-Control: no-store`;
  - empty body.
- On mutation failure, both routes return fixed `500 Internal Server Error`,
  no-store, with no ID, timestamp, SQL, binding, existence, prior-state, or D1
  detail.
- Do not log administrator identity, viewer identity, form values, IDs, state
  transitions, D1 errors, or operation details.
- Disabling a user must not:
  - delete or update `sessions`;
  - delete or update `album_permissions`;
  - change `password_hash`, `display_name`, `fail_count`, `locked_until`,
    `created_at`, or any album field;
  - read or write R2.
- Preserve the existing runtime authorization behavior:
  - disabled users cannot log in because auth requires `enabled = 1`;
  - preserved sessions for disabled users fail on the next request because
    session lookup requires `u.enabled = 1`;
  - permission and album authorization continue to require `u.enabled = 1`;
  - re-enabling does not reset lockout state and does not create a session.
- Preserve:
  - the existing seven-column user inventory query and validation;
  - user pagination and empty state;
  - all album and permission mutations;
  - every existing admin and viewer route;
  - all security headers and no-store behavior.
- Add focused repository and route tests covering:
  - exact single-table `UPDATE users` SQL shape;
  - only `enabled` and `updated_at` in the SET clause;
  - required `id = ? AND enabled <> ?` predicate;
  - exact bound parameter order;
  - no input literals, SELECT, JOIN, INSERT, DELETE, aggregate, or unrelated
    table mutation;
  - no `sessions` or `album_permissions` reference in the mutation SQL;
  - no `password_hash`, `display_name`, `fail_count`, or `locked_until` in the
    mutation SQL;
  - repository validation before D1;
  - success for changed, already-same, and unknown-user run results;
  - sanitized thrown, null, malformed, and unsuccessful D1 results;
  - admin guard precedence;
  - strict Origin and Content-Type behavior, including rejection of
    non-charset and multiple parameters;
  - exact one-field form parsing and rejection of repeated/additional values;
  - clock use only after validation;
  - clock/serialization failure handling;
  - correct numeric value passed by enable and disable routes;
  - 303 response headers and empty body;
  - each user row renders exactly one correct action form containing only the
    validated user ID;
  - no password, Access identity, session token/hash, permission, album, or R2
    data exposure;
  - preserved GET inventory, pagination, authentication, and failure behavior;
  - preserved album enable/disable and permission grant/revoke route behavior.
- Update Workers documentation for both POST routes and state explicitly:
  - disabling blocks login and existing-session use through existing
    `users.enabled` checks;
  - session and permission rows are retained;
  - re-enabling may restore use of an unexpired retained session;
  - lockout counters and timestamps are not reset.

## Files To Inspect

- `docs/handoffs/archive/2026-06-19-admin-album-enable-disable.md`
- `workers/migrations/0001_users_sessions.sql`
- `workers/src/index.tsx`
- `workers/src/routes/admin.tsx`
- `workers/src/services/admin-user-repository.ts`
- `workers/src/services/admin-album-repository.ts`
- `workers/src/services/auth-repository.ts`
- `workers/src/services/session-repository.ts`
- `workers/src/services/authorized-album-repository.ts`
- `workers/src/services/permission-repository.ts`
- `workers/src/services/repository-validation.ts`
- `workers/test/admin-routes.test.ts`
- `workers/test/admin-user-repository.test.ts`
- `workers/test/helpers/mock-d1.ts`
- `workers/README.md`

## Files To Edit

- `workers/src/index.tsx` (only if dependency typing/wiring requires adjustment)
- `workers/src/routes/admin.tsx`
- `workers/src/services/admin-user-repository.ts`
- `workers/public/styles.css` (only if required for minimal readable forms)
- `workers/test/admin-routes.test.ts`
- `workers/test/admin-user-repository.test.ts`
- `workers/test/helpers/mock-d1.ts` (only if existing run-result modeling is
  insufficient)
- `workers/README.md`

Stop before editing any other file.

## Constraints

- Preserve every Non-Negotiable Invariant in `AGENTS.md`.
- Preserve the existing Cloudflare Access JWT and administrator allowlist.
- Reuse the current strict admin mutation helpers and dependency injection where
  practical. Do not loosen Origin, Content-Type, or form validation.
- Keep the existing `AdminUserRepository`; add only the narrow enabled-state
  mutation method.
- Use bound parameters only. Do not use dynamic SQL.
- Do not query before updating and do not inspect affected-row counts.
- Do not delete, revoke, rotate, or modify sessions in this task.
- Do not delete or modify permission rows.
- Do not reset `fail_count` or `locked_until` on enable or disable.
- Do not select, update, return in new controls, render, or log password hashes,
  session hashes/tokens, permission data, album data, PhotoPrism/NAS details,
  R2 keys/objects, manifests, or Access identity.
- Do not add mutable module-level request state.
- Do not add dependencies, migrations, JSON APIs, or client-side JavaScript.
- Keep every admin response non-cacheable and every error fixed and sanitized.

## Non Goals

- Creating, deleting, renaming, or editing user display names.
- Setting, changing, resetting, or displaying passwords.
- Clearing login failures, unlocking accounts, or editing lockout policy.
- Deleting sessions, logout-all, session inventory, or session revocation.
- Granting or revoking album permissions.
- Creating, deleting, or otherwise editing albums.
- Bulk user operations.
- Sync requests/status, audit storage/UI, R2 inspection, cleanup, or deletion.
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
- strict same-origin, exact Content-Type, and exact form handling;
- one parameterized UPDATE of `users`;
- only `enabled` and `updated_at` changed;
- no session, permission, album, schema, dependency, or R2 change;
- idempotent and non-disclosing behavior;
- fixed no-store errors and empty 303 responses;
- no real IDs, names, emails, tokens, hashes, keys, or secrets.

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
- how same-state, unknown ID, and D1 failures are handled;
- proof that password, lockout, session, permission, album, and R2 data are
  untouched;
- the exact effect on new logins, existing sessions, and re-enabled users;
- verification commands and results;
- dependency/audit result;
- skipped or blocked checks with exact reasons;
- any required out-of-scope edit or design question.
