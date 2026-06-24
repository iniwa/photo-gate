Read AGENTS.md, CLAUDE.md, and this handoff file before implementation.
If implementation would violate constraints or require files outside this
handoff, stop and ask before editing.

## Goal

Add admin-only user creation and password reset operations to the existing
`/admin/users` surface.

This should let an allowlisted Cloudflare Access administrator:

- create a new viewer user with `id`, `display_name`, and an initial password;
- reset an existing viewer user's password;
- keep the existing user inventory, pagination, enable, and disable behavior.

## Background

Level 3 admin work already includes:

- Worker-side Cloudflare Access JWT verification and admin email allowlist;
- read-only `/admin/users`, `/admin/albums`, and `/admin/permissions`;
- idempotent permission grant/revoke;
- idempotent album enable/disable;
- idempotent user enable/disable.

The next useful gap is user lifecycle administration. Today an admin can enable
or disable a user but cannot add a new viewer user or rotate a viewer password
from the admin surface.

Existing password handling:

- `workers/src/services/auth-crypto.ts` exports `hashPassword`.
- `workers/src/services/login-policy.ts` exports
  `PBKDF2_PRODUCTION_ITERATIONS` (`100_000`).
- `workers/scripts/hash-password.mjs` documents the compatible encoded format.
- Login accepts passwords with length `1..1024`; preserve that limit unless a
  stronger local helper already exists.

Existing admin mutation pattern:

`requireAdmin` guard -> strict same-origin Origin -> strict
`application/x-www-form-urlencoded` Content-Type -> exact form-field validation
with `parseBody({ all: true })` -> clock/hash/repository -> `303` redirect.

## Acceptance Criteria

### Routes

Add two POST routes behind the existing `/admin` guard:

- `POST /admin/users/create`
- `POST /admin/users/reset-password`

Both routes must run in this order:

1. existing admin guard;
2. strict same-origin Origin check;
3. strict URL-encoded form Content-Type check;
4. exact form validation;
5. clock/hash/repository work only after the request is fully validated.

Expected responses:

- auth failure: existing generic `403 Forbidden`, `Cache-Control: no-store`;
- missing/null/malformed/mismatched Origin: `403 Forbidden`, no body detail,
  no repository call, no password hashing, no clock;
- wrong Content-Type: `400 Bad Request`, `Cache-Control: no-store`, no
  repository call, no password hashing, no clock;
- invalid form: `400 Bad Request`, `Cache-Control: no-store`, no repository
  call, no password hashing, no clock;
- hash failure, clock failure, D1 failure, duplicate user id, or unknown reset
  target: generic `500 Internal Server Error`, `Cache-Control: no-store`;
- success: `303` with `Location: /admin/users`, `Cache-Control: no-store`,
  empty body.

### Form Shape

`GET /admin/users` should render:

- a create-user form posting to `/admin/users/create`;
- a per-row password-reset form posting to `/admin/users/reset-password`;
- the existing per-row enable/disable forms unchanged.

Create form fields:

- `userId`
- `displayName`
- `password`

Reset form fields:

- `userId`
- `password`

Validation must reject missing, repeated, file-valued, extra, empty, or invalid
fields. Use `parseBody({ all: true })` so repeated fields become arrays and are
rejected.

Validation rules:

- `userId`: existing `isValidId`;
- `displayName`: non-empty string, at most 1024 code points, no ASCII control
  characters, and no leading/trailing whitespace;
- `password`: string length `1..1024`; do not trim or normalize it.

Do not reflect invalid input in any response.

### Repository Behavior

Extend `AdminUserRepository` narrowly.

Create user:

- single parameterized `INSERT INTO users (...) VALUES (?, ?, ?, 1, 0, NULL, ?, ?)`;
- bind order must be exactly:
  `(userId, displayName, passwordHash, createdAt, updatedAt)`;
- initial state is enabled (`1`), `fail_count = 0`, `locked_until = NULL`,
  `created_at = createdAt`, `updated_at = updatedAt`;
- duplicate `id` is a generic database operation failure; do not pre-check;
- no session, album, permission, R2, or PhotoPrism data is touched.

Reset password:

- single parameterized `UPDATE users SET password_hash = ?, fail_count = 0, locked_until = NULL, updated_at = ? WHERE id = ?`;
- bind order must be exactly `(passwordHash, updatedAt, userId)`;
- unknown `userId` is treated as a generic database operation failure by
  checking D1 change metadata when available; do not reveal whether the user
  exists;
- existing session rows are not deleted or updated;
- permissions are not touched;
- `enabled`, `display_name`, and `created_at` are not changed.

For both repository methods:

- validate `userId`, timestamp, password hash shape, and display name before
  preparing SQL;
- wrap D1 failures as the existing generic `database operation failed`;
- never include user id, display name, password, password hash, SQL, or D1 error
  details in thrown messages.

Password hash shape can be validated with a local helper matching the existing
encoded format:

`pbkdf2-sha256$100000$<base64url salt>$<base64url digest>`

Do not export or expose raw password hashes outside repository write paths.

### Password Handling

- Use `hashPassword(password, PBKDF2_PRODUCTION_ITERATIONS)` from existing
  services.
- Hash only after all cheap request validation passes.
- Do not pass the password to the repository.
- Do not log, render, store in context, return, or include the password or hash
  in any error message.
- The reset form should use `<input type="password" name="password" ...>`.
- It is acceptable that browser form input contains the plaintext password in
  the POST body; the Worker must not echo it.

### UI / Output Safety

- Existing user inventory still selects and renders only the approved seven
  read columns; it must not select or render `password_hash`.
- New forms must never render existing password hashes.
- The admin Access email must not be rendered.
- All admin responses remain `no-store`.
- No client-side JavaScript.

## Files To Inspect

- `AGENTS.md`
- `CLAUDE.md`
- `FABLE.md`
- `docs/fable/current-state.md`
- `docs/fable/roadmap.md`
- `docs/fable/progress.md`
- `workers/src/routes/admin.tsx`
- `workers/src/services/admin-user-repository.ts`
- `workers/src/services/auth-crypto.ts`
- `workers/src/services/login-policy.ts`
- `workers/src/services/repository-validation.ts`
- `workers/src/index.tsx`
- `workers/migrations/0001_users_sessions.sql`
- `workers/test/admin-routes.test.ts`
- `workers/test/admin-user-repository.test.ts`
- `workers/test/auth-crypto.test.ts`
- `workers/test/helpers/mock-d1.ts`
- `workers/README.md`

## Files To Edit

- `workers/src/routes/admin.tsx`
- `workers/src/services/admin-user-repository.ts`
- `workers/test/admin-routes.test.ts`
- `workers/test/admin-user-repository.test.ts`
- `workers/README.md`

Only edit `workers/src/index.tsx` if the route dependency shape cannot be kept
compatible by extending `AdminUserRepository` in place.

Only edit `workers/test/helpers/mock-d1.ts` if existing D1 run-result support is
insufficient for checking changed-row metadata.

Do not edit migrations unless you find a real schema incompatibility; the
expected solution needs no migration.

## Constraints

- Preserve every invariant in `AGENTS.md`.
- Stay within the existing admin mutation security pattern.
- Keep errors sanitized and fail closed.
- Use parameterized D1 statements only.
- Do not add dependencies.
- Do not introduce email fields; users are identified by existing `id`.
- Do not delete or mutate sessions when resetting a password.
- Do not grant or revoke album permissions while creating/resetting users.
- Do not expose password hashes in SQL SELECTs, returned types, HTML, tests,
  logs, README examples, or error output except where testing write SQL
  structure requires checking the literal column name.
- Do not change viewer login semantics except that a reset password should work
  through the existing login path once stored.
- Preserve existing mojibake text unless directly editing nearby UI labels; do
  not perform broad encoding cleanup.

## Non Goals

- Album create/edit/delete.
- User delete.
- Session revocation.
- Password confirmation fields, generated passwords, or password policy beyond
  the stated length limit.
- Sync administration.
- Audit log storage.
- R2 cleanup.
- Production mutation, smoke testing against production, deploy, commit, push,
  or handoff archival.

## Verification

Run from `workers/`:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm audit
npm audit --omit=dev --audit-level=high
```

If any check is skipped or blocked, report the exact command and reason.

## Expected Report

Report back with:

- changed files;
- exact route behavior for create and reset-password;
- exact SQL statements and bind orders;
- proof that password plaintext and password hashes are not exposed in HTML,
  logs, errors, read SELECTs, or returned objects;
- whether sessions, permissions, albums, and R2 data remain untouched;
- verification results with command names;
- any out-of-scope edits or design questions.
