# Admin Permission Grant And Revoke

Status: active.

Read AGENTS.md, CLAUDE.md, and this handoff file before implementation.
If implementation would violate constraints or require files outside this
handoff, stop and ask before editing.

## Goal

Add the first narrow admin mutation workflow:

- grant a user access to an album;
- revoke a user's access to an album.

Both operations must stay behind the existing Cloudflare Access administrator
boundary and must be fail-closed against cross-origin or malformed requests.

## Background

- The deployed `/admin` router verifies the Cloudflare Access JWT and the
  administrator email allowlist before any admin route runs.
- `GET /admin/permissions` already provides a read-only, keyset-paginated
  inventory of `album_permissions`.
- `album_permissions` has a composite primary key `(album_id, user_id)` and
  foreign keys to `albums` and `users`.
- Viewer authorization already reads this table. A successful grant or revoke
  therefore changes viewer access without requiring a schema change.
- This is intentionally smaller than user creation, album configuration, sync
  administration, audit UI, or cleanup.

## Acceptance Criteria

- Extend `GET /admin/permissions` with:
  - one server-rendered grant form containing `albumId` and `userId`;
  - one server-rendered revoke form for each displayed permission row;
  - no client-side JavaScript.
- Add exactly these mutation routes:
  - `POST /admin/permissions/grant`
  - `POST /admin/permissions/revoke`
- The existing admin guard must run before all request-shape validation and
  repository calls. Missing, invalid, or non-allowlisted Access identity
  remains the existing generic `403 Forbidden`.
- For both POST routes, require an `Origin` header exactly equal to the request
  URL origin:
  - absent, `null`, malformed, or mismatched Origin returns generic `403`;
  - return `Cache-Control: no-store`;
  - do not parse the body, call the clock, or call a repository.
- Accept only `application/x-www-form-urlencoded`, with an optional charset
  parameter. Any other or missing Content-Type returns generic `400 Bad
  Request`, no-store, before repository or clock use.
- Parse the form without silently accepting ambiguity:
  - require exactly one string `albumId`;
  - require exactly one string `userId`;
  - reject missing, repeated, file-valued, or additional fields;
  - validate both values with the existing ID rule;
  - malformed or invalid input returns generic `400 Bad Request`, no-store;
  - never reflect input and never call the repository or clock.
- Grant behavior:
  - obtain `created_at` from an injected clock only after request validation;
  - serialize it as a canonical UTC timestamp;
  - use a single parameterized statement equivalent to:
    `INSERT INTO album_permissions (album_id, user_id, created_at)
     VALUES (?, ?, ?)
     ON CONFLICT(album_id, user_id) DO NOTHING`;
  - an already-existing permission is a successful idempotent no-op.
- Revoke behavior:
  - use a single parameterized statement equivalent to:
    `DELETE FROM album_permissions WHERE album_id = ? AND user_id = ?`;
  - an already-absent permission is a successful idempotent no-op.
- Repository methods must validate IDs and the grant timestamp before preparing
  SQL, even though the route also validates them.
- Treat D1 preparation, binding, execution, foreign-key, malformed result, or
  unsuccessful result as a sanitized database operation failure.
- Successful grant and revoke return `303 See Other` with:
  - `Location: /admin/permissions`;
  - `Cache-Control: no-store`;
  - no response body containing IDs or operation details.
- Mutation failures return fixed generic `500 Internal Server Error`,
  `Cache-Control: no-store`, with no raw error, SQL, IDs, timestamp, binding,
  user existence, or album existence detail.
- Do not log administrator identity, form values, D1 errors, IDs, or operation
  details.
- Preserve the existing read-only permission query, pagination behavior,
  approved three-column result shape, admin 404 behavior, viewer
  authorization, security headers, and every existing route.
- Add focused repository and route tests covering:
  - exact mutation SQL shape and table;
  - bound parameter order and absence of input literals in SQL;
  - no `SELECT`, join, aggregate, or unrelated table mutation;
  - idempotent success results;
  - ID and timestamp validation before D1;
  - sanitized D1 failures and unsuccessful/malformed run results;
  - Access guard precedence;
  - required same-origin header;
  - Content-Type enforcement;
  - exact form fields, duplicate rejection, invalid IDs, and no repository call;
  - successful `303` response and headers;
  - grant clock usage only after validation;
  - revoke forms containing only the validated row IDs;
  - preserved GET pagination and failure behavior.
- Update Workers documentation for the two new POST routes and their security
  behavior.

## Files To Inspect

- `docs/handoffs/archive/2026-06-15-admin-read-only-album-permission-inventory.md`
- `workers/migrations/0001_users_sessions.sql`
- `workers/migrations/0002_albums_permissions.sql`
- `workers/src/index.tsx`
- `workers/src/routes/admin.tsx`
- `workers/src/routes/auth-api.ts`
- `workers/src/middleware/require-admin.ts`
- `workers/src/services/admin-permission-repository.ts`
- `workers/src/services/repository-validation.ts`
- `workers/test/admin-routes.test.ts`
- `workers/test/admin-permission-repository.test.ts`
- `workers/test/helpers/mock-d1.ts`
- `workers/README.md`

## Files To Edit

- `workers/src/index.tsx`
- `workers/src/routes/admin.tsx`
- `workers/src/services/admin-permission-repository.ts`
- `workers/public/styles.css` (only if required for minimal readable forms)
- `workers/test/admin-routes.test.ts`
- `workers/test/admin-permission-repository.test.ts`
- `workers/test/helpers/mock-d1.ts` (only to model D1 run results)
- `workers/README.md`

Stop before editing any other file.

## Constraints

- Preserve every Non-Negotiable Invariant in `AGENTS.md`.
- Preserve the existing Cloudflare Access JWT verification and email allowlist
  without weakening, bypassing, duplicating, or replacing them.
- Same-origin validation for these admin mutations is stricter than the viewer
  login behavior: an absent Origin is not accepted.
- Reuse dependency injection. Route tests must use fake repositories and a fake
  clock without a real D1 or real Cloudflare request.
- Keep the existing repository class; add only the two narrow mutation methods.
- All SQL values must be bound parameters. Do not use dynamic SQL.
- Keep grant and revoke idempotent.
- Do not disclose whether a supplied user or album exists.
- Do not select or expose password hashes, sessions, display names, album
  titles, PhotoPrism identifiers, transform settings, object keys, manifests,
  R2 data, administrator email, or Access claims.
- Do not add mutable module-level request state.
- Do not add dependencies, migrations, JSON APIs, or client-side JavaScript.
- Keep every admin response non-cacheable.
- Keep errors fixed and sanitized.

## Non Goals

- Creating, renaming, enabling, disabling, expiring, or deleting users or
  albums.
- Setting or resetting passwords, login failures, locks, or sessions.
- Editing album titles, download settings, PhotoPrism UIDs, or transform
  settings.
- Bulk permission import/export, wildcard grants, role systems, or approval
  workflows.
- Sync request/status administration or operational audit storage/UI.
- R2 inspection, cleanup, or deletion.
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

- admin guard precedence on both POST routes;
- exact required Origin and form Content-Type handling;
- strict rejection of duplicate or additional form fields;
- parameterized, idempotent, single-statement mutation SQL only;
- no unrelated table writes, joins, reads, migrations, or dependencies;
- fixed no-store errors and empty 303 responses;
- no real IDs, titles, emails, tokens, keys, secrets, or provider details.

If full `npm audit` still fails only for the already-tracked Wrangler/Miniflare
devDependency advisories, report the exact result and also run:

```powershell
npm audit --omit=dev --audit-level=high
```

Do not change dependencies solely to silence the tracked advisory.

## Expected Report

Report:

- changed files;
- exact grant and revoke request/response behavior;
- exact SQL and bound parameter order;
- how duplicate/additional form values and Origin failures are rejected before
  D1;
- how idempotency and D1 failures are handled;
- confirmation that forbidden data is absent;
- verification commands and results;
- dependency/audit result;
- skipped or blocked checks with exact reasons;
- any required out-of-scope edit or design question.
