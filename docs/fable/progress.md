# Progress

Last updated: 2026-06-11.

## Current Completion Level

Working toward Level 1: Securely Usable. **All Level 1 implementation work
(roadmap items 1 and 2) is complete.** Item 3 (deploy and validate) requires
human Cloudflare login and provisioning before it can start.

## Current Task

Blocked on human action (see below). Next unblocked candidate is Level 2
item 4 (CI workflows), but verifying mirror-triggered CI requires the
Gitea-to-GitHub mirror to exist, which is also human-controlled state.

## Last Completed Work

- Roadmap Level 1 item 2 complete (commits `aff9732`..`a16a4fd`):
  - active `/api/auth/*` login/logout/me with uniform credential-failure
    redirect, timing decoy, Origin enforcement, atomic lockout;
  - active `/img` routes with session -> album permission -> exact manifest
    membership -> private R2 read;
  - real viewer SSR pages replacing all fixtures (login form, album list with
    keyset pagination, manifest-driven detail, redirect-to-login);
  - daily expired-session cleanup cron;
  - operator bootstrap runbook + password-hash tool.
- Implementation by Opus/Sonnet subagents per FABLE delegation rules, reviewed
  and security-audited in the main session. One subagent was interrupted by a
  session limit; the main session completed and verified the remainder.

## Latest Known Verification

- Workers (2026-06-11): lint, typecheck, build dry-run, and audit passed;
  893 tests passed across 24 files.
- Docker baseline must be rechecked before the next Docker change.

## Current Blockers / Required Human Actions

1. **Cloudflare provisioning (Level 1 item 3):** interactive `wrangler login`
   and account selection, then either run `docs/operations/bootstrap.md`
   sections 2-6 manually or invoke Fable to perform resource creation and
   additive migrations after login.
2. **GitHub mirror:** confirm or configure the Gitea-to-GitHub mirror (and
   target repository) so Level 2 CI workflows can be authored and verified.
3. **Portainer:** initial stack/container, registry credentials, volumes, and
   the dedicated stack-update mechanism (needed for Level 1 item 3 Docker
   deployment and Level 2 delivery automation).

## Next Priority

After provisioning: Level 1 item 3 (apply migrations, register secrets,
deploy Workers, security smoke tests, controlled end-to-end sync/viewer
test). After mirror confirmation: Level 2 item 4 (Workers CI, Docker CI,
GHCR, Portainer update path).
