# Roadmap

This is a priority-ordered plan. Update status as implementation progresses.

## Level 1: Securely Usable

### 1. Complete Route-Independent Viewer Security

- [x] Complete and archive the active manifest-authorized photo loading handoff.
- [x] Decide and implement any remaining route-independent login policy helpers
      using the approved defaults.
- [x] Add tests proving every real photo read requires exact current-manifest
      membership (service-level; route-level proof repeats in item 2).

### 2. Connect Workers To Real D1 And Private R2

- [x] Add `DB` and `PHOTO_BUCKET` bindings and environment types.
- [x] Implement fixed seven-day session login/logout/me routes.
- [x] Implement five-failure, fifteen-minute login lockout.
- [x] Implement authenticated album list/detail routes.
- [x] Implement private image routes with session, album permission, manifest
      membership, standard-key validation, and safe responses.
- [x] Replace fixture viewer routes only after real routes are fully protected.
- [x] Add daily expired-session cleanup.
- [x] Add operator-safe user and album bootstrap instructions/tooling
      (`docs/operations/bootstrap.md`, `workers/scripts/hash-password.mjs`).

### 3. Deploy And Validate Level 1

- [x] Create/apply additive D1 migrations.
      (D1 `photo-gate` created in APAC; both migrations applied remotely.)
- [x] Create/configure private R2 and approved bindings.
      (R2 bucket `photo-gate` created, private; bindings live.)
- [x] Register required secrets without committing or printing them.
      (GitHub Actions: CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID; local
      operator token file outside the repository.)
- [x] Deploy Workers and perform security smoke tests.
      (https://photo-gate.iniwaiwana.workers.dev, version 70f9fc60, cron
      active. Smoke: login form 200/CSP/no fixture; unauthenticated pages
      303→/; credential failure 303→/?error=1 via real D1; /api /img /admin
      401 no-store; JSON login 401; cross-origin 403.)
- [x] Build and deploy the existing Docker sync CLI through the human-created
      Portainer stack. (Stack `iniwa-photo-gate` running image 0.1.6.)
- [x] Run a controlled end-to-end album sync and viewer test.
      (Complete 2026-06-12: 234 photos synced with 0.1.6 +
      PHOTOPRISM_PREVIEW_SIZE=fit_1920, manifest uploaded last, sampled
      outputs metadata-free; human confirmed browser login, album list,
      thumbnails, and preview display. Iterations: 0.1.1 fixed Portainer
      `${VAR:-default}` mis-expansion + unreadable errors; 0.1.2-0.1.5
      fixed bookworm libvips 8.14 synthesizing EXIF at save time (trixie
      base + CI container-test gate); 0.1.6 fails closed on PhotoPrism
      placeholder previews; Workers Referrer-Policy switched to
      same-origin because no-referrer made browsers send Origin: null on
      the login POST.)
- [x] Add album cover generation/upload to the sync tool.
      (0.1.7: cover.webp is the first manifest photo's thumb-processed
      fit_720 source, validated metadata-free, uploaded after all images
      and before the manifest; empty albums upload no cover. Implemented
      by a Sonnet subagent per FABLE delegation rules, audited in the
      main session; 164 tests. Appears on the Pi after the stack image
      is bumped to 0.1.7.)
- [x] Confirm PhotoPrism/NAS/originals/R2 direct URLs are not exposed.
      (Verified 2026-06-11/12 against production: manifest and sampled
      image bytes contain no URLs/tokens/EXIF/GPS/XMP; direct R2 access
      refused; client size allowlist excludes originals; viewer responses
      are fixed-shape.)

## Level 2: Operable

### 4. Delivery Automation

- [x] Add Workers CI: install, lint, typecheck, test, build, deploy.
      (Fully verified 2026-06-12: after the operator registered the
      GitHub secrets, the workers-ci run for c884256 executed every
      deploy step for real — migrations apply + wrangler deploy success,
      no skips — and the live smoke checks passed afterwards. Deploys
      can also be triggered via workflow_dispatch on main now.)
- [x] Add Docker CI: tests with libvips, multi-arch build, versioned GHCR push.
      (Verified green; `sync-v0.1.0` published `ghcr.io/iniwa/photo-gate-sync`
      tags `0.1.0` / `sha-b3c44be`, public package.)
- [x] ~~Trigger the dedicated existing Portainer stack update path after a
      successful versioned Docker release.~~
      (DROPPED 2026-06-12 by operator decision: stack webhooks require
      Portainer Business Edition and this deployment runs Community
      Edition. The webhook-gated CI job was removed; releases are applied
      by manually bumping the image tag in the stack, documented in
      docs/operations/rollback.md and recorded in deploy-log.md.)
- [x] Record deployed commit/version and document rollback.
      (docs/operations/deploy-log.md + rollback.md, 2026-06-12. Git-based
      redeploy is the primary Workers rollback; wrangler rollback is
      documented but unverified because the local operator token expired
      — re-verify after token refresh.)
- [x] Keep Gitea canonical and verify GitHub mirror-triggered workflows.
      (Mirror sync to `iniwa/photo-gate` observed within ~1 minute of push.)

### 5. Scheduled And Observable Operation

- [x] Add scheduled or long-running Docker sync operation.
      (0.2.0 `sync-daemon`: in-process interval scheduler as PID 1,
      SIGTERM-aware, config errors exit 2, transient failures retry.
      Compose shell loop replaced; junk-env guards kept. Released via
      docker-ci with the container-test gate, 2026-06-12.)
- [x] Add health/readiness behavior suitable for Portainer.
      (Atomic JSON health file + heartbeat task + `healthcheck`
      subcommand wired to Dockerfile HEALTHCHECK; fails closed on
      missing/stale/corrupt state or >= 3 consecutive failures.
      Visibility-only by design — see the 2026-06-12 scheduler ADR.)
- [x] Add sanitized operational logs and failure visibility.
      (Daemon + sync INFO logs with no URLs/tokens/titles; health file
      records the `_describe_error`-sanitized failure text via an
      error_sink shared with stderr.)
- [x] Add backup and recovery procedures for D1/configuration.
      (docs/operations/backup.md, 2026-06-12. `wrangler d1 export` is
      documented but pending verification after the operator token
      refresh; SELECT-dump fallback and Time Travel restore — the
      latter human-approval-only — are documented.)
- [x] Verify the Worker rollback procedure.
      (Worker: `wrangler rollback` verified 2026-06-23 — rollback to `0fa7821a`
      and restore to `495c9ae6` both succeeded; unauthenticated smoke checks
      passed both ways. The exercise confirmed Worker secrets must be checked
      and re-registered after rollback; production recovered on `08e567cf`.
      By operator decision on 2026-06-23, a production Docker rollback exercise
      is not required. The immutable-tag Portainer rollback procedure remains
      documented for incident use.)

## Level 3: Feature Complete

### 6. Administration

- [x] Protect `/admin` with Cloudflare Access JWT validation and admin email
      allowlist.
      (Worker-side validation, allowlist, fail-closed tests, and operator
      documentation are implemented, reviewed, and deployed 2026-06-15.
      The path-scoped Access application, all three Worker values, and
      authenticated smoke verification are complete as of 2026-06-23.)
- [x] Implement user, album, and permission administration.
      (Read-only, keyset-paginated user inventory implemented and reviewed
      2026-06-15. Read-only, keyset-paginated album and permission inventories
      implemented and reviewed 2026-06-16. Idempotent permission grant/revoke
      implemented and reviewed 2026-06-18. Idempotent album enable/disable
      controls implemented and reviewed 2026-06-19. Idempotent user
      enable/disable controls implemented and reviewed 2026-06-23. User
      creation/password reset and album public metadata update controls
      implemented and reviewed locally 2026-06-24. User display-name editing
      and browser-friendly permission assignment dropdowns implemented and
      reviewed locally 2026-06-26. D1-only album creation with explicit
      `enabled = 0` implemented and reviewed locally 2026-06-26. Docker
      Track A1 album catalog publication to private R2 implemented and reviewed
      locally 2026-06-26. Track A2 browser-owned sync targets and Docker
      consumption implemented and reviewed locally 2026-06-29. Track A3 Worker
      catalog picker UI integration implemented, reviewed, and deployed to the
      Worker on 2026-06-29 (version `b1874993`, commit `de74227`). Docker
      `0.4.1` is released from tag `sync-v0.4.1` and deployed in Portainer;
      catalog publication and picker smoke passed after the type-filter hotfix.
      User hard delete Phase 3 is deployed (`2260c2e`) and album hard delete Phase 4 is deployed (`0864043`, version `940fd57d-6836-4875-97f5-cbb14f586356`); album hard delete removes the matching sync target before D1 album deletion and leaves R2 album objects for the separate cleanup flow; reupload suppression is complete.)
- [x] Implement sync request/status administration.
      (Read-only `/admin/sync` status page, Docker best-effort R2 status
      publication, fixed private request object at `ops/sync-request.json`,
      Worker-side request writing, Docker-side request consumption, status
      schema 2 trigger metadata, pending indicator, and no-JS Sync Now form are
      implemented, deployed, and live-smoke verified 2026-06-26. Production
      smoke: manual request consumed, 234/234 synced, cover and manifest
      uploaded, pending cleared, failures 0, runsCompleted 1, manual trigger.)
- [x] Add operational audit information without sensitive-data leakage.
      (Read-only `/admin/ops` aggregate D1 summary implemented and reviewed
      locally 2026-06-25; no row-level identity/title/hash/token/PhotoPrism/R2
      data is selected or rendered.)

### 7. Safe Cleanup

- [x] Design and record a separately reviewed R2 cleanup ADR.
      (`docs/decisions/2026-06-30-r2-cleanup-dry-run.md` accepted and committed.)
- [x] Implement dry-run reporting first.
      (`GET /admin/r2-cleanup` deployed via CI run `28415678789`, commit `b3c434c`,
      2026-06-30. Read-only; albums/ and ops/ listing only; no R2 mutation.)
- [x] Add deletion confirmation preview while keeping actual R2 deletion disabled.
      (Phase 2 commit `d57ba95`: HMAC token, typed phrase, re-scan/fingerprint
      validation, and "not yet enabled" result page. Operator registered
      `R2_CLEANUP_HMAC_KEY`; no orphan prefixes are currently present.)
- [x] Keep actual R2 deletion disabled until explicit human approval.
      (Actual R2 deletion remains disabled. Dry-run and deletion-preview are
      available, but no route performs R2 object deletion.)

### 8. Final Hardening

- [x] Complete deployment, security, recovery, and operator documentation.
      (`docs/operations/operator-actions.md` was rewritten for the current
      production state on 2026-07-03; `rollback.md` now covers all five Worker
      secrets.)
- [x] Run end-to-end authorization and privacy tests.
      (Final Hardening E2E smoke passed on 2026-07-03: eight unauthenticated
      checks plus operator-confirmed authenticated browser checks for admin,
      viewer, R2 cleanup dry-run, hard-delete preview, and preview download.)
- [x] Review dependency, supply-chain, and GitHub Actions permissions.
      (Reviewed during Final Hardening audit. Existing permissions are acceptable.
      Post-Level-3 `ci-hardening` complete 2026-07-03: all GitHub Actions `uses:`
      entries in `workers-ci.yml` and `docker-ci.yml` pinned to full commit SHAs;
      `docker/Dockerfile` base image `python:3.12-slim-trixie` pinned to
      manifest-list digest `sha256:423ed6ab…`. Future action/base-image updates
      require an intentional hardening refresh.)
- [x] Confirm every Definition of Done item.
      (Level 3 Definition of Done confirmed on 2026-07-03. R2 deletion remains
      intentionally disabled unless separately approved.)

## Deferred Unless Explicitly Needed

- Original/RAW fallback.
- RAW/original download. ADR `2026-07-03-download-variants-and-raw-boundary.md` approves generated thumb/preview download variants only; RAW/original remains deferred and requires a separate future ADR before implementation because it would change the current no-originals/no-NAS/no-PhotoPrism viewer boundary.
- Public R2 access.
- Shared caching of authenticated images.
- Destructive automatic cleanup.
- Replacing Hono + JSX with an SPA.
