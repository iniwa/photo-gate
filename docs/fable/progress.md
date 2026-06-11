# Progress

Last updated: 2026-06-11.

## Current Completion Level

Working toward Level 1: Securely Usable. **All Level 1 implementation work
(roadmap items 1 and 2) is complete.** Item 3 (deploy and validate) requires
human Cloudflare login and provisioning before it can start.

## Current Task

Delivery pipeline verified end to end (2026-06-11): workers-ci green
(`61a56ca`), docker-ci green after fixing two Linux-only test failures
(`b3c44be`: libvips 8.16+ informational JPEG fields allowlisted; Pillow
fixture uses IFDRational), and `sync-v0.1.0` released
`ghcr.io/iniwa/photo-gate-sync:0.1.0` (public, multi-arch). The GitHub repo
is now public, so CI is observable via the API without auth.

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
  893 tests passed across 24 files. workers-ci green on the mirror.
- Docker (2026-06-11): 143 tests passed on Linux/libvips 8.18 (WSL) and in
  docker-ci (Ubuntu); 121 passed + 22 pyvips-skips on the Windows host.

## Current Blockers / Required Human Actions

1. **Cloudflare login did not persist:** the human reported logging in, but
   `npx wrangler whoami` still says unauthenticated and no OAuth token file
   exists under the wrangler config dir. Re-run `cd workers; npx wrangler
   login` and confirm with `npx wrangler whoami`; then Fable can run
   provisioning (`bootstrap.md` sections 2-6).
2. **Portainer:** create the initial stack from `deploy/portainer-stack.yml`
   (image tag `0.1.0`; the GHCR package is public, so no registry credential
   is needed) and set the environment variables. Provide the stack webhook
   URL as the `PORTAINER_WEBHOOK_URL` GitHub secret for automatic updates.

## Next Priority

After provisioning: Level 1 item 3 (apply migrations, register secrets,
deploy Workers, security smoke tests, controlled end-to-end sync/viewer
test). After mirror confirmation: Level 2 item 4 (Workers CI, Docker CI,
GHCR, Portainer update path).
