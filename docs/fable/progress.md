# Progress

Last updated: 2026-06-11.

## Current Completion Level

Working toward Level 1: Securely Usable.

## Current Task

Roadmap Level 1, item 1 remainder: route-independent login/session policy
helpers using the approved defaults.

Acceptance criteria:

- fixed seven-day session lifetime policy helper;
- five-failure / fifteen-minute lockout decision helpers;
- PBKDF2 iteration count decided and recorded as an ADR;
- helpers stay route-independent (no bindings, no active routes);
- focused tests; full Workers verification passes; committed and pushed.

## Last Completed Work

- Implemented `manifest-authorized-photo-service.ts`: thumb/preview loading
  gated on exact photo-ID membership in the current validated manifest,
  manifest-first read order, fixed reader call counts, sanitized failures,
  and no probing of unlisted/stale objects (commit `6333f8d`).
- Added 89 focused tests; updated `workers/README.md`.
- Archived the completed handoff
  `docs/handoffs/archive/2026-06-09-phase-3-manifest-authorized-photo-loading.md`.

## Latest Known Verification

- Workers (2026-06-11): lint, typecheck, build dry-run, and audit passed;
  769 tests passed.
- Docker baseline must be rechecked before the next Docker change.

## Human Setup Expected Later

- Initial Portainer stack/container, registry credentials, volumes, networks,
  environment variables, secrets, and dedicated stack update mechanism.
- Initial Cloudflare interactive login/account selection when required.
- Required production secret values.

## Current Blockers

None.

## Next Priority

After login/session policy helpers: begin wiring Workers to `DB` and
`PHOTO_BUCKET` per roadmap item 2 (bindings, login/logout/me routes,
authenticated album routes, protected image routes).
