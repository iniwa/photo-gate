# UI Redesign: Dark Gallery

Date: 2026-07-03

## 1. Context

### What exists today

All UI is server-rendered HTML (Hono + JSX) styled by a single
`workers/public/styles.css` (~600 lines), with zero client-side JavaScript.
The look is a generic light Bootstrap-like theme (white surfaces, blue accent).

Viewer pages (`src/routes/pages.tsx`, `src/routes/download-routes.tsx`):

- `GET /` — login form.
- `GET /albums` — authorized album card grid with keyset pagination.
- `GET /albums/:albumId` — photo thumbnail grid; under each thumbnail two
  text links (低画質/高画質 download); below the grid a separate
  checkbox-list form for multi-select download.
- `GET /albums/:albumId/photos/:photoId` — photo preview inside a bordered
  card, with back / prev / next / download links as pill buttons.
- `POST /download/:albumId/selection` result page — plain list of links.
- Preparing (準備中) / 403 / 404 / 500 pages.

Admin pages (`src/routes/admin*.tsx`): ~10 table-and-form screens (users,
albums, permissions, ops summary, sync, R2 cleanup, hard-delete flows).

### Problems

1. Photos are not the protagonist. The white chrome, bordered cards, and
   framed preview compete with the photos instead of receding.
2. The album-detail download affordances are heavy: two text links under
   every thumbnail break the grid rhythm, and multi-select lives in a
   disconnected checkbox list at the bottom of the page that duplicates the
   photo list as text.
3. Mobile support is minimal (one 600px breakpoint) although the primary
   audience is family members viewing on smartphones.
4. Admin tables are unstyled beyond borders; usable but with no visual
   hierarchy.

### Operator decisions (2026-07-03)

These were made interactively with the operator and are fixed inputs to this
ADR:

- **Scope**: full viewer redesign; admin is restyled with the same design
  tokens but keeps its current structure and information design.
- **JS policy**: relax the historical "no client-side JavaScript" rule to
  "minimal self-hosted progressive enhancement". Every feature must remain
  fully functional with JavaScript disabled. CSP is unchanged
  (`script-src 'self'` already permits this).
- **Direction**: dark gallery — neutral dark background, photos float,
  chrome recedes.
- **Audience priority**: mobile-first (family on smartphones).
- **Grid downloads**: remove the two per-photo download links from the
  album-detail grid. Single-photo download remains available on the preview
  page and via the selection flow, so capability is preserved; only
  placement changes.
- **Accent color**: gallery amber (`#E0A458`), used sparingly on
  interactive elements only.

### Invariants preserved

- No changes to routes, endpoints, authentication, authorization, manifest
  membership checks, or download gating logic. This is a presentation-layer
  redesign.
- CSP, cookie policy, and all security headers are unchanged.
- No external assets of any kind (fonts, scripts, images, CDNs) — the CSP
  forbids them and this ADR does not weaken it.
- No new dependencies, no build step for CSS/JS.
- Fail-closed and generic error responses keep their status codes and
  non-identifying content.

---

## 2. Decisions

### 2.1 Design concept and tokens

**Concept: 展示室 (exhibition room).** Photos hang in a neutral dark room
where their own colors are the only saturated thing on screen, plus one warm
amber that reads as gallery lighting. The signature element is the
**amber selection glow**: in selection mode, choosing a photo lights its
edge like a spotlight; everything else stays monochrome.

Design tokens (CSS custom properties, single source of truth at `:root`):

```css
:root {
  color-scheme: dark;
  /* room */
  --bg: #131316;            /* neutral dark, no color cast on photos */
  --surface: #1C1C21;       /* cards, bars, inputs */
  --surface-raised: #232329;/* hover rows, menus */
  --hairline: #2A2A31;      /* borders, dividers */
  --scrim: rgba(19, 19, 22, 0.72);  /* overlay bars on photos */
  /* ink */
  --text: #ECECEE;          /* ~15:1 on --bg */
  --text-muted: #9C9CA6;    /* ~6.9:1 on --bg */
  /* gallery light */
  --amber: #E0A458;         /* ~8.6:1 on --bg; buttons, links, selection */
  --amber-strong: #EDB878;  /* hover */
  --amber-glow: rgba(224, 164, 88, 0.35);  /* focus ring, selection glow */
  --on-amber: #1A1408;      /* text on amber fills */
  /* status */
  --danger: #E06858;
  --danger-surface: #2A1B18;
  --warning-surface: #2A2418;
  --warning-text: #E0C58A;
  /* shape */
  --radius: 10px;
  --radius-lg: 16px;
}
```

Rules of use:

- Amber appears only on interactive or selected things: buttons, links,
  checked state, focus ring. Never on headings, counts, or decoration.
- Photos are never framed with visible borders; they separate from the
  background by their own luminance plus a subtle shadow on hover
  (desktop only).
- Status colors follow the same restraint: error text uses `--danger`,
  warnings use the warning pair; nothing else is colored.

Typography — system stack only (Japanese webfonts are megabytes and CSP
forbids external fonts):

```css
font-family: system-ui, -apple-system, "Segoe UI", "Hiragino Sans",
  "Hiragino Kaku Gothic ProN", "Yu Gothic UI", Meiryo, sans-serif;
```

- Wordmark `photo-gate`: lowercase, `font-weight: 600`,
  `letter-spacing: 0.06em`, small (1rem) — a quiet label, not a logo.
- Page/album titles: 1.375rem mobile / 1.625rem desktop, weight 650.
- Counts and positions (`124枚`, `3 / 124`): `--text-muted`,
  `font-variant-numeric: tabular-nums`.
- Body 16px base, line-height 1.6. Never letter-space Japanese body text.

Layout system:

- Mobile-first. Breakpoints: `min-width: 641px` (tablet),
  `min-width: 1025px` (desktop). Content max-width 1200px except the
  preview page (full viewport).
- Tap targets ≥ 44×44px on all interactive elements.
- `<meta name="theme-color" content="#131316">` added to the layout head.

### 2.2 JavaScript policy

**Decided: one self-hosted script, progressive enhancement only.**

- Single file `workers/public/app.js`, vanilla ES2020, no dependencies, no
  build step, target < 5 KB unminified. Loaded with `defer` from the layout.
- Everything it does must be an enhancement of an already-working HTML
  mechanism. Concretely permitted in this redesign:
  - preview page: ArrowLeft/ArrowRight keyboard navigation and touch swipe
    navigation, by programmatically following the existing prev/next links;
  - album detail: live selected-count in the selection bar, and
    select-all / clear buttons (buttons themselves are inserted by JS so
    the no-JS page never shows dead controls).
- Forbidden: fetch/XHR of any kind, DOM-built URLs beyond reading existing
  `href` attributes, rendering data, touching cookies or storage, inline
  scripts or handlers (CSP would block them anyway).
- With JS disabled the pages are complete: navigation via links, selection
  via native checkboxes and submit.

### 2.3 Viewer screens

#### Layout shell

`Layout` gains a `chrome` variant: `'default'` renders the header
(wordmark left, logout right, hairline bottom border, `--bg` background —
no separate header surface); `'immersive'` renders no header (preview
page). Login and error pages use `'default'` without the logout button, as
today.

#### Login (`GET /`)

Centered column on `--bg` (no card box): wordmark large (1.75rem) with the
amber underline accent removed — instead a single amber dot after the
wordmark as the only color on screen. Fields as `--surface` inputs with
hairline borders, amber submit button (`--on-amber` text). Error message in
`--danger` on `--danger-surface`. Everything within one mobile viewport
height.

```
            photo-gate·
   ┌───────────────────────────┐
   │ ユーザーID                │
   ├───────────────────────────┤
   │ パスワード                │
   └───────────────────────────┘
   [        ログイン          ]   ← amber
```

#### Album list (`GET /albums`)

Cover-led cards. Mobile: single column, cover 16:10, edge-to-edge minus
1rem gutters. Tablet: 2 columns; desktop: 3. Title (and nothing else)
overlays the cover bottom on a bottom-up gradient scrim
(`transparent → rgba(0,0,0,0.62)`), white text, single line ellipsis. No
card border; radius `--radius-lg`; whole card is the link.

Pagination keeps the keyset `次へ` link as a full-width quiet button
(hairline border, `--text`) after the grid. Empty state: centered
`閲覧できるアルバムがありません` in `--text-muted` with the wordmark dot
above it.

```
┌──────────────────────────┐
│                          │
│        cover photo       │
│                          │
│ ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ │  ← gradient scrim
│ 運動会 2026              │
└──────────────────────────┘
```

#### Album detail (`GET /albums/:albumId`)

Header row: back link (`← アルバム`, quiet), title, `N枚` in muted
tabular figures.

Photo grid = contact sheet: square thumbnails, 2px gaps, no radius inside
the grid (the grid block itself is clipped at `--radius-lg`). Columns:
3 (mobile) / 5 (tablet) / 6 (desktop). Captions are removed from the grid
(titles remain as `alt` and on the preview page). Per-photo download links
are removed (operator decision; capability preserved elsewhere).

**Selection = the grid itself.** When `downloadEnabled`, the grid is
wrapped in the existing `POST /download/:albumId/selection` form. Each cell
contains the photo link plus a native `<input type="checkbox"
name="photoId">` rendered as a 28px circle in the cell's top-right corner
(always visible, scrim-backed for contrast). Checked state: amber-filled
circle with `--on-amber` check, and the cell gets an inset amber glow ring
(`box-shadow: inset 0 0 0 3px var(--amber)`) plus slight image dim — the
signature moment.

A selection bar is fixed to the bottom: variant `<select>`
(低画質 (WebP) / 高画質 (JPEG)) and the submit button
`ダウンロードリンクを表示` (amber). Visibility:

```css
.selection-form .selection-bar { display: none; }
.selection-form:has(input[name="photoId"]:checked) .selection-bar {
  display: flex;
}
```

Browsers without `:has()` degrade to an always-visible bar (functional).
JS enhancement adds `N枚選択中` and 全選択/解除 buttons to the bar.
When `downloadEnabled` is false, the grid renders without form, checkboxes,
or bar.

```
← アルバム   運動会 2026        124枚
┌────┬────┬────┐
│ ▣  │ ▢  │ ▢  │   ▣ = checked corner circle,
├────┼────┼────┤       amber ring around cell
│ ▢  │ ▢  │ ▢  │
└────┴────┴────┘
▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁
 2枚選択中 [高画質 ▾] [リンクを表示]   ← fixed bottom bar
```

#### Photo preview (`GET /albums/:albumId/photos/:photoId`)

Immersive: `chrome='immersive'`, full-viewport `--bg` (near-black), photo
centered with `object-fit: contain`, no frame, no card.

- Top bar (scrim, fades nothing — always visible, small): back link
  `← 運動会 2026` on the left, `3 / 124` tabular on the right. Photo title
  below the bar in one muted line (mobile) or inline (desktop).
- Bottom bar (scrim): `前へ` / `次へ` as large equal-width tap targets
  (min 44px tall). At the ends of the album the missing side renders as a
  disabled muted label, keeping the layout stable.
- Download (when enabled): a native `<details>` menu labeled `保存` in the
  bottom bar, opening upward with the two existing links
  (低画質 (WebP) / 高画質 (JPEG)). No JS involved.
- `<link rel="prefetch">` for the next photo's preview image in `<head>`
  (plain HTML, no JS).
- JS enhancement: ArrowLeft/ArrowRight and horizontal swipe follow the
  prev/next links.

```
▒ ← 運動会 2026            3 / 124 ▒
│                                  │
│            (photo)               │
│                                  │
▒ [  前へ  ] [ 保存 ▴ ] [  次へ  ] ▒
```

#### Selection result (`POST /download/:albumId/selection`)

Same data, presented as a list of rows on `--surface` (thumbnail-free by
design — this page must not read photo objects): each row is the photo
title with a trailing amber download icon-label, full-row link with
`download` attribute. Header states `N枚 ・ 高画質 (JPEG)` so the chosen
variant is visible. Back link to the album on top.

#### Preparing / 403 / 404 / 500

One shared quiet pattern on `--bg`: muted oversized status glyph (the
status code, or `準備中`), one-line explanation, one amber link back
(`アルバム一覧へ戻る` / `ログインへ`). Copy unchanged except the 404 page,
which is currently English and becomes Japanese for consistency
(`ページが見つかりません`).

### 2.4 Admin restyle

Admin keeps its structure, routes, forms, and information design. Changes
are token-level only:

- Same dark tokens and typography; admin pages get a thin amber top border
  on `<main>` as an "operator area" marker plus an `管理` chip next to the
  wordmark, so admin is never mistaken for the viewer.
- Tables: hairline row dividers instead of full cell borders, muted
  uppercase-tracking headers, `--surface` background, horizontal scroll
  wrapper on mobile (`overflow-x: auto` on a table container).
- Forms and buttons: shared components with the viewer. Destructive flows
  (hard delete, R2 cleanup) use `--danger` outline buttons and
  `--danger-surface` confirmation panels; the existing typed-confirmation
  UX is unchanged.
- No JS on admin pages.

### 2.5 Assets, caching, and delivery

`_headers` serves static assets as `public, max-age=31536000, immutable`,
so the redesigned CSS must not reuse the `/styles.css` URL:

- New files `workers/public/styles-v2.css` and `workers/public/app.js`;
  layout references `/styles-v2.css`. `_headers` gains matching entries
  (same directives) for both.
- `/styles.css` is deleted in the final phase once nothing references it
  (its immutable cache makes stale copies harmless).
- Future breaking CSS/JS changes bump the filename version.

CSP remains byte-identical. `app.js` is same-origin static, already
allowed by `script-src 'self'`.

### 2.6 Accessibility and quality floor

- Contrast: all token pairs listed in §2.1 meet WCAG AA (amber on bg
  ≈ 8.6:1, muted text ≈ 6.9:1, text ≈ 15:1); scrim overlays must keep
  overlay text ≥ 4.5:1 against the darkest expected photo content by
  using the scrim, never bare photo backgrounds.
- Focus: `:focus-visible` amber ring (`0 0 0 3px var(--amber-glow)`)
  on every interactive element; selection checkboxes remain real focusable
  inputs.
- Motion: hover lifts and bar transitions are ≤ 200ms and wrapped in
  `@media (prefers-reduced-motion: no-preference)`.
- Semantics: grid checkboxes get `aria-label` with the photo title
  (`「{title}」を選択`); prev/next links keep text labels; `<details>`
  download menu is natively accessible; `role="alert"` stays on the login
  error.
- `loading="lazy"` retained on grid thumbnails; explicit `aspect-ratio`
  on covers and cells prevents layout shift.

---

## 3. Non-goals

- No route, endpoint, parameter, or status-code changes.
- No dark/light theme toggle — dark only (photos are the content; the
  admin inherits it for consistency).
- No ZIP download, no RAW/original exposure, no new download variants.
- No album cover metadata, photo counts on the album list, or other data
  not already available to each page.
- No client-side routing, hydration, or framework adoption.
- No custom/self-hosted webfonts.

---

## 4. Implementation phases

Each phase is one Codex handoff, independently shippable, tests updated in
the same phase.

1. **Foundation** — token system and shell: `styles-v2.css` with tokens,
   reset, header/layout, `chrome` variant in `Layout`, `theme-color`,
   `_headers` entries; restyled login, preparing, 403/404/500 pages
   (404 copy to Japanese). Old pages keep working against the new
   stylesheet's legacy class names or are updated in place — whichever the
   handoff scopes, the site must never mix stylesheets.
2. **Albums** — album list cover cards; album detail contact-sheet grid;
   selection-as-grid form with corner checkboxes and bottom bar
   (`:has()`-driven, no JS); removal of per-photo grid download links;
   selection result page restyle.
3. **Preview + JS** — immersive preview page, `<details>` download menu,
   prefetch link, and `app.js` (keyboard + swipe on preview; selection
   count and select-all/clear on album detail).
4. **Admin restyle** — token-level admin styling per §2.4; delete
   `/styles.css` once unreferenced.

## 5. Verification expectations

Per phase, and cumulatively at the end:

- `npm test` and typecheck in `workers/` (template/route tests updated for
  new markup; security-relevant assertions — headers, gating, membership —
  must not be weakened).
- Manual smoke via `wrangler dev`: every viewer page at 375px and 1280px
  widths; explicit no-JS pass (JS disabled) confirming login, browsing,
  single download, multi-select download all work.
- Header assertions: CSP byte-identical; `Cache-Control` semantics on
  pages unchanged; new static assets carry the `_headers` directives.
- Keyboard-only pass: tab order, focus visibility, Enter-to-activate on
  all interactive elements; preview arrow keys (JS on).

## 6. Open questions for future ADRs

- Whether the preview page should gain photo preloading beyond the single
  `prefetch` (e.g., prev photo as well) after observing real-world feel.
- Whether the album list should eventually show photo counts (requires a
  cheap count source; out of scope here).
