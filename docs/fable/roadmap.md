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
- [ ] Verify Worker rollback and Docker image rollback procedures.

## Level 3: Feature Complete

### 6. Administration

- [ ] Protect `/admin` with Cloudflare Access JWT validation and admin email
      allowlist.
      (Worker-side validation, allowlist, fail-closed tests, and operator
      documentation are implemented, reviewed, and deployed 2026-06-15.
      Production Access application setup, values, and authenticated smoke
      verification remain.)
- [ ] Implement user, album, and permission administration.
      (Read-only, keyset-paginated user inventory implemented and reviewed
      2026-06-15. Read-only, keyset-paginated album and permission inventories
      implemented and reviewed 2026-06-16. User/album/permission mutation
      operations remain.)
- [ ] Implement sync request/status administration.
- [ ] Add operational audit information without sensitive-data leakage.

### 7. Safe Cleanup

- [ ] Design and record a separately reviewed R2 cleanup ADR.
- [ ] Implement dry-run reporting first.
- [ ] Keep actual R2 deletion disabled until explicit human approval.

### 8. Final Hardening

- [ ] Complete deployment, security, recovery, and operator documentation.
- [ ] Run end-to-end authorization and privacy tests.
- [ ] Review dependency, supply-chain, and GitHub Actions permissions.
- [ ] Confirm every Definition of Done item.

## Deferred Unless Explicitly Needed

- Original/RAW fallback.
- Public R2 access.
- Shared caching of authenticated images.
- Destructive automatic cleanup.
- Replacing Hono + JSX with an SPA.
