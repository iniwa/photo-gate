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

- [ ] Add `DB` and `PHOTO_BUCKET` bindings and environment types.
- [ ] Implement fixed seven-day session login/logout/me routes.
- [ ] Implement five-failure, fifteen-minute login lockout.
- [ ] Implement authenticated album list/detail routes.
- [ ] Implement private image routes with session, album permission, manifest
      membership, standard-key validation, and safe responses.
- [ ] Replace fixture viewer routes only after real routes are fully protected.
- [ ] Add daily expired-session cleanup.
- [ ] Add operator-safe user and album bootstrap instructions/tooling.

### 3. Deploy And Validate Level 1

- [ ] Create/apply additive D1 migrations.
- [ ] Create/configure private R2 and approved bindings.
- [ ] Register required secrets without committing or printing them.
- [ ] Deploy Workers and perform security smoke tests.
- [ ] Build and deploy the existing Docker sync CLI through the human-created
      Portainer stack.
- [ ] Run a controlled end-to-end album sync and viewer test.
- [ ] Confirm PhotoPrism/NAS/originals/R2 direct URLs are not exposed.

## Level 2: Operable

### 4. Delivery Automation

- [ ] Add Workers CI: install, lint, typecheck, test, build, deploy.
- [ ] Add Docker CI: tests with libvips, multi-arch build, versioned GHCR push.
- [ ] Trigger the dedicated existing Portainer stack update path after a
      successful versioned Docker release.
- [ ] Record deployed commit/version and document rollback.
- [ ] Keep Gitea canonical and verify GitHub mirror-triggered workflows.

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
