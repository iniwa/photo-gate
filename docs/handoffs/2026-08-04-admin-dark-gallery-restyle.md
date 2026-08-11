# Admin Dark Gallery Restyle (UI Redesign Phase 4)

Read `AGENTS.md`, this handoff, and the accepted decisions listed below before
implementation. This is a settled Worker presentation task. If implementation
would change an approval-gated behavior or cannot satisfy an acceptance item,
stop and return the exact blocker and resume condition.

## Goal

Complete the remaining Phase 4 from the accepted Dark Gallery redesign on the
current UI V3 baseline:

- mark every `/admin` page as a distinct operator area while retaining the
  shared dark-gallery tokens;
- restyle admin navigation, forms, tables, notices, pagination, and destructive
  confirmation surfaces for desktop and mobile;
- stop loading viewer-only `app.js` on admin pages;
- remove the unreferenced legacy `public/styles.css` asset and its `_headers`
  entry;
- correct the album hard-delete confirmation copy that still describes the
  retired preview-only phase even though the final POST now deletes the album.

This handoff changes SSR markup, CSS, static-asset declarations, safety copy,
and direct regression tests only. It must not change route behavior,
authentication, authorization, D1/R2 operations, POST contracts, or security
headers.

## Current Baseline

- Baseline branch: `main` at `fc35d5f` (2026-08-04 inspection).
- UI V3-1 is implemented and deployed. `Layout` links every SSR page to
  `/styles-v3.css`; production deployment is recorded in
  `docs/fable/current-state.md`.
- `docs/handoffs/2026-07-08-ui-v3-1-timeline.md` remains active only because
  its 375px/1280px browser visual QA is pending. Do not modify, archive, or
  claim completion of that handoff here.
- `styles-v3.css` still ends with a `LEGACY COMPAT (removed in Phase 4)` block
  for admin tables/notices and shared links.
- All admin pages use the shared `Layout` without an admin marker. They also
  receive `/app.js`, although the accepted ADR requires no JavaScript on admin
  pages.
- Admin tables use `class="user-table"` without a horizontal-scroll wrapper.
  Admin row forms and destructive controls have little or no semantic styling.
- `public/styles.css`, `public/styles-v2.css`, and their immutable `_headers`
  entries remain. No current SSR template references either stylesheet.
- `styles-v2.css` remains a V3 rollback asset until V3-4. This handoff removes
  only `styles.css`.
- `HardDeleteConfirmPage` currently tells album operators that submitting the
  form does not delete anything and references a future phase. That is stale:
  `POST /admin/albums/delete` removes the matching sync target, then deletes
  the D1 album row. R2 album objects are intentionally retained.

## Accepted Design Sources

- `docs/decisions/2026-07-03-ui-redesign.md`, especially sections 2.4, 2.5,
  2.6, and implementation Phase 4.
- `docs/decisions/2026-07-08-ui-v3-album-experience.md`, especially sections
  3.7, 3.8, and 4.

The Dark Gallery token values, no-external-asset rule, progressive-enhancement
policy, and all `AGENTS.md` security invariants remain authoritative.

## Exact Implementation Mechanics

### 1. Shared layout gets an explicit admin area

Extend `Layout` with an optional semantic area prop, using a narrow type such
as `area?: 'viewer' | 'admin'` and defaulting to viewer behavior.

For `area="admin"` only:

- render a visible `管理` chip next to the `photo-gate` wordmark;
- add a stable class such as `admin-main` to `<main>` so CSS can render the
  thin amber operator-area top border and scope admin rules;
- do not render `<script src="/app.js">`;
- keep the existing page title format, default chrome, site-title destination,
  absence of viewer logout controls, and all other shell behavior unchanged.

For viewer/public/default and immersive layouts:

- keep the current `/styles-v3.css` link and `/app.js` behavior;
- do not render the admin chip or admin-main class;
- keep existing header, logout, `head`, and immersive behavior unchanged.

Pass the admin area prop at every `Layout` call in all three admin route files.
Do not infer admin mode from a URL or request object inside `Layout`.

### 2. Admin markup and component classes

Keep every route, form action, method, input name/value, hidden field,
pagination URL, heading, and displayed data field unchanged except for the
specific hard-delete safety copy in section 4.

Apply a consistent class contract across the admin route files:

- admin home/navigation container and link list;
- admin page headings/back links;
- admin forms, labels, text/password inputs, and selects;
- compact row-action forms and action groups;
- primary, secondary, and danger button variants;
- empty, informational, warning, and danger notices;
- admin pagination;
- admin tables with a dedicated table class;
- a dedicated `<div>` table wrapper around every admin table so wide content
  scrolls horizontally without making the whole page overflow.

Use semantic HTML. Keep real buttons, labels, forms, tables, headings, and
links. Do not replace controls with clickable `<div>` elements. Do not add
inline `style=`, inline scripts, event attributes, `data-*` URLs, or JavaScript.

The admin home must no longer reuse the viewer login-box class. Present its six
existing destinations as an operator navigation surface without adding,
removing, or renaming routes.

### 3. CSS in `styles-v3.css`

Replace the legacy-compat admin intent with a first-class admin section. The
section must use the existing V3 tokens and include:

- an amber top border on `admin-main` and a compact `管理` chip;
- readable max-width/padding behavior without changing viewer `main` or
  immersive layout;
- surface-backed forms and tables using hairline row dividers;
- muted uppercase/tracked table headers as specified by the ADR;
- horizontally scrollable table wrappers on narrow screens;
- form controls with dark surfaces, readable text, 44px minimum touch target,
  and the existing amber `:focus-visible` treatment;
- row actions that wrap rather than overflow;
- danger outline buttons and danger-surface confirmation panels for hard
  delete and R2 cleanup confirmation flows;
- responsive behavior at the repository's existing breakpoints, including a
  usable 375px layout.

Do not change token values, timeline/aspect-ratio rules, viewer album cards,
selection UI, immersive preview, or status-page behavior. Shared utilities may
remain shared when they still have a real viewer consumer (for example the
viewer pagination container); remove or rename only rules proven stale by the
reference sweep.

### 4. Destructive-flow safety presentation and copy

Style all hard-delete confirmation pages and the R2 cleanup confirmation
preview as danger surfaces. This is visual emphasis only; do not change token
generation, phrase validation, TTLs, endpoint behavior, or mutations.

Correct the album hard-delete confirmation text to state the current facts:

- submitting the valid final form removes the matching sync-target entry
  first, then deletes the D1 album row;
- album permissions are removed through the existing D1 cascade;
- R2 album objects are not deleted and may appear as orphaned prefixes in the
  cleanup report.

Remove the stale album-only `Phase 2` / `future deletion phase` wording. Keep
the exact `DELETE ALBUM` phrase and the existing form action/fields. Do not
expose SQL, the fixed sync-target object key, raw PhotoPrism identifiers,
bucket names, credentials, or other protected details.

The R2 cleanup flow is still preview-only. Its copy must continue to state
that actual R2 deletion is disabled. Do not make any R2 deletion route live.

### 5. Static-asset cleanup and documentation

- Delete `workers/public/styles.css`.
- Remove only the `/styles.css` block from `workers/public/_headers`.
- Keep `/styles-v2.css`, `/styles-v3.css`, and `/app.js` with their existing
  immutable headers. `styles-v2.css` remains a rollback artifact until V3-4.
- Keep the dynamic security-header block byte-identical if one is present in
  the current `_headers` baseline.
- Update `workers/test/static-assets.test.ts` for the exact intended header
  file and assert that the removed asset/reference cannot return to the
  checked-in static surface.
- Update `workers/README.md` to describe the completed admin restyle, admin
  no-JS behavior, `styles.css` removal, and retained `styles-v2.css` rollback
  role. Do not edit deployment or production-state documents in this
  implementation task.

## Edge and Fallback Matrix

| Case | Required result |
|---|---|
| Public/viewer default layout | No admin chip/class; `/app.js` still loads |
| Immersive preview layout | Existing immersive markup and script behavior remain unchanged |
| Any admin page | Visible `管理` marker, admin-main class, no `/app.js` tag |
| Empty users/albums/permissions/report | Existing empty message remains readable; no fabricated table rows |
| Wide table at 375px | Table wrapper scrolls horizontally; document body does not overflow |
| Long IDs/timestamps/form controls | Content remains reachable and row actions wrap |
| JavaScript disabled | Every admin GET/POST workflow remains usable |
| Hard-delete confirmation | Danger styling plus accurate current deletion consequences |
| R2 cleanup confirmation | Danger styling but explicit preview-only/no-delete wording |
| Missing/invalid auth or data failures | Existing status, cache headers, sanitized body, and fail-closed behavior |
| Legacy asset request in source/tests/docs | No active `/styles.css` reference; `styles-v2.css` remains intentional |

## Acceptance Criteria

1. Every admin page in `admin.tsx`, `admin-hard-delete.tsx`, and
   `admin-r2-cleanup-delete.tsx` uses explicit admin layout mode.
2. Admin responses render a visible `管理` chip and admin-main marker and do
   not render `/app.js`; viewer/public responses retain current script and
   shell behavior.
3. Every admin table has the new admin table class and a horizontal-scroll
   wrapper. Empty states do not render fake rows.
4. Admin forms, controls, row actions, notices, navigation, and pagination use
   the V3 dark tokens and remain keyboard accessible with 44px targets and
   visible focus.
5. Hard-delete and R2 confirmation surfaces use danger styling. The album
   confirmation text accurately describes the already-enabled deletion path;
   R2 cleanup remains explicitly non-destructive.
6. All existing form methods, actions, field names, hidden values, exact typed
   phrases, redirects, routes, status codes, and displayed safe data remain
   unchanged.
7. `styles.css` and its `_headers` block are removed. `styles-v2.css`,
   `styles-v3.css`, and `app.js` remain with immutable headers.
8. The `LEGACY COMPAT (removed in Phase 4)` admin block no longer exists as a
   legacy placeholder. No required viewer V3 selector is removed or changed.
9. No inline style/script, external asset, CDN, webfont, dependency, build
   step, D1/R2 query, binding, migration, or Wrangler configuration is added.
10. CSP, security headers, session behavior, Cloudflare Access enforcement,
    cache policy, sanitized errors, and private-data exclusions remain intact.
11. At 375px and 1280px, admin home, users, albums, permissions, sync, ops,
    R2 cleanup, hard-delete confirmation, and R2 confirmation are usable with
    JavaScript enabled and disabled.

## Protected Regressions

The implementation and tests must preserve:

- Cloudflare Access JWT and allowlist checks before all admin routes;
- same-origin and content-type checks for mutation routes;
- exact hard-delete token, phrase, re-read, sync-target-before-D1-delete, and
  fail-closed behavior;
- actual R2 cleanup deletion remaining disabled;
- no password hash, session token, raw PhotoPrism UID, source hash, full R2
  key, bucket name, credential, SQL, stack trace, EXIF/GPS, or original/RAW
  path in admin HTML or errors;
- viewer session/album/manifest authorization and all viewer/download routes;
- dynamic security headers and current no-store/no-cache behavior.

## Files to Inspect

- `AGENTS.md`
- `docs/decisions/2026-07-03-ui-redesign.md`
- `docs/decisions/2026-07-08-ui-v3-album-experience.md`
- `workers/src/templates/layout.tsx`
- `workers/src/routes/admin.tsx`
- `workers/src/routes/admin-hard-delete.tsx`
- `workers/src/routes/admin-r2-cleanup-delete.tsx`
- `workers/public/styles-v3.css`
- `workers/public/styles-v2.css`
- `workers/public/styles.css`
- `workers/public/_headers`
- `workers/test/static-assets.test.ts`
- `workers/test/admin-routes.test.ts`
- `workers/test/admin-hard-delete.test.ts`
- `workers/test/admin-r2-cleanup-delete.test.ts`
- `workers/test/pages.test.ts`
- `workers/README.md`

## Expected Edit Set

- `workers/src/templates/layout.tsx`
- `workers/src/routes/admin.tsx`
- `workers/src/routes/admin-hard-delete.tsx`
- `workers/src/routes/admin-r2-cleanup-delete.tsx`
- `workers/public/styles-v3.css`
- `workers/public/_headers`
- `workers/public/styles.css` (delete)
- `workers/test/static-assets.test.ts`
- `workers/test/admin-routes.test.ts`
- `workers/test/admin-hard-delete.test.ts`
- `workers/test/admin-r2-cleanup-delete.test.ts`
- `workers/test/pages.test.ts` only for shared-layout regression assertions
- `workers/README.md`

Directly related test/helper files may be edited when required. The list is a
starting point, not an allowlist. Report any material expansion.

## Non-Goals and Approval Gates

- Do not implement UI V3-2, V3-3, V3-4, `app-v2.js`, View Transitions, PWA,
  icons, or `styles-v2.css` removal.
- Do not perform or record the pending V3-1 browser QA and do not archive its
  handoff.
- Do not change admin route behavior, authentication, authorization,
  repositories, D1/R2 reads or writes, manifests, downloads, or Docker code.
- Do not enable R2 deletion, publish RAW/originals, add direct R2 URLs, or
  access PhotoPrism/NAS/Portainer.
- Do not add dependencies, migrations, bindings, secrets, or external assets.
- Do not commit, push, merge, deploy, restart, mutate production, or archive a
  handoff without a separate explicit user instruction.
- Stop for approval if implementation requires changing an endpoint, request
  field, destructive behavior, authentication/exposure boundary, persistent
  data, or production/hosted configuration.

## Verification

Start with focused checks from `workers/`:

```powershell
npm ci
npx vitest run test/static-assets.test.ts test/admin-routes.test.ts test/admin-hard-delete.test.ts test/admin-r2-cleanup-delete.test.ts test/pages.test.ts
npm run lint
npm run typecheck
```

After the cohesive diff is stable, run the full Workers gate once:

```powershell
npm test
npm run build
npm audit
npm audit --omit=dev --audit-level=high
```

From the repository root:

```powershell
git diff --check
git diff HEAD -- docker/
git diff HEAD -- workers/migrations/
git diff HEAD -- .github/workflows/
git diff HEAD -- docs/decisions/
git diff HEAD -- docs/operations/
```

Run a stale-reference/static-asset sweep and report every match:

```powershell
rg -n 'styles\.css' workers/src workers/public workers/test workers/README.md
rg -n 'LEGACY COMPAT|user-table|class="login-box"' workers/src workers/public/styles-v3.css workers/test
rg -n 'styles-v2\.css' workers docs
rg -n 'Phase 2|将来の.*削除|実際の削除は行われません' workers/src/routes/admin-hard-delete.tsx workers/test/admin-hard-delete.test.ts
```

Expected sweep result: no active runtime/test/README `styles.css` reference,
no `styles-v3.css` legacy-admin placeholder, no admin `user-table` or
`login-box`, and no stale album-delete copy remains. `styles-v2.css` references
and its frozen legacy rules remain only as the intentional V3 rollback asset.
Accepted decisions, active implementation instructions, archived handoffs, and
historical progress may retain old names and must not be rewritten merely to
silence a broad documentation search.

Use browser-level verification when available:

- inspect admin home, users, albums, permissions, sync, ops, R2 cleanup,
  hard-delete confirmation, and R2 confirmation at both 375px and 1280px;
- repeat that complete page set with JavaScript enabled and disabled;
- confirm tables scroll inside their wrapper and destructive panels are
  visually distinct;
- confirm viewer login, album list/detail, and immersive preview have no admin
  marker or regression.

Use local or otherwise non-destructive fixtures for confirmation pages and do
not submit a final destructive action during visual QA. If a page or data state
cannot be produced safely, record that page/state as blocked with the exact
reason. If browser verification is unavailable, report the complete visual
criterion as blocked; do not claim visual acceptance complete from a partial
page or JavaScript-state sample.

## Required Return Evidence

Return one row or bullet per acceptance criterion with exactly one of
`passed`, `blocked`, or `unmet`, plus the concrete evidence. Also report:

- changed files and any expansion beyond the expected edit set;
- exact layout prop/class contract and admin script-suppression behavior;
- admin table/form/danger component mapping;
- the corrected album hard-delete safety copy and tests proving actual route
  mechanics were not changed;
- static assets removed and retained, including `_headers` proof;
- focused and full verification commands with results;
- stale-reference sweep results, separating active from historical matches;
- browser checks performed or exact blocker;
- dependencies, migrations, bindings, CI, Docker, D1/R2, and production state
  change summary (expected: none);
- self-review result and any remaining risk or follow-up.
