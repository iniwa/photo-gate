# photo-gate workers

Cloudflare Workers application for photo-gate. It serves the shared photo viewing UI.

> **WARNING: This is a Phase 2/3 foundation. Do not deploy this as a real photo-sharing service.**
> Login routes, D1 bindings, R2 bindings, and real photo data are not connected.
> Authentication and authorization middleware is implemented but not wired to any active route.
> R2 key builders, manifest validator, private-object loaders, and image response helpers are implemented but no R2 reads or object responses are active.
> A private R2 reader adapter is implemented but no R2 binding or active route uses it.
> Authorized-album catalog repository is implemented but not wired to any active route.
> All visible content is synthetic fixture data.

## Architecture

- **Runtime**: Cloudflare Workers (TypeScript, Hono + JSX SSR)
- **Static assets**: `public/` served via Workers Assets (`/styles.css`)
- **UI**: Server-side rendered HTML via Hono + JSX, with no client-side JavaScript
- **Phase 3 foundation**: D1 schema, crypto primitives, session model, repositories, auth middleware, R2-key builders, manifest validator, private-object loaders, and image response helpers are implemented but not yet wired to live routes.

### Phase boundary

| | Phase 2 (active routes) | Phase 3 (this foundation) | Phase 4 |
|---|---|---|---|
| Data source | In-code fixtures | Not wired | D1 + R2 |
| Viewer login | Not implemented | Middleware ready | Full login route |
| Album authorization | Not implemented | Middleware ready | Per-user D1 checks |
| Image delivery | 401 | Not wired | R2 via Workers |
| R2 key construction | — | Key builders ready | Active routes |
| Manifest validation | — | Validator ready | Active R2 reads |
| Private-object loaders | — | Loaders ready | Active R2 reads |
| Image responses | — | Response helpers ready | Active object routes |
| Private R2 reader | — | Injected adapter ready | Active R2 reads |
| Authorized-album catalog | — | Repository ready | Active album routes |

## Install

```sh
cd workers
npm ci
```

## Verification

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

Verification runs without a Cloudflare account, D1, R2, PhotoPrism, or secrets.

## Local development

```sh
npx wrangler dev
```

> `/api`, `/img`, and `/admin` routes always return 401. Reserved for Phase 4.

## Routes (Phase 2 fixture UI)

| Route | Description |
|---|---|
| `GET /` | Login placeholder; indicates auth is not yet active |
| `GET /albums` | Fixture album list |
| `GET /albums/:albumId` | Fixture album detail with photo cards |

Photo cards do **not** link to `/img/*` or any image endpoint.

### Reserved routes: intentional 401

```
/api    /api/*
/img    /img/*
/admin  /admin/*
```

Fail closed by design. No fixture data is returned.

## D1 Schema (Phase 3, created but not applied)

Two migrations are defined under `migrations/`. They are **not applied** in this handoff.

### 0001_users_sessions.sql

- `users`: id, display_name, password_hash, enabled, fail_count, locked_until, created_at, updated_at
- `sessions`: token_hash (SHA-256 hex), user_id references users with CASCADE, created_at, expires_at, last_seen_at
- Indexes: sessions.user_id, sessions.expires_at

### 0002_albums_permissions.sql

- `albums`: id, title, photoprism_album_uid, enabled, expires_at, image settings, strip_exif, download_enabled, created_at, updated_at
- `album_permissions`: (album_id, user_id) composite PK with CASCADE references to albums and users
- Indexes: album_permissions.user_id, album_permissions.album_id

Foreign keys are enabled with `PRAGMA foreign_keys = ON`. Deleting a user deletes their sessions and permissions. Deleting an album deletes its permissions.

## Authentication and Authorization Middleware (Phase 3, not wired)

Two reusable middleware factories and generic failure-response helpers are defined under `src/middleware/`. They are **not attached to any active route** and require no D1 binding, secrets, or deployment to test.

### `requireSession(fetcher, clock)`

Validates the session cookie and loads the authenticated user:

1. Parses `photo_gate_session` cookie via the strict parser (rejects missing, duplicate, malformed, wrong-length tokens)
2. Digests the raw token to a SHA-256 hex string (the raw token is never passed to the repository or downstream handler)
3. Calls `fetcher.fetchValidSession(digest, now)`; `now` is read from `clock()` exactly once when a valid cookie requires lookup
4. Sets `userId` in Hono context variables; calls `next()` on success

**Failure behavior:**

| Condition | Status |
|---|---|
| Missing, duplicate, malformed cookie | `401 Unauthorized` |
| Unknown, expired, or disabled-user session | `401 Unauthorized` |
| Repository / crypto failure | `503 Service Unavailable` |

All failure responses use `Cache-Control: no-store`. Responses never include user IDs, tokens, digests, SQL, or exception text.

### `requireAlbumPermission(permChecker, albumIdResolver, clock)`

Authorizes access to a specific album (intended to run after `requireSession`):

1. Reads `userId` from Hono context variables (set by session middleware)
2. Resolves `albumId` from the caller-supplied resolver function
3. Validates the `albumId` format
4. Calls `permChecker.checkPermission(userId, albumId, now)`; `now` is read from `clock()` exactly once when a valid request requires a permission check

**Failure behavior:**

| Condition | Status |
|---|---|
| `userId` not in context | `401 Unauthorized` |
| Invalid or absent album ID | `403 Forbidden` |
| Permission denied, disabled album, expired album | `403 Forbidden` |
| Repository failure | `503 Service Unavailable` |

Fails closed on repository errors: a DB outage never accidentally grants permission. All failure responses use `Cache-Control: no-store`.

### Request context

Downstream handlers receive only:

```typescript
{ userId: string }
```

Raw tokens, token digests, password hashes, session rows, and permission rows are never stored in context.

### Dependency injection

Both factories accept interface values (`SessionFetcher`, `PermissionChecker`) rather than concrete repository classes. Pass the concrete `SessionRepository` / `PermissionRepository` instances when wiring to routes in Phase 4.

## Password Hash Encoding

```text
pbkdf2-sha256$<iterations>$<salt-base64url>$<digest-base64url>
```

- PBKDF2 with HMAC-SHA256, 16-byte random salt, 32-byte derived key
- Stored iteration count is validated on every verify call (min 100 000, max 10 000 000)
- Malformed encodings, unsupported algorithms, and out-of-range iteration counts are rejected
- Derived keys are compared in constant-time application code
- **Production iteration count is not yet decided.** `hashPassword` requires an explicit count so a Workers CPU benchmark can select the value before login routes are implemented.

## Session Token Model

- Tokens: 32 random bytes from `crypto.getRandomValues()`, encoded as unpadded base64url
- D1 stores only the lowercase hex SHA-256 digest (`token_hash`); the raw token is never stored
- Repository methods reject raw tokens; only 64-char lowercase hex digests are accepted
- Session lifetime is always supplied explicitly by callers
- Repository timestamps must be canonical UTC strings produced by `Date.toISOString()`

## Secure Cookie Contract

| Attribute | Value |
|---|---|
| Name | `photo_gate_session` |
| HttpOnly | yes |
| Secure | yes |
| SameSite | Strict |
| Path | / |
| Max-Age | explicit positive integer (creation) / 0 (clear) |

`parseSessionCookie` rejects duplicate cookie names, malformed base64url, and tokens that do not decode to exactly 32 bytes.

## Security headers

Applied to all Worker-generated responses:

```
Content-Security-Policy: default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

Cache headers:

- Successful HTML pages: `Cache-Control: private, no-cache`
- 401 and error responses: `Cache-Control: no-store`
- `public/styles.css` (via `_headers`): `Cache-Control: public, max-age=31536000, immutable`

## R2 Object Key Builders (Phase 3, not wired)

Four explicit builder functions are defined in `src/services/r2-object-key.ts`. They produce the standard R2 paths used by the Docker sync service and are not connected to any active route or R2 binding.

| Builder | Path produced |
|---|---|
| `albumManifestKey(albumId)` | `albums/{albumId}/manifest.json` |
| `albumCoverKey(albumId)` | `albums/{albumId}/cover.webp` |
| `photoThumbKey(albumId, photoId)` | `albums/{albumId}/thumbs/{photoId}.webp` |
| `photoPreviewKey(albumId, photoId)` | `albums/{albumId}/previews/{photoId}.jpg` |

Each builder validates the supplied ID against the safe-ID contract (`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$`) and throws before returning a key if the ID is invalid. Error messages identify the invalid field category but never echo the rejected value.

Arbitrary caller-supplied paths, relative segments, path traversal, backslashes, URL encoding, extensions, or prefixes are intentionally unsupported. There is no generic `buildKey(parts)` or `getObject(key)` helper.

## Manifest Runtime Validator (Phase 3, not wired)

`parseManifest(json, expectedAlbumId)` in `src/services/manifest-validator.ts` accepts a raw JSON string read from R2 and validates it against the `schemaVersion: 1` contract produced by `docker/src/photo_gate/manifest.py`. It is not connected to any active route or R2 binding.

### Validation behavior

- Rejects invalid JSON, over-size input, non-object roots, unsupported `schemaVersion`, and any missing or unexpected properties at every schema level.
- Requires `manifest.albumId` to exactly match the caller-supplied `expectedAlbumId` — prevents serving one album's manifest in response to another album's request.
- Validates all IDs with the shared safe-ID contract; validates timestamps as timezone-aware ISO 8601.
- Requires `images.stripExif === true`, `thumb.format === "webp"`, `preview.format === "jpg"`.
- Requires each photo's `thumb` and `preview` paths to exactly equal `thumbs/{id}.webp` and `previews/{id}.jpg` — rejects absolute paths, path traversal, backslashes, URL-like values, query strings, fragments, wrong extensions, and cross-photo path references.
- Rejects duplicate photo IDs.
- Returns a freshly constructed `Manifest` object; the raw parsed input is never returned or mutated.

All validation errors throw `Error('invalid manifest')`. No album IDs, photo IDs, titles, paths, JSON snippets, or parser exception text are included in errors.

### Defensive parser limits

These limits apply at parse time and are intentionally conservative. They are not product limits or synchronization targets.

| Limit | Value |
|---|---|
| Input JSON UTF-8 byte length | 8 MiB |
| Photo count | 20,000 |
| Title length (album and per-photo) | 1,024 Unicode code points |
| Image dimensions (width, height, long edges) | 100,000 |

Limits are exported as `MANIFEST_LIMITS` for tests.

### Docker schema contract

The validator mirrors the current Docker implementation:

- `docker/src/photo_gate/manifest.py` — `build_manifest` output format
- `docker/src/photo_gate/models.py` — `AlbumIdentity`, `ImageSettings`, `PhotoPrismPhoto` field constraints

The validator does not accept schema fields beyond what Docker currently emits. Schema changes require an explicit versioned update to both the Docker and Workers implementations.

## Centralized Safe-ID Contract

All identifier validation — repositories, authorization middleware, R2 key builders, and manifest validator — uses a single helper in `src/services/safe-id.ts`:

```
^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$
```

- Must begin with an alphanumeric character
- May contain alphanumerics, underscores, and hyphens after the first character
- Minimum length: 1; maximum length: 128

## Private Object Reader Contract (Phase 3, not wired)

The injected `PrivateObjectReader` interface in `src/types/private-object.ts` defines the minimum required operation for reading private R2 objects. It is not connected to a real R2 binding.

```typescript
interface PrivateObjectReader {
  get(key: string): Promise<PrivateObjectBody | null>
}
```

`PrivateObjectBody` exposes only:

| Property | Description |
|---|---|
| `body: ReadableStream \| null` | Response-compatible body; image loaders require a non-null readable stream |
| `text(): Promise<string>` | Full object content as UTF-8 (manifest parsing only) |

All other stored object properties — `Content-Type`, `ETag`, checksums, `size`, upload timestamp, HTTP metadata, custom metadata, and bucket name — are **intentionally excluded** from the contract. Route-independent services must not trust or forward stored metadata.

The R2 binding name is not yet decided. The reader stays injected and decoupled from `wrangler.toml`.

## Private Album Object Loaders (Phase 3, not wired)

Four explicit loaders are defined in `src/services/private-album-object-service.ts`. They are not connected to any active route or R2 binding.

| Loader | Object fetched | Key used |
|---|---|---|
| `loadAlbumManifest(reader, albumId)` | Album manifest JSON | `albumManifestKey(albumId)` |
| `loadAlbumCover(reader, albumId)` | Cover image body | `albumCoverKey(albumId)` |
| `loadPhotoThumb(reader, albumId, photoId)` | Thumbnail image body | `photoThumbKey(albumId, photoId)` |
| `loadPhotoPreview(reader, albumId, photoId)` | Preview image body | `photoPreviewKey(albumId, photoId)` |

Each loader:

- accepts only structured identifiers; no caller-supplied key, path, or arbitrary string is accepted
- delegates key construction to the existing explicit R2 key builders (which enforce the safe-ID contract)
- calls the injected reader exactly once
- returns `{ status: 'not_found' }` for absent objects without throwing
- throws `ObjectServiceError` (not the raw reader error) for unexpected failures

### Mandatory manifest validation

`loadAlbumManifest` performs mandatory validation after a successful read:

1. Calls `obj.text()` to read the raw JSON string
2. Passes it to `parseManifest(text, expectedAlbumId)` for strict schemaVersion 1 validation
3. Returns only the validated `Manifest` object; the raw JSON string is never returned

`text()` is never called if the reader returns `null` (object absent).

### Sanitized service errors

`ObjectServiceError` has a stable `code` property for route mapping:

| Code | Meaning |
|---|---|
| `reader_failure` | Reader rejected, `text()` rejected, or invalid identifier supplied |
| `manifest_invalid` | JSON is malformed, fails schema validation, or has a mismatched `albumId` |

Error messages are generic (`'object read failed'` / `'manifest invalid'`). No album IDs, photo IDs, R2 keys, bucket names, underlying exception text, or manifest content are included in errors.

Image object loaders (`loadAlbumCover`, `loadPhotoThumb`, `loadPhotoPreview`) return only a validated non-null `ReadableStream` from `PrivateObjectBody.body`. Missing or invalid bodies fail closed as sanitized reader failures. All other stored metadata is discarded, even if a test double supplies it. Bodies are never buffered, converted to strings, or inspected.

### Authorization boundary

These loaders are intended to run only after `requireSession` and `requireAlbumPermission`. They contain no authorization logic. The responsibility boundary is:

1. route authentication (`requireSession`)
2. album authorization (`requireAlbumPermission`)
3. explicit object loader
4. safe response helper

## Private Object Response Helpers (Phase 3, not wired)

Three helpers are defined in `src/middleware/private-object-response.ts`. They are not connected to any active route.

### Successful image responses

```typescript
privateImageResponse(body: ReadableStream | null, kind: ImageKind): Response
```

`ImageKind` is an explicit allowlist: `'cover' | 'thumb' | 'preview'`. Content-Type is fixed by kind:

| Kind | Content-Type |
|---|---|
| `cover` | `image/webp` |
| `thumb` | `image/webp` |
| `preview` | `image/jpeg` |

All successful object responses use `Cache-Control: private, no-store` and `X-Content-Type-Options: nosniff`. The body is passed through without buffering or inspection.

The following headers are **never** set or forwarded: `ETag`, `Last-Modified`, `Content-Length`, `Content-Disposition`, `Content-Range`, stored `Cache-Control`, or any other R2 object metadata.

### Failure responses

| Helper | Status | Cache-Control | Body |
|---|---|---|---|
| `objectNotFoundResponse()` | 404 | `no-store` | Generic; no IDs, keys, or storage details |
| `objectInternalErrorResponse()` | 500 | `no-store` | Generic; no IDs, keys, or storage details |

Both failure helpers set `X-Content-Type-Options: nosniff`. Cache-Control is `no-store` (not `private, no-store`), matching the existing auth failure policy.

## Private R2 Reader Adapter (Phase 3, not wired)

`PrivateR2Reader` adapts an injected `R2Bucket` to the minimal `PrivateObjectReader` contract. It permits only the four standard private album object layouts:

```text
albums/{albumId}/manifest.json
albums/{albumId}/cover.webp
albums/{albumId}/thumbs/{photoId}.webp
albums/{albumId}/previews/{photoId}.jpg
```

Keys are validated before R2 access. Arbitrary prefixes, unsafe IDs, traversal forms, wrong extensions, query strings, fragments, encoded alternatives, and additional path segments are rejected. Expected object absence returns `null`; invalid keys, R2 failures, malformed objects, and text-read failures produce only a sanitized adapter error.

Found R2 objects are reconstructed as the existing minimal `{ body, text }` contract. R2 metadata, HTTP metadata, custom metadata, ETag, checksums, size, upload time, bucket identity, and all write/list/delete operations are intentionally unavailable.

Authentication and album authorization remain required before an explicit object loader calls this adapter. No R2 binding name, active route, or real R2 read is connected.

## Authorized Album Catalog Repository (Phase 3, not wired)

`AuthorizedAlbumRepository` in `src/services/authorized-album-repository.ts` provides two operations for discovering only the albums an authenticated shared user is currently authorized to view. It is not connected to any active route or D1 binding.

### Viewer-facing album shape

```typescript
interface AuthorizedAlbumSummary {
  id: string
  title: string
}
```

Fields intentionally **not returned**: `photoprism_album_uid`, image-generation settings (`thumb_long_edge`, `thumb_format`, `thumb_quality`, `preview_*`), `strip_exif`, `download_enabled`, permission rows, user IDs, session data, R2 keys, and timestamps. R2 manifests remain the source for photo lists and generated image details.

### Repository methods

| Method | Returns |
|---|---|
| `listAuthorizedAlbums(userId, now, limit, afterAlbumId?)` | `AuthorizedAlbumSummary[]` |
| `getAuthorizedAlbum(userId, albumId, now)` | `AuthorizedAlbumSummary \| null` |

### Authorization conditions (enforced by every query)

Every query enforces all of the following within a single parameterized SQL statement:

- an explicit `album_permissions` row for the supplied `userId` and `albumId`
- `users.enabled = 1` (the viewer account is active)
- `albums.enabled = 1` (the album is published)
- `albums.expires_at IS NULL OR albums.expires_at > now` (the album has not expired)

These conditions are redundant with middleware authorization by design — the repository cannot become an accidental data-enumeration boundary if middleware is bypassed or misconfigured.

### Keyset pagination

`listAuthorizedAlbums` uses deterministic ascending `ORDER BY a.id ASC` with an explicit `LIMIT`. The `limit` parameter must be an integer between `1` and `100` inclusive. When `afterAlbumId` is supplied, the query adds `AND a.id > ?` and binds the cursor as a parameter; no offset pagination is used. Callers use the last returned album ID as the next cursor.

### Input and row validation

- Invalid `userId` returns `[]` (list) or `null` (get) without querying D1.
- Invalid `albumId` returns `null` (get) without querying D1.
- Invalid `limit` (0, >100, non-integer, NaN, Infinity), non-canonical `now`, or invalid `afterAlbumId` throw generic validation errors before D1 access.
- D1-returned rows are validated: only safe IDs and string titles up to 1,024 Unicode code points are accepted. Unexpected fields are discarded. Duplicate IDs and malformed rows throw `'database operation failed'`.

### Failure behavior

All D1 failures and malformed rows throw the existing sanitized `'database operation failed'` error — no user IDs, album IDs, cursor values, titles, SQL, or internal exception details are included in thrown errors.

## What is not connected

- D1 database: no `[d1_databases]` binding in `wrangler.toml`; migrations are not applied
- R2 bucket: no `[r2_buckets]` binding in `wrangler.toml`; no manifests, thumbs, previews, or covers
- R2 key builders: implemented, not wired to any route; no R2 reads or object responses
- Manifest validator: implemented, not wired to any route; no real manifests parsed
- Private-object loaders: implemented, not wired to any route; no real R2 reads
- Image response helpers: implemented, not wired to any route; no real object responses
- Private R2 reader adapter: implemented, not wired to any route or binding; no real object reads
- Authentication middleware: implemented, not wired to any route; no login, logout, or session cookies in active routes
- Authorization middleware: implemented, not wired to any route
- Authorized-album catalog repository: implemented, not wired to any route; no real D1 binding, no active album list or album detail routes
- PhotoPrism: no API calls
- Admin UI: `/admin/*` returns 401
