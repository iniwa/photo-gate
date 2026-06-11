# Progress

Last updated: 2026-06-11.

## Current Completion Level

Working toward Level 1: Securely Usable. **All Level 1 implementation work
(roadmap items 1 and 2) is complete.** Item 3 (deploy and validate) requires
human Cloudflare login and provisioning before it can start.

## Current Task

Level 1 item 3 mostly complete (2026-06-11): D1/R2 provisioned, migrations
applied, Workers deployed to https://photo-gate.iniwaiwana.workers.dev
(version `70f9fc60`, cron active) with all security smoke tests passing
against live D1. GitHub secrets registered; future main pushes touching
`workers/**` auto-migrate and auto-deploy. Remaining: first user/album rows,
Portainer stack (human), end-to-end sync/viewer test.

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

## Operational Notes

- Cloudflare API token lives in `~\.photo-gate-cf-token` (outside the repo,
  human-provided, never printed) and in GitHub Actions secrets. Wrangler
  commands load it into `CLOUDFLARE_API_TOKEN` per invocation.
- Deployed Worker: https://photo-gate.iniwaiwana.workers.dev, version
  `70f9fc60-6907-4387-bc75-556317ecb0f4` (commit `e566edb`).

## Current Blockers / Required Human Actions

1. **First viewer user:** generate a hash with
   `node workers/scripts/hash-password.mjs` and either run bootstrap.md §5
   yourself or hand Fable the hash + desired user ID to insert.
2. **Portainer:** create the initial stack from `deploy/portainer-stack.yml`
   (image tag `0.1.0`, public GHCR package, no registry credential needed),
   set the environment variables including an R2 S3 API token created in the
   Cloudflare dashboard, and register the stack webhook URL as the
   `PORTAINER_WEBHOOK_URL` GitHub secret for automatic updates.

## Next Priority

After provisioning: Level 1 item 3 (apply migrations, register secrets,
deploy Workers, security smoke tests, controlled end-to-end sync/viewer
test). After mirror confirmation: Level 2 item 4 (Workers CI, Docker CI,
GHCR, Portainer update path).
