Read `AGENTS.md`, `CLAUDE.md`, `photo-gate-design.md`, the accepted Workers UI/auth decision, archived handoffs, existing Workers implementation, and this handoff before implementation.
If implementation would violate constraints or require files outside this handoff, stop and ask before editing.

## Goal

Build reusable Phase 3 session-authentication and album-authorization middleware without connecting it to the active fixture app or exposing real data.

This handoff adds:

- typed authenticated-request context
- reusable session-authentication middleware
- reusable album-authorization middleware
- generic no-store authentication and authorization error responses
- comprehensive in-process tests using the existing D1 test double

Login, logout, D1 binding configuration, active route wiring, R2 reads, and real data remain out of scope.

## Background

The accepted Workers auth design requires every future manifest and image request to verify:

1. the opaque session cookie
2. the SHA-256 token digest stored in D1
3. session expiration
4. enabled user state
5. explicit album permission
6. enabled and non-expired album state

The completed Phase 3 foundation already provides:

- strict session-cookie parsing
- session-token digesting
- `SessionRepository.fetchValidSession`
- `PermissionRepository.checkPermission`
- safe ID and canonical UTC timestamp validation

The active Worker still serves fixture-only HTML and returns `401` for all `/api`, `/img`, and `/admin` routes. Preserve that behavior.

## Security Decisions For This Handoff

### Authentication Middleware

Create reusable middleware that:

- reads the request `Cookie` header
- parses only `photo_gate_session` using the existing strict parser
- digests the raw token using the existing crypto helper
- fetches a valid session at an explicit injected clock time
- accepts only sessions associated with enabled users
- stores only the authenticated `userId` in Hono context variables
- never stores the raw token, token digest, password hash, or complete session row in context

Authentication failure behavior:

- missing, duplicate, malformed, unknown, expired, or disabled-user sessions return the same generic `401 Unauthorized`
- database or unexpected internal failures return generic `503 Service Unavailable`
- all failure responses use `Cache-Control: no-store`
- responses must not reveal user IDs, album IDs, tokens, digests, SQL, or exception details
- do not redirect authentication failures

The clock must be injected and converted to canonical UTC using `Date.toISOString()`. Do not read the clock more than once per request.

### Album Authorization Middleware

Create reusable middleware intended to run after session authentication that:

- obtains authenticated `userId` only from the typed Hono context variable
- obtains `albumId` from a narrowly defined resolver supplied by the caller or from a documented route parameter
- calls the existing `PermissionRepository.checkPermission`
- calls `next()` only when permission is explicitly granted

Authorization failure behavior:

- missing authenticated context returns generic `401 Unauthorized`
- invalid album IDs and denied, disabled, expired, or absent albums return the same generic `403 Forbidden`
- repository/database or unexpected internal failures return generic `503 Service Unavailable`
- failures must fail closed and must not expose details
- all failure responses use `Cache-Control: no-store`

Do not query album metadata, return album existence information, or read R2.

### Successful Request Context

Define a small context contract containing only:

```typescript
userId: string
```

Do not add roles, admin state, raw cookies, session tokens, token digests, album records, or permission rows.

## Files To Inspect

- `AGENTS.md`
- `CLAUDE.md`
- `photo-gate-design.md`
- `docs/decisions/2026-06-09-workers-ui-and-auth-foundation.md`
- `docs/handoffs/archive/2026-06-09-phase-3-auth-session-foundation.md`
- `workers/src/index.tsx`
- `workers/src/middleware/security-headers.ts`
- `workers/src/services/auth-crypto.ts`
- `workers/src/services/session-cookie.ts`
- `workers/src/services/session-repository.ts`
- `workers/src/services/permission-repository.ts`
- `workers/src/types/env.ts`
- `workers/test/app.test.ts`
- `workers/test/helpers/mock-d1.ts`

## Files To Create Or Edit

- `workers/src/types/auth-context.ts`
- `workers/src/middleware/auth-response.ts`
- `workers/src/middleware/require-session.ts`
- `workers/src/middleware/require-album-permission.ts`
- focused test files under `workers/test/`
- `workers/README.md`

The current `PermissionRepository.checkPermission` converts D1 failures into `false`, which prevents middleware from distinguishing a denied permission from a database outage. Change it to return `false` only for expected denial/absence and throw the existing sanitized `database operation failed` error for D1 failures. Update its focused tests accordingly.

Edit another existing repository or validation helper only if a focused correction is required for the middleware contract. Explain any such change in the report.

Do not edit:

- `workers/src/index.tsx`
- `workers/wrangler.toml`
- existing migrations
- fixture routes or fixture data

## Middleware Design Constraints

- Use Hono middleware types and existing project conventions.
- Accept dependencies explicitly so tests require no real D1 binding.
- Keep middleware factories small and narrowly scoped.
- Do not create a general dependency-injection framework.
- Do not add an ORM, auth library, cookie library, or other runtime dependency.
- Do not catch authorization denial and convert it into success.
- Do not use string interpolation to construct SQL.
- Do not log sensitive values or raw internal errors.
- Do not mutate session expiration or `last_seen_at`.
- Do not implement sliding sessions, rotation, cleanup, or lockout.

The middleware may accept repository interfaces containing only the methods it needs instead of concrete repository classes. This is preferred if it keeps tests focused and avoids unnecessary coupling.

## Test Strategy

Tests must run without Cloudflare credentials, D1, R2, network access, secrets, or deployment.

Use Hono in-process requests and small dependency fakes. Reuse the existing D1 test double only where repository integration adds value.

At minimum test:

- valid session calls downstream handler and exposes only `userId`
- clock is read exactly once and the canonical timestamp reaches the session lookup
- missing cookie returns generic `401`
- duplicate, malformed, short, and long cookie values return the same generic `401`
- unknown and expired sessions return the same generic `401`
- session repository failure returns generic `503`
- authentication errors contain no user ID, album ID, token, digest, SQL, or internal exception text
- every authentication failure has `Cache-Control: no-store`
- permitted album request calls downstream handler
- album authorization uses the authenticated context user ID, caller-resolved album ID, and canonical timestamp
- missing authenticated context returns generic `401`
- invalid, absent, disabled, expired, and denied albums return the same generic `403`
- permission repository failure returns generic `503`, fails closed, and exposes no details
- every authorization failure has `Cache-Control: no-store`
- denied middleware never calls downstream handlers
- the active Phase 2 fixture and reserved-route tests remain unchanged and pass

Avoid tests that only assert source-code strings. Exercise middleware behavior through requests.

## README

Document:

- the new reusable middleware foundation
- authentication and authorization failure behavior
- the minimal `userId` request context
- that middleware is not wired to active routes yet
- that no D1 binding, login route, real data, or R2 access is active
- local verification commands

Do not document credentials, account IDs, database IDs, deployment commands, or migration-apply commands.

## Constraints

- Preserve all architecture and security invariants in `AGENTS.md`.
- Preserve all current active route behavior.
- Do not connect the active app to D1.
- Do not add D1 or R2 bindings to `wrangler.toml`.
- Do not apply migrations.
- Do not implement or wire `/api/login`, `/api/logout`, `/api/me`, album APIs, image routes, or authenticated pages.
- Do not read R2 or serve real manifests/images.
- Do not implement admin behavior or Cloudflare Access JWT validation.
- Do not create seed data or real user records.
- Do not choose PBKDF2 production iterations, lockout policy, session lifetime, refresh policy, or cleanup policy.
- Do not deploy, publish, push, or commit automatically.

## Non Goals

- active route wiring
- production PBKDF2 iteration selection
- login orchestration or dummy-password verification
- login lockout policy
- session creation, deletion, expiration, refresh, or rotation policy
- login/logout/me routes
- fixture replacement
- D1 or R2 binding configuration
- D1 migration application
- real album queries
- R2 reads or image delivery
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
- Middleware contracts and dependency injection approach
- Authentication failure behavior
- Album authorization failure behavior
- Context data exposed to downstream handlers
- Confirmation that active routes and bindings are unchanged
- Dependency changes, if any
- Verification results
- Any blocked checks with exact reasons
- Questions that must return to Codex before active login or data routes are implemented
