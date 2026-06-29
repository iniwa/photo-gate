Read AGENTS.md, CLAUDE.md, and this handoff file before implementation.
If implementation would violate constraints or require files outside this
handoff, stop and ask before editing.

## Goal

Implement Track A3 for browser-complete sync: let the Worker admin surface read
the Docker-published safe album catalog at `ops/album-catalog.json` and replace
the temporary free-text `catalogId` input in the sync-target form with a
catalog picker.

This handoff does not complete catalog-based D1 album creation. The existing
manual album create form may remain as an emergency/operator path. This task is
only to make selecting a PhotoPrism catalog entry for an existing D1 album
browser-friendly and safe.

## Background

Track A1 is implemented locally: Docker `photo-gate-sync publish-catalog` writes
a sanitized PhotoPrism album catalog to private R2:

```text
ops/album-catalog.json
```

Schema 1:

```json
{
  "schema": 1,
  "publishedAt": "2026-06-26T00:00:00Z",
  "albums": [
    {
      "catalogId": "64 lowercase hex sha256 of the PhotoPrism album UID",
      "title": "Album title for admin display",
      "photoCount": 234,
      "updatedAt": "2026-06-26T00:00:00Z"
    }
  ]
}
```

`photoCount` and `updatedAt` may be `null`.

Track A2 is implemented locally: Worker admin routes write
`ops/sync-targets.json`, and Docker consumes it to sync resolved catalog
targets. The current Worker form under `GET /admin/albums` still asks the
operator to type a 64-hex `catalogId` manually. That is not acceptable as the
normal browser-complete flow.

The Worker still must not contact PhotoPrism, NAS, Docker, Portainer, or a
Docker socket. The Worker may only read the fixed private R2 catalog object.

## Acceptance Criteria

1. Add a Worker-side admin catalog repository for `ops/album-catalog.json`.
2. `GET /admin/albums` reads the catalog and renders catalog options in the
   per-album sync-target upsert form.
3. The sync-target upsert route still accepts only `albumId` and `catalogId`,
   but now verifies that the submitted `catalogId` exists in the current safe
   catalog before writing `ops/sync-targets.json`.
4. The selected target title used in `ops/sync-targets.json` must come from the
   existing D1 album row, not from the catalog. This preserves the public album
   title already managed by D1.
5. Catalog read behavior is fail-closed for malformed objects and safe for
   missing objects:
   - missing `ops/album-catalog.json` -> `GET /admin/albums` still renders the
     page with a clear "catalog not available" message and no upsert selector;
   - malformed catalog, R2 read failure, invalid JSON, oversized object, or
     invalid row -> `GET /admin/albums` returns sanitized 500 `no-store`;
   - malformed catalog or R2 read failure during POST validation -> sanitized
     500 `no-store`;
   - submitted `catalogId` not present in the current catalog -> 400
     `no-store` and no D1 clock/repo/sync-target write.
6. The admin page must never render raw PhotoPrism UID, PhotoPrism URL, token,
   NAS path, source filename, source metadata, R2 bucket/key details, raw JSON,
   admin identity, or Cloudflare Access claims.
7. The catalog picker is no-JS SSR HTML. Do not add client-side JavaScript.
8. The implementation stays within Workers and documentation only. No Docker
   code, migrations, deployment, production data mutation, commit, push, or
   handoff archival.

## Detailed Requirements

### Catalog Types

Add safe admin catalog types, for example:

```ts
export interface AdminAlbumCatalogEntry {
  catalogId: string
  title: string
  photoCount: number | null
  updatedAt: string | null
}

export interface AdminAlbumCatalog {
  schema: 1
  publishedAt: string
  albums: AdminAlbumCatalogEntry[]
}
```

These types must not include raw PhotoPrism UID or any URL/token/source fields.

### Catalog Repository

Add a repository similar in shape to the existing R2 admin repositories.

Expected behavior:

- fixed key only: `ops/album-catalog.json`;
- `bucket.get(CATALOG_KEY)` returns `null` -> `{ status: 'missing' }`;
- object size limit before `text()`; use a conservative maximum such as
  `256 * 1024` bytes;
- `text()`/JSON parse/schema validation failures -> throw a fixed
  `album catalog read failed` error;
- root object has exactly 3 keys: `schema`, `publishedAt`, `albums`;
- `schema === 1`;
- `publishedAt` is Docker seconds UTC format
  `YYYY-MM-DDTHH:mm:ssZ` and canonical;
- `albums` is an array with a reasonable max, normally 1000 entries unless a
  smaller existing admin constant is more appropriate;
- each album object has exactly 4 keys: `catalogId`, `title`, `photoCount`,
  `updatedAt`;
- `catalogId` is exactly 64 lowercase hex characters;
- `title` is non-empty, no leading/trailing whitespace, no ASCII control
  characters, max 1024 code points;
- `photoCount` is `null` or a safe non-negative integer;
- `updatedAt` is `null` or Docker seconds UTC format;
- duplicate `catalogId` values fail closed;
- sort order may preserve catalog order from Docker, but tests should not rely
  on unsorted input unless the implementation explicitly sorts.

Expose methods sufficient for the route, for example:

```ts
getCatalog(): Promise<
  | { status: 'missing' }
  | { status: 'available'; publishedAt: string; albums: AdminAlbumCatalogEntry[] }
>

hasCatalogId(catalogId: string): Promise<boolean>
```

It is acceptable to implement `hasCatalogId` by reading and validating the
catalog once per POST.

### GET /admin/albums

Extend `AdminRouteDeps` so the admin route receives the catalog repository.
Wire it from `workers/src/index.tsx` using `env.PHOTO_BUCKET`.

On authenticated `GET /admin/albums`:

1. Continue to read the D1 album page exactly as today.
2. Also read the album catalog.
3. Render a catalog picker in each album row's sync-target upsert form when the
   catalog is available and has at least one entry.
4. If the catalog is missing or empty, render a short admin-visible message in
   the sync-target area and do not render a free-text `catalogId` input.

Picker details:

- Use `<select name="catalogId">`.
- Each option value is the safe `catalogId`.
- Option label may include catalog title plus safe metadata such as
  `(234 photos, updated 2026-06-26T00:00:00Z)`.
- `photoCount === null` and `updatedAt === null` must render as safe text such
  as `unknown`.
- Do not render raw JSON or any non-schema fields.
- Do not include any JavaScript.

### POST /admin/albums/sync-target-upsert

Keep the existing security chain:

`requireAdmin -> same-origin Origin -> exact form Content-Type -> parseBody({ all: true }) -> exact field validation`

Keep the body shape exactly two fields:

- `albumId`
- `catalogId`

After cheap form validation and before `clock()` or `albumRepo.getAlbumForSync`,
verify that `catalogId` exists in the current validated catalog. If the catalog
is missing, malformed, unreadable, or the catalog ID is absent:

- missing/malformed/unreadable -> 500 `no-store`, fixed body
  `Internal Server Error`;
- absent but well-formed catalog -> 400 `no-store`, fixed body such as
  `Bad Request`;
- no clock, D1, or sync-target repository write is called for either case.

On success, keep the existing behavior:

- read the D1 album row via `getAlbumForSync(albumId)`;
- use D1 `title`, `expiresAt`, and `downloadEnabled` for the sync-target record;
- `clock().toISOString()` supplies `publishedAt`;
- write `ops/sync-targets.json`;
- return `303 Location: /admin/albums` with `Cache-Control: no-store` and empty
  body.

### Privacy Proofs Required In Tests

Tests must prove:

- `GET /admin/albums` renders catalog titles, counts, timestamps, and 64-hex
  catalog IDs only;
- HTML does not include raw UID-like test strings, PhotoPrism URLs, tokens,
  `photoprism_album_uid`, R2 bucket names, raw JSON, or admin email/claims;
- malformed catalog fields are not partially rendered;
- POST rejects a catalog ID that is syntactically valid but absent from the
  current catalog without calling `clock`, `albumRepo`, or `syncTargetRepo`.

## Files To Inspect

- `AGENTS.md`
- `CLAUDE.md`
- `FABLE.md`
- `docs/fable/current-state.md`
- `docs/fable/progress.md`
- `docs/fable/roadmap.md`
- `docs/decisions/2026-06-26-browser-complete-sync-and-reupload-phasing.md`
- `docs/decisions/2026-06-26-admin-browser-management.md`
- `workers/src/routes/admin.tsx`
- `workers/src/index.tsx`
- `workers/src/services/admin-sync-target-repository.ts`
- `workers/src/services/admin-sync-status-repository.ts`
- `workers/src/services/admin-sync-request-repository.ts`
- `workers/src/services/repository-validation.ts`
- `workers/test/admin-routes.test.ts`
- `workers/test/admin-sync-target-repository.test.ts`
- `workers/test/admin-sync-status-repository.test.ts`
- `workers/test/admin-sync-request-repository.test.ts`
- `workers/README.md`

## Files To Edit

- `workers/src/types/admin-album-catalog.ts` (new)
- `workers/src/services/admin-album-catalog-repository.ts` (new)
- `workers/src/routes/admin.tsx`
- `workers/src/index.tsx`
- `workers/test/admin-album-catalog-repository.test.ts` (new)
- `workers/test/admin-routes.test.ts`
- `workers/README.md`

Do not edit Docker files, migrations, Fable docs, operation docs, archived
handoffs, secrets, or local configuration for this handoff. If another file is
required, stop and report why before editing.

## Constraints

- Workers must not contact PhotoPrism, NAS, Docker, Portainer, or a Docker
  socket.
- Docker must not be changed in this handoff.
- R2 remains private. Only fixed private keys may be read or written.
- Do not render or log raw PhotoPrism UIDs, URLs, tokens, R2 credentials, NAS
  paths, original filenames, source metadata, admin identity, or Access claims.
- Do not change the `ops/album-catalog.json` schema produced by Docker.
- Do not change the `ops/sync-targets.json` schema produced by Worker.
- Do not weaken admin authentication, same-origin, Content-Type, or exact form
  field validation.
- Do not add JavaScript, SPA behavior, dependencies, or public API routes.
- Do not enable albums automatically.
- Do not implement R2 deletion or cleanup.
- Do not commit, push, deploy, mutate production, or archive the handoff.

## Non Goals

- No catalog-based D1 album creation in this handoff.
- No D1 migration or schema change.
- No removal of the emergency/manual `photoprismAlbumUid` create path.
- No Docker daemon catalog auto-publication cadence changes.
- No manual sync request schema changes.
- No reupload suppression or object metadata optimization.
- No album/user hard delete.
- No R2 cleanup report or deletion.
- No production deployment or smoke test.

## Verification

Run from `workers/`:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm audit --omit=dev --audit-level=high
```

Run from repository root:

```powershell
git diff --check
git diff HEAD -- docker/
git diff HEAD -- workers/migrations/
```

Do not run Docker tests unless Docker files were changed by mistake. If any
verification is skipped or blocked, report the exact reason.

## Expected Report

Report in Japanese:

1. Changed files.
2. Catalog repository schema and validation rules.
3. `GET /admin/albums` rendering behavior for available, empty, missing, and
   malformed catalogs.
4. `POST /admin/albums/sync-target-upsert` behavior, including proof that an
   absent catalog ID does not call `clock`, D1, or sync-target writes.
5. Privacy proof: list what catalog/admin data is rendered and what sensitive
   fields are not rendered/logged.
6. Verification commands and exact results.
7. Skipped checks and exact reasons.
8. Unexpected findings or out-of-scope changes.
9. Model limitation report if Opus/Sonnet split was unavailable.
10. Design questions for Codex, if any.
