# Current State

Last audited: 2026-06-23.

## Level

**Level 1 (Securely Usable) is complete.** A real family album is served
end-to-end in production: PhotoPrism -> Docker sync on the Pi -> private
R2 -> Workers viewer, with a human-confirmed browser login, album list,
thumbnail grid, and preview display (2026-06-12).

## Production Topology

- Workers viewer: https://photo-gate.iniwaiwana.workers.dev
  (CI-deployed commit `729dc72`; cron 18:00 UTC session cleanup).
- D1 `photo-gate` (APAC, id `de77cb73-497a-4a41-bd1c-151fd907be3f`),
  2 migrations applied. One user, one album, one permission row (real
  identifiers live only in D1/Portainer, never in the repo).
- R2 `photo-gate`, private. One album: 234 thumbs (640 WebP) + 234
  previews (fit_1920 source, JPEG) + manifest.json, all metadata-free.
- Sync: Portainer stack `iniwa-photo-gate` on a Raspberry Pi 4 running
  `ghcr.io/iniwa/photo-gate-sync:0.2.1` with the native sync daemon,
  healthcheck, and
  `PHOTOPRISM_PREVIEW_SIZE=fit_1920`, scheduled at the default 86400-second
  interval.
- Sync `0.2.1` is published for `linux/amd64` and `linux/arm64` and the
  operator confirmed it is deployed on the Pi on 2026-06-23. It fixes the
  httpx log leak that exposed short-lived PhotoPrism preview URLs/tokens in
  Portainer logs.
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
- workers-ci: checks green; the secret-gated deploy job was verified end to
  end on 2026-06-12, including migrations, deploy, and live smoke checks.

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

- Level 2: verify and record Worker and Docker rollback procedures. Worker
  version rollback remains blocked on optional local token scope; Docker
  rollback requires an intentional production stack operation.
- Level 3: `/admin` Worker-side Cloudflare Access JWT validation plus admin
  email allowlist and the read-only, keyset-paginated user, album, and
  permission inventories and idempotent permission grant/revoke mutations are
  implemented and deployed. Idempotent album enable/disable controls are also
  implemented and deployed. Idempotent user enable/disable controls are also
  implemented and deployed. The operator must create the path-scoped
  Access
  application and register the three Worker values before the production admin
  surface is usable; until then deployed admin routes fail closed with 403.
  Broader user and album mutation operations, sync
  administration, dry-run cleanup, and final hardening remain unimplemented.

## Verification Baseline

- Workers: 894 tests / 24 files, lint, typecheck, build, audit green
  in the last production baseline (2026-06-12). The reviewed `/admin`
  authentication foundation, read-only inventories, permission mutations, and
  album and user enable/disable controls pass lint, typecheck, build, and 1403
  tests / 29 files locally (2026-06-23).
  Production audit is clean; full `npm audit` remains blocked by devDependency
  advisories in Wrangler/Miniflare. Workers CI checks and deploy succeeded for
  commit `42a7b56`; production smoke confirms the user inventory plus
  enable/disable POST routes fail closed with 403/no-store without config.
- Docker: 183 tests reported green for sync `0.2.1`; the targeted daemon
  regression suite independently passed 19 tests on Windows (2026-06-15).
- Live security posture verified 2026-06-11/12: unauthenticated pages
  303 to `/`; `/img` and reserved routes 401 `no-store`; cross-origin
  and `Origin: null` POSTs 403; direct R2 access refused; manifest and
  sampled images carry no URLs, tokens, EXIF, GPS, or XMP.

## Documentation Condition

Some older Japanese documents (e.g. `photo-gate-design.md`, old ADRs) are
mojibake in the working tree; preserve as historical evidence. Use
`FABLE.md`, `AGENTS.md`, and `docs/fable/` as the operational source of
truth.
