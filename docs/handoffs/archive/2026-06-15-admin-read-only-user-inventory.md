# Admin Read-Only User Inventory

Status: completed and reviewed by Codex on 2026-06-15. Deployment remains a
separate delivery action.

Read AGENTS.md, CLAUDE.md, and this handoff file before implementation.
If implementation would violate constraints or require files outside this
handoff, stop and ask before editing.

## Goal

Add the first narrow administration feature: an authenticated, read-only,
paginated user inventory at `GET /admin/users`.

This handoff must not add any user mutation, password handling, session
inspection, album management, or permission management.

## Background

- The reviewed `/admin` Cloudflare Access boundary protects every admin path
  with Worker-side JWT verification and an administrator email allowlist.
- `GET /admin` currently renders a minimal placeholder page.
- The existing D1 `users` table contains both safe operational fields and
  highly sensitive `password_hash` data. The admin repository must explicitly
  select and reconstruct only the approved fields.
- Existing repositories use parameterized queries, strict row validation,
  sanitized database errors, bounded limits, and keyset pagination.
- Production Access setup and deployment remain separate operator/delivery
  actions. This task is local implementation and verification only.

## Acceptance Criteria

- Add `GET /admin/users`, protected by the existing admin guard.
- Add a link from `GET /admin` to `/admin/users`.
- List only these fields for each user:
  - `id`
  - `display_name`
  - `enabled`
  - `fail_count`
  - `locked_until`
  - `created_at`
  - `updated_at`
- Never select, return, render, log, or otherwise expose `password_hash`.
- Never query or expose session tokens, token hashes, session rows, albums,
  permissions, PhotoPrism identifiers, R2 keys, or viewer data.
- Implement a dedicated admin user repository with keyset pagination:
  - order by `id ASC`;
  - page size exactly 50;
  - query at most 51 rows, return at most 50, and use the extra row only to
    determine whether a next page exists;
  - optional `after` cursor using a valid user ID;
  - no `OFFSET`;
  - all values bound as parameters;
  - request enough rows to determine whether a next page exists without
    issuing a count query.
- Invalid or repeated `after` query values fail closed with a generic `400 Bad
  Request`, `Cache-Control: no-store`, and no reflected input.
- Strictly validate every D1 row before returning it:
  - valid ID using the existing ID rules;
  - `display_name` string, at most 1024 Unicode code points;
  - `enabled` exactly `0` or `1`;
  - `fail_count` a non-negative integer;
  - `locked_until` either `null` or a canonical UTC timestamp;
  - `created_at` and `updated_at` canonical UTC timestamps;
  - duplicate IDs or malformed D1 result shapes are errors.
- D1/binding/query/row-validation failures return a fixed generic `500`
  response with `Cache-Control: no-store`. Do not log or echo D1 errors, IDs,
  names, timestamps, cursor values, SQL, or binding details.
- Successful admin pages use `Cache-Control: no-store` and retain the existing
  security headers.
- The page clearly shows enabled/disabled state, failed-login count, lock
  state, and timestamps without adding mutation controls.
- Empty results render a safe empty state.
- Pagination links contain only the validated next user ID.
- Existing `/admin` authentication behavior, authenticated admin 404 behavior,
  viewer routes, D1 schema, and all security invariants remain unchanged.
- Add focused repository and route tests covering SQL shape, parameterization,
  row validation, pagination, empty state, malformed cursor behavior, generic
  failures, leak resistance, and preserved admin authentication.
- Update Workers documentation for the new read-only route.

## Files To Inspect

- `docs/handoffs/archive/2026-06-15-admin-access-auth-foundation.md`
- `workers/migrations/0001_users_sessions.sql`
- `workers/src/index.tsx`
- `workers/src/routes/admin.tsx`
- `workers/src/services/repository-validation.ts`
- `workers/src/services/authorized-album-repository.ts`
- `workers/src/templates/layout.tsx`
- `workers/public/styles.css`
- `workers/test/admin-routes.test.ts`
- `workers/test/authorized-album-repository.test.ts`
- `workers/test/helpers/mock-d1.ts`
- `workers/README.md`

## Files To Edit

- `workers/src/index.tsx`
- `workers/src/routes/admin.tsx`
- `workers/src/types/admin-user.ts` (new)
- `workers/src/services/admin-user-repository.ts` (new)
- `workers/public/styles.css` (only if needed for a minimal readable table/list)
- `workers/test/admin-routes.test.ts`
- `workers/test/admin-user-repository.test.ts` (new)
- `workers/README.md`

If a different new test filename is clearly better, keep it under
`workers/test/` and report the change. Stop before editing any other file.

## Constraints

- Preserve every Non-Negotiable Invariant in `AGENTS.md`.
- Preserve the existing Cloudflare Access JWT and allowlist boundary without
  weakening, bypassing, duplicating, or replacing it.
- Reuse existing repository validation and error-sanitization patterns.
- Use explicit SQL columns. `SELECT *` is forbidden.
- `password_hash` and session data must not appear in implementation SQL,
  returned types, route dependencies, rendered HTML, logs, errors, fixtures, or
  snapshots. Tests may mention these names only in negative assertions proving
  they are absent.
- Do not add aggregate counts that require scanning all users.
- Do not add mutable module-level request state.
- Do not add client-side JavaScript.
- Do not add dependencies or migrations.
- Do not add forms, POST routes, action buttons, hidden mutation endpoints, or
  mutation repository methods.
- Do not display or persist the Access administrator email from the JWT.
- Keep every admin response non-cacheable.
- Keep failures fixed and sanitized; never expose raw exceptions.
- Use dependency injection so route tests use fake repositories without D1.

## Non Goals

- Creating, enabling, disabling, unlocking, renaming, or deleting users.
- Password creation, reset, hashing, display, or rotation.
- Session listing, revocation, or cleanup.
- Album or permission listing/management.
- Admin audit logging or sync status.
- D1 migrations.
- Access application creation, Worker value registration, deployment,
  production smoke tests, commit, push, or handoff archival.
- General UI redesign.

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

- no `password_hash` or session query/exposure in the new implementation;
- no mutation routes, controls, SQL, or methods;
- no auth bypass or change to the existing admin guard;
- parameterized, bounded, keyset-paginated SQL only;
- fixed sanitized errors and `no-store` admin responses;
- no real user IDs, display names, emails, tokens, or secrets.

## Expected Report

Report:

- changed files;
- implementation summary;
- exact `GET /admin/users` success, pagination, bad-cursor, and failure
  behavior;
- exact selected D1 columns and confirmation that password/session data is
  absent;
- verification commands and results;
- dependency/audit result;
- any skipped or blocked checks with exact reasons;
- any required out-of-scope edit or design question.
