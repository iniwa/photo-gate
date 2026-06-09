Read `AGENTS.md`, `CLAUDE.md`, `photo-gate-design.md`, the accepted Workers UI/auth decision, archived handoffs, existing Workers implementation, and this handoff before implementation.
If implementation would violate constraints or require files outside this handoff, stop and ask before editing.

## Goal

Build a route-independent D1 repository for discovering only the albums an authenticated shared user is currently authorized to view.

This handoff adds:

- minimal viewer-facing authorized-album types
- a narrowly scoped authorized-album catalog repository
- deterministic, bounded keyset pagination
- fail-closed and sanitized D1 behavior
- comprehensive parameterized-query tests

Do not connect a D1 binding, replace fixture routes, read R2, or expose real data in this handoff.

## Background

Completed Phase 3 foundations provide session authentication and per-album authorization middleware. Future authenticated album-list and album-detail routes also need a safe D1 query boundary that returns only albums explicitly permitted to the authenticated user.

The D1 `albums` table contains internal configuration that shared viewers do not need, including:

- `photoprism_album_uid`
- image-generation settings
- metadata stripping settings
- download settings

Viewer-facing repository methods must not return those fields. R2 manifests remain the source for photo lists and generated image details.

## Security Decisions For This Handoff

### Viewer-Facing Album Data

Define minimal viewer-facing records:

```typescript
interface AuthorizedAlbumSummary {
  id: string
  title: string
}
```

Do not include:

- `photoprism_album_uid`
- image settings
- `strip_exif`
- `download_enabled`
- permission rows
- user IDs
- session data
- R2 keys or manifest contents
- created/updated timestamps

### Repository Methods

Create a small repository with these explicit operations:

```typescript
listAuthorizedAlbums(userId, now, limit, afterAlbumId?)
getAuthorizedAlbum(userId, albumId, now)
```

`listAuthorizedAlbums` must:

- require a safe authenticated `userId`
- require a canonical UTC `now`
- require an explicit integer `limit` from `1` through `100`
- accept an optional safe `afterAlbumId` keyset cursor
- return only `AuthorizedAlbumSummary[]`
- use deterministic ascending `albums.id` ordering
- use keyset pagination (`a.id > ?`) when a cursor is provided
- never use offset pagination
- expose no separate next-cursor field; callers may use the last returned album ID as the next cursor

`getAuthorizedAlbum` must:

- require safe authenticated user and album IDs
- require canonical UTC `now`
- return one minimal summary or `null`

Both operations must require, within the same parameterized SQL query:

- an explicit `album_permissions` row for the supplied user and album
- `users.enabled = 1`
- `albums.enabled = 1`
- `albums.expires_at IS NULL OR albums.expires_at > now`

Do not rely only on middleware authorization. The repository query itself must preserve the same authorization conditions so it cannot become an accidental data-enumeration boundary.

### Input And Row Validation

Validate all IDs, timestamps, limits, cursors, and D1-returned rows at the repository boundary.

Rules:

- invalid list/get inputs must fail before D1 access
- invalid `userId` returns `[]` from list and `null` from get without querying D1
- invalid `albumId` returns `null` from get without querying D1
- invalid pagination limits or canonical timestamps throw generic validation errors
- invalid `afterAlbumId` throws a generic validation error before D1 access
- D1 rows must contain only safe IDs and string titles
- reject unexpected, malformed, or duplicate rows from D1 rather than returning them
- titles may be empty because the current schema and Docker contract allow empty strings
- define an authorized-album repository/type-local title limit of `1,024` Unicode code points; do not couple this repository to the manifest validator

Do not trust D1 return types solely because a generic type argument was supplied.

### Failure Behavior

- expected absence returns `null` or an empty list
- invalid authorization identifiers fail closed without querying D1
- D1 failures and malformed D1 rows throw the existing sanitized `database operation failed` error
- errors must not include user IDs, album IDs, cursor values, titles, SQL, bound parameters, or underlying exception details
- do not silently convert D1 failures into empty successful results

## Files To Inspect

- `AGENTS.md`
- `CLAUDE.md`
- `photo-gate-design.md`
- `docs/decisions/2026-06-09-workers-ui-and-auth-foundation.md`
- `docs/handoffs/archive/2026-06-09-phase-3-auth-session-foundation.md`
- `docs/handoffs/archive/2026-06-09-phase-3-session-album-authorization-middleware.md`
- `workers/migrations/0002_albums_permissions.sql`
- `workers/src/services/permission-repository.ts`
- `workers/src/services/repository-validation.ts`
- `workers/src/services/safe-id.ts`
- `workers/src/types/album.ts`
- `workers/test/helpers/mock-d1.ts`
- existing repository tests

## Files To Create Or Edit

- `workers/src/types/authorized-album.ts`
- `workers/src/services/authorized-album-repository.ts`
- focused tests under `workers/test/`
- `workers/test/helpers/mock-d1.ts` only if a focused enhancement is required to return `.all()` rows
- `workers/README.md`

Edit another existing file only if a focused correction is required for this repository contract. Explain any such change in the report.

Do not edit:

- `workers/src/index.tsx`
- `workers/wrangler.toml`
- `workers/src/types/env.ts`
- migrations
- fixture routes or fixture data
- R2/object services
- Docker implementation

## SQL And Pagination Constraints

- Use D1 `.prepare().bind()` parameter binding for every caller-supplied value.
- Never interpolate identifiers, timestamps, limits, cursors, or values into SQL.
- Select only `a.id` and `a.title`.
- Do not use `SELECT *`.
- Use explicit joins to `album_permissions`, `albums`, and `users`.
- Use deterministic `ORDER BY a.id ASC`.
- Bind the explicit limit; do not hardcode or interpolate it into SQL.
- When `afterAlbumId` is absent, do not bind a fabricated cursor value.
- When `afterAlbumId` is present, require `a.id > ?`.
- Do not implement total counts, offset pagination, search, fuzzy matching, or title sorting.

## Test Strategy

Tests must run without Cloudflare credentials, a real/local D1 database, R2, network access, secrets, or deployment.

Enhance the existing D1 test double narrowly if needed. Do not add an ORM or general database abstraction.

At minimum test:

- list query selects only album ID and title
- list query joins permissions, albums, and users
- list query requires explicit permission, enabled user, enabled album, and non-expired album
- list query uses deterministic ID ordering and no offset
- list query without cursor binds user ID, timestamp, and limit only
- list query with cursor adds `a.id > ?` and binds the cursor
- get query requires the same authorization conditions
- get query selects only album ID and title
- SQL never contains caller-supplied IDs, timestamps, cursors, titles, or limits as literals
- invalid user/album IDs fail closed before D1 access
- invalid cursor, timestamp, and limits fail before D1 access
- limits `1` and `100` are accepted; `0`, `101`, fractions, NaN, and infinity are rejected
- expected no-row results return empty list or `null`
- valid rows return minimal reconstructed objects only
- unexpected extra fields in D1 test rows are not propagated
- malformed IDs, non-string titles, over-limit titles, and duplicate IDs from D1 fail closed
- D1 failures throw only sanitized database errors
- errors never expose IDs, cursor values, SQL, bound parameters, titles, or underlying details
- no PhotoPrism UID, image settings, permission data, or internal album configuration can appear in returned values
- all existing Workers tests continue to pass

Do not write tests that only search source strings when behavior can be exercised through the D1 test double.

## README

Document:

- the authorized-album catalog repository
- the minimal viewer-facing album shape
- authorization conditions enforced by every query
- deterministic keyset pagination and explicit `1..100` limit
- that PhotoPrism UID and internal album configuration are not returned
- that no D1 binding, active route, fixture replacement, or real data access is connected yet
- local verification commands

Do not document credentials, account IDs, database IDs, deployment commands, migration-apply commands, or real album/user data.

## Constraints

- Preserve all architecture and security invariants in `AGENTS.md`.
- Preserve all current active route behavior.
- Do not connect the active app to D1 or R2.
- Do not add D1 or R2 bindings to `wrangler.toml`.
- Do not edit `workers/src/types/env.ts`.
- Do not apply migrations.
- Do not implement or wire login, album APIs, image routes, authenticated pages, or active data routes.
- Do not replace fixture data.
- Do not read R2 or serve real manifests/images.
- Do not create seed data or real records.
- Do not choose login, lockout, session-lifetime, refresh, cleanup, or binding policies.
- Do not deploy, publish, push, or commit automatically.

## Non Goals

- active route wiring
- D1 binding configuration
- migration application
- fixture replacement
- login/logout/me routes
- authentication or session policy
- album search or title sorting
- total counts or offset pagination
- manifest or R2 reads
- image delivery
- admin APIs or UI
- Cloudflare Access
- deployment or CI/CD

## Verification

From `workers/`:

```powershell
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm audit
```

From the repository root:

```powershell
git diff --check
git status --short
```

Verification must pass without:

- Cloudflare authentication or account access
- a real/local D1 database
- R2 or PhotoPrism
- Docker services
- secrets or `.env`
- network access after `npm ci`

## Expected Report

- Changed files
- Viewer-facing album type
- Repository methods and authorization conditions
- Pagination and input-validation behavior
- D1 row-validation and sanitized failure behavior
- Confirmation that active routes, bindings, migrations, fixtures, and R2 services are unchanged
- Dependency changes, if any
- Verification results
- Any blocked checks with exact reasons
- Questions that must return to Codex before active album routes or real D1 binding are implemented
