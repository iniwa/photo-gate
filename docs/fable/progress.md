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

- Roadmap Level 1 item 1 complete: manifest-authorized photo loading and
  login/session policy helpers with PBKDF2 ADR (`6333f8d`, `d5c030d`).
- `DB`/`PHOTO_BUCKET` bindings and env types declared (`44a5835`).
- Active `/api/auth/*` login/logout/me routes with uniform failures,
  timing decoy, Origin enforcement, and lockout (ADR viewer-auth-routes,
  commit `aff9732`). Implemented by Opus subagents, reviewed in main session.
- Active `/img` private image routes with the full authorization chain
  (ADR private-image-routes, commit `6a78cfd`).

## Latest Known Verification

- Workers (2026-06-11): lint, typecheck, build dry-run, and audit passed;
  881 tests passed.
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
