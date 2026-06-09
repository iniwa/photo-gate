Read `AGENTS.md`, `CLAUDE.md`, `photo-gate-design.md`, the existing decision records, archived handoffs, and this handoff file before starting.
If the requested decision would violate architecture/security constraints or requires implementation changes, stop and ask before editing.

## Goal

Research and document the Workers UI and authentication architecture required before Phase 2 and Phase 3 implementation begins.

Produce a decision record that recommends:

- the Workers UI rendering approach
- the boundary between Phase 2 viewing functionality and Phase 3 authentication/authorization
- viewer authentication and session handling
- administrator authentication
- a safe first Workers implementation slice

Do not implement Workers code in this handoff.

## Background

Phase 1 now provides a one-shot Docker sync CLI and production Docker runtime image that upload metadata-stripped share assets and `manifest.json` to a private R2 bucket.

The next design phase is the Workers viewing surface, but the following decisions remain open:

- Workers UI approach:
  - plain HTML/template responses
  - Hono + JSX
  - Workers Assets + SPA
- administrator authentication approach
- how Phase 2 can be implemented without exposing private R2 assets before Phase 3 authorization exists

The architecture requires:

- the R2 bucket remains private
- all album/photo access is authorized by Workers
- shared users never access PhotoPrism or NAS directly
- authentication alone is insufficient; album-level authorization is mandatory
- Workers do not perform image processing
- normal viewing uses only Workers, D1, and private R2

An unauthenticated Phase 2 implementation that serves real manifests or images is not acceptable.

## Required Research Sources

Use current official Cloudflare documentation as primary sources. Verify current behavior rather than relying only on memory.

At minimum research the relevant official documentation for:

- Cloudflare Workers static assets / Workers Assets
- Workers HTML responses and routing
- Hono support and deployment model on Cloudflare Workers
- D1 access from Workers
- R2 bindings and private object reads from Workers
- Workers cookies, Web Crypto, and session-related capabilities
- Cloudflare Access behavior for protecting an administrator route/application

You may use Hono official documentation for Hono-specific facts. Avoid basing the decision on blogs, tutorials, or unverified examples when primary documentation exists.

Include source links and access dates in the decision record. Keep quotations short; prefer paraphrased findings.

## Files To Inspect

- `AGENTS.md`
- `CLAUDE.md`
- `photo-gate-design.md`
- `docs/decisions/2026-06-09-use-photoprism-previews-as-sync-source.md`
- `docs/handoffs/archive/2026-06-09-phase-1-photoprism-preview-sync-core.md`
- `docs/handoffs/archive/2026-06-09-phase-1-r2-object-store.md`
- `docs/handoffs/archive/2026-06-09-phase-1-sync-once-cli.md`
- `docs/handoffs/archive/2026-06-09-phase-1-docker-runtime-image.md`
- `docker/src/photo_gate/manifest.py`
- `docker/src/photo_gate/r2_store.py`
- `docker/README.md`

## Files To Create Or Edit

- Create `docs/decisions/2026-06-09-workers-ui-and-auth-foundation.md`

Do not edit application code, `AGENTS.md`, `CLAUDE.md`, `photo-gate-design.md`, configuration, workflows, or existing decision records in this handoff.

## Questions The Decision Must Answer

### UI Architecture

- Which UI approach should the initial Workers implementation use?
- Why is it appropriate for a small private photo-sharing application?
- Does it allow album pages and photo pages to be rendered without a separate frontend deployment?
- What complexity, build tooling, and client-side JavaScript does it require?
- How should static CSS/JS assets be served?

### Phase Boundary

- What can Phase 2 safely implement before full viewer login and D1 permissions exist?
- Should Phase 2 use fixture/fake data only, a disabled-by-default route, or a minimal authorization layer?
- Which routes must not serve real R2 data until Phase 3 authorization is present?
- What is the smallest safe first Workers handoff after this decision?

### Viewer Authentication And Sessions

- Should shared viewers use Worker-owned username/password login backed by D1, Cloudflare Access, or another approach?
- How should passwords be hashed and verified within the Workers runtime?
- How should sessions be represented, stored, expired, rotated, and revoked?
- What cookie attributes are mandatory?
- How are CSRF, session fixation, brute force, and user enumeration risks handled?
- How does every manifest/image route enforce album-level authorization?

Do not recommend storing plaintext passwords, reversible passwords, bearer tokens in browser local storage, or authorization only in the UI.

### Administrator Authentication

- Should `/admin` use Cloudflare Access, Worker-owned login, or both?
- How is administrator identity distinguished from viewer identity?
- What additional authorization check is required after authentication?
- How should local development work without weakening production controls?

### R2 And Manifest Access

- How should Workers read private R2 objects through bindings?
- How are album IDs and photo IDs validated before constructing R2 keys?
- How should missing/invalid manifests and missing images fail safely?
- What cache behavior is appropriate for manifests versus immutable image assets?
- Which response headers should be set for HTML, JSON, and image responses?

### D1 Foundation

- Which minimum D1 tables are required for the recommended authentication/session/permission model?
- Which design-document tables should be retained, changed, or deferred?
- What migrations are needed for the first safe Workers implementation slice?

Do not create migration files in this handoff.

## Required Decision Record Structure

The decision record must contain:

1. Status and date
2. Context and constraints
3. Threat model
4. Options considered
5. Decision
6. Phase 2 and Phase 3 boundary
7. Recommended route/authentication flow
8. Recommended D1 model
9. R2/manifest access rules
10. Consequences and tradeoffs
11. Rejected alternatives
12. First implementation handoff recommendation
13. Open questions that still require user/Codex input
14. Official sources

Clearly distinguish:

- verified facts from official sources
- project-specific recommendations
- assumptions or unresolved questions

## Constraints

- Preserve all architecture and security invariants in `AGENTS.md`.
- Do not make the R2 bucket public.
- Do not permit unauthenticated access to real albums, manifests, thumbs, or previews.
- Do not use PhotoPrism as the viewer authentication system.
- Do not expose PhotoPrism/NAS to shared viewers.
- Do not move image processing to Workers.
- Do not implement code, install packages, initialize `workers/`, create D1 migrations, or deploy.
- Do not create or access real Cloudflare resources.
- Do not touch secrets, credentials, `.env`, Wrangler settings, or local Cloudflare state.
- Do not commit automatically.

## Non Goals

- Workers implementation
- UI mockups or visual design
- D1 migration implementation
- real user creation
- password generation
- Cloudflare Access configuration
- R2/Workers deployment
- Docker changes
- CI/CD
- cleanup/deletion design

## Verification

From the repository root:

```powershell
git diff --check
git status --short
```

Review the decision record for:

- direct answers to every required question
- no conflict with private-R2 and album-authorization invariants
- no unauthenticated real-data phase
- clear separation of verified facts, recommendations, and assumptions
- current official-source links
- a narrowly scoped recommendation for the next implementation handoff

## Expected Report

- Created/changed files
- Recommended UI architecture
- Recommended viewer authentication/session model
- Recommended administrator authentication model
- Safe Phase 2/3 boundary
- Recommended first Workers implementation handoff
- Remaining questions requiring Codex/user decision
- Verification results
