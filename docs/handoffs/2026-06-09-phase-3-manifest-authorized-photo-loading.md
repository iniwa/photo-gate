Read `AGENTS.md`, `CLAUDE.md`, `photo-gate-design.md`, archived handoffs, existing Workers implementation, and this handoff before implementation.
If implementation would violate constraints or require files outside this handoff, stop and ask before editing.

## Goal

Build a route-independent service that serves photo objects only when the requested photo is present in the album's currently validated manifest.

This handoff adds:

- validated manifest photo-membership lookup
- manifest-authorized thumbnail and preview loading
- explicit absence and sanitized failure behavior
- comprehensive in-process tests

Do not connect active routes, add bindings, or read a real R2 bucket.

## Background

Completed foundations can:

- authenticate sessions and authorize albums
- read only standard private R2 keys
- load and validate album manifests
- load thumbnail and preview objects

Album authorization alone must not allow a caller to guess an arbitrary safe `photoId` under an authorized album prefix. Deleted or stale image objects may remain in R2 until cleanup is implemented. Future image routes must first verify that the requested photo is listed in the current validated manifest.

## Required Behavior

Create a small route-independent service with explicit operations equivalent to:

```typescript
loadManifestAuthorizedThumb(reader, albumId, photoId)
loadManifestAuthorizedPreview(reader, albumId, photoId)
```

Each operation must:

1. validate IDs through existing safe boundaries
2. load and validate the album manifest using `loadAlbumManifest`
3. return `not_found` if the manifest is absent
4. search the validated manifest for an exact photo ID match
5. return `not_found` without reading an image object if the photo is not listed
6. load the requested image only after membership succeeds
7. return the image stream using the existing explicit loader

Use the existing `PrivateObjectReader`, object loaders, manifest types, and sanitized service errors. Do not accept caller-supplied keys or paths.

### Manifest Membership

- Match only exact `photo.id`.
- Do not use title, index, path substring, prefix, case-folding, or fuzzy matching.
- Do not trust caller-supplied manifest paths.
- The existing strict manifest validator guarantees each listed photo's paths match its ID.
- Do not return manifest contents, photo metadata, paths, or IDs from the new service.

### Read Order And Counts

- Always read the manifest before an image object.
- Missing manifest: exactly one reader call.
- Photo absent from manifest: exactly one reader call.
- Photo present: exactly two reader calls, manifest then the explicit image key.
- Manifest/read failures must stop immediately; do not attempt the image read.

### Results And Failures

Use the existing `ObjectLoadResult<ReadableStream>` shape:

- expected absence returns `{ status: 'not_found' }`
- found authorized photo returns `{ status: 'found', value: ReadableStream }`
- reader failures and invalid identifiers use existing sanitized `ObjectServiceError` behavior
- invalid/malformed/wrong-album manifests use existing sanitized manifest error behavior
- never reveal whether an unlisted photo object physically exists
- never expose identifiers, keys, manifest contents, paths, R2 details, or underlying errors

Do not silently convert unexpected failures into `not_found`.

## Files To Inspect

- `AGENTS.md`
- `CLAUDE.md`
- `photo-gate-design.md`
- `docs/handoffs/archive/2026-06-09-phase-3-r2-key-manifest-validation-foundation.md`
- `docs/handoffs/archive/2026-06-09-phase-3-private-object-read-response-foundation.md`
- `docs/handoffs/archive/2026-06-09-phase-3-private-r2-reader-adapter.md`
- `workers/src/types/manifest.ts`
- `workers/src/types/private-object.ts`
- `workers/src/services/private-album-object-service.ts`
- `workers/src/services/manifest-validator.ts`
- `workers/src/services/r2-object-key.ts`
- existing private-object tests

## Files To Create Or Edit

- `workers/src/services/manifest-authorized-photo-service.ts`
- focused tests under `workers/test/`
- `workers/README.md`

Edit another existing file only if a focused correction is required for this contract. Explain any such change in the report.

Do not edit:

- `workers/src/index.tsx`
- `workers/wrangler.toml`
- `workers/src/types/env.ts`
- migrations
- fixture routes or fixture data
- Docker implementation

## Implementation Constraints

- Use platform and language APIs only.
- Do not add dependencies.
- Keep this service independent of Hono routes, D1, R2 binding names, and concrete `R2Bucket` types.
- Do not duplicate manifest parsing or R2 key construction.
- Do not accept arbitrary keys, paths, content types, or headers.
- Do not buffer or transform images.
- Do not implement caches, writes, deletes, listing, cleanup, or downloads.
- Do not log identifiers, keys, manifest contents, or errors.
- Preserve all active fixture route behavior.

## Test Strategy

Tests must run without Cloudflare credentials, D1, a real/local R2 bucket, network access, secrets, or deployment.

Use injected reader fakes and in-memory readable streams.

At minimum test both thumb and preview operations for:

- manifest read occurs before image read
- exact standard keys are used
- found listed photo returns the image stream
- missing manifest returns `not_found` with one reader call
- unlisted photo returns `not_found` with one reader call
- unlisted photo never probes its image key, even if a fake object would exist
- case-different, prefix, suffix, and substring photo IDs do not match
- invalid album/photo IDs fail closed before inappropriate reads
- manifest reader failure stops before image read
- manifest text failure stops before image read
- malformed and wrong-album manifests stop before image read
- image absence returns `not_found`
- image reader failure remains a sanitized service error
- errors never expose IDs, keys, manifest data, or underlying details
- image streams remain streamed and are not buffered
- all existing Workers tests continue to pass

Exercise behavior rather than relying only on source-string assertions.

## README

Document:

- why album authorization alone is insufficient for photo-object reads
- manifest-first photo membership enforcement
- exact-match behavior and read order
- absence and sanitized failure behavior
- that stale/orphan R2 images are not readable through this service
- that no active route, binding, or real R2 read is connected
- local verification commands

Do not document credentials, account IDs, bucket names/IDs, deployment commands, or real data.

## Constraints

- Preserve all architecture and security invariants in `AGENTS.md`.
- Preserve all current active route behavior.
- Do not connect the active app to D1 or R2.
- Do not add or choose D1/R2 bindings.
- Do not edit `workers/src/types/env.ts`.
- Do not apply migrations.
- Do not implement or wire login, album APIs, image routes, authenticated pages, or active object routes.
- Do not read real R2 data.
- Do not implement cleanup or deletion.
- Do not deploy, publish, push, or commit automatically.

## Non Goals

- active route wiring
- bindings or migration application
- login/session policy
- album authorization middleware changes
- cover or manifest response routes
- R2 cleanup/deletion
- image caching or optimization
- range/conditional/download responses
- admin UI
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

Verification must pass without Cloudflare access, real D1/R2, PhotoPrism, Docker services, secrets, or `.env`.

## Expected Report

- Changed files
- Manifest membership and exact-match behavior
- Read order and reader call counts
- Absence and sanitized failure behavior
- Confirmation that stale/unlisted object keys are never read
- Confirmation that active routes, bindings, environment types, migrations, and fixtures are unchanged
- Dependency changes, if any
- Verification results
- Any blocked checks with exact reasons
- Questions that must return to Codex before active image routes are implemented
