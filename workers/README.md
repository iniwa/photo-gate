# photo-gate workers

Cloudflare Workers application for photo-gate. It serves the shared photo viewing UI.

> **WARNING: Not yet provisioned for production. Do not deploy without real resources.**
> The viewer UI (`/`, `/albums`, `/albums/:albumId`), auth routes (`/api/auth/*`), and
> private image routes (`/img/*`) are all ACTIVE and fully real — no fixture data remains.
> They require a real `DB` (D1) database and a real `PHOTO_BUCKET` (R2) bucket. The
> bindings are declared in `wrangler.toml` with a placeholder D1 ID; no real resources
> exist yet, so against the current configuration every authenticated path fails closed
> (login 503, pages 303-to-login/503, images 401/403/503/500) and no real data is served.
> Migrations are not applied; no users, albums, sessions, or images exist.

## Architecture

- **Runtime**: Cloudflare Workers (TypeScript, Hono + JSX SSR)
- **Static assets**: `public/` served via Workers Assets (`/styles.css`)
- **UI**: Server-side rendered HTML via Hono + JSX, with no client-side JavaScript
- **Status**: the full viewer surface (login UI, album pages, auth API, image delivery) is implemented and wired. Real D1/R2 provisioning, migrations, and operator bootstrap are the remaining steps before deployment.

### Active surface

| Surface | Routes | Backing |
|---|---|---|
| Login UI | `GET /` | D1 (session probe; fail-safe to form) |
| Album pages | `GET /albums`, `GET /albums/:albumId` | D1 (authorization) + R2 (manifest) |
| Photo preview page | `GET /albums/:albumId/photos/:photoId` | D1 (session + album permission) + R2 (manifest membership check); HTML page embeds existing `/img` preview route via `<img>` — page route does not read the preview object directly; no originals, no PhotoPrism/NAS, no R2 mutation |
| Auth API | `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` | D1 |
| Image delivery | `GET /img/:albumId/{cover,thumb/:photoId,preview/:photoId}` | D1 + R2 |
| Preview download | `GET /download/:albumId/preview/:photoId` | D1 (session + album permission + `download_enabled` gate) + R2 (manifest membership check, then preview JPEG as attachment); serves only existing generated preview JPEG — no originals, no new R2 objects, no R2 mutation |
| Admin surface | `GET /admin` | Cloudflare Access JWT + email allowlist |
| Admin user inventory | `GET /admin/users` | D1 (read-only; no `password_hash`) |
| Admin album inventory | `GET /admin/albums` | D1 (read-only; no `photoprism_album_uid`, transform settings, or `strip_exif`) |
| Admin permission inventory + assignment UI | `GET /admin/permissions` | D1 (3 queries: users `id/display_name/enabled`, albums `id/title/enabled`, permissions `album_id/user_id/created_at`; no `password_hash`, `photoprism_album_uid`; renders `<select>` dropdowns for grant form; disabled users/albums shown with `(無効)` badge; fail closed if either list exceeds 100 rows) |
| Admin permission grant | `POST /admin/permissions/grant` | D1 (insert; idempotent ON CONFLICT DO NOTHING) |
| Admin permission revoke | `POST /admin/permissions/revoke` | D1 (delete; idempotent on absent pair) |
| Admin album create | `POST /admin/albums/create` | D1 only (INSERT; enabled=0 explicit; photoprism_album_uid write-only on create, never selected back; transform/EXIF columns omitted so schema defaults apply; no PhotoPrism/NAS/Docker/Portainer/R2 access) |
| Admin album enable/disable | `POST /admin/albums/enable`, `POST /admin/albums/disable` | D1 (UPDATE enabled; idempotent) |
| Admin album metadata update | `POST /admin/albums/update-public-metadata` | D1 (UPDATE title, expires_at, download_enabled, updated_at; photoprism_album_uid and transform settings untouched) |
| Admin user enable/disable | `POST /admin/users/enable`, `POST /admin/users/disable` | D1 (UPDATE enabled; sessions and lockout untouched) |
| Admin user create | `POST /admin/users/create` | D1 (INSERT; enabled=1, fail_count=0, locked_until=NULL) |
| Admin user password reset | `POST /admin/users/reset-password` | D1 (UPDATE password_hash, fail_count=0, locked_until=NULL; sessions and permissions untouched) |
| Admin user display name update | `POST /admin/users/update-display-name` | D1 (UPDATE display_name, updated_at; no password_hash, enabled, fail_count, locked_until, sessions, or permissions touched; unknown userId is 500) |
| Admin hard-delete controls | `POST /admin/users/confirm-delete`, `POST /admin/users/delete`, `POST /admin/albums/confirm-delete`, `POST /admin/albums/delete` | Users: two-step HMAC confirmation then `DELETE FROM users WHERE id = ?` with D1 cascade for sessions/permissions. Albums: two-step HMAC confirmation; remove matching sync target first, then `DELETE FROM albums WHERE id = ?`; no R2 album asset deletion |
| Admin ops summary | `GET /admin/ops` | D1 (read-only aggregate counts from `users`, `albums`, `album_permissions`, `sessions`; no row-level identity, title, hash, token, PhotoPrism UID, or R2 data) |
| Admin sync status | `GET /admin/sync` | Private R2 (read-only; accepts schema 1 and schema 2 status from `ops/sync-status.json`; schema 1 normalizes trigger fields to null; schema 2 includes `lastTriggerKind` and `lastHandledRequestId`; also reads pending request state from `ops/sync-request.json`; renders Sync Now form and pending indicator) |
| Admin sync request writer | `POST /admin/sync/request` | Private R2 (write-only; fixed key `ops/sync-request.json`; admin-only; validates exact `kind=sync-now` form input; Docker daemon consumes and handles; Sync Now form exposed on `GET /admin/sync`) |
| Admin sync target upsert | `POST /admin/albums/sync-target-upsert` | Private R2 `ops/album-catalog.json` (catalog check: verifies submitted `catalogId` exists; missing/malformed → 500, absent → 400) + D1 (read album by `albumId`) + Private R2 (read-modify-write `ops/sync-targets.json`; accepts `albumId`+`catalogId`; rejects duplicate `catalogId` across albums; fixed thumb/preview/stripExif schema) |
| Admin sync target remove | `POST /admin/albums/sync-target-remove` | Private R2 (read-modify-write `ops/sync-targets.json`; accepts `albumId`; removes matching entry; no-op for unknown album ID) |
| Admin R2 cleanup report | `GET /admin/r2-cleanup` | Private R2 (`list()` only under `albums/` and `ops/`; no object body reads) + D1 (read-only: `SELECT id, enabled FROM albums`; no title, photoprism_album_uid, or transform settings); read-only dry-run reporting only — does not delete, mutate, or move any R2 object |
| Admin album catalog (GET /admin/albums picker) | `GET /admin/albums` (catalog read) | Private R2 `ops/album-catalog.json` (read-only; missing → renders "カタログ未取得" message; malformed/R2 error → 500 no-store; available → renders `<select name="catalogId">` picker per album row; no raw UID, URL, token, or R2 credential rendered) |
| Everything else under `/api`, `/img` | always `401` | — |
| `/admin/*` (non-GET or unknown path) | authenticated `404` (behind Access guard) | — |

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

> `/api/auth/*` (login, logout, me) is active but needs a real `DB` binding; without one it returns 503.
> The three `/img/*` image routes are active but need real `DB` + `PHOTO_BUCKET` bindings; without
> them an authenticated request fails closed (401/403/503/500/404).
> `/admin` is now the Cloudflare Access boundary: `GET /admin` returns 200 only to a verified,
> allowlisted administrator; all other callers get 403. However, until the three Access config
> values (`CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `ADMIN_EMAILS`) are registered as Worker
> vars/secrets, `/admin` fails closed with 403 for everyone.
> All other `/api` and `/img` routes always return 401.

## Viewer Pages (SSR)

Real D1/R2-backed pages defined in `src/routes/pages.tsx` (no client-side JavaScript,
no fixture data). Mounted after the reserved-401 catch-alls so `/api`, `/img`, and
`/admin` are never shadowed.

| Route | Authenticated | Unauthenticated |
|---|---|---|
| `GET /` | `303` to `/albums` | `200` login form (POST to `/api/auth/login`) |
| `GET /albums` | `200` authorized album list | `303` to `/` |
| `GET /albums/:albumId` | `200` photo grid / `403` no permission | `303` to `/` |

- **Login form.** `/` shows the generic error 「ユーザーIDまたはパスワードが正しくありません」
  only when the query is exactly `error=1` (set by the login redirect). No other query
  content is reflected. The logged-in check on `/` is a fail-safe probe: any D1/crypto
  failure renders the login form instead of an error.
- **Redirect-to-login.** HTML pages convert the session 401 into `303` to `/` via the
  `requireSessionPage` wrapper (`src/middleware/require-session-page.ts`); 503 passes
  through unchanged. API/image routes keep their raw 401.
- **Album list.** `listAuthorizedAlbums(userId, now, 50, after?)` with keyset pagination;
  an invalid `after` cursor falls back to the first page. Covers load from
  `/img/{albumId}/cover`. Empty list renders a friendly message.
- **Album detail.** Chain: session → album permission → `getAuthorizedAlbum` (D1 title is
  the page heading) → `loadAlbumManifest`. Manifest absent renders a 200 「準備中」 page
  (sync has not produced a manifest yet — not an error); manifest invalid or reader
  failure renders a generic 500 page. Photos render in manifest order as thumbs linking
  to previews; no EXIF-style metadata is displayed. All text is JSX auto-escaped.
- **Caching.** Authenticated HTML uses `Cache-Control: private, no-cache`; redirects and
  error pages use `no-store`.

## Viewer Auth Routes (`/api/auth`)

The first real D1-backed routes. Defined in `src/routes/auth-api.ts` and mounted in
`src/index.tsx` **before** the reserved-401 catch-alls, so `/api/auth/*` reaches this
router while every other `/api/*` path stays 401. They require a real `DB` binding;
without one, repository calls reject and the handlers return `503` (fail closed — no
explicit binding check).

| Route | Method | Success | Failure |
|---|---|---|---|
| `/api/auth/login` | POST | `303` to `/albums` with a session cookie | `303` to `/?error=1` (uniform credential failure) / `401` (malformed request) |
| `/api/auth/logout` | POST | `303` to `/` clearing the cookie (idempotent) | `503` only if D1 delete fails (cookie not cleared) |
| `/api/auth/me` | GET | `200 {"userId": ...}` (via `requireSession`) | `401` / `503` per middleware |

- **Form-only login.** `POST /api/auth/login` accepts `application/x-www-form-urlencoded`
  (`userId`, `password`) only. The viewer UI is SSR with no client JS, so login is a form POST.
- **Uniform credential failure.** Every credential-failure cause — unknown user, disabled
  user, invalid-format ID, wrong password, locked account — returns the identical
  `303` to `/?error=1` with `Cache-Control: no-store` (the SSR login form re-renders with
  a generic message). No cause, ID, or detail is exposed. Malformed requests (wrong
  Content-Type, missing/oversize fields) return a plain `401`. A fixed public dummy
  PBKDF2 hash (a timing decoy, not a secret) is verified when no user row is found so the
  unknown-user path spends the same work as a real verification.
- **Origin enforcement.** State-changing routes (`login`, `logout`) reject with `403` when an
  `Origin` header is present and does not match the request URL's origin, before parsing the
  body. Combined with the `SameSite=Strict` cookie this blocks login CSRF.
- **Lockout.** 5 consecutive failures lock the account for 15 minutes
  (`MAX_LOGIN_FAILURES` / `LOCKOUT_DURATION_SECONDS` in `src/services/login-policy.ts`).
- **Session issuance.** Each success mints a fresh 32-byte token (anti-fixation); only its
  SHA-256 digest is stored in D1. The raw token appears only in the `Set-Cookie` header.
  Cookie contract: see [Secure Cookie Contract](#secure-cookie-contract); lifetime is the
  fixed 7-day `SESSION_LIFETIME_SECONDS`.
- **Fail closed.** Binding-missing, D1, and crypto failures all return `503` with a generic
  body containing no IDs, digests, SQL, or internal error text.

`/api/*` outside `/api/auth/*` stays `401`.

## Private Image Routes (`/img`)

The first routes that perform real R2 reads. Defined in `src/routes/img-routes.ts` and
mounted in `src/index.tsx` **before** the reserved-401 catch-alls, so the three image GET
shapes reach this router while every other `/img` path stays 401. They require both a real
`DB` binding (session + album permission) and a real `PHOTO_BUCKET` binding (R2 reads);
without them the chain fails closed (no explicit binding check — repository/reader calls
reject and the middleware/handlers return 503/500/404, while a no-cookie request still
returns 401 before any binding is touched).

| Route | Method | R2 object | Content-Type |
|---|---|---|---|
| `/img/:albumId/cover` | GET | `albums/{albumId}/cover.webp` | `image/webp` |
| `/img/:albumId/thumb/:photoId` | GET | `albums/{albumId}/thumbs/{photoId}.webp` | `image/webp` |
| `/img/:albumId/preview/:photoId` | GET | `albums/{albumId}/previews/{photoId}.jpg` | `image/jpeg` |

Successful responses carry `Cache-Control: private, no-store` and `X-Content-Type-Options:
nosniff` only. No `ETag`, `Last-Modified`, `Content-Disposition`, stored cache headers, or
any other R2 object metadata is forwarded; the body stream is passed through without
buffering or inspection. There is no range, conditional-request, or caching support.

### Authorization chain (fixed order)

1. **`requireSession`** — validates the `photo_gate_session` cookie. Invalid/missing session
   → 401; nothing else runs (the permission check and R2 are never reached).
2. **`requireAlbumPermission`** — checks the authenticated user's permission for `:albumId`.
   Invalid-format `albumId` or denied permission → 403; R2 is never reached.
3. **Object load** —
   - **thumb/preview:** `:photoId` is format-validated first (invalid → 404, no R2 read).
     Then manifest-first membership is enforced: the validated manifest is read and the
     image object is fetched **only** after an exact `photo.id` match. An unlisted or stale
     photo is never probed in R2, so object existence is never revealed.
   - **cover:** loaded directly with `loadAlbumCover`. **Cover is an album-scoped asset
     published by the Docker sync, not a per-photo object, so it is NOT manifest-gated** —
     album permission is the boundary. A cover can be served even when no manifest exists
     yet (sync uploads cover/images first, the manifest last). See
     `docs/decisions/2026-06-11-private-image-routes.md` §2.2.4.
4. **Response** — only the safe `privateImageResponse` (fixed Content-Type by kind) or the
   generic `objectNotFoundResponse` / `objectInternalErrorResponse` helpers.

### Failure table

| Condition | Response |
|---|---|
| Invalid / missing session | `401` (generic) |
| Album permission denied / invalid `albumId` | `403` (generic) |
| Invalid `photoId` format | `404` (no R2 read) |
| Manifest absent / photo unlisted / image object absent | `404` (generic, indistinguishable) |
| Manifest invalid / reader failure / any other throw | `500` (generic) |
| D1 failure (session or permission lookup) | `503` (generic) |

404/500/503 responses contain no album ID, photo ID, R2 key, object type, storage provider,
or internal error detail. An unlisted photo and a missing image object return the identical
404; the image key of an unlisted/stale photo is never requested from R2.

### Reserved routes: intentional 401

```
/api (exact)      /api/* except /api/auth/*
/img (exact)      /img/* except the three image GET shapes
```

Fail closed by design. No fixture data is returned. `/api/auth/login`, `/api/auth/logout`,
and `/api/auth/me` are the only active routes under `/api`; everything else under these
prefixes returns 401. Under `/img`, only the three GET shapes
`/img/:albumId/cover`, `/img/:albumId/thumb/:photoId`, and `/img/:albumId/preview/:photoId`
reach the image router; `/img` itself, any other path shape, and any non-GET method fall
through to the reserved 401 catch-all.

`/admin` is no longer in the reserved-401 list. It is now owned by a dedicated Cloudflare
Access-protected router mounted **before** the 401 catch-alls. See
[Admin Surface (`/admin`, Cloudflare Access)](#admin-surface-admin-cloudflare-access) below.

## Admin Surface (`/admin`, Cloudflare Access)

Defined in `src/routes/admin.tsx` and mounted in `src/index.tsx` **before** the
reserved-401 catch-alls, so the admin router owns every `/admin` and `/admin/*`
request and nothing falls through to the public viewer page router. `/admin` was
removed from the reserved-401 set; only `/api` and `/img` remain there.

### Route behavior

| Route | Auth result | Response |
|---|---|---|
| `GET /admin` | Verified + allowlisted | `200` minimal SSR page (heading 「管理コンソール」; links to `/admin/users`, `/admin/albums`, `/admin/permissions`) |
| `GET /admin` | Any failure | `403 Forbidden` (generic, no-store) |
| `GET /admin/users` | Verified + allowlisted | `200` read-only user inventory (keyset-paginated; no `password_hash`) |
| `GET /admin/users?after=<id>` | Verified + allowlisted | `200` next page; `400` on invalid/repeated cursor |
| `GET /admin/users` | Any failure | `403 Forbidden` (generic, no-store) |
| `GET /admin/albums` | Verified + allowlisted | `200` read-only album inventory (keyset-paginated; forbidden columns absent) |
| `GET /admin/albums?after=<id>` | Verified + allowlisted | `200` next page; `400` on invalid/repeated cursor |
| `GET /admin/albums` | Any failure | `403 Forbidden` (generic, no-store) |
| `GET /admin/permissions` | Verified + allowlisted | `200` read-only permission inventory (composite keyset-paginated; no JOIN) |
| `GET /admin/permissions?after_album=<a>&after_user=<u>` | Verified + allowlisted | `200` next page; `400` on incomplete/invalid/repeated cursor params |
| `GET /admin/permissions` | Any failure | `403 Forbidden` (generic, no-store) |
| `POST /admin/permissions/grant` | Verified + allowlisted + same-origin + form body | `303` to `/admin/permissions` (idempotent grant) |
| `POST /admin/permissions/grant` | Any auth failure | `403 Forbidden` (generic, no-store) |
| `POST /admin/permissions/grant` | Missing/mismatched Origin | `403 Forbidden` (same-origin check) |
| `POST /admin/permissions/grant` | Wrong Content-Type | `400 Bad Request` (no-store) |
| `POST /admin/permissions/grant` | Invalid/missing/extra/repeated fields | `400 Bad Request` (no-store) |
| `POST /admin/permissions/revoke` | Verified + allowlisted + same-origin + form body | `303` to `/admin/permissions` (idempotent revoke) |
| `POST /admin/permissions/revoke` | Any auth failure | `403 Forbidden` (generic, no-store) |
| `POST /admin/permissions/revoke` | Missing/mismatched Origin | `403 Forbidden` (same-origin check) |
| `POST /admin/permissions/revoke` | Wrong Content-Type | `400 Bad Request` (no-store) |
| `POST /admin/permissions/revoke` | Invalid/missing/extra/repeated fields | `400 Bad Request` (no-store) |
| `POST /admin/albums/create` | Verified + allowlisted + same-origin + form body (albumId, title, photoprismAlbumUid, expiresAt, downloadEnabled) | `303` to `/admin/albums` (D1 INSERT; enabled=0 explicit; photoprism_album_uid never selected back) |
| `POST /admin/albums/create` | Any auth failure | `403 Forbidden` (generic, no-store) |
| `POST /admin/albums/create` | Missing/mismatched Origin | `403 Forbidden` (same-origin check) |
| `POST /admin/albums/create` | Wrong Content-Type | `400 Bad Request` (no-store) |
| `POST /admin/albums/create` | Invalid/missing/extra/repeated/whitespace fields | `400 Bad Request` (no-store; no submitted values reflected) |
| `POST /admin/albums/create` | Clock/repo failure | `500 Internal Server Error` (no-store; no D1 error text, no UID/title/albumId reflected) |
| `POST /admin/albums/enable` | Verified + allowlisted + same-origin + form body | `303` to `/admin/albums` (idempotent enable) |
| `POST /admin/albums/enable` | Any auth failure | `403 Forbidden` (generic, no-store) |
| `POST /admin/albums/enable` | Missing/mismatched Origin | `403 Forbidden` (same-origin check) |
| `POST /admin/albums/enable` | Wrong Content-Type | `400 Bad Request` (no-store) |
| `POST /admin/albums/enable` | Invalid/missing/extra/repeated field | `400 Bad Request` (no-store) |
| `POST /admin/albums/disable` | Verified + allowlisted + same-origin + form body | `303` to `/admin/albums` (idempotent disable) |
| `POST /admin/albums/disable` | Any auth failure | `403 Forbidden` (generic, no-store) |
| `POST /admin/albums/disable` | Missing/mismatched Origin | `403 Forbidden` (same-origin check) |
| `POST /admin/albums/disable` | Wrong Content-Type | `400 Bad Request` (no-store) |
| `POST /admin/albums/disable` | Invalid/missing/extra/repeated field | `400 Bad Request` (no-store) |
| `POST /admin/users/enable` | Verified + allowlisted + same-origin + form body | `303` to `/admin/users` (idempotent enable) |
| `POST /admin/users/enable` | Any auth failure | `403 Forbidden` (generic, no-store) |
| `POST /admin/users/enable` | Missing/mismatched Origin | `403 Forbidden` (same-origin check) |
| `POST /admin/users/enable` | Wrong Content-Type | `400 Bad Request` (no-store) |
| `POST /admin/users/enable` | Invalid/missing/extra/repeated field | `400 Bad Request` (no-store) |
| `POST /admin/users/disable` | Verified + allowlisted + same-origin + form body | `303` to `/admin/users` (idempotent disable) |
| `POST /admin/users/disable` | Any auth failure | `403 Forbidden` (generic, no-store) |
| `POST /admin/users/disable` | Missing/mismatched Origin | `403 Forbidden` (same-origin check) |
| `POST /admin/users/disable` | Wrong Content-Type | `400 Bad Request` (no-store) |
| `POST /admin/users/disable` | Invalid/missing/extra/repeated field | `400 Bad Request` (no-store) |
| `POST /admin/users/update-display-name` | Verified + allowlisted + same-origin + form body | `303` to `/admin/users` (updates display_name; unknown userId is 500) |
| `POST /admin/users/update-display-name` | Any auth failure | `403 Forbidden` (generic, no-store) |
| `POST /admin/users/update-display-name` | Missing/mismatched Origin | `403 Forbidden` (same-origin check) |
| `POST /admin/users/update-display-name` | Wrong Content-Type | `400 Bad Request` (no-store) |
| `POST /admin/users/update-display-name` | Invalid/missing/extra/repeated fields | `400 Bad Request` (no-store) |
| `GET /admin/r2-cleanup` | Verified + allowlisted | `200` read-only HTML report: per-album-prefix category (owned-active, owned-disabled, orphan), object count, total bytes; malformed count; excluded ops count; truncation notice if limit reached; no full object keys, photo IDs, bucket name, PhotoPrism data, or mutation form |
| `GET /admin/r2-cleanup` | Any auth failure | `403 Forbidden` (generic, no-store) |
| `POST /admin/users/confirm-delete` | Verified + allowlisted + same-origin + form body (`userId`) + `HARD_DELETE_HMAC_KEY` present | `200` confirmation-preview page with 15-minute HMAC token and exact phrase requirement; selects only `id`, `display_name`, `enabled`; no actual delete |
| `POST /admin/users/delete` | Verified + allowlisted + same-origin + form body (`token`, `phrase`) + valid unexpired user-delete token + phrase `DELETE USER` + target re-read | `200` completion page after `DELETE FROM users WHERE id = ?`; sessions and album permissions are removed by existing D1 `ON DELETE CASCADE`; no R2/Docker/PhotoPrism/NAS/Portainer access |
| `POST /admin/albums/confirm-delete` | Verified + allowlisted + same-origin + form body (`albumId`) + `HARD_DELETE_HMAC_KEY` present | `200` confirmation page with 15-minute HMAC token and exact phrase requirement; selects only `id`, `title`, `enabled`; no sync-target mutation until final delete POST |
| `POST /admin/albums/delete` | Verified + allowlisted + same-origin + form body (`token`, `phrase`) + valid unexpired album-delete token + phrase `DELETE ALBUM` + target re-read | `200` completion page after removing the matching sync target and then `DELETE FROM albums WHERE id = ?`; album permissions are removed by D1 cascade; R2 album objects are not deleted and may become orphaned prefixes |
| hard-delete POST routes | Missing/mismatched Origin, wrong Content-Type, invalid/repeated/extra fields, wrong phrase, malformed/tampered/expired/wrong-category token | `403` or `400` no-store; input is not reflected and no delete is attempted |
| hard-delete preview POST routes | Missing/short `HARD_DELETE_HMAC_KEY` or repository failure | `500 Internal Server Error` no-store; no SQL, stack trace, password hash, PhotoPrism UID, R2 key, bucket, or credential detail |
| `GET /admin/r2-cleanup` | D1 or R2 list failure | `500 Internal Server Error` (no-store; no SQL, R2 key, bucket name, or exception detail) |
| `POST /admin/r2-cleanup/confirm` | Verified + allowlisted + same-origin + valid form body + HMAC key present + report not truncated + within limits | `200` HMAC-signed confirmation page: orphan counts, 15-min token embedded in hidden field, phrase input form submitting to `/delete`; no R2 keys, album IDs, or credentials exposed |
| `POST /admin/r2-cleanup/confirm` | Any auth failure | `403 Forbidden` (generic, no-store) |
| `POST /admin/r2-cleanup/confirm` | Missing/mismatched Origin | `403 Forbidden` (same-origin check) |
| `POST /admin/r2-cleanup/confirm` | Wrong Content-Type or unexpected body fields | `400 Bad Request` (no-store) |
| `POST /admin/r2-cleanup/confirm` | `R2_CLEANUP_HMAC_KEY` absent or shorter than 32 chars | `500 Internal Server Error` (no-store; fails closed) |
| `POST /admin/r2-cleanup/confirm` | Report truncated or orphan/object count exceeds Phase 2 limits (50 prefixes / 500 objects) | `400 Bad Request` (no-store) |
| `POST /admin/r2-cleanup/delete` | Verified + allowlisted + same-origin + valid form body + correct phrase + valid unexpired token + re-scan fingerprint match | `200` "not yet enabled" result page (Phase 2: no R2 deletion performed) |
| `POST /admin/r2-cleanup/delete` | Any auth failure | `403 Forbidden` (generic, no-store) |
| `POST /admin/r2-cleanup/delete` | Missing/mismatched Origin | `403 Forbidden` (same-origin check) |
| `POST /admin/r2-cleanup/delete` | Wrong Content-Type, unexpected/missing fields, wrong phrase, invalid/expired/tampered token, or fingerprint mismatch | `400 Bad Request` (no-store) |
| `POST /admin/r2-cleanup/delete` | `R2_CLEANUP_HMAC_KEY` absent or shorter than 32 chars | `500 Internal Server Error` (no-store; fails closed) |
| Any other method or `/admin/*` path | Verified + allowlisted | `404 Not Found` (generic, no-store) |
| Any other method or `/admin/*` path | Any failure | `403 Forbidden` (generic, no-store) |

### Admin album inventory — approved columns

`GET /admin/albums` selects **7 explicit columns** from the `albums` table. The following are **never** selected, returned, rendered, logged, or exposed:

| Forbidden column | Reason |
|---|---|
| `photoprism_album_uid` | PhotoPrism internal identifier — must never be surfaced |
| `thumb_long_edge`, `thumb_format`, `thumb_quality` | Internal transform settings |
| `preview_long_edge`, `preview_format`, `preview_quality` | Internal transform settings |
| `strip_exif` | Internal transform setting |

Approved columns: `id`, `title`, `enabled`, `expires_at`, `download_enabled`, `created_at`, `updated_at`.

### Admin permission inventory — approved columns

`GET /admin/permissions` selects **3 explicit columns** from `album_permissions` only. There is **no JOIN** to `users` or `albums`. The following are **never** selected, returned, rendered, logged, or exposed:

| Forbidden data | Reason |
|---|---|
| `password_hash` | User credential — must never be surfaced |
| `display_name` | User PII — not needed for the permission inventory |
| `title` (album) | Not joined — no album metadata is included |
| `photoprism_album_uid` | PhotoPrism internal identifier — must never be surfaced |

Approved columns: `album_id`, `user_id`, `created_at`.

The `GET /admin` page and all inventory pages contain **no** `password_hash`, session,
PhotoPrism, R2, NAS, or private metadata. The Access administrator email is never
displayed or logged. All responses under `/admin` use `Cache-Control: no-store`.

### Authentication: Cloudflare Access JWT validation

The Worker validates the Cloudflare Access JWT itself using the `jose` library
(`createRemoteJWKSet` + `jwtVerify`). It reads **only** the `Cf-Access-Jwt-Assertion`
request header — there is no `CF_Authorization` fallback.

Verification enforces:

- **Signature** — via the team-domain JWKS endpoint `https://<team-domain>/cdn-cgi/access/certs`
- **Issuer** — must equal `https://<team-domain>`
- **Audience** — must match the configured AUD tag
- **`exp`** — required and must not be expired
- **`nbf`** — honored when present

### Email allowlist

After JWT verification the `email` claim is normalized (lowercased; rejected if it
contains any whitespace, surrounding whitespace, or control characters, or lacks a basic
`local@domain` shape) and compared case-insensitively against the `ADMIN_EMAILS` allowlist.
The allowlist is comma-separated and trimmed at parse time. Empty entries, trailing commas,
and malformed addresses all cause the entire allowlist to be rejected fail closed.

### Fail-closed behavior

Every failure class — missing or malformed runtime config, missing or invalid JWT,
signature/issuer/audience/temporal verification failure, JWKS fetch failure, missing or
malformed email claim, and non-allowlisted email — returns the **identical generic
`403 Forbidden`** with `Cache-Control: no-store`. No cause is revealed. No JWT, claim
value, email address, team domain, audience tag, or JWKS error is ever logged or echoed.

### Runtime configuration (three values)

The three values below are registered at **deploy time as Worker vars/secrets**, not
in `wrangler.toml` or source. All three are declared as optional on the `Env` interface
so that a missing or malformed value fails closed to the generic 403 rather than a type
error.

| Variable | Description | Constraints |
|---|---|---|
| `CF_ACCESS_TEAM_DOMAIN` | Cloudflare Access team domain hostname only | Must end in `.cloudflareaccess.com`; no scheme, path, port, or trailing slash (e.g. `<team>.cloudflareaccess.com`) |
| `CF_ACCESS_AUD` | Cloudflare Access application Audience tag | Non-empty, printable ASCII, max 256 chars |
| `ADMIN_EMAILS` | Comma-separated administrator email allowlist | Each entry trimmed, normalized, and exact-matched case-insensitively |

Until all three values are configured and a real Cloudflare Access application is created
and deployed, `/admin` fails closed with `403` for everyone. The production Access
application, secrets, and deployment at `https://share-photo.iniwach.com` are complete
as of 2026-06-23. See `docs/operations/admin-access.md` for operator setup instructions.

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
- **Production iteration count is 100,000** (`PBKDF2_PRODUCTION_ITERATIONS` in `src/services/login-policy.ts`) — the Cloudflare Workers platform cap. See `docs/decisions/2026-06-11-login-session-policy-and-pbkdf2-iterations.md`. `hashPassword` still requires an explicit count at every call site.

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
Referrer-Policy: same-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

`Referrer-Policy` must stay `same-origin`, not `no-referrer`: browsers
serialize the `Origin` header of navigation POSTs (the login form)
according to the referrer policy, so `no-referrer` makes every browser
send `Origin: null` and the login origin check rejects it with 403.

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
  download_enabled: number  // 1 = downloads permitted; 0 = downloads disabled
}
```

Fields intentionally **not returned**: `photoprism_album_uid`, image-generation settings (`thumb_long_edge`, `thumb_format`, `thumb_quality`, `preview_*`), `strip_exif`, permission rows, user IDs, session data, R2 keys, and timestamps. R2 manifests remain the source for photo lists and generated image details.

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

## Manifest-Authorized Photo Loading (Phase 3, not wired)

`loadManifestAuthorizedThumb(reader, albumId, photoId)` and `loadManifestAuthorizedPreview(reader, albumId, photoId)` in `src/services/manifest-authorized-photo-service.ts` serve photo objects only when the requested photo is present in the album's currently validated manifest. They are not connected to any active route, binding, or real R2 read.

### Why album authorization alone is insufficient

Album authorization proves the caller may view an album, but not that a specific `photoId` belongs to it. Without manifest membership enforcement, an authorized viewer could probe arbitrary safe photo IDs under the authorized album prefix and read stale or orphaned image objects that remain in R2 until cleanup is implemented. The current validated manifest is the single source of truth for which photos an album currently publishes.

### Manifest-first membership enforcement

Each operation, in fixed order:

1. validates `albumId` and `photoId` against the safe-ID contract (fail closed before any read)
2. loads and validates the album manifest via `loadAlbumManifest` (strict schemaVersion 1 validation, album-ID match)
3. returns `{ status: 'not_found' }` if the manifest is absent
4. searches the validated manifest for an **exact** `photo.id` match
5. returns `{ status: 'not_found' }` **without reading any image object** if the photo is not listed
6. loads the image through the existing explicit loader only after membership succeeds

### Exact-match behavior

Membership uses exact string equality on `photo.id` only. Title, index, path substring, prefix, suffix, case-folding, and fuzzy matching never match. Caller-supplied manifest paths are not accepted; the strict manifest validator already guarantees each listed photo's paths match its ID.

### Read order and call counts

| Condition | Reader calls | Result |
|---|---|---|
| Invalid album/photo ID | 0 | sanitized `reader_failure` |
| Manifest absent | 1 (manifest) | `not_found` |
| Photo not listed | 1 (manifest) | `not_found`; the image key is never probed |
| Photo listed | 2 (manifest, then exact image key) | image stream or `not_found` |
| Manifest read/validation failure | 1 (manifest) | sanitized error; the image read is never attempted |

### Absence and failure behavior

- Expected absence (missing manifest, unlisted photo, missing image) returns `{ status: 'not_found' }`. An unlisted photo is indistinguishable from a missing image object — the service never reveals whether an unlisted photo object physically exists.
- Reader failures and invalid identifiers use the existing sanitized `ObjectServiceError('reader_failure')`; invalid, malformed, or wrong-album manifests use `ObjectServiceError('manifest_invalid')`.
- Unexpected failures are never converted into `not_found`.
- Errors and results never expose identifiers, keys, manifest contents, photo metadata, paths, R2 details, or underlying error text.
- Stale or orphaned R2 image objects that are no longer listed in the current manifest are not readable through this service.

### Verification

```sh
cd workers
npm run lint
npm run typecheck
npm test
npm run build
```

## Login And Session Policy (Phase 3, not wired)

Route-independent policy helpers are defined in `src/services/login-policy.ts`. They
are pure functions and constants with no Hono, D1, or R2 dependency, and no login
route uses them yet.

- **Fixed 7-day sessions.** `SESSION_LIFETIME_SECONDS = 604_800`. `sessionExpiresAtFrom(createdAt)`
  returns the expiry as a canonical UTC string. There is no sliding refresh in the
  initial implementation.
- **5-failure / 15-minute atomic lockout.** `MAX_LOGIN_FAILURES = 5`,
  `LOCKOUT_DURATION_SECONDS = 900`. `recordLoginFailure` applies the lockout inside a
  single parameterized `UPDATE` using a `CASE WHEN fail_count + 1 >= ?` expression, so a
  concurrent read-modify-write cannot drop the lock. The repository stays policy-free:
  the threshold and lockout timestamp are always passed in by the caller.
- **Fail-closed `locked_until`.** `isAccountLocked(lockedUntil, now)` treats a non-null
  but non-canonical `locked_until` value as locked. Authentication uncertainty always
  resolves to deny.
- **PBKDF2 production iterations = 100,000.** `PBKDF2_PRODUCTION_ITERATIONS = 100_000`
  is the Cloudflare Workers (workerd) platform cap; higher counts fail at runtime. See
  `docs/decisions/2026-06-11-login-session-policy-and-pbkdf2-iterations.md` for the
  decision and its compensating controls.

## What is not connected

- D1 database: declared with a placeholder ID in `wrangler.toml`; no real database is provisioned and migrations are not applied, so the active `/api/auth/*` and `/img/*` routes return 503 on session/permission lookups
- R2 bucket: declared in `wrangler.toml` but no real bucket is provisioned; the active `/img/*` routes have no manifests, thumbs, previews, or covers to read
- R2 key builders: wired through the active `/img/*` routes via the private-object loaders; still no real R2 data
- Manifest validator: wired through the active thumb/preview routes (manifest-first membership); no real manifests parsed
- Private-object loaders: wired through the active `/img/*` routes; no real R2 reads against a provisioned bucket
- Image response helpers: wired through the active `/img/*` routes; no real object bytes served
- Private R2 reader adapter: wired through the active `/img/*` routes via the injected reader; no real bucket connected
- Login/session policy helpers: implemented in `src/services/login-policy.ts` and now used by the active `/api/auth/*` routes (a real `DB` binding is still required for them to function)
- Authentication middleware and login/logout/me routes: wired and active under `/api/auth/*`, but require a real `DB` binding; against the current placeholder config they return 503
- Authorization middleware (album-level): wired and active under the `/img/*` image routes; requires a real `DB` binding (without one, permission lookups return 503)
- Manifest-authorized photo loading: wired and active under the `/img/:albumId/{thumb,preview}/:photoId` routes; requires real `DB` + `PHOTO_BUCKET` bindings
- Authorized-album catalog repository: wired and active under the `/albums` viewer pages; requires a real `DB` binding
- Viewer pages: wired and active (`/`, `/albums`, `/albums/:albumId`); no fixture data remains, but without real D1/R2 they render only the login form / fail-closed responses
- Expired-session cleanup: a daily cron trigger (`0 18 * * *` UTC = 03:00 JST) runs `deleteExpiredSessions` via the worker `scheduled` handler; it needs a real `DB` binding to have effect (failures are swallowed — expired sessions are already rejected at read time)
- PhotoPrism: no API calls
- Admin authentication boundary: implemented (`/admin` is now Cloudflare Access-gated with Worker-side JWT validation and email allowlist). The Cloudflare Access application, all three Worker config values (`CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `ADMIN_EMAILS`), and deployment are complete — the production admin surface at `https://share-photo.iniwach.com/admin` is operator-verified as of 2026-06-23 (see `docs/operations/admin-access.md`).
- Admin user inventory: implemented (`GET /admin/users`). Reads the D1 `users` table with 7 explicit columns; `password_hash` is never selected, returned, rendered, logged, or exposed. Keyset-paginated (50 per page). Requires a real `DB` binding to function; without one, D1 calls fail closed with `500`.
- Admin album inventory: implemented (`GET /admin/albums`). Reads 7 explicit columns from the D1 `albums` table; `photoprism_album_uid`, all transform settings, and `strip_exif` are never selected, returned, rendered, logged, or exposed. Keyset-paginated (50 per page). Requires a real `DB` binding; without one, D1 calls fail closed with `500`.
- Admin permission inventory + assignment UI: implemented (`GET /admin/permissions`). Issues 3 D1 queries: (1) `users` — `id, display_name, enabled` only (`password_hash`, `fail_count`, `locked_until`, `sessions`, `photoprism_album_uid` never selected); (2) `albums` — `id, title, enabled` only (`photoprism_album_uid`, transform settings never selected); (3) `album_permissions` — `album_id, user_id, created_at`. Lists capped at `ASSIGNMENT_OPTIONS_MAX = 100`; exceeding fails closed with `500`. Renders `<select>` dropdowns for grant form (disabled users/albums shown with `(無効)` badge). Permissions composite keyset-paginated (50 per page, `?after_album=<a>&after_user=<u>`). Requires a real `DB` binding; without one, D1 calls fail closed with `500`.
- Admin album create: implemented (`POST /admin/albums/create`). Strict same-origin, exact form Content-Type, five-field validated body (`albumId`, `title`, `photoprismAlbumUid`, `expiresAt`, `downloadEnabled`). Inserts a D1 row with `enabled = 0` explicitly (schema default is `1`). `photoprism_album_uid` is accepted write-only on create and is never selected back, rendered, logged, or returned in error responses. Transform/EXIF columns (`thumb_*`, `preview_*`, `strip_exif`) are omitted so schema defaults apply. No PhotoPrism, NAS, Docker, Portainer, or R2 access. Duplicate `albumId` (D1 constraint failure) is sanitized → `500`. Requires a real `DB` binding; without one, D1 calls fail closed with `500`.
- Admin user display name update: implemented (`POST /admin/users/update-display-name`). Strict same-origin, exact form Content-Type, two-field validated body (`userId`, `displayName`). Updates `display_name` and `updated_at` only; `password_hash`, `enabled`, `fail_count`, `locked_until`, sessions, and permissions are never touched. Unknown `userId` (D1 `meta.changes === 0`) is treated as a DB failure → `500`. Requires a real `DB` binding; without one, D1 calls fail closed with `500`.
- Admin permission mutations: implemented (`POST /admin/permissions/grant`, `POST /admin/permissions/revoke`). Strict same-origin, exact form Content-Type, two-field validated body. Idempotent: re-granting is a no-op (ON CONFLICT DO NOTHING); revoking an absent pair is a no-op (zero rows deleted). Both require a real `DB` binding; without one, D1 calls fail closed with `500`.
- Admin album state controls: implemented (`POST /admin/albums/enable`, `POST /admin/albums/disable`). Strict same-origin, exact form Content-Type, single-field validated body (`albumId`). Idempotent: enabling an already-enabled album or disabling an already-disabled album affects zero rows and leaves `updated_at` unchanged. Disabling removes the album from the viewer album list, album detail, and image authorization (which require `enabled = 1`) without deleting permissions or R2 data. Both require a real `DB` binding; without one, D1 calls fail closed with `500`.
- Admin user state controls: implemented (`POST /admin/users/enable`, `POST /admin/users/disable`). Strict same-origin, exact form Content-Type, single-field validated body (`userId`). Idempotent: re-enabling an already-enabled user or disabling an already-disabled user affects zero rows and leaves `updated_at` unchanged. Disabling a user blocks login (auth requires `enabled = 1`) and makes existing sessions unusable on their next request (session lookup requires `u.enabled = 1`), without deleting session rows or permission rows. Re-enabling may restore an unexpired retained session without creating a new one; lockout counters and `locked_until` are not reset. Only `enabled` and `updated_at` are written; `password_hash`, `display_name`, `fail_count`, `locked_until`, `created_at`, and all album/permission/R2 data are never touched. Both require a real `DB` binding; without one, D1 calls fail closed with `500`.
