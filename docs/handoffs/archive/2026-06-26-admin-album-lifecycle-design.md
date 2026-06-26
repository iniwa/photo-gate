Read AGENTS.md, CLAUDE.md, and this handoff file before implementation.
If implementation would violate constraints or require files outside this
handoff, stop and ask before editing.

## Goal

Create an ADR for browser-based admin management before any implementation.

The ADR must decide how `photo-gate` should eventually support these operations
from `/admin` without breaking the project boundaries:

- create, edit, disable/enable, reset password for, and delete/depublish users;
- fetch or present PhotoPrism album information for operator selection;
- assign albums to individual users;
- manage how synced share assets live in private cloud storage.

The ADR should include album lifecycle controls, but it must not treat album
creation/deletion as an isolated feature. The desired operator experience is a
browser-based management console for users, PhotoPrism-sourced albums,
assignments, and private R2-backed share assets.

Non-negotiable boundaries still apply:

- Workers must not access PhotoPrism, NAS, Docker, or Portainer.
- Docker must not read D1 or implement viewer/admin authorization.
- private R2 must remain private.
- R2 deletion remains dry-run only until separately approved.

This is a design-only handoff. Do not implement routes, repositories, tests, D1
migrations, sync changes, or UI changes.

## Background

Current admin functionality already exists for some pieces:

- User creation and password reset exist.
- User enable/disable exists.
- User deletion and display-name editing do not exist.
- Permission grant/revoke exists, but the UI requires manual album/user IDs.

Current album administration already exists for the D1 `albums` table:

- `GET /admin/albums` lists only approved public/admin-safe fields:
  `id`, `title`, `enabled`, `expires_at`, `download_enabled`, `created_at`,
  `updated_at`.
- `POST /admin/albums/enable` and `/disable` toggle only `enabled`.
- `POST /admin/albums/update-public-metadata` updates only `title`,
  `expires_at`, `download_enabled`, and `updated_at`.
- `photoprism_album_uid`, transform settings, `strip_exif`, and R2 data are not
  selected or rendered in current admin album pages.

The D1 schema has an `albums.photoprism_album_uid TEXT NOT NULL` column, but the
current Docker sync daemon is still configured from Portainer environment
variables for one album. Docker does not read D1. Therefore, an admin-created D1
album row would not automatically become a Docker sync target.

The current production sync is `0.3.0`; manual sync is live-smoke verified for
the existing configured album. That does not yet solve multi-album lifecycle
management, PhotoPrism album discovery, or browser-friendly per-user assignment.

## Acceptance Criteria

Create a new ADR file:

- `docs/decisions/2026-06-26-admin-browser-management.md`

The ADR must answer these questions concretely:

1. What should browser-based user management include?
   - create user;
   - edit display name and enabled state;
   - reset password;
   - delete user versus disable user;
   - what happens to sessions and album permissions.
2. How should browser assignment work?
   - assign/unassign albums to users without requiring manual ID typing;
   - whether pages may join safe display data for admin-only assignment views;
   - how to avoid exposing password hashes, session tokens, PhotoPrism UIDs, or
     raw source identifiers unnecessarily.
3. What does "create album" mean in the current architecture?
   - D1 row only?
   - D1 row plus a future sync catalog?
   - something else?
4. How is `photoprism_album_uid` handled?
   - whether admin may input it;
   - whether it is write-only after creation;
   - whether it is ever rendered back in HTML, errors, logs, or list pages.
5. How should PhotoPrism album information be fetched or presented?
   - Worker direct PhotoPrism access must be rejected unless the ADR explicitly
     changes a non-negotiable invariant, which it should not do;
   - evaluate Docker-published sanitized PhotoPrism album catalog in private R2;
   - decide which fields are safe to expose in admin UI, such as title and a
     stable opaque catalog ID, and which fields remain hidden;
   - decide whether manual PhotoPrism UID entry remains an interim path.
6. What should the initial `enabled` state be for a newly created album?
   - evaluate fail-closed default `enabled = 0` versus immediate publication;
   - account for missing R2 manifest/cover while sync has not run.
7. How do Docker sync and album creation connect?
   - explicitly reject Docker-to-D1 coupling;
   - explicitly reject Worker-to-PhotoPrism/NAS/Docker/Portainer coupling;
   - decide whether a later private R2 sync-catalog object is needed.
8. What does "delete album" mean?
   - D1 hard delete?
   - disable-only/depublish?
   - R2 cleanup dry-run only?
   - how permissions cascade or are preserved;
   - how to avoid deleting an actively synced Portainer-configured album.
9. How should cloud storage be treated?
   - private R2 remains the only cloud storage for share assets;
   - Workers may read R2 share assets only through authorization/manifest checks;
   - Docker may write generated, metadata-stripped share assets;
   - no originals/RAW/source metadata in R2;
   - cleanup starts as dry-run/reporting only;
   - decide how orphaned album objects are represented before deletion exists.
10. What are the recommended implementation phases and future handoffs?

The ADR should recommend a staged path. Unless the analysis finds a stronger
reason, use this as the default recommendation:

1. Phase 1: browser-friendly user and assignment management.
   - User edit/delete design first: prefer disable over hard delete unless a
     separate hard-delete design proves session/permission behavior is safe.
   - Assignment UI should use safe admin-only lists and avoid manual ID typing.
   - Do not expose password hashes, sessions, or PhotoPrism source IDs.
2. Phase 2: D1-only album creation.
   - Route: future `POST /admin/albums/create`.
   - Fields: `albumId`, `title`, `photoprismAlbumUid`, `expiresAt`,
     `downloadEnabled`.
   - `enabled` is explicitly inserted as `0` so newly created albums are not
     viewer-visible until an admin enables them after sync readiness is known.
   - Transform settings and `strip_exif` use schema defaults; no UI editing.
   - `photoprismAlbumUid` is accepted only on create and never rendered back.
   - No PhotoPrism validation or lookup from Worker.
   - No Docker/Portainer change.
3. Phase 3: PhotoPrism album catalog / sync-target design.
   - Prefer Docker publishing a sanitized private R2 catalog because Docker is
     already allowed to talk to PhotoPrism, while Worker is not.
   - The catalog must not contain PhotoPrism URLs, tokens, NAS paths, originals,
     or source metadata.
   - Evaluate a private R2 sync catalog written by Worker and read by Docker,
     versus continuing single-album Portainer env operation.
   - This must remain separate from earlier implementation unless Codex later
     approves it.
4. Phase 4: cloud storage cleanup/reporting design.
   - Inventory private R2 share objects versus D1 albums/manifests.
   - Start with dry-run reports only.
   - Do not implement actual R2 deletion.
5. Phase 5: D1-only delete/depublish design.
   - Prefer disable/depublish as the normal safe path.
   - If hard delete is recommended, require a separate implementation handoff,
     admin guard, same-origin POST, strict form validation, no R2 deletion, and
     clear handling of cascading `album_permissions`.
   - The ADR must call out that R2 objects become orphaned until a separately
     reviewed cleanup dry-run exists.

## Files To Inspect

- `AGENTS.md`
- `CLAUDE.md`
- `FABLE.md`
- `docs/fable/project-context.md`
- `docs/fable/current-state.md`
- `docs/fable/progress.md`
- `docs/fable/roadmap.md`
- `docs/decisions/2026-06-25-sync-request-controls.md`
- `workers/migrations/0002_albums_permissions.sql`
- `workers/src/services/admin-user-repository.ts`
- `workers/src/services/admin-album-repository.ts`
- `workers/src/services/admin-permission-repository.ts`
- `workers/src/routes/admin.tsx`
- `workers/README.md`
- `docker/README.md`

## Files To Edit

Only:

- `docs/decisions/2026-06-26-admin-browser-management.md`

Do not edit Fable state, README files, code, tests, migrations, or handoff
archives in this handoff.

## Constraints

- Do not use `claude -p`.
- Documentation-only. Do not implement code.
- Do not run production commands.
- Do not query PhotoPrism, NAS, R2, D1, Cloudflare, GHCR, or Portainer.
- Do not print or infer real album IDs, PhotoPrism UIDs, tokens, or operator
  secrets.
- Preserve current invariants:
  - Workers never access PhotoPrism/NAS/Docker/Portainer.
  - Docker does not read D1 or implement viewer/admin authorization.
  - R2 remains private.
  - R2 deletion remains dry-run only until separately approved.
- Treat `photoprism_album_uid` and any PhotoPrism catalog identifiers as
  sensitive operational source identity unless the ADR explicitly justifies a
  narrower classification. Even if admin-input is allowed, rendering raw source
  IDs back should remain prohibited by default.

## Non Goals

- No route/repository/UI implementation.
- No D1 migration.
- No Docker sync change.
- No private R2 sync catalog implementation.
- No PhotoPrism catalog publisher implementation.
- No album hard delete implementation.
- No user hard delete implementation.
- No R2 cleanup or deletion.
- No production deploy, tag, push, commit, or handoff archival.
- No broad cleanup of mojibake or historical docs.

## Verification

Documentation-only checks:

```powershell
git diff --check
git status --short
git diff HEAD -- workers/ docker/
rg -n "photoprism_album_uid|PhotoPrism UID|PhotoPrism catalog|secret|token|delete|R2 deletion|sync catalog|Docker-to-D1|Worker-to-PhotoPrism|cloud storage|assignment|user" docs/decisions/2026-06-26-admin-browser-management.md
```

Do not run Workers or Docker test suites unless code was accidentally changed.

## Expected Report

Report in Japanese with:

1. Changed files.
2. ADR decision summary.
3. Recommended implementation phases.
4. Explicit boundary decisions:
   - Worker-to-PhotoPrism/NAS/Docker/Portainer;
   - Docker-to-D1;
   - PhotoPrism UID visibility;
   - user delete versus disable;
   - user-album assignment UI;
   - cloud storage/R2 object ownership;
   - R2 cleanup/deletion.
5. Verification results.
6. Any design questions for Codex.

Do not archive this handoff. Do not commit or push.