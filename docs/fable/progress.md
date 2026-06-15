# Progress

Last updated: 2026-06-12.

## Current Completion Level

**Level 1: Securely Usable — COMPLETE (2026-06-12).** A real album is
served end-to-end in production and a human confirmed browser login,
album list, thumbnail grid, and preview display. Working toward Level 2:
Operable.

## Current Task

Level 2 (Operable) execution, 2026-06-12:

- DONE: CI auto-deploy verified end to end (workers-ci c884256 ran
  every deploy step with the registered secrets; live smoke passed;
  workflow_dispatch deploys from main enabled).
- DONE: docs/operations/ deploy-log.md, rollback.md, backup.md.
- DONE: sync `0.2.0` implemented and tagged (`sync-v0.2.0`):
  sync-daemon native scheduler, atomic health file + healthcheck
  subcommand + Dockerfile HEALTHCHECK, sanitized INFO progress logs.
  Sonnet subagent implementation, audited in the main session with
  three fixes (heartbeat waiter leak via asyncio.shield, unwired
  sleep_fn, last_error hardcoded None). 182 tests in 2 s on WSL.
  docker-ci for the tag green; GHCR `0.2.0` published — covers + daemon
  land together when the stack is bumped to `0.2.0` (0.1.7 skipped).
- DROPPED by operator decision: Portainer stack auto-update webhook
  (Business Edition feature; running Community Edition). Manual tag
  bumps are the documented path.

Level 2 leftovers: re-verify wrangler rollback/export after the local
token refresh; rollback-procedure verification record.

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

See `docs/operations/operator-actions.md` for the operator-facing
action list and full status snapshot.

1. ACTIVE BLOCKER: production sync is failing on R2 `Unauthorized`.
   The 0.2.0 daemon starts and lists 234 photos but every PutObject
   returns Unauthorized — the R2 S3 access key (Portainer
   `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`) was very likely
   invalidated when the API token was rolled on 2026-06-12. Fail-closed
   means nothing was overwritten: the last good 0.1.6 sync (234 photos)
   plus covers are still served, so viewing is fine; only new uploads
   are stalled. Fix: issue a new R2 Object Read & Write key scoped to
   `photo-gate` and update the Portainer env (operator-actions.md A-1).
2. DONE 2026-06-12: stack updated to `0.2.0` with the sync-daemon
   command block (daemon confirmed starting from logs).
3. DONE 2026-06-12: local token refreshed; D1 export verified. The
   token has D1 permission only — add Account -> Workers Scripts -> Edit
   if local `wrangler versions list` / emergency local deploys are
   wanted; until then Workers changes deploy via CI
   (operator-actions.md A-2).

## Next Priority

Sync cover.webp generation (Level 1 polish), then Level 2 item 4/5
leftovers.
