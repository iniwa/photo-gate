Read AGENTS.md, CLAUDE.md, and this handoff file before implementation.
If implementation would violate constraints or require files outside this
handoff, stop and ask before editing.

## Goal

Implement Phase 2 of the R2 cleanup deletion controls: a no-JavaScript admin
confirmation and deletion-preview flow for orphan R2 cleanup, with actual R2
deletion still disabled.

Add authenticated POST routes that let an admin request a fresh cleanup
confirmation summary, issue a short-lived signed fingerprint token, validate a
typed confirmation phrase, and then render a fixed "deletion not yet enabled"
result. This phase must not call `R2Bucket.delete()`, must not mutate R2 or D1,
and must not perform production actions.

## Background

Accepted design documents:

- `docs/decisions/2026-06-30-r2-cleanup-dry-run.md`
- `docs/decisions/2026-06-30-r2-cleanup-deletion-controls.md`

Current production/admin state:

- `GET /admin/r2-cleanup` is deployed as a read-only dry-run report.
- The dry-run report classifies private R2 objects into `owned-active`,
  `owned-disabled`, `orphan`, `malformed`, and `excluded-ops`.
- R2 deletion is still disabled by policy.
- Phase 3, if separately approved later, will delete `orphan` candidates only.
  `malformed` remains report-only until real malformed keys are reviewed and a
  follow-on decision is accepted.

This handoff is only Phase 2. It prepares the confirmation safety machinery but
leaves deletion impossible.

## Acceptance Criteria

1. Add a deletion-preview module or equivalent narrowly scoped admin route code:
   - `POST /admin/r2-cleanup/confirm`;
   - `POST /admin/r2-cleanup/delete`;
   - both guarded by existing `requireAdmin` through `createAdminRoutes`;
   - both enforce the existing admin mutation guard chain: same-origin check,
     strict form `Content-Type`, and `parseBody({ all: true })`-style parsing;
   - all success and error responses include `Cache-Control: no-store`.
2. Extend the dry-run page:
   - add a no-JavaScript form that POSTs to `/admin/r2-cleanup/confirm`;
   - label it clearly as a deletion confirmation preview / request, not actual
     deletion;
   - show no delete button that performs real deletion;
   - do not include any R2 object key, photo ID, or browser-supplied candidate
     key in the form.
3. `POST /admin/r2-cleanup/confirm` behavior:
   - re-runs the existing R2 cleanup classification server-side;
   - if the report is truncated or exceeds the new Phase 2 limits, refuse with a
     sanitized no-store error and issue no token;
   - computes orphan-only candidate summary from the fresh report;
   - excludes `malformed`, `owned-disabled`, `owned-active`, and `excluded-ops`
     from the candidate set;
   - computes a deterministic fingerprint for the orphan candidate set;
   - signs a token with HMAC-SHA-256 using a new Worker secret such as
     `R2_CLEANUP_HMAC_KEY`;
   - token includes enough non-sensitive data to validate expiry and fingerprint
     later, for example version/schema, issuedAt, expiresAt, category, and
     fingerprint;
   - token TTL is 15 minutes;
   - renders a confirmation page with counts, approximate total bytes, orphan
     prefix count, warning text, and the exact required phrase `DELETE ORPHANS`;
   - renders album IDs only at prefix level if already present in the dry-run
     report; never render full keys or photo IDs.
4. `POST /admin/r2-cleanup/delete` Phase 2 behavior:
   - accepts exactly the signed token and typed confirmation phrase fields;
   - rejects missing, duplicate, extra, tampered, malformed, or expired fields;
   - validates the typed phrase exactly: `DELETE ORPHANS`;
   - re-runs the existing R2 cleanup classification server-side;
   - recomputes the orphan-only candidate fingerprint;
   - rejects if the fingerprint differs from the token;
   - on successful validation, renders a no-store page saying deletion is not
     enabled in this phase;
   - must not call `R2Bucket.delete()` or any R2/D1 write method.
5. HMAC secret handling:
   - add the secret to the Worker `Env` type, for example
     `R2_CLEANUP_HMAC_KEY?: string`;
   - missing, empty, too-short, or invalid secret fails closed with a sanitized
     `500 Internal Server Error` or a fixed admin-safe error page;
   - do not add a real secret value to any committed file;
   - do not require production secret registration in this handoff.
6. Fingerprint and token safety:
   - browser never supplies object keys, photo IDs, album titles, or raw
     candidate lists;
   - fingerprint uses only server-derived candidate data;
   - token is opaque and HMAC-signed;
   - tampered token, wrong HMAC, expired token, wrong category, malformed JSON,
     or unsupported schema all fail closed;
   - token validation errors do not reveal the HMAC secret or internal payload.
7. Limits:
   - define Phase 2 constants for max orphan prefixes and max candidate objects,
     aligned with the ADR unless a lower value is easier to test:
     `max orphan album prefixes = 50`, `max objects = 500`;
   - if exceeded, refuse confirmation and delete-preview validation before any
     mutation-like action;
   - report counts only, not keys.
8. Sensitive data prohibitions:
   - never render or log full R2 object keys, photo IDs, manifest contents, raw
     JSON, source hashes, album titles, PhotoPrism UIDs/URLs/tokens, bucket
     names, R2 credentials, Cloudflare Access claims, user emails, SQL text,
     stack traces, or exception messages;
   - do not add logging unless required for tests; if added, logs must contain
     fixed event names and non-sensitive counts only.
9. No mutation proof:
   - no R2 `.delete()`, `.put()`, `.get()` body reads for this feature;
   - no D1 `INSERT`, `UPDATE`, or `DELETE`;
   - `POST /admin/r2-cleanup/delete` remains a stub after validation;
   - no production action, commit, push, deploy, secret registration, or handoff
     archival.
10. Documentation:
    - update `workers/README.md` to document the two Phase 2 routes as
      confirmation preview only, with deletion disabled;
    - do not update Fable docs, operations docs, deploy logs, or archived
      handoffs.

## Files To Inspect

- `AGENTS.md`
- `CLAUDE.md`
- `FABLE.md`
- `docs/decisions/2026-06-30-r2-cleanup-dry-run.md`
- `docs/decisions/2026-06-30-r2-cleanup-deletion-controls.md`
- `docs/fable/current-state.md`
- `workers/src/routes/admin.tsx`
- `workers/src/index.tsx`
- `workers/src/types/env.ts`
- `workers/src/types/admin-r2-cleanup.ts`
- `workers/src/services/admin-r2-cleanup-repository.ts`
- `workers/src/services/safe-id.ts`
- `workers/src/services/r2-object-key.ts`
- `workers/test/admin-r2-cleanup-repository.test.ts`
- `workers/test/admin-routes.test.ts`
- `workers/test/helpers/mock-d1.ts`
- `workers/README.md`

## Files To Edit

Edit only these files unless a narrow test helper adjustment is required:

- `workers/src/types/env.ts`
- `workers/src/types/admin-r2-cleanup.ts` if additional report/token-related
  types are useful
- `workers/src/services/admin-r2-cleanup-delete-token.ts` (new, recommended)
- `workers/src/routes/admin-r2-cleanup-delete.tsx` (new, recommended) or the
  equivalent narrowly scoped code inside `workers/src/routes/admin.tsx`
- `workers/src/routes/admin.tsx`
- `workers/test/admin-r2-cleanup-delete-token.test.ts` (new, if token helper is
  created)
- `workers/test/admin-r2-cleanup-delete.test.ts` (new, recommended) or
  equivalent route tests in `workers/test/admin-routes.test.ts`
- `workers/test/admin-routes.test.ts`
- `workers/README.md`

Optional only if existing mocks cannot express the required assertions:

- `workers/test/helpers/mock-d1.ts`

Do not edit:

- `workers/migrations/`
- `docker/`
- `docs/fable/`
- `docs/operations/`
- `docs/decisions/`
- `docs/handoffs/archive/`
- `.github/`
- `docs/iniwa-issues.md`

## Constraints

- Preserve every non-negotiable invariant in `AGENTS.md`.
- R2 deletion remains disabled in this handoff.
- Worker must not access PhotoPrism, NAS, Docker, or Portainer.
- Docker must not read D1.
- R2 remains private; do not create public URLs or signed URLs.
- Do not read R2 object bodies.
- Do not trust browser-supplied object keys, prefixes, album IDs, or candidate
  lists for deletion selection.
- Do not render full object keys or photo IDs.
- Do not select or render `photoprism_album_uid`, album titles, user data,
  transform settings, manifest contents, raw JSON, source hashes, EXIF/GPS, R2
  credentials, bucket names, SQL, stack traces, exception messages, user email,
  or Access claims.
- Use Web Crypto APIs available in Workers for HMAC/SHA-256; do not add a new
  dependency unless there is no reasonable platform API.
- Token code must be deterministic and unit-testable without real secrets.
- Preserve unrelated user changes. `docs/iniwa-issues.md`, if present, is
  unrelated and must not be edited, staged, or committed.

## Non Goals

- No actual R2 deletion.
- No R2 object mutation.
- No D1 mutation or migration.
- No album hard delete.
- No user hard delete.
- No malformed deletion.
- No Docker changes.
- No production deployment or live smoke.
- No secret registration.
- No Fable or operations docs update.
- No handoff archival.

## Verification

Run from `workers/`:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm audit --omit=dev --audit-level=high
```

Run from repository root:

```powershell
git diff --check
git diff HEAD -- docker/
git diff HEAD -- workers/migrations/
git diff HEAD -- docs/fable/
git diff HEAD -- docs/operations/
git diff HEAD -- docs/decisions/
git status --short
```

Do not run Docker tests unless Docker files are changed by mistake.

## Expected Report

Report in Japanese.

Include:

1. Changed files.
2. Route summary:
   - `POST /admin/r2-cleanup/confirm`;
   - `POST /admin/r2-cleanup/delete`;
   - how each route is guarded.
3. Token/fingerprint design:
   - token fields;
   - HMAC algorithm;
   - TTL;
   - secret env name;
   - tamper/expiry/fingerprint mismatch behavior.
4. Candidate selection:
   - orphan-only;
   - `malformed`, `owned-disabled`, `owned-active`, and `excluded-ops` excluded;
   - browser never supplies keys or candidate lists.
5. Phase 2 delete route behavior:
   - validation success still renders "deletion not yet enabled";
   - proof that no `R2Bucket.delete()` call exists.
6. Failure matrix:
   - unauthenticated/non-admin;
   - same-origin failure;
   - bad content type;
   - body validation failure;
   - missing/invalid HMAC secret;
   - report truncated/limits exceeded;
   - tampered/expired token;
   - fingerprint mismatch;
   - typed phrase mismatch;
   - repository failure;
   - success.
7. Privacy proof:
   - list sensitive fields that are neither rendered nor logged.
8. Mutation impossibility proof:
   - no R2 `.delete()` / `.put()`;
   - no D1 write SQL;
   - no production action.
9. Test additions and key assertions.
10. Verification command results.
11. Skipped checks with exact reasons.
12. Confirmation that Docker, migrations, Fable docs, operations docs,
    decisions, production state, archived handoffs, and `docs/iniwa-issues.md`
    were not changed.
13. Any blockers or Codex design questions. If none, say none.