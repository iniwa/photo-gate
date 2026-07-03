Read AGENTS.md, CLAUDE.md, and this handoff file before implementation.
If implementation would violate constraints or require files outside this
handoff, stop and ask before editing.

## Goal

Implement Viewer UI Cleanup Phase 2 with a narrow focus on photo browsing
usability, while preserving the existing server-rendered, no-JavaScript, private
R2 viewer architecture.

This pass should make the authenticated viewer photo experience easier to use:

- album detail page should more clearly present the photo grid and available
  actions;
- photo preview page should clearly show the current photo title, current
  position within the album, back/previous/next/download controls, and fit well
  on mobile and desktop;
- shared viewer action styling should be refined enough for these flows.

This is presentation-only. Do not change route behavior, authorization,
manifest validation, image delivery, download delivery, persistence, or any
security boundary.

## Background

Level 3 is complete. The viewer currently supports:

- login;
- album list;
- album detail thumbnail grid;
- authenticated photo preview page at `GET /albums/:albumId/photos/:photoId`;
- preview JPEG download links when `download_enabled = 1`;
- Viewer UI Cleanup Phase 1, which improved basic spacing and responsive layout.

The operator wants UI improvements handled separately from feature/security
work. RAW/original download and 3-kind download selection are explicitly
deferred and require a separate ADR before implementation.

Current security model to preserve:

- Viewer pages use Cloudflare Workers, D1, validated manifests, and private R2
  only.
- Workers do not access NAS, PhotoPrism, Docker, or Portainer.
- Photo object reads happen only through existing `/img` and `/download` routes,
  after session, album permission, and exact manifest membership checks.
- The photo preview HTML page may read only the current album manifest; it must
  not read preview image objects directly.
- R2 remains private. Do not add signed URLs or direct object links.

## Acceptance Criteria

1. Photo preview page UX:
   - render the current photo title as visible page content, JSX-escaped;
   - render a position indicator based on current manifest order, for example
     `2 / 10`, without exposing photo IDs or R2 keys;
   - group Back to album, Previous, Next, and Download controls in a clear
     action area;
   - keep previous/next link targets exactly as
     `/albums/:albumId/photos/:photoId`;
   - keep the main image source exactly `/img/:albumId/preview/:photoId`;
   - keep the download link target exactly
     `/download/:albumId/preview/:photoId` and render it only when
     `download_enabled = 1`;
   - do not render unavailable previous/next controls as links. Plain disabled
     text/spans are acceptable if useful, but must not contain private IDs.
2. Album detail page UX:
   - improve the page header and grid grouping for the thumbnail view;
   - show a safe photo count derived from the validated manifest length;
   - optionally show photo titles/captions below thumbnails if it improves
     usability, but only from already validated manifest entries and with JSX
     escaping;
   - keep thumbnail image sources as `/img/:albumId/thumb/:photoId`;
   - keep thumbnail links targeting the HTML photo preview page;
   - keep existing conditional preview download links and their hrefs.
3. Responsive layout:
   - photo preview must not overflow horizontally on narrow screens;
   - action controls must wrap or stack cleanly on mobile;
   - photo grid tiles and optional captions must remain readable on mobile;
   - desktop layout should not become wider than the existing `main` max width.
4. No behavior changes:
   - no new routes;
   - no route path changes;
   - no auth middleware order changes;
   - no D1 query or repository changes;
   - no R2 key format changes;
   - no manifest schema or parser changes;
   - no image response or download response header changes;
   - no cache-control changes.
5. No JavaScript or external assets:
   - do not add client-side JavaScript, inline scripts, event handlers, remote
     fonts, remote CSS, data URLs, base64 assets, or new dependencies;
   - do not relax CSP or `_headers`.
6. Privacy/security:
   - do not render `photoprism_album_uid`, source hash, R2 object keys, bucket
     names, PhotoPrism URLs/tokens, EXIF/GPS/takenAt/dimensions, SQL, stack
     traces, exception messages, session/user IDs, or Cloudflare Access claims;
   - do not add public R2 access, signed URLs, R2 list, R2 put/delete, or
     direct object links.
7. Tests:
   - update or add route tests proving the preview page renders the safe photo
     title and position indicator;
   - prove the title is escaped and raw HTML is not rendered;
   - prove previous/next/download hrefs remain unchanged;
   - prove download controls are still conditional on `download_enabled`;
   - prove the preview page still does not directly read the preview object;
   - update album detail tests if captions/photo counts/header markup are added.
8. Documentation:
   - update `workers/README.md` only if the viewer UI contract needs a short
     note;
   - do not update Fable, operations, decisions, archived handoffs, or
     `docs/iniwa-issues.md` in this implementation handoff.

## Files To Inspect

- `AGENTS.md`
- `CLAUDE.md`
- `FABLE.md`
- `docs/fable/project-context.md`
- `docs/fable/current-state.md`
- `docs/fable/progress.md`
- `docs/handoffs/archive/2026-06-30-viewer-ui-cleanup-phase-1.md`
- `docs/handoffs/archive/2026-06-30-viewer-preview-page.md`
- `docs/handoffs/archive/2026-06-30-viewer-preview-download.md`
- `workers/src/templates/layout.tsx`
- `workers/src/routes/pages.tsx`
- `workers/public/styles.css`
- `workers/public/_headers`
- `workers/test/pages.test.ts`
- `workers/test/private-object-response.test.ts`
- `workers/README.md`

## Files To Edit

Edit only these files unless a test filename differs:

- `workers/src/routes/pages.tsx`
- `workers/public/styles.css`
- `workers/test/pages.test.ts`
- `workers/README.md` only if a short viewer UI note is needed

Do not edit:

- `workers/src/routes/admin.tsx`
- `workers/src/routes/admin-hard-delete.tsx`
- `workers/src/routes/admin-r2-cleanup-delete.tsx`
- `workers/src/routes/img-routes.ts`
- `workers/src/routes/download-routes.ts`
- `workers/src/services/`
- `workers/src/middleware/`
- `workers/src/templates/layout.tsx` unless you stop and explain why first
- `workers/public/_headers`
- `workers/migrations/`
- `docker/`
- `.github/`
- `docs/fable/`
- `docs/operations/`
- `docs/decisions/`
- `docs/handoffs/archive/`
- `docs/iniwa-issues.md`

## Constraints

- Preserve every non-negotiable invariant in `AGENTS.md`.
- This is presentation-only. Do not change application behavior.
- Keep the no-JavaScript SSR model.
- Use existing Hono JSX escaping; do not manually concatenate HTML strings.
- Keep IDs only in existing safe route href/src values. Do not add data
  attributes carrying IDs.
- Do not show photo IDs as visible text.
- Do not show R2 keys, object prefixes, bucket names, source hashes, PhotoPrism
  data, EXIF/GPS/takenAt/dimensions, or internal errors.
- Do not add dependencies, build tooling, external assets, or remote resources.
- Preserve unrelated user changes.
- Do not commit, push, deploy, mutate production, or archive this handoff.

## Non Goals

- No Admin UI cleanup.
- No login/auth behavior change.
- No JavaScript lightbox.
- No modal UI.
- No keyboard shortcut support.
- No preloading adjacent images.
- No bulk selection.
- No ZIP download.
- No thumb/preview/RAW selector.
- No RAW/original/NAS/PhotoPrism download.
- No new derivative image generation.
- No Docker changes.
- No D1 migration or repository change.
- No hard delete changes.
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
git diff HEAD -- docs/handoffs/archive/
git status --short
```

Do not run Docker tests unless Docker files are changed by mistake.

## Expected Report

Report in Japanese.

Include:

1. Changed files.
2. Viewer UI surfaces changed:
   - album detail page;
   - photo preview page;
   - shared viewer controls/styles.
3. CSS/markup summary.
4. Confirmation that route paths, auth behavior, D1 behavior, R2 behavior,
   manifest behavior, image responses, download responses, and cache-control are
   unchanged.
5. Responsive behavior summary.
6. Privacy/security proof:
   - no NAS/PhotoPrism/Docker/Portainer access;
   - no originals/RAW/source JPEGs;
   - no R2 mutation/list or direct object links;
   - no sensitive data rendered/logged;
   - no public/signed R2 URLs.
7. Test changes and key assertions.
8. Verification command results.
9. Skipped checks with exact reasons.
10. Confirmation that Docker, migrations, Fable docs, operations docs,
    decisions, archived handoffs, production state, and `docs/iniwa-issues.md`
    were not changed.
11. Any blockers or Codex design questions. If none, say none.
