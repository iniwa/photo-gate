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
provide logs. (`0.1.3` itself never published: in trixie `libvips` is only
a virtual package, so the image build failed and the new container-test
gate correctly blocked the release; `0.1.4` installs `libvips42t64`.)

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
