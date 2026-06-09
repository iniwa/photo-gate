Read `AGENTS.md`, `CLAUDE.md`, `photo-gate-design.md`, the accepted Workers UI/auth decision, archived handoffs, existing Workers implementation, and this handoff before implementation.
If implementation would violate constraints or require files outside this handoff, stop and ask before editing.

## Goal

Build the Phase 3 authentication and authorization foundation without exposing real data or enabling login routes yet.

This handoff adds:

- D1 schema migrations for users, sessions, albums, and album permissions
- strict TypeScript binding and domain types
- PBKDF2-SHA256 password hash/verify primitives using Web Crypto
- opaque session token generation and SHA-256 digesting
- secure session-cookie parsing and serialization
- narrowly scoped D1 repositories for users, sessions, and album permissions
- comprehensive in-process tests

Real login/logout/me routes, authenticated pages, R2 reads, and deployment remain out of scope.

## Background

The accepted decision in `docs/decisions/2026-06-09-workers-ui-and-auth-foundation.md` establishes:

- shared viewers authenticate through a D1-backed Workers login
- passwords use PBKDF2-SHA256
- session tokens are random opaque 32-byte values
- only SHA-256 session-token digests are stored in D1
- session cookies are `HttpOnly`, `Secure`, and `SameSite=Strict`
- every future manifest/image route must verify both session and album permission

Phase 2 currently serves fixture-only HTML and returns `401` for all `/api`, `/img`, and `/admin` routes. Preserve that behavior in this handoff.

## Security Decisions For This Handoff

### Password Hash Encoding

Use this explicit storage format:

```text
pbkdf2-sha256$<iterations>$<salt-base64url>$<digest-base64url>
```

Requirements:

- PBKDF2 with HMAC-SHA256
- random 16-byte salt for newly generated hashes
- 32-byte derived key
- stored iteration count must be parsed and validated
- reject malformed encodings and unsupported algorithms
- reject iteration counts below `100000` or above a documented defensive maximum
- compare derived keys in constant-time application code
- never include passwords, hashes, salts, session tokens, or token digests in error messages

The production iteration count is intentionally not decided in this handoff. Hash creation must require an explicit iteration count so a later Workers CPU benchmark can select the production value. Tests may use the minimum valid value.

### Session Model

- generate session tokens with `crypto.getRandomValues()` using exactly 32 random bytes
- encode browser-visible tokens as unpadded base64url
- store only lowercase hexadecimal SHA-256 digests in D1
- raw session tokens must never be accepted by repository storage methods
- session lifetime is supplied explicitly by callers; do not choose sliding versus fixed expiration here
- cookie name: `photo_gate_session`
- cookie attributes: `HttpOnly; Secure; SameSite=Strict; Path=/`
- session-cookie creation must include an explicit positive `Max-Age`
- cookie clearing must use `Max-Age=0`
- cookie parsing must reject duplicate session-cookie names, malformed base64url, and tokens that are not exactly 32 decoded bytes

### D1 Data Model

Create two migrations:

```text
workers/migrations/0001_users_sessions.sql
workers/migrations/0002_albums_permissions.sql
```

Use the accepted decision as the schema source. Add appropriate foreign keys, checks, and indexes needed for session lookup, expiration cleanup, and permission lookup.

At minimum:

- `users`: id, display_name, password_hash, enabled, fail_count, locked_until, created_at, updated_at
- `sessions`: token_hash, user_id, created_at, expires_at, last_seen_at
- `albums`: accepted design fields from `photo-gate-design.md`
- `album_permissions`: album_id, user_id, created_at

Rules:

- enable foreign keys in migrations
- deleting a user must delete their sessions and permissions
- deleting an album must delete its permissions
- use ISO 8601 UTC text timestamps at repository boundaries
- repository methods must use D1 parameter binding, never SQL string interpolation
- do not add seed users, passwords, real albums, fixture records, or production identifiers

## Files To Inspect

- `AGENTS.md`
- `CLAUDE.md`
- `photo-gate-design.md`
- `docs/decisions/2026-06-09-workers-ui-and-auth-foundation.md`
- `docs/handoffs/archive/2026-06-09-phase-2-workers-fixture-ui-foundation.md`
- `workers/package.json`
- `workers/tsconfig.json`
- `workers/wrangler.toml`
- `workers/src/index.tsx`
- `workers/src/fixtures.ts`
- `workers/src/types/album.ts`
- `workers/test/app.test.ts`

## Files To Create Or Edit

- `workers/migrations/0001_users_sessions.sql`
- `workers/migrations/0002_albums_permissions.sql`
- `workers/src/types/env.ts`
- `workers/src/types/user.ts`
- `workers/src/types/session.ts`
- `workers/src/services/auth-crypto.ts`
- `workers/src/services/session-cookie.ts`
- `workers/src/services/auth-repository.ts`
- `workers/src/services/session-repository.ts`
- `workers/src/services/permission-repository.ts`
- focused test files under `workers/test/`
- `workers/README.md`
- remove `workers/migrations/.gitkeep` and `workers/src/services/.gitkeep` after real files are added
- edit `workers/package.json` or lockfile only if a test-only dependency is genuinely required

Do not edit `workers/wrangler.toml` to add a real D1 binding in this handoff. Do not add account IDs, database IDs, secrets, routes, or environments.

## Type And Repository Contracts

### Environment Type

Define the future Worker binding shape containing:

```typescript
DB: D1Database
```

This is a compile-time type only. Do not attach it to the active fixture Hono app or add a Wrangler D1 binding yet.

### Repository Behavior

Keep repositories small and explicit. They may accept `D1Database` in their constructor or as a function argument.

At minimum support:

- fetch enabled user authentication state by safe user ID
- record login failure state through parameterized updates
- reset login failure state after successful authentication
- insert a session using a validated token digest
- fetch a valid, unexpired session and associated enabled user
- delete a session by validated token digest
- delete expired sessions using an explicit caller-supplied timestamp
- check whether an enabled user has permission to an enabled, unexpired album

Requirements:

- safe IDs use `^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$`
- validate all IDs and token digests before issuing D1 queries
- distinguish expected absence from database failures without leaking sensitive data
- do not silently treat database failures as successful authorization
- permission checks fail closed
- no repository method returns password hashes unless specifically required for password verification

Do not implement high-level login orchestration, lockout thresholds, lockout durations, session rotation, or session refresh in this handoff. Those require explicit policy decisions in the next handoff.

## Test Strategy

Tests must run without Cloudflare credentials, a real D1 database, network access, secrets, or deployment.

Use small D1 test doubles that verify prepared SQL and bound parameters. Do not add a general database abstraction or external ORM.

At minimum test:

- password hash format, explicit iterations, random salt behavior, valid verification, wrong-password rejection
- malformed/weak/unsupported password hashes are rejected safely
- password/hash values never appear in thrown errors
- constant-time comparison helper handles equal and unequal byte arrays
- generated session tokens decode to exactly 32 bytes and are base64url without padding
- token digest is deterministic lowercase SHA-256 hex
- malformed tokens and malformed digests are rejected
- session cookie has all required attributes and explicit `Max-Age`
- duplicate, malformed, short, and long session cookies are rejected
- migration SQL contains required tables, foreign keys, cascades, checks, and indexes
- repository SQL is parameterized
- invalid IDs/digests fail before D1 access
- expired sessions are not accepted
- disabled users are not accepted
- permission checks require enabled/non-expired album plus explicit user permission
- D1 failures fail closed and do not expose sensitive values
- all existing Phase 2 route tests continue to pass unchanged in behavior

## README

Document:

- the added Phase 3 foundation and D1 schema
- password hash encoding and the unresolved production iteration benchmark
- opaque session-token storage model
- secure cookie contract
- that no login route, D1 binding, real data, or R2 access is active yet
- local verification commands
- that migrations are created but not applied

Do not document real credentials, account IDs, database IDs, user passwords, deployment commands, or migration-apply commands.

## Constraints

- Preserve all architecture and security invariants in `AGENTS.md`.
- Preserve all Phase 2 route behavior, especially reserved-route `401` responses.
- Do not connect the active app to D1.
- Do not add D1 bindings to `wrangler.toml`.
- Do not apply migrations.
- Do not implement `/api/login`, `/api/logout`, `/api/me`, authenticated pages, or middleware.
- Do not read R2 or serve real manifests/images.
- Do not implement admin behavior or Cloudflare Access JWT validation.
- Do not create seed data or real user records.
- Do not add an ORM, authentication library, cookie library, or database library.
- Use Web Crypto and platform APIs.
- Do not deploy, publish, push, or commit automatically.

## Non Goals

- production PBKDF2 iteration selection
- login lockout policy
- session expiration/refresh policy
- login/logout/me routes
- session middleware
- album page authorization
- real D1 binding configuration
- D1 migration application
- R2 binding or reads
- admin authentication
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
- Migration schema and constraints summary
- Password hash encoding and validation behavior
- Session token/cookie behavior
- Repository methods and fail-closed behavior
- Dependency changes, if any
- Verification results
- Any blocked checks with exact reasons
- Questions that must return to Codex before implementing login routes
