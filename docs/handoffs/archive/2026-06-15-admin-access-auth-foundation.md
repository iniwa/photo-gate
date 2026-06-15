# Admin Cloudflare Access Authentication Foundation

Status: completed and reviewed by Codex on 2026-06-15. Production Access
configuration and deployment remain separate operator/delivery actions.

Read AGENTS.md, CLAUDE.md, and this handoff file before implementation.
If implementation would violate constraints or require files outside this
handoff, stop and ask before editing.

## Goal

Replace the reserved `/admin` 401 response with a minimal, fail-closed admin
surface protected by Worker-side Cloudflare Access JWT validation and an
administrator email allowlist.

This handoff establishes only the admin authentication boundary. It does not
implement administration features.

## Background

- `docs/decisions/2026-06-09-workers-ui-and-auth-foundation.md` adopts
  Cloudflare Access for `/admin`, followed by Worker-side JWT validation and
  an admin email allowlist.
- Cloudflare's current guidance says the Worker must validate the
  `Cf-Access-Jwt-Assertion` header even when Access is in front of the Worker.
  Validation must verify the signature through the team-domain JWKS endpoint,
  issuer, audience, expiry, and other standard JWT checks.
- Cloudflare's Workers example uses the `jose` package with `jwtVerify` and
  `createRemoteJWKSet`.
- `/admin` and `/admin/*` currently fall through to a reserved generic 401.
- Real Access application creation, real binding values, secret registration,
  deployment, and production smoke tests require separate authorization and
  are outside this handoff.

## Acceptance Criteria

- Add a narrowly scoped Cloudflare Access JWT verifier using `jose`.
- Read only the `Cf-Access-Jwt-Assertion` request header. Do not accept
  `CF_Authorization` as a fallback.
- Verify signature, issuer, audience, and standard temporal JWT claims against:
  - `CF_ACCESS_TEAM_DOMAIN`
  - `CF_ACCESS_AUD`
- Require an `exp` claim and reject expired tokens. Honor `nbf` when present.
- Require `email` to be a non-empty string with no surrounding whitespace or
  control characters, then compare it against `ADMIN_EMAILS`.
- Treat `ADMIN_EMAILS` as a comma-separated, trimmed, case-insensitive exact
  email allowlist. Reject empty entries and malformed configuration
  fail-closed.
- Never log or echo JWTs, claims, administrator email addresses, team domain,
  audience, JWKS errors, or configuration values.
- Missing/malformed configuration, missing/invalid JWT, verification/JWKS
  failure, missing/malformed email claim, and non-allowlisted email all fail
  closed with the same fixed `403 Forbidden` response and
  `Cache-Control: no-store`.
- A valid allowlisted Access identity can reach `GET /admin`, which returns a
  minimal SSR page containing no viewer, album, R2, PhotoPrism, or NAS data.
- Every other method/path under `/admin` remains protected and returns a safe,
  generic fail-closed response or authenticated 404. It must never fall into
  the public viewer page router.
- Existing viewer authentication, viewer pages, `/api`, `/img`, scheduled
  cleanup, security headers, and private data behavior remain unchanged.
- Unit/integration tests exercise successful access and every failure class
  above without external network calls.
- Add operator documentation explaining how to create a path-scoped Access
  application for `/admin`, register the three Worker values without placing
  real values or email addresses in the repository, and perform later smoke
  checks.
- Update Workers documentation to describe the new route boundary and required
  runtime configuration.

## Files To Inspect

- `docs/decisions/2026-06-09-workers-ui-and-auth-foundation.md`
- `docs/fable/autonomy-contract.md`
- `workers/package.json`
- `workers/src/index.tsx`
- `workers/src/types/env.ts`
- `workers/src/middleware/security-headers.ts`
- `workers/src/routes/pages.tsx`
- `workers/src/templates/layout.tsx`
- `workers/test/app.test.ts`
- `workers/README.md`

## Files To Edit

- `workers/package.json`
- `workers/package-lock.json`
- `workers/src/index.tsx`
- `workers/src/types/env.ts`
- `workers/src/types/admin-auth.ts` (new, if useful)
- `workers/src/services/cloudflare-access-jwt.ts` (new)
- `workers/src/middleware/require-admin.ts` (new)
- `workers/src/routes/admin.tsx` (new)
- `workers/test/admin-access-jwt.test.ts` (new)
- `workers/test/admin-routes.test.ts` (new)
- `workers/test/app.test.ts`
- `workers/README.md`
- `docs/operations/admin-access.md` (new)

If a different new test filename is clearly better, keep it under
`workers/test/` and report the change. Stop before editing any other file.

## Constraints

- Preserve every Non-Negotiable Invariant in `AGENTS.md`.
- Use `jose`; do not implement JWT parsing or cryptographic verification by
  hand.
- Keep the production verifier dependency-injected or otherwise testable
  without real Cloudflare requests, real JWTs, or a test bypass in production.
- Do not add a development bypass, trusted debug header, hardcoded test key,
  or environment switch that can skip verification.
- Do not store request-specific identity or claims in mutable module-level
  state.
- Restrict the JWKS URL to the validated HTTPS Cloudflare Access team domain.
  Do not allow an arbitrary caller-controlled URL.
- Configuration validation must be strict and fail closed. Real values,
  administrator email addresses, and tokens must not appear in source,
  `wrangler.toml`, tests, snapshots, logs, or documentation.
- Keep responses fixed and sanitized. Do not reveal whether failure was due to
  JWT validation, allowlist membership, configuration, or JWKS availability.
- Use `Cache-Control: no-store` for all admin responses.
- Preserve the existing global security headers.
- Prefer existing Hono router, middleware, dependency injection, and JSX SSR
  patterns.

## Non Goals

- Creating or changing the real Cloudflare Access application or policy.
- Registering real Worker values/secrets.
- Deployment, production smoke tests, commit, push, or handoff archival.
- Admin user, album, permission, sync, status, audit, or cleanup operations.
- D1 migrations or D1-backed administrator roles.
- Viewer authentication or authorization changes.
- Cloudflare Access for shared viewers.
- Styling beyond reusing the existing page shell and CSS.

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

- no real values, emails, JWTs, claims, URLs, or secrets;
- no production authentication bypass;
- no change to viewer route authorization;
- no network-dependent tests;
- sanitized, no-store admin failures.

## Expected Report

Report:

- changed files;
- implementation summary;
- exact admin success and failure behavior;
- how JWT/JWKS verification is isolated for tests;
- verification commands and results;
- dependency/audit result;
- any skipped or blocked checks with exact reasons;
- any design question or required out-of-scope edit.
