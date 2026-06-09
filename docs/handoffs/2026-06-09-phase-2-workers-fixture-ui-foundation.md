Read `AGENTS.md`, `CLAUDE.md`, `photo-gate-design.md`, the accepted Workers UI/auth decision, archived handoffs, existing repository files, and this handoff before implementation.
If implementation would violate constraints or require files outside this handoff, stop and ask before editing.

## Goal

Initialize the Phase 2 Cloudflare Workers application and implement a safe fixture-only viewing UI using Hono + JSX server-side rendering.

This handoff establishes the Workers project structure, page rendering, public CSS asset, security headers, fail-closed reserved data routes, and local automated verification. It must not read D1, R2, PhotoPrism, or any real album/photo data.

## Background

The accepted decision in `docs/decisions/2026-06-09-workers-ui-and-auth-foundation.md` establishes:

- Hono + JSX server-side rendering for the initial UI
- Workers Assets for static CSS/JS
- Phase 2 uses fixture data only
- real R2/D1 access waits until Phase 3 authentication and album authorization exist
- unauthenticated real album, manifest, thumb, or preview access is forbidden

The existing `workers/` directory contains only planned empty directories and `.gitkeep` files.

## Files To Inspect

- `AGENTS.md`
- `CLAUDE.md`
- `photo-gate-design.md`
- `.gitignore`
- `.editorconfig`
- `.gitattributes`
- `docs/decisions/2026-06-09-workers-ui-and-auth-foundation.md`
- `docs/handoffs/archive/2026-06-09-workers-ui-auth-architecture-decision.md`
- `docker/src/photo_gate/manifest.py`
- `workers/`

## Files To Create Or Edit

- `workers/package.json`
- `workers/package-lock.json`
- `workers/tsconfig.json`
- `workers/wrangler.toml`
- `workers/eslint.config.js`
- `workers/README.md`
- `workers/public/_headers`
- `workers/public/styles.css`
- `workers/src/index.tsx`
- `workers/src/fixtures.ts`
- `workers/src/middleware/security-headers.ts`
- `workers/src/routes/pages.tsx`
- `workers/src/templates/layout.tsx`
- `workers/src/types/album.ts`
- `workers/src/types/manifest.ts`
- `workers/test/app.test.ts`
- remove superseded `.gitkeep` files only from directories receiving real files

Do not create or edit D1 migrations, services, authentication modules, Docker files, repository-level configuration, workflows, deployment files, or decision records in this handoff. Keep unused planned directories and their `.gitkeep` files.

## Dependency And Tooling Decisions

Use npm and commit `package-lock.json`.

Runtime dependency:

- `hono`

Development dependencies:

- `typescript`
- `wrangler`
- `vitest`
- `eslint`
- `typescript-eslint`
- `@cloudflare/workers-types`

Use current stable versions compatible with Node.js 22 and each other. Do not add React, Vue, Svelte, Vite, Tailwind, CSS frameworks, component libraries, authentication libraries, database libraries, or Cloudflare SDK clients.

Required npm scripts:

```json
{
  "lint": "...",
  "typecheck": "...",
  "test": "...",
  "build": "wrangler deploy --dry-run --outdir dist"
}
```

Tests must run once and exit; do not make the default `npm test` command watch indefinitely.

## Wrangler Contract

Configure a local/development-safe Worker only.

- Worker entrypoint: `src/index.tsx`
- compatibility date: `2026-06-09`
- Workers Assets directory: `public`
- Assets binding name: `ASSETS`
- do not declare R2 or D1 bindings
- do not declare secrets or environment-specific identifiers
- do not add routes, custom domains, account IDs, database IDs, bucket names, or deployment environments
- do not enable automatic deployment
- do not configure an assets SPA fallback

Only public non-sensitive assets such as `styles.css` may bypass application routing. HTML pages must be rendered by the Worker.

## Required Route Contract

### Fixture HTML Routes

Implement:

```text
GET /
GET /albums
GET /albums/:albumId
```

All content must come exclusively from an in-code fixture module clearly named and documented as non-production sample data.

Behavior:

- `GET /` renders a login-placeholder/welcome page. It must not submit credentials or imply authentication is implemented.
- `GET /albums` renders fixture album cards/links.
- `GET /albums/:albumId` validates the identifier before lookup and renders fixture photo cards for a known fixture album.
- unknown or invalid fixture album IDs return a safe HTML `404`.
- fixture photo cards must not link to `/img/*` or any real image endpoint.
- use public placeholder styling or CSS-only visual placeholders; do not add real photos, remote image URLs, data URLs, base64 images, or copied PhotoPrism/R2 content.
- HTML must escape fixture values through JSX; do not use unsafe raw HTML injection.

Fixture identifiers must follow the existing safe ID contract:

```text
^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$
```

### Reserved Data Routes

Every request under these prefixes must fail closed:

```text
/api
/api/*
/img
/img/*
/admin
/admin/*
```

Required behavior:

- return `401 Unauthorized`
- do not redirect
- do not expose fixture data
- do not reveal whether an album/photo exists
- use a concise generic response
- include the required security headers

Do not implement login/logout/me, image delivery, manifest delivery, admin pages, health routes, or JSON APIs.

### Other Routes

Unknown non-reserved routes return a safe HTML `404`.

## Fixture And Type Contract

Create typed fixture models for the UI. Keep them intentionally separate from future D1/R2 services.

At minimum define:

- album summary/detail types used by fixture pages
- photo summary type used by fixture pages
- TypeScript representation of manifest schema version 1 matching the current Docker-generated manifest shape

The manifest type is a compile-time contract only in this handoff. Do not parse, fetch, or render a real manifest.

Fixture data must:

- be obviously synthetic
- contain no real names, credentials, domains, PhotoPrism hashes, IDs from a real instance, GPS, or personal data
- use only local route links
- be deterministic for tests

## Hono Application Structure

- Export the Hono app from `src/index.tsx` so tests can call it without starting a server.
- Default-export the app for Wrangler.
- Keep route rendering in `src/routes/pages.tsx`.
- Keep reusable page shell/layout in `src/templates/layout.tsx`.
- Keep security headers in dedicated middleware.
- Keep fixture data in `src/fixtures.ts`.
- Do not add abstractions for future D1/R2/authentication implementations.

## Security Header Contract

Apply security headers to all Worker-generated responses, including errors and reserved routes:

```text
Content-Security-Policy: default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

Also apply:

- HTML responses: `Cache-Control: private, no-cache`
- reserved `401` and error responses: `Cache-Control: no-store`

Do not add permissive CORS headers.

Configure relevant security and cache headers for the public CSS asset in `workers/public/_headers`. Do not rely on asset headers for Worker-generated responses.

## UI Requirements

The UI should be deliberately small but usable:

- semantic HTML
- responsive layout suitable for desktop and mobile
- shared layout/header
- accessible links and headings
- visible fixture-only/development notice
- album list page
- fixture album detail/photo grid page
- safe 404 page

Keep CSS dependency-free and local. Do not implement JavaScript interactions unless strictly required; none are expected in this handoff.

## Tests

Use Vitest and Hono's in-process request support. Tests must not use a real Worker deployment, network, Cloudflare account, credentials, D1, R2, PhotoPrism, or external assets.

At minimum test:

- `/` returns HTML and clearly indicates login is not yet active
- `/albums` returns only fixture album content
- known `/albums/:albumId` renders deterministic fixture photos
- invalid and unknown album IDs return `404`
- fixture pages contain no `/img/` links, remote image URLs, or real-data bindings
- `/api`, nested `/api/*`, `/img`, nested `/img/*`, `/admin`, and nested `/admin/*` return `401`
- reserved routes do not reveal fixture album IDs or photo IDs
- unknown non-reserved routes return `404`
- security headers are present on success, `401`, and `404` responses
- cache headers match the contract
- fixture values are escaped safely by JSX

## README

Document:

- architecture and fixture-only Phase 2 boundary
- install and verification commands
- local development command if provided
- available fixture HTML routes
- reserved routes that intentionally return `401`
- explicit statement that D1/R2/authentication/real data are not connected
- explicit warning not to deploy this fixture UI as a real sharing service

Do not document real credentials, account IDs, bucket names, database IDs, or deployment commands.

## Constraints

- Preserve all architecture and security invariants in `AGENTS.md`.
- Use fixture data only.
- Do not add D1/R2 bindings or reads.
- Do not implement authentication, sessions, authorization, admin behavior, or Cloudflare Access JWT validation.
- Do not serve real manifests, thumbs, previews, albums, or photos.
- Do not access PhotoPrism, NAS, Docker service, R2, D1, or external services.
- Do not add real images or remote image dependencies.
- Do not add deployment routes, account identifiers, secrets, or environment-specific settings.
- Do not create migrations.
- Do not add CI/CD.
- Do not deploy or publish.
- Do not commit automatically.

## Non Goals

- viewer login/logout
- D1 schemas or migrations
- D1/R2 service adapters
- manifest parsing
- image delivery
- administrator UI/authentication
- sync APIs
- real photo gallery behavior
- deployment
- CI/CD

## Verification

From `workers/`:

```powershell
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

From the repository root:

```powershell
git diff --check
git status --short
```

Verification must pass without:

- Cloudflare authentication
- a Cloudflare account
- D1 or R2 resources
- PhotoPrism
- Docker services
- secrets or `.env`
- network access after `npm ci`

Report any dependency installation or registry/network failure separately from implementation failures.

## Expected Report

- Changed files
- Package/tool versions
- Route behavior summary
- Fixture-only safeguards
- Security/cache header summary
- Verification results
- Any blocked checks with exact reasons
- Any Workers/security/design questions that should return to Codex
