# Progress

Last updated: 2026-06-19.

## Current Completion Level

**Level 1: Securely Usable — COMPLETE (2026-06-12).** A real album is
served end-to-end in production and a human confirmed browser login,
album list, thumbnail grid, and preview display. Working toward Level 2:
Operable.

## Current Task

The active Level 3 implementation handoff is:

- `docs/handoffs/2026-06-23-admin-user-enable-disable.md`
- Add idempotent viewer-user enable/disable controls behind the existing admin
  Access boundary.
- Change only `users.enabled` and `updated_at`; preserve passwords, lockout
  state, sessions, permissions, albums, and R2 data.
- Existing sessions become unusable while the user is disabled through the
  existing `u.enabled = 1` checks. Retained unexpired sessions may become usable
  again after re-enable; session revocation is explicitly outside this task.

The fifth Level 3 implementation handoff is reviewed and complete:

- DONE: idempotent `POST /admin/albums/enable` and
  `POST /admin/albums/disable` behind the existing Access guard.
- The single parameterized UPDATE changes only `albums.enabled` and
  `updated_at`; same-state and unknown IDs are successful no-ops, while
  permissions and all R2 data remain untouched.
- Codex review tightened the shared admin mutation Content-Type check so only
  the URL-encoded media type with an optional single `charset` parameter is
  accepted.
- DONE: implementation commit `1c4974c` was included in CI-deployed commit
  `729dc72`; unauthenticated GET/enable/disable production smoke checks all
  returned the expected 403 with `Cache-Control: no-store`, without performing
  a D1 mutation.

The fourth Level 3 implementation handoff is reviewed and complete:

- DONE: idempotent `POST /admin/permissions/grant` and
  `POST /admin/permissions/revoke` behind the existing Access guard.
- Both mutations require an exact same-origin POST, strict URL-encoded
  two-field input, parameterized D1 statements, and sanitized no-store
  failures without disclosing user or album existence.
- Codex review fixed the grant clock/serialization failure path so it also
  returns the fixed no-store 500 response before repository use.
- DONE: commit `2e12f08` passed workers-ci and deployed the mutations;
  unauthenticated GET/grant/revoke production smoke checks all returned the
  expected 403 with `Cache-Control: no-store`, without performing a D1 mutation.

The third Level 3 implementation handoff is reviewed and complete:

- DONE: read-only, keyset-paginated `GET /admin/albums` and
  `GET /admin/permissions` inventories behind the reviewed Access boundary.
- The album repository selects only seven approved album fields and strictly
  excludes PhotoPrism identifiers, transform settings, R2 data, and mutation
  operations.
- The permission repository selects only `album_id`, `user_id`, and
  `created_at` from `album_permissions`, with no joins to users or albums.

The second Level 3 implementation handoff is reviewed and complete:

- DONE: read-only, keyset-paginated `GET /admin/users` inventory behind the
  reviewed Access boundary.
- The repository selects only seven approved user fields and strictly excludes
  password hashes, sessions, mutation operations, albums, and permissions.

The first Level 3 implementation handoff is reviewed and complete:

- DONE: `/admin` Worker-side Cloudflare Access JWT verification, strict
  `*.cloudflareaccess.com` JWKS origin validation, admin email allowlist,
  minimal protected SSR page, fail-closed tests, and operator documentation.
- DONE: commit `e72de73` passed workers-ci and deployed the admin boundary plus
  user inventory; production `/admin` and `/admin/users` both return the
  expected fail-closed 403 with `Cache-Control: no-store`.
- DONE: commit `127c887` passed workers-ci and deployed the read-only album and
  permission inventories; production `/admin/albums` and `/admin/permissions`
  both return the expected fail-closed 403 with `Cache-Control: no-store` while
  Access configuration is absent.
- PENDING HUMAN: create the path-scoped Cloudflare Access application, register
  `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, and `ADMIN_EMAILS`, and perform the
  documented authenticated production smoke checks.
- Admin CRUD, sync operations, audit UI, and cleanup remain unimplemented.

Recent Level 2 execution:

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
- DONE: sync `0.2.1` implemented, tagged, and published multi-arch. It
  restores the root logger to WARNING so httpx cannot expose PhotoPrism
  preview URLs/tokens while retaining `photo_gate.*` INFO logs.
- DONE: the operator confirmed the existing Portainer stack is running sync
  `0.2.1` on 2026-06-23.

Level 2 leftovers: verify Worker version rollback after the local token gains
the optional Workers Scripts scope; verify Docker rollback and record both
procedures.

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
  in the production baseline (2026-06-12). The reviewed `/admin`
  authentication foundation, read-only inventories, permission mutations, and
  album enable/disable controls pass lint, typecheck, build, and 1317 tests /
  29 files locally (2026-06-19). `npm audit` reports five advisories (1 low /
  4 high) through devDependencies (`wrangler -> esbuild/miniflare ->
  undici/ws`); production dependency audit with
  `npm audit --omit=dev --audit-level=high` reports 0 vulnerabilities. Workers
  CI gates production dependencies only until upstream Wrangler/Miniflare adopt
  fixed transitive releases.
  Live includes CI-deployed commit `729dc72`; unauthenticated admin smoke checks
  return the expected 403/no-store while Access configuration is absent.
- Docker: sync `0.2.1` reports 183 tests green and is published multi-arch;
  the targeted daemon regression suite independently passed 19 tests on
  Windows (2026-06-15). The operator confirmed the production Pi is running
  `0.2.1` on 2026-06-23.
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

1. DONE 2026-06-23: the Portainer stack image is running `0.2.1`. 0.2.1
   fixes a log leak found in production on
   2026-06-15: the 0.2.0 daemon configured the *root* logger at INFO,
   which enabled httpx's `HTTP Request: GET <url>` lines on stdout —
   and that URL embeds the PhotoPrism preview token + hostname. 0.2.1
   keeps root at WARNING and logs only `photo_gate.*` at INFO. The
   leaked tokens are short-lived (re-fetched each sync) so no emergency
   revocation is needed (operator-actions.md A-0).
2. DONE 2026-06-15: R2 `Unauthorized` blocker resolved. The R2 S3 key
   had been invalidated by the 2026-06-12 token roll; the operator
   issued a new photo-gate-scoped Object Read & Write key and updated
   the Portainer env. Production 0.2.0 then synced 234/234, uploaded
   cover + manifest, "sync attempt 1 succeeded in 134.1s". Fail-closed
   meant nothing was corrupted while the key was bad.
3. DONE 2026-06-12: stack updated to `0.2.0` sync-daemon command block.
4. DONE 2026-06-12: local token refreshed; D1 export verified (D1
   permission only — see operator-actions.md A-2 for the optional
   Workers-scope edit).

## Next Priority

Implement and review the active admin user enable/disable handoff. Configure the
deployed `/admin` Access boundary. Complete Level 2 rollback verification when
production access and token scope permit. After the active handoff, select the
next Level 3 priority from broader user/album administration, sync
administration, or operational audit information.
