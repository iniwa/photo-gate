Read `AGENTS.md`, `CLAUDE.md`, `photo-gate-design.md`, the accepted Workers UI/auth decision, archived handoffs, Docker manifest implementation, existing Workers implementation, and this handoff before implementation.
If implementation would violate constraints or require files outside this handoff, stop and ask before editing.

## Goal

Build the route-independent Workers foundation for safe R2 object-key construction and strict runtime validation of Docker-generated `schemaVersion: 1` manifests.

This handoff adds:

- centralized safe identifier validation shared by Workers repositories and R2-key builders
- allowlisted R2 object-key builders
- strict runtime parsing and validation for manifest JSON
- cross-component contract tests against the Docker manifest schema

Do not connect an R2 binding, read R2, return objects, or wire active routes in this handoff.

## Background

The Docker sync service writes only these object shapes:

```text
albums/{albumId}/manifest.json
albums/{albumId}/cover.webp
albums/{albumId}/thumbs/{photoId}.webp
albums/{albumId}/previews/{photoId}.jpg
```

The Workers application must eventually read those private objects only after session authentication and album-level authorization. Before any R2 route is connected, Workers needs a single safe key-construction boundary and a runtime manifest validator that does not trust R2 object contents.

The current `workers/src/types/manifest.ts` is compile-time only. A TypeScript interface does not validate JSON read from R2.

## Security Decisions For This Handoff

### Safe Identifiers

Use the existing accepted identifier contract everywhere:

```text
^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$
```

Expose the existing validation behavior through a clearly named shared helper. Do not duplicate identifier regexes across R2-key and manifest modules.

Invalid identifiers must be rejected before key construction. Error messages must identify the invalid field category but must not echo the rejected value.

### R2 Key Construction

Create explicit builders for:

- album manifest
- album cover
- photo thumbnail
- photo preview

Requirements:

- accept only validated `albumId` and, where applicable, `photoId`
- produce exactly the standard R2 paths
- never accept arbitrary relative paths, suffixes, extensions, prefixes, or complete keys
- never normalize or repair invalid input
- no leading slash, backslash, dot segment, URL encoding, query, fragment, or alternate extension can be produced
- errors must not echo rejected IDs

Do not create a generic `buildKey(parts)` or `getObject(key)` helper.

### Manifest Runtime Validation

Implement a parser that accepts an unknown JSON string and an explicitly expected authorized `albumId`, then returns a validated `Manifest`.

The parser must:

- reject invalid JSON without exposing the input or parser details
- reject non-object roots, arrays, `null`, unsupported `schemaVersion`, and missing required fields
- require `manifest.albumId` to exactly equal the explicitly supplied expected album ID
- validate all IDs with the shared safe-ID helper
- require `source.type === "photoprism"` and a safe `source.albumUid`
- require timezone-aware, valid ISO 8601 values for `generatedAt` and every `takenAt`
- require `images.stripExif === true`
- require thumb format `webp`, preview format `jpg`, positive integer long edges, and integer quality from 1 through 100
- require `photos` to be an array
- require unique photo IDs
- require string titles, including the empty string currently allowed by Docker, with a documented defensive maximum length
- require positive integer width and height with a documented defensive maximum
- require each photo path to exactly match its ID:
  - `thumbs/{photoId}.webp`
  - `previews/{photoId}.jpg`
- reject absolute paths, traversal, backslashes, URL-like values, query strings, fragments, alternate extensions, and paths belonging to another photo
- reject unexpected object properties at every schema level so schema changes require an explicit versioned update
- return only a newly constructed validated object; do not return or mutate the parsed input object

Use these explicit parser safety limits:

- input JSON UTF-8 byte length: `8 MiB`
- photo count: `20,000`
- title length: `1,024` Unicode code points
- image dimensions and long edges: `100,000`

Export the limits for tests and document them in `workers/README.md`. These are defensive parser limits, not product limits or synchronization targets.

All parser errors exposed to callers must use a generic message such as `invalid manifest`. Do not include album IDs, photo IDs, titles, paths, JSON snippets, or parser exception text.

### Contract Scope

The runtime validator must match the current Docker implementation:

- `docker/src/photo_gate/manifest.py`
- `docker/src/photo_gate/models.py`
- `docker/src/photo_gate/r2_store.py`

Do not silently broaden the Workers contract beyond what Docker emits.

## Files To Inspect

- `AGENTS.md`
- `CLAUDE.md`
- `photo-gate-design.md`
- `docs/decisions/2026-06-09-workers-ui-and-auth-foundation.md`
- `docs/handoffs/archive/2026-06-09-phase-3-auth-session-foundation.md`
- `docs/handoffs/archive/2026-06-09-phase-3-session-album-authorization-middleware.md`
- `docker/src/photo_gate/manifest.py`
- `docker/src/photo_gate/models.py`
- `docker/src/photo_gate/r2_store.py`
- `docker/tests/test_manifest.py`
- `workers/src/types/manifest.ts`
- `workers/src/services/repository-validation.ts`
- `workers/src/middleware/require-album-permission.ts`
- `workers/test/migrations.test.ts`

## Files To Create Or Edit

- `workers/src/services/safe-id.ts`
- `workers/src/services/r2-object-key.ts`
- `workers/src/services/manifest-validator.ts`
- `workers/src/types/manifest.ts`
- focused test files under `workers/test/`
- `workers/src/services/repository-validation.ts` to consume the centralized safe-ID helper
- `workers/src/middleware/require-album-permission.ts` to consume the centralized safe-ID helper
- `workers/README.md`

Remove the old private safe-ID implementation only after all references are updated.

Do not edit:

- `workers/src/index.tsx`
- `workers/wrangler.toml`
- migrations
- fixture routes or fixture data
- Docker implementation

## Implementation Constraints

- Use platform and language APIs only.
- Do not add a schema-validation library or runtime dependency.
- Prefer small explicit validators over a generic validation framework.
- Do not use unsafe type assertions to treat unvalidated JSON as `Manifest`.
- Do not construct R2 keys through arbitrary caller-supplied paths.
- Do not read R2 or introduce an `R2Bucket` dependency.
- Do not add D1 or R2 bindings.
- Do not create active API/image routes.
- Do not log rejected manifest contents or identifiers.
- Preserve current middleware and active route behavior.

## Test Strategy

Tests must run without Cloudflare credentials, D1, R2, network access, secrets, or deployment.

At minimum test:

- each explicit key builder produces the exact standard path
- invalid album/photo IDs fail before a key is returned
- key-builder errors do not contain rejected values
- valid empty and populated Docker-compatible manifests parse successfully
- parsed output contains only the validated schema fields
- expected album ID mismatch is rejected
- invalid or unsupported schema versions are rejected
- invalid root and nested types are rejected
- missing and unexpected fields at every schema level are rejected
- unsafe IDs are rejected
- duplicate photo IDs are rejected
- invalid, timezone-free, or non-string timestamps are rejected
- `stripExif: false` is rejected
- wrong image formats, invalid quality, invalid long edge, width, and height are rejected
- thumb/preview paths that are absolute, traversing, backslash-based, URL-like, queried, fragmented, wrong-extension, or mismatched to photo ID are rejected
- each defensive limit accepts its boundary and rejects values beyond it
- all parser failures expose only the generic error message and never echo sensitive manifest values
- repositories and authorization middleware continue using the same safe-ID contract
- all existing Workers tests continue to pass

Include at least one realistic manifest fixture matching the current Docker output, including timezone-offset timestamps.

## README

Document:

- the explicit R2-key builders and standard paths
- that arbitrary keys and paths are intentionally unsupported
- runtime manifest validation and the Docker schema contract
- parser safety limits and that they are defensive rather than product limits
- that no R2 binding, R2 read, object response, or active route is connected yet
- local verification commands

Do not document credentials, account IDs, bucket IDs, deployment commands, or real album/photo data.

## Constraints

- Preserve all architecture and security invariants in `AGENTS.md`.
- Preserve all current active route behavior.
- Do not connect the active app to D1 or R2.
- Do not add D1 or R2 bindings to `wrangler.toml`.
- Do not apply migrations.
- Do not implement or wire login, album APIs, image routes, authenticated pages, or object responses.
- Do not read R2 or serve real manifests/images.
- Do not create seed data or real records.
- Do not choose PBKDF2, lockout, session lifetime, refresh, or cleanup policy.
- Do not deploy, publish, push, or commit automatically.

## Non Goals

- R2 binding configuration
- R2 reads or writes
- object response streaming
- cache/header response policy implementation
- active route wiring
- login/logout/me routes
- D1 queries
- fixture replacement
- admin authentication
- Cloudflare Access
- deployment or CI/CD
- Docker manifest schema changes

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
- Centralized safe-ID contract
- Explicit R2-key builder behavior
- Manifest runtime-validation behavior
- Defensive limits selected and rationale
- Confirmation that Docker schema, active routes, and bindings are unchanged
- Dependency changes, if any
- Verification results
- Any blocked checks with exact reasons
- Questions that must return to Codex before R2 reads or active data routes are implemented
