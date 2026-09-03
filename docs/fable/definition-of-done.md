# Definition Of Done

## Level 1: Securely Usable

Level 1 is complete only when:

- Docker can sync a selected PhotoPrism album into private R2 using re-encoded,
  metadata-stripped assets and a manifest published last.
- A shared user can log in and log out.
- A shared user sees only explicitly authorized enabled, non-expired albums.
- Every manifest and image path requires a valid session and album permission.
- Every photo image read requires exact membership in the current validated
  manifest.
- R2 remains private and direct object URLs are not used.
- Workers and Docker are deployed to the intended environments.
- Required bindings, additive migrations, secrets, and operator bootstrap steps
  are documented.
- Security-critical tests and controlled end-to-end smoke tests pass.

## Level 2: Operable

Level 2 is complete only when:

- Gitea push and GitHub mirror flow reliably trigger CI/CD.
- Workers checks and permitted deployment are automated.
- Docker tests, multi-arch versioned build, and GHCR publication are automated;
  the existing Portainer stack has a documented manual immutable-tag update
  path.
- Scheduled sync and daily session cleanup operate.
- Failures are observable without leaking sensitive data.
- Worker rollback is tested and documented.
- Docker rollback uses the documented immutable-tag Portainer procedure.
  A production rollback exercise is optional and is not required for Level 2.
- Backup and recovery procedures are documented and exercised where practical.

## Level 3: Feature Complete

Level 3 is complete only when:

- Cloudflare Access protects the admin surface and Workers validates admin JWT
  and allowlist membership.
- Admin user, album, permission, and sync operations are implemented.
- Sync status and useful audit/operational information are available.
- R2 cleanup has a reviewed design and a verified dry-run implementation.
- Actual deletion remains disabled until explicit human approval.
- Security, deployment, recovery, and operator documentation is complete.
- Final end-to-end privacy and authorization review passes.

## Task-Level Done

A task is done only when:

- acceptance criteria are met;
- a stable task-owned diff is produced while unrelated work is preserved;
- focused verification, and the full affected suite when its blast radius
  requires it, pass;
- every check required by acceptance passes. If an unavailable check is not
  itself required and equivalent evidence satisfies acceptance, its exact
  blocker is recorded and the check is not reported as passed;
- security and regression self-review finds no unresolved issue;
- docs and operational state are updated when in scope;
- the active handoff lifecycle is completed when applicable.

Commit, push, CI, and deployment are not universal task requirements. They are
completion conditions only when the current task scope and the current user's
approval explicitly require that delivery.

If any acceptance criterion remains unmet, the task is incomplete. Record the
unmet criteria, partial edits, blockers, and exact resume conditions.
