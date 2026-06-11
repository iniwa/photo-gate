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
- [ ] Build and deploy the existing Docker sync CLI through the human-created
      Portainer stack. (Stack `iniwa-photo-gate` deployed with image 0.1.0;
      needs redeploy with 0.1.1 — see below.)
- [ ] Run a controlled end-to-end album sync and viewer test.
      (First user/album rows inserted. Failure 1: Portainer mis-expands
      `${VAR:-default}`; fixed in 0.1.1 along with readable sync errors.
      Failure 2, revealed by 0.1.1 logs: container libvips 8.14 leaves EXIF
      in saved output — it synthesizes a fresh mandatory-tag EXIF block at
      save time, so 0.1.2's explicit metadata removal could not stop it; the
      fail-closed validator blocked the upload as designed. Fixed in 0.1.3
      by moving the base image to Debian trixie (libvips 8.16) with a new CI
      container-test job gating release. Awaiting redeploy with 0.1.3.)
- [ ] Add album cover generation/upload to the sync tool.
      (Gap found 2026-06-11: bootstrap.md §7 and the `/img/:albumId/cover`
      route expect `albums/<id>/cover.webp`, but `sync-once` never uploads
      it, so album list covers will 404 until implemented.)
- [ ] Confirm PhotoPrism/NAS/originals/R2 direct URLs are not exposed.

## Level 2: Operable

### 4. Delivery Automation

- [x] Add Workers CI: install, lint, typecheck, test, build, deploy.
      (Verified green on mirror; deploy stays secret-gated until Cloudflare
      provisioning replaces the D1 placeholder.)
- [x] Add Docker CI: tests with libvips, multi-arch build, versioned GHCR push.
      (Verified green; `sync-v0.1.0` published `ghcr.io/iniwa/photo-gate-sync`
      tags `0.1.0` / `sha-b3c44be`, public package.)
- [ ] Trigger the dedicated existing Portainer stack update path after a
      successful versioned Docker release.
      (Authored as a `PORTAINER_WEBHOOK_URL`-gated job; webhook not yet
      provided. Interim stack: `deploy/portainer-stack.yml`.)
- [ ] Record deployed commit/version and document rollback.
- [x] Keep Gitea canonical and verify GitHub mirror-triggered workflows.
      (Mirror sync to `iniwa/photo-gate` observed within ~1 minute of push.)

### 5. Scheduled And Observable Operation

- [ ] Add scheduled or long-running Docker sync operation.
- [ ] Add health/readiness behavior suitable for Portainer.
- [ ] Add sanitized operational logs and failure visibility.
- [ ] Add backup and recovery procedures for D1/configuration.
- [ ] Verify Worker rollback and Docker image rollback procedures.

## Level 3: Feature Complete

### 6. Administration

- [ ] Protect `/admin` with Cloudflare Access JWT validation and admin email
      allowlist.
- [ ] Implement user, album, and permission administration.
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
