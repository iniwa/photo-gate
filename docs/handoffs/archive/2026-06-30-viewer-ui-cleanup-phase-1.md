Read AGENTS.md, CLAUDE.md, and this handoff file before implementation.
If implementation would violate constraints or require files outside this
handoff, stop and ask before editing.

## Goal

Improve the viewer-side UI presentation without changing behavior, data access,
routes, security boundaries, or persistence.

This is a CSS/markup cleanup pass for the authenticated viewer and login
experience:

- login page;
- album list page;
- album detail thumbnail grid;
- photo preview page;
- shared viewer navigation/buttons.

Admin UI is out of scope. RAW/original download is out of scope and remains
deferred pending a separate ADR.

## Background

The viewer now supports:

- album list;
- album detail thumbnail grid;
- authenticated HTML photo preview page with previous/next navigation;
- preview JPEG download links when `download_enabled = 1`.

The feature set is acceptable, but the UI is still the original minimal styling.
The operator explicitly wants UI work handled separately from feature/security
work. This handoff performs a first viewer-only cleanup while preserving the
existing no-JavaScript SSR model.

Existing safety model:

- Viewer pages use Cloudflare Workers + D1 + private R2 only.
- Workers must not access NAS, PhotoPrism, Docker, or Portainer.
- R2 remains private.
- Only generated metadata-stripped derivatives may be displayed or downloaded.
- The existing `/img` and `/download` routes own image/download authorization.
- No new route, D1 query, R2 key, or R2 operation is needed for visual cleanup.

Recent state:

- `GET /download/:albumId/preview/:photoId` is deployed.
- `GET /albums/:albumId/photos/:photoId` is deployed.
- RAW/original download is deferred and requires a separate ADR.
- Admin hard delete has an ADR but remains unimplemented.
- Actual R2 deletion remains disabled.

## Acceptance Criteria

1. Viewer-only UI cleanup:
   - improve visual spacing, sizing, and grouping for the login page,
     `/albums`, `/albums/:albumId`, and
     `/albums/:albumId/photos/:photoId`;
   - keep the existing server-rendered/no-client-JavaScript model;
   - keep existing route paths, HTTP behavior, and authorization behavior.
2. Responsive layout:
   - album cards should remain readable on mobile and desktop;
   - photo grid should adapt cleanly on narrow screens;
   - the preview page main image should fit within the viewport and should not
     overflow horizontally;
   - navigation/download controls should wrap or stack cleanly on mobile.
3. Markup changes:
   - allowed only when needed to support styling or clearer layout;
   - do not add form fields, hidden data, new links to private object keys, data
     attributes containing IDs beyond existing route hrefs, or client scripts;
   - preserve JSX escaping of user/D1/manifest text.
4. Styling:
   - update `workers/public/styles.css` using existing CSS variables where
     reasonable;
   - add new classes only for viewer UI structures already rendered by
     `pages.tsx`;
   - do not use external fonts, external CSS, remote assets, inline scripts,
     inline event handlers, data URLs, or base64 assets;
   - do not relax CSP.
5. Login page:
   - keep the existing login form action and fields unchanged;
   - improve visual layout only;
   - do not change auth behavior, error behavior, or text reflection behavior.
6. Album list page:
   - keep album links and cover image URLs unchanged;
   - improve card layout and mobile readability;
   - do not render any new private data.
7. Album detail page:
   - keep thumbnail image sources unchanged;
   - keep thumbnail links targeting the HTML preview page;
   - keep existing conditional download links;
   - improve grid spacing and action placement.
8. Photo preview page:
   - keep the main preview image source as `/img/:albumId/preview/:photoId`;
   - keep previous/next/back/download link targets unchanged;
   - improve image sizing, navigation grouping, and mobile layout;
   - do not preload adjacent images or add JavaScript lightbox behavior.
9. Documentation:
   - update `workers/README.md` only if the UI contract or static CSS behavior
     needs a short note;
   - do not update Fable/operations docs unless the implementation unexpectedly
     changes a documented operational fact.
10. Boundaries:
    - no NAS access;
    - no PhotoPrism access;
    - no Docker or Portainer access;
    - no RAW/original/source JPEG download;
    - no new R2 objects;
    - no R2 mutation;
    - no R2 list operation;
    - no D1 query or migration changes;
    - no admin UI changes;
    - no hard delete implementation;
    - no actual R2 deletion;
    - no production action, commit, push, deploy, or handoff archival.

## Files To Inspect

- `AGENTS.md`
- `CLAUDE.md`
- `FABLE.md`
- `docs/fable/project-context.md`
- `docs/fable/current-state.md`
- `docs/fable/progress.md`
- `workers/src/templates/layout.tsx`
- `workers/src/routes/pages.tsx`
- `workers/public/styles.css`
- `workers/public/_headers`
- `workers/test/pages.test.ts`
- `workers/test/app.test.ts`
- `workers/README.md`

## Files To Edit

Edit only these files unless a test filename differs:

- `workers/public/styles.css`
- `workers/src/routes/pages.tsx` (only for CSS classes/semantic wrappers needed
  by viewer UI)
- `workers/test/pages.test.ts` (only if markup assertions require updates)
- `workers/README.md` (only if documentation needs a short note)

Do not edit:

- `workers/src/routes/admin.tsx`
- `workers/src/routes/img-routes.ts`
- `workers/src/routes/download-routes.ts`
- `workers/src/services/`
- `workers/src/middleware/`
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
- This is presentation-only. Do not change application behavior.
- Do not add JavaScript, dependencies, build tooling, external assets, remote
  stylesheets, or fonts.
- Do not change route paths, auth middleware order, D1 repositories, R2 readers,
  manifest parsing, image response headers, download response headers, or
  cache-control behavior.
- Do not render `photoprism_album_uid`, source hash, R2 keys, bucket names,
  PhotoPrism URLs/tokens, EXIF/GPS, SQL, stack traces, or exception messages.
- Do not add public R2 access, signed URLs, or direct object links.
- Preserve unrelated user changes.

## Non Goals

- No Admin UI cleanup.
- No JavaScript lightbox.
- No modal UI.
- No keyboard navigation.
- No preloading adjacent images.
- No multi-select download.
- No ZIP download.
- No thumb/preview/RAW selector.
- No RAW/original/NAS download.
- No new image derivative.
- No Docker changes.
- No D1 migration.
- No hard delete implementation.
- No actual R2 deletion.
- No deployment or live smoke.

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
2. Viewer UI surfaces changed:
   - login;
   - album list;
   - album detail;
   - photo preview page;
   - shared navigation/buttons.
3. CSS/markup summary.
4. Confirmation that route paths, auth behavior, D1 behavior, R2 behavior,
   manifest behavior, image responses, and download responses are unchanged.
5. Responsive behavior summary.
6. Privacy/security proof:
   - no NAS/PhotoPrism/Docker/Portainer access;
   - no originals/RAW/source JPEGs;
   - no R2 mutation or R2 list;
   - no sensitive data rendered/logged;
   - no public/signed R2 URLs.
7. Test changes and key assertions.
8. Verification command results.
9. Skipped checks with exact reasons.
10. Confirmation that Docker, migrations, Fable docs, operations docs,
    decisions, production state, archived handoffs, and `docs/iniwa-issues.md`
    were not changed.
11. Any blockers or Codex design questions. If none, say none.
