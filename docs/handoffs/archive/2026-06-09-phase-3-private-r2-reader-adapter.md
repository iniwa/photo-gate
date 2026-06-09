Read `AGENTS.md`, `CLAUDE.md`, `photo-gate-design.md`, the accepted Workers UI/auth decision, archived handoffs, existing Workers implementation, and this handoff before implementation.
If implementation would violate constraints or require files outside this handoff, stop and ask before editing.

## Goal

Implement a route-independent, injected R2 read adapter that satisfies the existing `PrivateObjectReader` contract while preventing arbitrary R2 key reads and discarding all R2 metadata.

This handoff adds:

- strict validation for the four standard private album object-key shapes
- a read-only `R2Bucket` adapter
- metadata-discarding wrappers for found R2 objects
- sanitized fail-closed behavior
- focused in-process tests

Do not add an R2 binding, choose a binding name, connect active routes, or read a real R2 bucket.

## Background

Completed Phase 3 foundations provide:

- explicit safe key builders for manifest, cover, thumbnail, and preview objects
- a minimal injected `PrivateObjectReader` contract
- explicit private album object loaders
- runtime manifest validation
- safe private object response helpers

The next safe boundary is the concrete adapter between an injected Cloudflare `R2Bucket` and `PrivateObjectReader`. The adapter must not expose R2 metadata or become a general arbitrary-key storage API.

The active Worker remains fixture-only. Authentication, authorization, D1, R2 bindings, and real data routes remain disconnected.

## Security Decisions For This Handoff

### Allowed Read Keys

The adapter may read only keys matching exactly one standard layout:

```text
albums/{albumId}/manifest.json
albums/{albumId}/cover.webp
albums/{albumId}/thumbs/{photoId}.webp
albums/{albumId}/previews/{photoId}.jpg
```

Both IDs must satisfy the existing shared safe-ID contract.

Add a strict key predicate or assertion near the existing R2 key builders. It must reject:

- empty strings
- leading slashes
- backslashes
- dot segments
- repeated or missing path segments
- extra prefixes or suffixes
- wrong directories or extensions
- URL-encoded alternatives
- query strings or fragments
- control characters
- unsafe album or photo IDs
- arbitrary objects elsewhere in the bucket

The validator must accept every key produced by the four existing key builders. Do not change the standard layout.

### R2 Reader Adapter

Create one narrowly scoped adapter that implements:

```typescript
PrivateObjectReader
```

The constructor accepts an injected `R2Bucket`. The adapter must:

- expose only `get(key)`
- validate the key before calling `bucket.get`
- call `bucket.get` exactly once for a valid key
- return `null` for an absent object
- return only the existing minimal `PrivateObjectBody` shape for a found object
- never expose the original `R2ObjectBody`
- never expose or forward HTTP metadata, custom metadata, ETag, checksums, size, upload time, range information, bucket identity, or public URLs
- never list, write, delete, head, or create signed/public URLs

The returned wrapper may expose only:

- the response-compatible readable body
- a `text()` operation delegated for manifest loading

Validate the minimum body/text capabilities at runtime. Malformed object results must fail closed.

### Failure Behavior

- invalid or non-standard keys must fail before `bucket.get`
- bucket errors and malformed returned objects must throw only a sanitized adapter error
- delegated `text()` failures must also be sanitized by the adapter
- error messages must not contain keys, IDs, object contents, bucket names, account details, R2 metadata, or underlying exception text
- expected object absence remains `null`, not an exception

It is acceptable to define a small stable adapter error class or generic error message. Do not expose an underlying cause.

The existing private album object service will continue converting reader failures to its own `ObjectServiceError('reader_failure')` boundary.

### Authorization Boundary

The adapter does not perform user or album authorization. The intended future call order remains:

1. session authentication
2. album authorization
3. explicit private album object loader
4. injected R2 reader adapter
5. safe response helper

The strict key allowlist is defense in depth against accidental arbitrary-key reads. It does not replace album authorization.

## Files To Inspect

- `AGENTS.md`
- `CLAUDE.md`
- `photo-gate-design.md`
- `docs/decisions/2026-06-09-workers-ui-and-auth-foundation.md`
- `docs/handoffs/archive/2026-06-09-phase-3-r2-key-manifest-validation-foundation.md`
- `docs/handoffs/archive/2026-06-09-phase-3-private-object-read-response-foundation.md`
- `workers/src/types/private-object.ts`
- `workers/src/services/r2-object-key.ts`
- `workers/src/services/private-album-object-service.ts`
- `workers/src/middleware/private-object-response.ts`
- existing R2 key and private-object tests

## Files To Create Or Edit

- `workers/src/services/private-r2-reader.ts`
- `workers/src/services/r2-object-key.ts`
- focused tests under `workers/test/`
- `workers/README.md`

Edit another existing file only if a focused correction is required for this adapter contract. Explain any such change in the report.

Do not edit:

- `workers/src/index.tsx`
- `workers/wrangler.toml`
- `workers/src/types/env.ts`
- migrations
- fixture routes or fixture data
- Docker implementation

## Implementation Constraints

- Use Cloudflare Workers and language APIs only.
- Do not add runtime or test dependencies.
- Use the platform `R2Bucket` type only inside the concrete adapter and its tests.
- Keep `PrivateObjectReader` and `PrivateObjectBody` independent of R2 types.
- Do not add a general storage abstraction.
- Do not accept arbitrary bucket operations, arbitrary metadata, arbitrary headers, or arbitrary object paths.
- Do not buffer image bodies.
- Do not parse or transform images.
- Do not log keys, IDs, object data, metadata, or internal errors.
- Preserve the existing key builders and private object loader behavior.
- Preserve all active fixture route behavior.

## Test Strategy

Tests must run without Cloudflare credentials, a real/local R2 bucket, D1, network access, secrets, or deployment.

Use small injected `R2Bucket` test doubles and in-memory readable streams. Cast only the narrow test double where required; do not build a general R2 emulator.

At minimum test:

- strict key validation accepts every existing builder output
- strict key validation rejects each unsafe/non-standard category listed above
- the adapter implements the existing reader contract
- valid keys call `bucket.get` exactly once with the exact key
- invalid keys fail before `bucket.get`
- absent objects return `null`
- found objects return only `body` and `text`
- fake R2 metadata and extra properties are not propagated
- the original R2 object is not returned
- the image body remains streamed and is not buffered
- `text()` delegates only when called and returns text for valid objects
- bucket rejection is sanitized
- malformed object/body/text capabilities are sanitized
- delegated `text()` rejection is sanitized
- errors never expose keys, IDs, object data, bucket names, metadata, or underlying exception details
- the adapter exposes no list, put, delete, head, signed URL, or public URL operation
- existing explicit loaders work with the adapter test double
- existing Workers tests continue to pass

Exercise behavior rather than relying only on source-string assertions.

## README

Document:

- the injected private R2 reader adapter
- the four allowed key layouts
- strict arbitrary-key rejection
- expected absence versus sanitized failure
- R2 metadata discard behavior
- that authentication and album authorization remain outside the adapter
- that no R2 binding, binding name, active route, or real object read is connected yet
- local verification commands

Do not document credentials, account IDs, bucket names/IDs, deployment commands, or real album/photo data.

## Constraints

- Preserve all architecture and security invariants in `AGENTS.md`.
- Preserve all current active route behavior.
- Do not connect the active app to D1 or R2.
- Do not add D1 or R2 bindings to `wrangler.toml`.
- Do not choose an R2 binding name.
- Do not edit `workers/src/types/env.ts`.
- Do not apply migrations.
- Do not implement or wire login, album APIs, image routes, authenticated pages, or active object-response routes.
- Do not read a real R2 bucket or serve real manifests/images.
- Do not create seed data or real records.
- Do not implement writes, deletes, listing, cleanup, range requests, downloads, or caching.
- Do not deploy, publish, push, or commit automatically.

## Non Goals

- active route wiring
- R2 binding name or configuration
- D1 binding or migration application
- authentication or authorization changes
- R2 writes, deletes, listing, cleanup, or synchronization
- public bucket access or signed URLs
- range or conditional requests
- shared/private cache optimization
- album HTML/API implementation
- login/logout/me routes
- admin authentication or UI
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
- a real/local R2 bucket or D1 database
- PhotoPrism or Docker services
- secrets or `.env`
- network access after `npm ci`

## Expected Report

- Changed files
- Strict allowed-key validation behavior
- Adapter API and R2 metadata-discard behavior
- Absence and sanitized failure behavior
- Confirmation that authentication/authorization remain outside the adapter
- Confirmation that active routes, bindings, environment types, migrations, and fixtures are unchanged
- Dependency changes, if any
- Verification results
- Any blocked checks with exact reasons
- Questions that must return to Codex before an R2 binding or active data route is implemented
