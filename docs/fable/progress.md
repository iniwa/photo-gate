# Progress

Last updated: 2026-06-12.

## Current Completion Level

**Level 1: Securely Usable — COMPLETE (2026-06-12).** A real album is
served end-to-end in production and a human confirmed browser login,
album list, thumbnail grid, and preview display. Working toward Level 2:
Operable.

## Current Task

Next: implement album cover generation/upload in the sync tool
(`albums/<id>/cover.webp`; bootstrap.md §7 and the `/img/:albumId/cover`
route already expect it). Then Level 2 leftovers: verify CI auto-deploy
on the next workers/** push, `PORTAINER_WEBHOOK_URL` secret,
deployed-version/rollback records, native scheduled sync, health
behavior, sanitized progress logs, backups.

## Last Completed Work (Level 1 closure, 2026-06-11..12)

- End-to-end sync of 234 photos with sync `0.1.6` +
  `PHOTOPRISM_PREVIEW_SIZE=fit_1920`; manifest uploaded last; sampled
  production thumb and preview verified metadata-free.
- Browser login was broken for every real browser (403 Forbidden): with
  `Referrer-Policy: no-referrer` browsers serialize the login form POST's
  Origin header as `Origin: null` (Fetch spec), which the origin check
  correctly rejects; curl smoke tests don't apply referrer policy and
  missed it. Diagnosed with Playwright (request showed `origin: null`),
  fixed to `Referrer-Policy: same-origin` + value-asserting regression
  test (894 tests). `Origin: null` stays rejected by design.
- Deploying that fix exposed that workers-ci's deploy job had silently
  skipped all steps (secret gate: Cloudflare secrets absent on GitHub).
  Deployed manually (version `131a0632`, live header + browser flow
  re-verified). Operator registered the GitHub repository secrets
  2026-06-12; first real CI deploy still unobserved.
- Earlier iterations recorded in roadmap item 3: Portainer
  `${VAR:-default}` mis-expansion (0.1.1), bookworm libvips 8.14
  synthesizing EXIF at save time -> trixie base + CI container-test gate
  (0.1.2-0.1.5), PhotoPrism placeholder previews -> fail-closed size
  check + `--photoprism-preview-size` (0.1.6).

## Latest Known Verification

- Workers: 894 tests / 24 files, lint, typecheck, build, audit green
  (2026-06-12). Live: version `131a0632`.
- Docker: 159 tests on Linux/libvips 8.18 (WSL) and inside the trixie
  image (libvips 8.16) via docker-ci container-test; GHCR `0.1.6`
  multi-arch published and running on the Pi.
- Live security posture (2026-06-11/12): unauthenticated pages 303 to
  `/`; `/img` + reserved routes 401 `no-store`; cross-origin and
  `Origin: null` POSTs 403; direct R2 refused; no URL/token/EXIF/GPS/XMP
  in manifest or sampled images.

## Operational Notes

- Cloudflare API token: `~\.photo-gate-cf-token` (outside repo, never
  printed) and GitHub Actions secrets (registered 2026-06-12).
- Real user/album identifiers exist only in D1 and Portainer env.
- Cloudflare REST API caches R2 object GET bodies; verify object
  contents via fresh keys or listing etag/size, not re-downloads.

## Current Blockers / Required Human Actions

None for Level 1. For Level 2, when convenient:

1. Register the Portainer stack webhook URL as the
   `PORTAINER_WEBHOOK_URL` GitHub secret (enables auto-update on
   release).
2. Optionally trigger workers-ci via workflow_dispatch (Actions > Run
   workflow) to confirm the now-registered secrets drive a CI deploy.

## Next Priority

Sync cover.webp generation (Level 1 polish), then Level 2 item 4/5
leftovers.
