# Progress

Last updated: 2026-06-11.

## Current Completion Level

Working toward Level 1: Securely Usable.

## Current Task

Roadmap Level 1, item 2: connect Workers to real D1 and private R2.

Acceptance criteria (incremental, in order):

- `DB` and `PHOTO_BUCKET` bindings and environment types;
- login/logout/me routes using the approved policy helpers;
- authenticated album list/detail routes;
- private image routes enforcing session, album permission, exact manifest
  membership, standard keys, and safe responses;
- fixture viewer routes replaced only after real routes are fully protected;
- daily expired-session cleanup (Cron);
- operator bootstrap instructions/tooling;
- full Workers verification passes at every step; committed and pushed.

## Last Completed Work

- Manifest-authorized thumb/preview loading service with exact-membership
  enforcement; handoff archived (commits `6333f8d`, `ba76829`).
- Login/session policy helpers (`login-policy.ts`), atomic lockout-aware
  `recordLoginFailure`, and ADR fixing PBKDF2 at 100,000 iterations
  (commit `d5c030d`). Roadmap Level 1 item 1 is complete.
- Subagent delegation and auto-push rules added to `FABLE.md` (`f8dc674`).

## Latest Known Verification

- Workers (2026-06-11): lint, typecheck, build dry-run, and audit passed;
  789 tests passed.
- Docker baseline must be rechecked before the next Docker change.

## Human Setup Expected Later

- Initial Portainer stack/container, registry credentials, volumes, networks,
  environment variables, secrets, and dedicated stack update mechanism.
- Initial Cloudflare interactive login/account selection when required.
- Required production secret values.

## Current Blockers

None.

## Next Priority

Roadmap Level 1 item 2 sub-steps in order: bindings/env types first, then
login routes, album routes, image routes, fixture replacement, Cron cleanup,
operator bootstrap. Then item 3 (deploy and validate Level 1).
