# photo-gate workers

Cloudflare Workers application for photo-gate. It serves the shared photo viewing UI.

> **WARNING: This is a Phase 2 fixture UI. Do not deploy this as a real photo-sharing service.**
> D1, R2, authentication, and real photo data are not connected. All content is synthetic fixture data.

## Architecture

- **Runtime**: Cloudflare Workers (TypeScript, Hono + JSX SSR)
- **Static assets**: `public/` served via Workers Assets (`/styles.css`)
- **UI**: Server-side rendered HTML via Hono + JSX, with no client-side JavaScript
- **Phase 2 boundary**: Fixture data only. Real album/photo data waits until Phase 3 authentication and album-level authorization exist.

### Phase boundary

| | Phase 2 (this) | Phase 3 |
|---|---|---|
| Data source | In-code fixtures | D1 + R2 |
| Viewer login | Not implemented | D1-backed login, PBKDF2-SHA256 |
| Album authorization | Not implemented | Per-user D1 permissions |
| Image delivery | Not implemented (401) | R2 via Workers |

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

> Note: `/api`, `/img`, and `/admin` routes always return 401. This is intentional because they are reserved for Phase 3 and fail closed.

## Routes

### Fixture HTML routes (Phase 2)

| Route | Description |
|---|---|
| `GET /` | Login placeholder; indicates auth is not yet active |
| `GET /albums` | Fixture album list |
| `GET /albums/:albumId` | Fixture album detail with photo cards |

Photo cards on album detail pages do **not** link to `/img/*` or any image endpoint.

### Reserved routes: intentional 401

Every request under the following prefixes returns `401 Unauthorized` with no body content that reveals album or photo data:

```
/api
/api/*
/img
/img/*
/admin
/admin/*
```

These routes are reserved for Phase 3 implementation. They fail closed by design.

### Other routes

Unknown paths return a safe HTML `404`.

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

- D1 database: no users, albums, permissions, or sessions
- R2 bucket: no manifests, thumbs, or previews
- Authentication: no login, logout, or session cookies
- PhotoPrism: no API calls
- Admin UI: `/admin/*` returns 401
