# Current State

Last audited: 2026-06-12.

## Level

**Level 1 (Securely Usable) is complete.** A real family album is served
end-to-end in production: PhotoPrism -> Docker sync on the Pi -> private
R2 -> Workers viewer, with a human-confirmed browser login, album list,
thumbnail grid, and preview display (2026-06-12).

## Production Topology

- Workers viewer: https://photo-gate.iniwaiwana.workers.dev
  (manual deploy version `131a0632`; cron 18:00 UTC session cleanup).
- D1 `photo-gate` (APAC, id `de77cb73-497a-4a41-bd1c-151fd907be3f`),
  2 migrations applied. One user, one album, one permission row (real
  identifiers live only in D1/Portainer, never in the repo).
- R2 `photo-gate`, private. One album: 234 thumbs (640 WebP) + 234
  previews (fit_1920 source, JPEG) + manifest.json, all metadata-free.
- Sync: Portainer stack `iniwa-photo-gate` on a Raspberry Pi 4 running
  `ghcr.io/iniwa/photo-gate-sync:0.1.6` with
  `PHOTOPRISM_PREVIEW_SIZE=fit_1920`, interval loop (default 86400 s).
- PhotoPrism serves static thumbs up to 1920 px; dynamic previews stay
  disabled by operator choice (Pi load).

## Delivery

- Gitea is canonical; GitHub `iniwa/photo-gate` mirrors within ~1 minute
  and runs CI.
- docker-ci: host-libvips tests + container-test (suite inside the
  published image's libvips, gates release) + `sync-v*` multi-arch GHCR
  release. Stack updates are manual tag bumps in Portainer: automated
  stack webhooks were dropped 2026-06-12 (Business Edition feature;
  this deployment runs Community Edition).
- workers-ci: checks green; the deploy job is secret-gated. Cloudflare
  secrets were registered on GitHub 2026-06-12 but a CI-driven deploy has
  not yet been observed end-to-end (every production deploy so far was
  manual with the local operator token). Verify on the next `workers/**`
  push or via workflow_dispatch.

## Key Operational Lessons (details in docs/fable/progress.md)

- Portainer mis-expands `${VAR:-default}`; the stack file forbids that
  syntax and normalizes junk values in the container shell.
- Debian bookworm libvips 8.14 synthesizes EXIF at save time; the image
  is pinned to trixie (libvips 8.16) and CI tests inside the container.
- PhotoPrism answers an unservable size with a 200 placeholder; sync
  fails closed on undersized sources (`--photoprism-preview-size`).
- `Referrer-Policy: no-referrer` makes browsers send `Origin: null` on
  form POSTs; the viewer uses `same-origin` and a value-asserting test.

## Missing / Next (see roadmap)

- Sync does not yet generate `albums/<id>/cover.webp`; album-list covers
  404 (viewer handles it; known Level 1 gap promoted to next task).
- Level 2: verify CI auto-deploy, `PORTAINER_WEBHOOK_URL` secret,
  deployed-version/rollback records, native scheduled sync (replace the
  compose shell loop), health/readiness, sanitized progress logging,
  backup/recovery procedures.
- Level 3: `/admin` (Cloudflare Access), administration, dry-run cleanup,
  final hardening.

## Verification Baseline

- Workers: 894 tests / 24 files, lint, typecheck, build, audit green
  (2026-06-12).
- Docker: 159 tests on Linux/libvips 8.18 and inside the trixie image
  (8.16) via docker-ci container-test (2026-06-11).
- Live security posture verified 2026-06-11/12: unauthenticated pages
  303 to `/`; `/img` and reserved routes 401 `no-store`; cross-origin
  and `Origin: null` POSTs 403; direct R2 access refused; manifest and
  sampled images carry no URLs, tokens, EXIF, GPS, or XMP.

## Documentation Condition

Some older Japanese documents (e.g. `photo-gate-design.md`, old ADRs) are
mojibake in the working tree; preserve as historical evidence. Use
`FABLE.md`, `AGENTS.md`, and `docs/fable/` as the operational source of
truth.
