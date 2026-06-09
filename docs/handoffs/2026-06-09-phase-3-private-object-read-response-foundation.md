Read `AGENTS.md`, `CLAUDE.md`, `photo-gate-design.md`, the accepted Workers UI/auth decision, archived handoffs, existing Workers implementation, and this handoff before implementation.
If implementation would violate constraints or require files outside this handoff, stop and ask before editing.

## Goal

Build the route-independent foundation for reading authorized private album objects and constructing safe authenticated object responses, without adding a real R2 binding or active data route.

This handoff adds:

- a minimal injected private-object reader contract
- explicit album manifest, cover, thumbnail, and preview loaders
- mandatory runtime manifest validation after object reads
- safe private image response construction
- generic no-store not-found and internal-error responses
- comprehensive in-process tests

Do not connect the active Worker app, add an R2 binding, or expose real data in this handoff.

## Background

Completed Phase 3 foundations now provide:

- session authentication middleware
- album authorization middleware
- explicit safe R2 object-key builders
- strict runtime validation for Docker-generated manifests

The next safe boundary is the code that will eventually run only after authentication and album authorization. It must ensure that route handlers cannot:

- request arbitrary R2 keys
- skip manifest validation
- trust R2-stored content types or cache metadata
- expose R2 read errors or object metadata
- allow authenticated objects into shared caches

The actual R2 binding name remains undecided. Keep the reader dependency injected and independent of `wrangler.toml`.

## Security Decisions For This Handoff

### Private Object Reader Contract

Define a small injected reader interface that supports the minimum required object operation:

```typescript
get(key: string): Promise<PrivateObjectBody | null>
```

`PrivateObjectBody` must expose only what the route-independent services need:

- a response-compatible readable body for image delivery
- a `text()` method for manifest parsing

Do not expose or forward:

- stored `Content-Type`
- stored `Cache-Control`
- HTTP metadata
- custom metadata
- ETag
- checksums
- object size
- upload timestamp
- bucket name
- public URL

The reader is an injected contract only. Do not implement a real `R2Bucket` adapter, add an `R2Bucket` type dependency, or add a binding in this handoff.

### Explicit Object Loaders

Create explicit loaders for:

- `loadAlbumManifest(reader, albumId)`
- `loadAlbumCover(reader, albumId)`
- `loadPhotoThumb(reader, albumId, photoId)`
- `loadPhotoPreview(reader, albumId, photoId)`

Each loader must:

- accept only structured identifiers, never a caller-supplied key or path
- use the existing explicit key builder for its object type
- call the injected reader exactly once
- distinguish expected absence (`null`) from reader failure
- never log or expose identifiers, keys, object contents, or internal errors

Manifest loading must:

- read object text only after a manifest object is found
- parse it with `parseManifest(text, expectedAlbumId)`
- return only the validated `Manifest`
- propagate only sanitized errors for reader, body-text, or validation failures

Image/cover loading must:

- return only the readable body needed by the response builder
- discard all other object properties, even if a test double supplies them
- never inspect or trust stored object metadata

Use explicit result unions for expected absence, for example:

```typescript
{ status: 'found', value: ... }
{ status: 'not_found' }
```

Do not use exceptions to represent expected object absence.

### Sanitized Service Errors

Define one small typed or class-based error boundary for unexpected object-read failures.

Requirements:

- reader rejection, manifest `text()` rejection, and malformed manifest must fail closed
- invalid identifiers or key-builder failures must also be sanitized at this service boundary
- exposed error messages must be generic
- error messages must not contain album IDs, photo IDs, keys, manifest data, bucket details, or underlying exception text
- preserve expected `not_found` as a non-error result

It is acceptable to distinguish malformed manifest from object-reader failure using stable non-sensitive error codes or error classes if that improves later route mapping. Do not expose underlying details.

### Private Authenticated Object Responses

Create response helpers for authenticated image objects:

- cover and thumbnail: fixed `Content-Type: image/webp`
- preview: fixed `Content-Type: image/jpeg`
- all successful object responses: `Cache-Control: private, no-store`
- set `X-Content-Type-Options: nosniff`
- do not set or forward `ETag`, `Last-Modified`, `Content-Length`, `Content-Disposition`, stored cache headers, or any R2 metadata
- accept only a response-compatible readable body and an explicit allowlisted response kind
- do not accept arbitrary content types or arbitrary response headers

Create generic object-route failure response helpers:

- object absent: `404 Not Found`
- internal reader or malformed-manifest failure: `500 Internal Server Error`
- both use `Cache-Control: no-store`
- both use `X-Content-Type-Options: nosniff`
- bodies must not reveal IDs, keys, object type, storage provider, or internal details

Do not implement redirects, range requests, conditional requests, downloads, or cache validators.

### Authorization Boundary

These services and helpers are intended to be called only after `requireSession` and `requireAlbumPermission`.

Do not place authorization logic inside object loaders and do not wire them to routes yet. Keep the responsibility boundary explicit:

1. route authentication
2. album authorization
3. explicit object loader
4. safe response helper

## Files To Inspect

- `AGENTS.md`
- `CLAUDE.md`
- `photo-gate-design.md`
- `docs/decisions/2026-06-09-workers-ui-and-auth-foundation.md`
- `docs/handoffs/archive/2026-06-09-phase-3-session-album-authorization-middleware.md`
- `docs/handoffs/archive/2026-06-09-phase-3-r2-key-manifest-validation-foundation.md`
- `workers/src/services/r2-object-key.ts`
- `workers/src/services/manifest-validator.ts`
- `workers/src/types/manifest.ts`
- `workers/src/middleware/auth-response.ts`
- `workers/src/middleware/security-headers.ts`
- `workers/src/types/env.ts`
- existing Workers tests

## Files To Create Or Edit

- `workers/src/types/private-object.ts`
- `workers/src/services/private-album-object-service.ts`
- `workers/src/middleware/private-object-response.ts`
- focused test files under `workers/test/`
- `workers/README.md`

Edit another existing file only if a focused correction is required for the contracts above. Explain any such change in the report.

Do not edit:

- `workers/src/index.tsx`
- `workers/wrangler.toml`
- `workers/src/types/env.ts`
- migrations
- fixture routes or fixture data
- Docker implementation

## Implementation Constraints

- Use platform and language APIs only.
- Do not add runtime or test dependencies.
- Keep the reader contract minimal and injected.
- Do not introduce `R2Bucket`, `R2Object`, or `R2ObjectBody` into the route-independent contract.
- Do not create a general storage abstraction supporting writes, deletes, lists, arbitrary keys, or arbitrary metadata.
- Do not accept caller-supplied keys, paths, content types, statuses, or headers.
- Do not buffer image bodies.
- Do not parse or transform images.
- Do not trust or forward object metadata.
- Do not log object contents, IDs, keys, or internal errors.
- Preserve current middleware and active route behavior.

## Test Strategy

Tests must run without Cloudflare credentials, a real R2 bucket, D1, network access, secrets, or deployment.

Use small object-reader fakes and in-memory readable streams.

At minimum test:

- each explicit loader uses the exact existing key builder output
- each loader calls the reader exactly once
- loaders never accept arbitrary keys or paths
- missing objects return `not_found` without throwing
- reader failures throw only sanitized service errors
- error messages never contain album IDs, photo IDs, keys, bucket names, or underlying error text
- manifest loader calls `text()` only for a found object
- manifest loader returns a validated manifest for valid Docker-compatible JSON
- malformed, wrong-album, and unsupported manifests fail closed with sanitized errors
- manifest `text()` failure is sanitized
- image/cover loaders return only the readable body and discard supplied fake metadata
- successful cover/thumb responses use exactly `image/webp`
- successful preview responses use exactly `image/jpeg`
- every successful object response uses `Cache-Control: private, no-store` and `X-Content-Type-Options: nosniff`
- response helpers never forward fake stored metadata, ETag, cache headers, content disposition, or internal values
- response helpers do not accept arbitrary content types or arbitrary headers
- missing-object response is generic `404`, no-store, and non-leaking
- internal-error response is generic `500`, no-store, and non-leaking
- image bodies remain streamed and are not converted to strings or byte arrays by the service
- all existing Workers tests continue to pass unchanged

Exercise behavior rather than asserting only source-code strings.

## README

Document:

- the injected private-object reader contract
- the four explicit loaders
- mandatory manifest validation
- fixed authenticated image response content types
- `private, no-store` response policy
- that R2 metadata is intentionally discarded and never forwarded
- that no R2 binding, active route, or real object read is connected yet
- local verification commands

Do not document credentials, account IDs, bucket IDs, deployment commands, or real album/photo data.

## Constraints

- Preserve all architecture and security invariants in `AGENTS.md`.
- Preserve all current active route behavior.
- Do not connect the active app to D1 or R2.
- Do not add D1 or R2 bindings to `wrangler.toml`.
- Do not edit `workers/src/types/env.ts` to add an R2 binding.
- Do not apply migrations.
- Do not implement or wire login, album APIs, image routes, authenticated pages, or active object-response routes.
- Do not read a real R2 bucket or serve real manifests/images.
- Do not create seed data or real records.
- Do not deploy, publish, push, or commit automatically.

## Non Goals

- real `R2Bucket` adapter
- R2 binding name decision or configuration
- active route wiring
- authentication or authorization changes
- object upload, deletion, listing, or cleanup
- range requests
- conditional requests or ETag support
- download responses
- shared/private cache optimization
- HTML or album API implementation
- login/logout/me routes
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
- Private-object reader contract
- Explicit loader behavior and absence/error distinction
- Manifest validation behavior after reads
- Safe response headers and metadata-discard behavior
- Confirmation that active routes, bindings, and environment types are unchanged
- Dependency changes, if any
- Verification results
- Any blocked checks with exact reasons
- Questions that must return to Codex before a real R2 adapter or active data routes are implemented
