# photo-gate workers

Cloudflare Workers application for photo-gate. It serves the shared photo viewing UI.

> **WARNING: This is a Phase 2/3 foundation. Do not deploy this as a real photo-sharing service.**
> Login routes, D1 bindings, R2 bindings, and real photo data are not connected.
> All visible content is synthetic fixture data.

## Architecture

- **Runtime**: Cloudflare Workers (TypeScript, Hono + JSX SSR)
- **Static assets**: `public/` served via Workers Assets (`/styles.css`)
- **UI**: Server-side rendered HTML via Hono + JSX, with no client-side JavaScript
- **Phase 3 foundation**: D1 schema, crypto primitives, session model, and repositories are implemented but not yet wired to live routes.

### Phase boundary

| | Phase 2 (active routes) | Phase 3 (this foundation) | Phase 4 |
|---|---|---|---|
| Data source | In-code fixtures | Not wired | D1 + R2 |
| Viewer login | Not implemented | Primitives ready | Full login route |
| Album authorization | Not implemented | Repository ready | Per-user D1 checks |
| Image delivery | 401 | Not wired | R2 via Workers |

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

## What is not connected

- D1 database: no `[d1_databases]` binding in `wrangler.toml`; migrations are not applied
- R2 bucket: no manifests, thumbs, or previews
- Authentication: no login, logout, or session cookies in active routes
- PhotoPrism: no API calls
- Admin UI: `/admin/*` returns 401
