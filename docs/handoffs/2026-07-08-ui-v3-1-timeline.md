# UI V3-1 Timeline Implementation

Role: one native `bounded_implementer` acting as the sole writer for this
cohesive outcome.

## Pilot status (2026-08-03)

Implementation and automated verification are complete in the working tree;
independent review returned Go with no material findings. The change is not
committed, pushed, deployed, or production-verified. Browser visual QA at
375/1280px with JavaScript enabled and disabled remains a separate pending
task. Resume at standalone browser QA and later explicitly authorized delivery,
not reimplementation. The acceptance criteria below preserve the original
baseline and scope.

Read `AGENTS.md`, the two accepted UI decisions named below, and this handoff
before implementation. Start the configured role without inherited
conversation history and without an explicit model or effort override. Named
files are starting points, not a strict allowlist. Return control before an
approval gate, an unresolved material decision, or a required change that
would violate the explicit scope below.

The primary session owns integration and does not make routine edits on the
delegated source surface. Send minor in-scope corrections back to the same
implementer. Record the actual role, model, effort, retries, corrections, and
token fields when exposed; use `unknown` rather than estimates.

## Goal

Implement UI v3 phase V3-1 for the viewer album experience:

- switch the viewer shell from `styles-v2.css` to `styles-v3.css`;
- render album detail pages as date-grouped timeline sections;
- replace the square contact sheet with a non-cropped justified grid based on
  manifest `width` / `height`;
- output `width` and `height` attributes for album-detail thumbnail images;
- add a safe empty-album state;
- add pure date/aspect-ratio helpers and focused tests.

This is a viewer presentation and SSR markup phase only. It must not change any
route, authorization, download, D1, R2, manifest-read, image-response, or
production-secret behavior.

## Background

Accepted ADR: `docs/decisions/2026-07-08-ui-v3-album-experience.md`.

At handoff authoring, V3-1 was not implemented in the current baseline: `Layout` still links
`/styles-v2.css`, album detail still uses the square `.contact-sheet`,
`_headers` has no `/styles-v3.css` entry, and there is no timeline, aspect
class, or empty-album implementation.

UI v3 keeps the existing Dark Gallery token system and progressive enhancement
policy, but changes the album-detail information architecture from a square
file-list grid into a family photo timeline. Manifest entries already contain
`takenAt`, `width`, and `height`; V3-1 may use those fields because the
manifest is already the authorized rendering input for the album detail page.

The ADR also recommends completing the old UI redesign Phase 4 admin restyle
and legacy `styles.css` removal before or alongside UI v3 so stale style
references do not linger. Do not implement admin restyle in this handoff. Do
record in the report whether V3-1 leaves any `styles.css` / `styles-v2.css`
dependency that should be handled by the separate admin-restyle handoff.

## Acceptance Criteria

1. `Layout` links all SSR pages to `/styles-v3.css`. Because the shell is shared,
   admin pages also receive the new stylesheet URL, but V3-1 must not change
   admin markup, behavior, or information design. Create `styles-v3.css` from
   the complete `styles-v2.css` baseline and preserve every class needed by
   existing viewer and admin pages. Keep both `styles-v2.css` and `styles.css`
   unchanged for rollback and the separate admin-restyle phase.
2. `_headers` contains an immutable static-asset entry for `/styles-v3.css`.
   Existing security headers for dynamic pages must remain byte-identical.
3. Album detail pages group photos by the local date encoded in each
   manifest `takenAt` string, preserving manifest order. Do not sort. If the
   same date appears in multiple separated runs, render the heading again rather
   than reordering.
4. Date headings render as Japanese month/day/week labels. Include the year
   only when the album spans more than one year. Invalid or missing `takenAt`
   must not throw; group those photos under a stable fallback heading such as
   `日付不明`.
5. Album detail thumbnails use the existing `/img/:albumId/thumb/:photoId`
   route and preview-page links. No direct R2 URL, signed URL, sourceHash,
   PhotoPrism UID, EXIF/GPS, or RAW/original path is rendered.
6. The square `.contact-sheet` layout is replaced on album detail with timeline
   sections and a non-cropped justified grid. Use CSS only for layout; do not
   add JavaScript.
7. Do not use inline `style=` attributes. `style-src 'self'` must keep working.
   For valid positive dimensions, calculate `width / height`, clamp to
   `0.5..2.4`, round to the nearest `0.1`, and map to the 20 static classes
   `ar-050`, `ar-060`, ... `ar-240`. Use `ar-100` for invalid dimensions.
   Define all 20 classes in CSS. Thumbnail content must use a non-cropping
   rule such as `object-fit: contain`.
8. Each album-detail thumbnail `<img>` includes the exact numeric `width` and
   `height` attributes from the manifest when valid. Invalid dimensions must
   not throw; use `ar-100` and omit invalid attributes. The manifest validator
   normally rejects invalid dimensions before rendering, so cover this
   fallback directly in pure-helper tests as defensive behavior.
9. `download_enabled=1` keeps the existing selection POST flow: selected
   checkboxes still submit `photoId` values to `/download/:albumId/selection`,
   variant selection remains `thumb|preview`, and no RAW/original option appears.
10. `download_enabled=0` renders no selection form and no `/download/` links,
    as today.
11. Empty manifest photos render a clear empty state (`写真がまだありません`) and
    an `/albums` back link instead of an empty grid.
12. Album list and photo preview pages continue to render with the new CSS link
    and compatible class names. Do not implement V3-2 preview changes here
    (`takenAt` display on preview, prefetch prev+next, image attributes on
    preview) except where strictly needed for CSS compatibility.
13. CSP, session cookie attributes, auth redirects, no-store/no-cache behavior,
    and security headers must not be weakened.
14. Put date grouping/formatting and aspect-class calculation in the pure,
    directly testable module
    `workers/src/services/viewer-photo-presentation.ts`. It must not read R2,
    D1, request state, environment bindings, or wall-clock state. Use the local
    date and time text encoded in `takenAt`; do not perform host-time-zone
    conversion.
15. Add a focused static-asset test that reads `public/_headers` and proves the
    `/styles-v3.css` immutable entry exists while the dynamic security-header
    block remains unchanged.

## Files To Inspect

- `docs/decisions/2026-07-08-ui-v3-album-experience.md`
- `docs/decisions/2026-07-03-ui-redesign.md`
- `workers/src/templates/layout.tsx`
- `workers/src/routes/pages.tsx`
- `workers/src/services/private-album-object-service.ts`
- `workers/src/types/manifest.ts` or the current manifest type location
- `workers/public/styles-v2.css`
- `workers/public/_headers`
- `workers/test/pages.test.ts`
- `workers/test/app.test.ts` for current dynamic security-header assertions

## Files To Edit

Expected edit set:

- `workers/src/templates/layout.tsx`
- `workers/src/routes/pages.tsx`
- `workers/public/styles-v3.css` (new, based on `styles-v2.css`)
- `workers/public/_headers`
- `workers/test/pages.test.ts`
- `workers/src/services/viewer-photo-presentation.ts` (new pure helpers)
- `workers/test/viewer-photo-presentation.test.ts` (new focused tests)
- `workers/test/static-assets.test.ts` (new `_headers` assertion)
- `workers/README.md`

Do not edit admin route behavior, D1 repositories, image/download routes,
Docker code, migrations, CI workflows, secrets, or deployment docs in this
handoff.

## Constraints

- Preserve all AGENTS.md non-negotiable invariants.
- Workers must not access NAS, PhotoPrism, RAW/originals, or source metadata.
- Every real data route must keep its existing session and album authorization
  chain.
- A photo object may still be read only after exact current manifest
  membership. This handoff should not read photo objects directly from the
  album-detail page; it only emits existing `/img/.../thumb/...` URLs.
- No new npm dependency, framework, build step, external asset, webfont, CDN,
  inline script, or inline style.
- Do not modify CSP or dynamic security-header policy.
- JavaScript is out of scope for V3-1.
- Keep helpers small, explicit, pure, and directly tested; do not perform a
  broad route, template, or stylesheet refactor.
- Do not delete or modify `styles-v2.css` or `styles.css`. The new
  `styles-v3.css` must retain the existing shared class rules before adding the
  V3-1 timeline rules.

## Non Goals

- V3-2 preview enhancements: preview `takenAt` display, prev+next prefetch,
  preview image `width`/`height`/`fetchpriority`/`decoding`.
- V3-3 selection mode v2 and `app-v2.js`.
- V3-4 View Transitions, PWA-lite, icons, manifest, `app.js` removal.
- Admin restyle / legacy `styles.css` removal. This remains a recommended
  separate handoff before or near V3 work, but not part of V3-1.
- Pagination for large albums.
- RAW/original download.
- R2 cleanup deletion or any destructive operation.
- Production deploy, push, handoff archival, or Portainer changes.

## Verification

Run from `workers/`:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm audit --omit=dev --audit-level=high
```

Also run from repository root:

```powershell
git diff --check
git diff HEAD -- docker/
git diff HEAD -- workers/migrations/
git diff HEAD -- docs/operations/
git diff HEAD -- docs/decisions/
```

Expected focused tests include:

- date grouping preserves manifest order and repeats a date heading when a
  date reappears after another date;
- invalid/missing `takenAt` uses the fallback heading without throwing;
- mixed-year album includes years in headings, single-year album omits years;
- aspect-ratio classes are quantized/clamped and no `style=` appears;
- all 20 aspect classes and the `ar-100` invalid fallback are covered;
- thumbnail `width`/`height` attributes are emitted for valid dimensions;
- empty album renders the empty state and back link;
- `_headers` contains the immutable `/styles-v3.css` entry without changing
  the dynamic security-header block;
- download-enabled selection form still posts the same fields and contains no
  RAW/original option;
- security-sensitive existing assertions for auth, manifest membership,
  no direct preview object read on preview page, and no sensitive data still
  pass.

If local browser/manual checks are feasible, inspect `/albums/:albumId` at
375px and 1280px with JavaScript enabled and disabled. If not feasible, report
that explicitly.

## Expected Report

Report:

- changed files;
- summary of timeline grouping, aspect-ratio quantization, `styles-v3.css`
  migration, and empty-state behavior;
- proof that routes/auth/D1/R2/download behavior did not change;
- tests added and verification results;
- any skipped checks and exact reason;
- whether any `styles.css` / `styles-v2.css` dependency remains and whether the
  separate admin-restyle handoff should run next.
