Read AGENTS.md, CLAUDE.md, and this handoff file before implementation.
If implementation would violate constraints or require files outside this
handoff, stop and ask before editing.

## Goal

Implement the read-only admin R2 cleanup dry-run report.

Add `GET /admin/r2-cleanup`, protected by the existing admin guard, that reports
which private R2 album prefixes are owned, disabled-owned, orphaned, or
malformed. This is a report only. It must not delete, mutate, move, or rewrite
anything in R2 or D1.

## Background

The accepted design is:

- `docs/decisions/2026-06-30-r2-cleanup-dry-run.md`

Important decisions from the ADR:

- R2 cleanup starts as dry-run/reporting only.
- Actual R2 deletion requires explicit human approval and a separate reviewed
  handoff.
- D1 `albums.id` is the authority for owned album namespaces.
- Disabled albums are owned, not orphaned.
- Worker admin route is the preferred implementation because Workers already
  have `DB` and `PHOTO_BUCKET`.
- Docker must not read D1.
- Worker must not contact PhotoPrism, NAS, Docker, or Portainer.
- The report must not read R2 object bodies or render full per-object keys.

## Acceptance Criteria

1. Add a new admin route:
   - `GET /admin/r2-cleanup`;
   - guarded by existing `requireAdmin`;
   - mounted with the other read-only admin GET routes, before the first POST
     route and before `admin.all('*', ...)`;
   - returns `Cache-Control: no-store` on success and every error.
2. Add an Admin home link to the R2 cleanup report.
3. Add a read-only repository/service that:
   - queries D1 with only `SELECT id, enabled FROM albums ORDER BY id ASC LIMIT ?`;
   - does not select `title`, `photoprism_album_uid`, transform settings,
     timestamps, permissions, users, sessions, or any password/session data;
   - validates every returned D1 row before use;
   - fails closed on invalid D1 rows or D1 errors.
4. R2 listing behavior:
   - uses `R2Bucket.list()` only;
   - does not call `.get()`, `.put()`, `.delete()`, or any object body method;
   - lists `albums/` with pagination and bounded processing;
   - may list `ops/` separately only to produce an informational count;
   - does not list or read any other prefix.
5. Bounded processing:
   - define clear constants such as `R2_CLEANUP_MAX_ALBUM_ROWS`,
     `R2_CLEANUP_MAX_R2_PAGES`, and `R2_CLEANUP_MAX_R2_OBJECTS`;
   - D1 album rows must be bounded, for example `LIMIT max + 1`, with overflow
     treated as a sanitized failure;
   - R2 listing must use cursors and stop with a visible `truncated` flag if
     the configured object/page limit is reached;
   - do not accumulate all object keys unbounded in memory.
6. Classification:
   - aggregate R2 objects by valid album ID from `albums/<albumId>/...`;
   - `owned-active`: R2 prefix exists and D1 row exists with `enabled = 1`;
   - `owned-disabled`: R2 prefix exists and D1 row exists with `enabled = 0`;
   - `orphan`: R2 prefix exists and no D1 row exists;
   - `malformed`: key under `albums/` has an invalid album ID, missing segment,
     or a non-standard album asset shape;
   - `excluded-ops`: if `ops/` is listed, count only; never classify as orphan.
7. Valid album asset shape:
   - reuse `isValidId` / `isStandardPrivateObjectKey` or equivalent existing
     helpers rather than inventing ad-hoc regexes;
   - recognized standard shapes are `manifest.json`, `cover.webp`,
     `thumbs/<photoId>.webp`, and `previews/<photoId>.jpg`;
   - malformed per-object keys must not be rendered in full.
8. Report rendering:
   - render prefix-level rows only, not per-object key lists;
   - acceptable fields: category, album ID for valid album prefixes, object
     count, approximate total bytes, malformed object count, and a truncation
     notice;
   - do not render full object keys, photo IDs, manifest contents, raw JSON,
     source hashes, album titles, PhotoPrism UIDs, PhotoPrism URLs/tokens, R2
     credentials, or bucket names;
   - JavaScript is not required;
   - no delete form or mutation form appears anywhere.
9. Error behavior:
   - D1 errors, invalid D1 rows, R2 list errors, or unexpected validation errors
     return fixed `500 Internal Server Error` with `Cache-Control: no-store`;
   - response bodies must not include SQL, R2 keys, bucket names, exception
     messages, stack traces, credentials, or raw internal data.
10. Route behavior:
    - auth failure: existing `403 Forbidden` no-store;
    - success: `200` no-store HTML report;
    - D1/R2/repository failure: `500 Internal Server Error` no-store.
11. No mutation:
    - no R2 `.put()` or `.delete()`;
    - no D1 `INSERT`, `UPDATE`, or `DELETE`;
    - no POST route;
    - no production action.
12. Documentation:
    - update `workers/README.md` active surface / route behavior with
      `GET /admin/r2-cleanup`;
    - explicitly state it is read-only dry-run reporting and does not delete.

## Files To Inspect

- `AGENTS.md`
- `CLAUDE.md`
- `FABLE.md`
- `docs/decisions/2026-06-30-r2-cleanup-dry-run.md`
- `docs/fable/current-state.md`
- `workers/src/routes/admin.tsx`
- `workers/src/index.tsx`
- `workers/src/services/r2-object-key.ts`
- `workers/src/services/safe-id.ts`
- `workers/src/services/admin-album-repository.ts`
- `workers/src/services/private-r2-reader.ts`
- `workers/test/admin-routes.test.ts`
- `workers/test/private-r2-reader.test.ts`
- `workers/test/r2-object-key.test.ts`
- `workers/test/helpers/mock-d1.ts`
- `workers/README.md`

## Files To Edit

Edit only these files unless you discover a narrow test helper is required:

- `workers/src/types/admin-r2-cleanup.ts` (new)
- `workers/src/services/admin-r2-cleanup-repository.ts` (new)
- `workers/src/routes/admin.tsx`
- `workers/src/index.tsx`
- `workers/test/admin-r2-cleanup-repository.test.ts` (new)
- `workers/test/admin-routes.test.ts`
- `workers/README.md`

Optional, only if existing helpers are insufficient and the change stays narrow:

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
- R2 deletion stays disabled.
- This route is dry-run reporting only.
- Worker must not access PhotoPrism, NAS, Docker, or Portainer.
- Docker must not read D1.
- R2 remains private; do not create public URLs or signed URLs.
- Do not read R2 object bodies.
- Do not render full object keys or photo IDs.
- Do not select or render `photoprism_album_uid`, album titles, user data,
  transform settings, manifest contents, raw JSON, source hashes, EXIF/GPS, R2
  credentials, bucket names, SQL, stack traces, or exception messages.
- Do not add any mutation route, delete form, POST form, JavaScript delete
  control, migration, production action, commit, push, deploy, or handoff
  archival.
- Preserve unrelated user changes. `docs/iniwa-issues.md`, if present, is
  unrelated and must not be edited, staged, or committed.

## Non Goals

- No R2 deletion.
- No R2 object mutation.
- No album hard delete.
- No user hard delete.
- No Docker changes.
- No D1 migrations.
- No deployment or live smoke.
- No Fable or operations docs update.
- No cleanup delete design.

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
git status --short
```

Do not run Docker tests unless Docker files are changed by mistake.

## Expected Report

Report in Japanese.

Include:

1. Changed files.
2. Route summary for `GET /admin/r2-cleanup`.
3. Repository summary:
   - exact D1 selected columns;
   - R2 list prefixes;
   - page/object limits;
   - classification rules.
4. Report output fields and explicit non-rendered data.
5. Failure matrix:
   - unauthenticated;
   - D1 failure;
   - invalid D1 row;
   - R2 list failure;
   - R2 truncation/limit reached;
   - success.
6. Proof that no mutation is possible:
   - no POST route;
   - no delete form;
   - no R2 `.put()` / `.delete()`;
   - no D1 write SQL.
7. Test additions and key assertions.
8. Verification command results.
9. Skipped checks with exact reasons.
10. Confirmation that Docker, migrations, Fable docs, operations docs,
    decisions, production state, and `docs/iniwa-issues.md` were not changed.
11. Any blockers or Codex design questions. If none, say none.
