Read AGENTS.md, CLAUDE.md, and this handoff file before implementation.
If implementation would violate constraints or require files outside this
handoff, stop and ask before editing.

## Goal

Implement Admin Hard Delete Controls Phase 2: a no-JavaScript, two-step
confirmation preview flow for user and album hard delete, without enabling any
actual D1 DELETE or R2 album-asset deletion.

This phase must prove the destructive-operation guard pattern works:

- admin guard;
- same-origin POST guard;
- strict form content-type and body validation;
- HMAC-SHA-256 signed short-lived token;
- exact typed confirmation phrase;
- fresh target re-read before the final preview result;
- sanitized HTML responses;
- no actual delete.

The result of the final delete POST in this phase is a fixed "not yet enabled"
preview page. It must not delete users, albums, permissions, sessions, R2 album
objects, or sync-target entries.

## Background

The accepted design is recorded in:

- `docs/decisions/2026-06-30-admin-hard-delete-controls.md`

Relevant decisions from that ADR:

- Disable remains the normal safe path.
- Hard delete requires a separate multi-step browser confirmation.
- User hard delete will eventually delete one D1 `users` row and rely on
  existing cascades, but not in this phase.
- Album hard delete will eventually remove a matching `ops/sync-targets.json`
  entry before deleting one D1 `albums` row, but not in this phase.
- Album hard delete must not delete R2 objects under `albums/<albumId>/`.
- `photoprism_album_uid`, password hashes, session tokens, R2 keys, SQL, stack
  traces, credentials, and PhotoPrism/NAS identifiers must never be selected or
  rendered.
- HMAC secret: `HARD_DELETE_HMAC_KEY`, minimum 32 characters.
- Typed phrases:
  - user delete: `DELETE USER`
  - album delete: `DELETE ALBUM`

There is an existing analogous preview-only flow for R2 cleanup deletion:

- `workers/src/services/admin-r2-cleanup-delete-token.ts`
- `workers/src/routes/admin-r2-cleanup-delete.tsx`
- `workers/test/admin-r2-cleanup-delete-token.test.ts`
- `workers/test/admin-r2-cleanup-delete.test.ts`

Use that as the implementation pattern, but do not share tokens or secrets with
R2 cleanup. The hard-delete token service must be separate and must use
`HARD_DELETE_HMAC_KEY`.

## Acceptance Criteria

### 1. New routes

Add these four admin POST routes:

- `POST /admin/users/confirm-delete`
- `POST /admin/users/delete`
- `POST /admin/albums/confirm-delete`
- `POST /admin/albums/delete`

All four routes must be mounted inside `createAdminRoutes` and protected by the
existing `requireAdmin` middleware.

### 2. Phase 2 behavior only

This phase must not execute any actual hard delete.

- No D1 `DELETE FROM users`.
- No D1 `DELETE FROM albums`.
- No D1 `DELETE FROM sessions`.
- No D1 `DELETE FROM album_permissions`.
- No R2 delete.
- No R2 write to album asset keys.
- No sync-target read-modify-write yet.

After a valid token and phrase on the final `/delete` route, return a sanitized
HTML page explaining that hard delete validation succeeded but actual deletion
is not enabled in this phase.

### 3. Confirmation flow

#### Step 1: confirm-delete

`POST /admin/users/confirm-delete` accepts exactly one field:

- `userId`

`POST /admin/albums/confirm-delete` accepts exactly one field:

- `albumId`

For both routes:

- require same-origin Origin;
- require exact `application/x-www-form-urlencoded` with the existing optional
  single `charset` rule;
- parse with `parseBody({ all: true })`;
- reject missing, extra, repeated, file-valued, empty, or invalid ID fields;
- re-read the target from D1 before issuing a token;
- if target is absent, render a sanitized target-not-found page with no delete
  form;
- if repository read fails, return generic `500 Internal Server Error` with
  `Cache-Control: no-store`;
- if `HARD_DELETE_HMAC_KEY` is missing or shorter than 32 characters, return
  generic `500 Internal Server Error` with `Cache-Control: no-store`;
- issue a 15-minute HMAC token on success;
- render a warning page with a final POST form to the matching `/delete` route.

The Step 1 page must show only allowed summary data.

User summary may show:

- user ID;
- display name;
- enabled state;
- session count only if easy to provide safely; otherwise omit it;
- permission count only if easy to provide safely; otherwise omit it;
- warning that future real delete will remove sessions and permissions by
  cascade.

Album summary may show:

- album ID;
- title;
- enabled state;
- whether a sync-target entry exists only if easy to provide safely; otherwise
  state that this phase does not inspect sync-targets;
- warning that future real delete will remove permissions by cascade;
- warning that R2 album objects will not be deleted and will become orphaned.

Do not add sync-target R2 reads in Phase 2 unless they are strictly necessary.
They are not required for acceptance.

#### Step 2: delete preview

`POST /admin/users/delete` accepts exactly two fields:

- `token`
- `phrase`

`POST /admin/albums/delete` accepts exactly two fields:

- `token`
- `phrase`

For both routes:

- require same-origin Origin;
- require exact form content-type;
- parse with `parseBody({ all: true })`;
- reject missing, extra, repeated, file-valued, empty, or overlong fields;
- require correct exact phrase (`DELETE USER` or `DELETE ALBUM`), no trimming,
  case-sensitive;
- require valid HMAC token:
  - signature valid;
  - schema valid;
  - not expired;
  - category matches route;
  - token target ID matches submitted target ID if the route also receives one,
    or matches the target ID encoded in the token if no separate ID is posted;
- re-read the target from D1 after token and phrase validation;
- absent target returns a sanitized target-not-found page and no mutation;
- read failure returns generic 500 and no mutation;
- success returns a fixed preview page saying deletion is not enabled in this
  phase.

Preferred delete body shape for this phase:

- `token`
- `phrase`

The target ID may be encoded only in the token and re-derived from token
payload. Do not put display names, titles, object counts, sync-target content,
R2 keys, permission lists, session details, or other destructive facts in hidden
form fields.

### 4. Token service

Create `workers/src/services/admin-hard-delete-token.ts`.

It should mirror the R2 cleanup token pattern but use hard-delete-specific
payload categories:

```ts
export type HardDeleteCategory = 'user-delete' | 'album-delete'

export interface HardDeleteTokenPayload {
  schema: 1
  issuedAt: number
  expiresAt: number
  category: HardDeleteCategory
  targetId: string
}
```

Constants:

- `HARD_DELETE_HMAC_MIN_KEY_LEN = 32`
- `HARD_DELETE_TOKEN_TTL_MS = 15 * 60 * 1000`

Functions:

- `signHardDeleteToken(hmacKeyRaw, payload): Promise<string>`
- `verifyHardDeleteToken(hmacKeyRaw, token, nowMs): Promise<HardDeleteTokenPayload | null>`

Validation requirements:

- token must be `base64url(JSON(payload)).base64url(hmac)`;
- HMAC must be verified before JSON parsing;
- schema must be exactly `1`;
- category must be exactly `user-delete` or `album-delete`;
- targetId must pass the existing admin/repository ID validation;
- issuedAt and expiresAt must be numbers;
- expired token returns null;
- malformed/tampered tokens return null without throwing.

### 5. Repository read methods

Add the minimum read-only repository methods needed to produce Step 1 summaries
and Step 2 re-read checks.

Preferred methods:

- `AdminUserRepository.getUserForHardDelete(userId)`
- `AdminAlbumRepository.getAlbumForHardDelete(albumId)`

They must:

- use parameterized SQL;
- validate ID before D1;
- select only allowed columns.

User allowed columns:

- `id`
- `display_name`
- `enabled`

Do not select:

- `password_hash`
- `fail_count`
- `locked_until`
- session token hashes
- album permissions rows unless separately counted with safe aggregate counts

Album allowed columns:

- `id`
- `title`
- `enabled`

Do not select:

- `photoprism_album_uid`
- transform settings
- `strip_exif`
- timestamps unless needed for a safe display decision

If count summaries are added, use aggregate counts only and validate them as
safe non-negative integers. Counts are optional in Phase 2.

### 6. Admin page buttons

Add small confirm-delete forms to existing admin list pages:

- users list row: form posts to `/admin/users/confirm-delete` with hidden
  `userId` only;
- albums list row: form posts to `/admin/albums/confirm-delete` with hidden
  `albumId` only.

These buttons must be visually and textually distinct from enable/disable.
Because this phase does not delete, the label may explicitly say preview or
confirm only, e.g. `削除確認`.

Do not add delete forms to viewer pages.
Do not add JavaScript.

### 7. Response and cache behavior

All responses from the four new POST routes must set:

- `Cache-Control: no-store`

Generic failures must not include sensitive details.

Allowed error bodies:

- `Bad Request`
- `Internal Server Error`
- sanitized HTML pages that do not include sensitive fields

### 8. Privacy/security prohibitions

No response, log, thrown error message, test fixture assertion, or hidden field
may include:

- password hashes;
- session tokens or token hashes;
- `photoprism_album_uid`;
- R2 object keys below album-prefix level;
- R2 bucket name;
- R2 credentials or endpoint;
- Cloudflare account ID or API tokens;
- Access JWT claims;
- SQL text;
- stack traces;
- contents of `ops/sync-targets.json`;
- PhotoPrism URLs/tokens;
- NAS paths.

### 9. Documentation

Update `workers/README.md` active surface and route behavior sections to mention
that hard-delete confirmation-preview routes exist but actual hard delete is not
enabled.

Do not update Fable docs or operations docs in this implementation handoff.
Those are delivery/state documents and should be updated later by Codex after
review/deploy.

## Files To Inspect

- `AGENTS.md`
- `CLAUDE.md`
- `FABLE.md`
- `docs/decisions/2026-06-30-admin-hard-delete-controls.md`
- `docs/decisions/2026-06-30-r2-cleanup-deletion-controls.md`
- `workers/src/routes/admin.tsx`
- `workers/src/routes/admin-r2-cleanup-delete.tsx`
- `workers/src/services/admin-r2-cleanup-delete-token.ts`
- `workers/src/services/admin-user-repository.ts`
- `workers/src/services/admin-album-repository.ts`
- `workers/src/types/env.ts`
- `workers/test/admin-routes.test.ts`
- `workers/test/admin-r2-cleanup-delete-token.test.ts`
- `workers/test/admin-r2-cleanup-delete.test.ts`
- `workers/test/admin-user-repository.test.ts`
- `workers/test/admin-album-repository.test.ts`
- `workers/README.md`

## Files To Edit

Allowed:

- `workers/src/services/admin-hard-delete-token.ts` (new)
- `workers/src/routes/admin-hard-delete.tsx` (new)
- `workers/src/services/admin-user-repository.ts`
- `workers/src/services/admin-album-repository.ts`
- `workers/src/routes/admin.tsx`
- `workers/src/types/env.ts`
- `workers/test/admin-hard-delete-token.test.ts` (new)
- `workers/test/admin-hard-delete.test.ts` (new)
- `workers/test/admin-user-repository.test.ts`
- `workers/test/admin-album-repository.test.ts`
- `workers/test/admin-routes.test.ts`
- `workers/README.md`

Do not edit unless Codex explicitly approves:

- `workers/migrations/`
- `workers/src/routes/pages.tsx`
- `workers/src/routes/img-routes.ts`
- `workers/src/routes/download-routes.ts`
- `workers/src/services/admin-sync-target-repository.ts`
- `workers/src/services/admin-r2-cleanup-repository.ts`
- `workers/src/services/admin-r2-cleanup-delete-token.ts`
- `workers/src/routes/admin-r2-cleanup-delete.tsx`
- `docker/`
- `docs/fable/`
- `docs/operations/`
- `docs/decisions/`
- `docs/handoffs/archive/`
- `.github/`
- `docs/iniwa-issues.md`

## Constraints

- Preserve every non-negotiable invariant in `AGENTS.md`.
- This is Phase 2 preview only. Do not implement actual hard delete.
- Do not add D1 migrations.
- Do not add dependencies.
- Do not add JavaScript.
- Do not add external assets, fonts, scripts, or CSP relaxations.
- Do not change viewer routes or viewer behavior.
- Do not change existing enable/disable semantics.
- Do not change R2 cleanup deletion-preview behavior.
- Do not register `HARD_DELETE_HMAC_KEY`; only add the optional env type and
  fail-closed runtime checks.
- Do not commit, push, deploy, mutate production, or archive this handoff.

## Non Goals

- No actual `DELETE FROM users`.
- No actual `DELETE FROM albums`.
- No session or permission cascade execution beyond what tests may mock for
  future phases.
- No sync-target removal.
- No R2 deletion.
- No R2 object listing for this feature.
- No R2 cleanup actual deletion.
- No admin UI redesign beyond adding the small confirm-delete forms.
- No viewer UI changes.
- No RAW/original download.
- No production smoke.
- No documentation outside `workers/README.md`.

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
git diff HEAD -- docs/handoffs/archive/
git diff HEAD -- docs/iniwa-issues.md
git status --short
```

Do not run Docker tests unless Docker files are changed by mistake.

## Expected Report

Report in Japanese.

Include:

1. Changed files.
2. Route summary for the four new POST routes.
3. Token service summary:
   - payload schema;
   - TTL;
   - categories;
   - HMAC verification before JSON parse.
4. Repository summary:
   - selected columns for user summary;
   - selected columns for album summary;
   - explicit confirmation that `password_hash` and `photoprism_album_uid` are
     not selected.
5. UI summary:
   - user list confirm-delete form;
   - album list confirm-delete form;
   - Step 1 confirmation page;
   - Step 2 not-yet-enabled result page.
6. Phase 2 no-delete proof:
   - no D1 DELETE;
   - no R2 delete;
   - no sync-target mutation;
   - no session/permission mutation.
7. Failure matrix:
   - unauthenticated/non-admin;
   - Origin absent/null/cross-origin;
   - bad Content-Type;
   - invalid fields;
   - missing/short HMAC key;
   - malformed/tampered/expired/wrong-category token;
   - wrong phrase;
   - missing target;
   - repository error.
8. Privacy/security proof:
   - no password hash/session token/photoprism UID/R2 key/bucket/SQL/stack trace
     in responses;
   - no PhotoPrism/NAS/Docker/Portainer access;
   - no public/signed R2 URL.
9. Tests added and key assertions.
10. Verification command results.
11. Skipped checks with exact reason.
12. Confirmation that Docker, migrations, viewer routes, Fable docs,
    operations docs, decisions, archived handoffs, production state, and
    `docs/iniwa-issues.md` were not changed.
13. Blockers or Codex design questions. If none, say none.