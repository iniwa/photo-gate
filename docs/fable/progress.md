# Progress

Last updated: 2026-06-11.

## Current Completion Level

Working toward Level 1: Securely Usable. All Level 1 implementation work
(roadmap items 1 and 2) is complete and the Workers side of item 3 is
deployed and smoke-tested. Remaining: a successful end-to-end sync.

## Current Task

Level 1 item 3: first end-to-end sync attempt failed and was diagnosed
(2026-06-11). Two root causes from the Portainer stack `iniwa-photo-gate`
logs:

1. Portainer's stack variable expansion does not understand the compose
   default syntax `${VAR:-default}` and injected `-86400` (dash included)
   into `SYNC_INTERVAL_SECONDS`, so `sleep` failed instantly and the retry
   loop ran with no wait (hot loop against PhotoPrism/R2).
2. `main.py` swallowed the sync exception entirely (`Sync failed for album
   ...` with no cause), making the actual failure undiagnosable from logs.

Both fixed in `0.1.1`. The readable logs then revealed EXIF surviving
re-encoding on the container's libvips (bookworm, 8.14); `0.1.2` removed
all attached metadata before saving, but the failure persisted with the
exact libexif mandatory-tag set (ExifVersion, FlashpixVersion, ColorSpace,
ComponentsConfiguration, PixelX/YDimension, Orientation, resolution tags,
YCbCrPositioning): libvips 8.14 synthesizes a fresh EXIF block at save
time regardless of image metadata, so no Python-side change can prevent
it. `0.1.3` moves the base image to Debian trixie (libvips 8.16, same
keep-based generation as the CI-verified 8.15/8.18) and adds a CI
container-test job that runs the suite against the runtime libvips inside
the image, gating release — this would have caught both 8.14 bugs before
publishing. Album/user rows are live in D1; viewer password was reset on
request. Waiting on human: bump the stack image to `0.1.3`, redeploy, and
provide logs.

Release iterations (gate worked as designed; no broken image published):
`0.1.3` failed in CI — trixie's `libvips` is a virtual package (need
`libvips42t64`); `0.1.4` failed in CI — `.dockerignore` excluded `tests/`
so the test stage could not COPY them; `0.1.5` fully green, with
container-test passing the whole suite against the runtime libvips 8.16
inside the image, and published multi-arch to GHCR.

`0.1.5` synced all 234 photos end-to-end (manifest last, thumbs verified
640px/EXIF-free from live R2), but every preview was a 455-byte 24x24
placeholder: PhotoPrism answers 200 image/jpeg with a placeholder when
asked for a size its thumbnail settings cannot serve (fit_3840 here,
while fit_720 worked). `0.1.6` adds a fail-closed plausibility check
(decoded long edge must reach half of what the requested size and source
photo dimensions allow, manifest withheld otherwise) and a
`--photoprism-preview-size` flag / `PHOTOPRISM_PREVIEW_SIZE` stack env so
operators can match their instance.

**End-to-end sync succeeded 2026-06-11 with `0.1.6` +
`PHOTOPRISM_PREVIEW_SIZE=fit_1920`** (the operator's PhotoPrism has
`THUMB_SIZE=1920`, so fit_1920 serves from the static cache with no
dynamic rendering load). All 234 placeholders were overwritten with real
previews (107-697 KB), manifest re-uploaded last; a freshly sampled
preview is 1600x1200 (correct fit_1920 box fit for 4:3) with zero
EXIF/GPS/XMP. The 0.1.6 check also proved itself live: it refused
fit_2048 and fit_3840 with exact diagnostics until the size matched.
Remaining for Level 1: human confirms the viewer in a browser (login,
album list, detail, preview display).

Browser login was then found broken for every real browser (plain 403
"Forbidden"): with `Referrer-Policy: no-referrer`, the Fetch spec makes
browsers serialize the login form POST's Origin header as `Origin: null`,
which the origin check correctly rejects. curl-based smoke tests missed
it because curl does not apply referrer policy. Fixed by switching to
`Referrer-Policy: same-origin` (nothing leaks cross-origin; the app has
no external links) with a value-asserting regression test; `Origin: null`
is still rejected by design (sandboxed attacker pages send it).
Reproduced and diagnosed with a real browser via Playwright.

Deploying the fix exposed another gap: the workers-ci deploy job ran with
every real step skipped — the secret gate reports the Cloudflare secrets
as not configured on the GitHub repo, so CI has never actually deployed
(all production deploys so far were manual with the local operator
token). The fix was deployed manually (version `131a0632`, live header
verified, browser login flow re-tested green via Playwright). Human TODO:
register `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as GitHub
**repository secrets** (Settings > Secrets and variables > Actions) on
`iniwa/photo-gate` so auto-deploy works.

Verified live security posture (2026-06-11): unauthenticated `/albums`
303 to `/`; `/img/*` 401 `no-store`; direct R2 URL refused; manifest
contains no URLs/tokens/secrets; sampled thumb and preview carry zero
EXIF/GPS/XMP.

## Last Completed Work

- Metadata stripping made libvips-version-independent (0.1.2): explicit
  field removal before save, regression tests for preview validation and
  zero attached metadata fields; 151 tests pass on Linux/libvips 8.18.
- Sync diagnosability + stack hardening (0.1.1, 2026-06-11):
  - `deploy/portainer-stack.yml`: no `${VAR:-default}` anywhere; shell-side
    guards normalize junk/missing `SYNC_INTERVAL_SECONDS` (non-numeric ->
    86400) and clear junk CF Access values (guards verified with sh).
  - `docker/src/photo_gate/main.py`: `_describe_error` prints messages only
    for raise-site-sanitized exception types (photo_gate errors + botocore
    `ClientError`); unknown types show class name only; httpx types excluded
    because their messages can embed preview-token URLs; unwraps causes and
    `ExceptionGroup` (depth/width capped). 6 new tests.
  - Found gap: sync never uploads `albums/<id>/cover.webp` (roadmap item).
- Earlier 2026-06-11: Workers deployed (version `70f9fc60`, security smoke
  tests green), D1/R2 provisioned, migrations applied, GHCR `0.1.0`
  released, first viewer user inserted.

## Latest Known Verification

- Workers (2026-06-11): lint, typecheck, build dry-run, and audit passed;
  893 tests passed across 24 files. workers-ci green on the mirror.
- Docker (2026-06-11): 127 passed + 22 pyvips-skips on the Windows host
  after the `_describe_error` change; full libvips suite runs in docker-ci.

## Operational Notes

- Cloudflare API token lives in `~\.photo-gate-cf-token` (outside the repo,
  human-provided, never printed) and in GitHub Actions secrets. Wrangler
  commands load it into `CLOUDFLARE_API_TOKEN` per invocation.
- Deployed Worker: https://photo-gate.iniwaiwana.workers.dev, version
  `70f9fc60-6907-4387-bc75-556317ecb0f4` (commit `e566edb`).
- Portainer stack `iniwa-photo-gate` exists (human-created). Real user and
  album identifiers live only in D1 and Portainer env, never in the repo.

## Current Blockers / Required Human Actions

1. **Portainer redeploy:** update the stack to the new
   `deploy/portainer-stack.yml` contents and image tag `0.1.1` (after
   docker-ci publishes it), redeploy, and paste the container logs.
2. **Portainer webhook (Level 2):** register the stack webhook URL as the
   `PORTAINER_WEBHOOK_URL` GitHub secret for automatic updates.

## Next Priority

Read the redeployed stack's logs, fix the real sync failure they reveal,
and complete the controlled end-to-end sync/viewer test (Level 1 item 3).
Then implement cover.webp upload in sync, then Level 2 items 4-5 leftovers
(webhook update path, version/rollback records, native scheduled sync,
health behavior, backups).
