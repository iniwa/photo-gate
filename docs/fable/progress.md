# Progress

Last updated: 2026-06-11.

## Current Completion Level

Working toward Level 1: Securely Usable. **All Level 1 implementation work
(roadmap items 1 and 2) is complete.** Item 3 (deploy and validate) requires
human Cloudflare login and provisioning before it can start.

## Current Task

Level 2 item 4 delivery pipeline authored and pushed (commit `78a3f3d`):
Workers CI (secret-gated deploy), Docker CI (`sync-v*` multi-arch GHCR
release, webhook-gated Portainer update), and the interim
`deploy/portainer-stack.yml`. The GitHub mirror `iniwa/photo-gate` exists
(human-confirmed) but is private, so CI run results cannot be observed from
this environment; verification is pending human confirmation or `gh` auth.

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

1. **Cloudflare provisioning (Level 1 item 3):** `cd workers; npx wrangler
   login` (wrangler is a project devDependency, not a global install), then
   either run `docs/operations/bootstrap.md` sections 2-6 manually or invoke
   Fable after login.
2. **CI verification:** the GitHub mirror repo is private; confirm the
   `workers-ci` / `docker-ci` Actions runs are green after the mirror syncs
   commit `78a3f3d`, or provide an authenticated `gh` CLI.
3. **Portainer:** create the initial stack from `deploy/portainer-stack.yml`
   with GHCR registry credentials and environment variables; provide the
   stack webhook URL as the `PORTAINER_WEBHOOK_URL` GitHub secret. The first
   GHCR image requires a `sync-v0.1.0` tag push after CI is confirmed green.

## Next Priority

After provisioning: Level 1 item 3 (apply migrations, register secrets,
deploy Workers, security smoke tests, controlled end-to-end sync/viewer
test). After mirror confirmation: Level 2 item 4 (Workers CI, Docker CI,
GHCR, Portainer update path).
