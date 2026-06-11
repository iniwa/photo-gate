# AGENTS.md

## Project

`photo-gate` is a private photo-sharing gateway. It publishes generated,
metadata-stripped share images without exposing PhotoPrism, NAS originals, or a
public R2 bucket.

Read these files before substantial work:

1. `FABLE.md` for autonomous execution rules and document precedence.
2. `docs/fable/project-context.md` for architecture and security invariants.
3. `docs/fable/current-state.md` for implemented and missing behavior.
4. `docs/fable/roadmap.md` and `docs/fable/progress.md` for the next work.
5. The active file directly under `docs/handoffs/`, when one exists.

`photo-gate-design.md` and archived handoffs are historical design context.
Some older Japanese text is mojibake; do not infer a new requirement from
corrupted text when the Fable documents provide a clear current rule.

## Non-Negotiable Invariants

- Normal viewing must use Cloudflare Workers, D1, and private R2 only.
- Shared users must never access PhotoPrism or NAS directly.
- R2 must remain private and images must be returned through Workers only.
- Never place RAW, RW2, originals, PhotoPrism data, or location-bearing
  originals in R2.
- Only re-encoded, metadata-stripped share thumbnails, previews, covers, and
  validated manifests may be published.
- Workers must not resize images, strip metadata, develop RAW files, or access
  NAS originals.
- Docker sync must not implement viewer authentication, viewer pages, or D1
  authorization.
- Every real data route must authenticate the session and authorize the album.
- A photo object may be read only after exact membership in the current
  validated manifest is confirmed.
- R2 deletion stays dry-run only until a separately reviewed safe deletion
  design is accepted.
- Secrets and real local configuration must never be committed or printed.

## Repository Boundaries

- `workers/`: TypeScript, Hono, Cloudflare Workers, D1, private R2, viewer/admin
  UI and APIs.
- `docker/`: Python 3.12 sync CLI/service, PhotoPrism preview input, pyvips
  re-encoding, metadata removal, R2 upload, manifest generation.
- `docs/`: decisions, handoffs, operations, and Fable state.

Do not add Workers-to-NAS access or Docker-to-D1/viewer dependencies.

## Engineering Rules

- Prefer existing patterns and narrowly scoped changes.
- Keep security boundaries fail-closed and errors sanitized.
- Parameterize all D1 queries and strictly validate IDs and object keys.
- Update documentation when code changes a documented contract.
- Add tests for authorization, manifest integrity, metadata removal, sync
  ordering, and destructive-operation protection.
- Preserve user changes and do not rewrite unrelated code.
- Do not use destructive Git operations or rewrite published history.

## Verification

Workers:

```powershell
Set-Location workers
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm audit
```

Docker:

```powershell
Set-Location docker
python -m pip install -e ".[dev]"
python -m pytest
python -m compileall src
```

For Docker runtime changes, also build and smoke-test the image when Docker is
available. Report every skipped or blocked check with the exact reason.

## Handoff Lifecycle

- Active handoffs live directly under `docs/handoffs/`.
- Complete an active handoff before selecting unrelated roadmap work.
- After implementation, self-review, verification, and implementation commit,
  move the completed handoff to `docs/handoffs/archive/` and commit the move
  separately.
- Do not archive blocked, incomplete, or unreviewed handoffs.

## Deployment Safety

Autonomous delivery permissions and human-approval boundaries are defined in
`docs/fable/autonomy-contract.md`. In short:

- Existing Docker delivery pipelines and an existing Portainer stack may be
  updated after successful verification.
- Workers, additive D1 migrations, and approved bindings may be deployed after
  successful verification and required initial human login.
- Destructive migrations, persistent-data deletion, R2 deletion, public-access
  changes, resource deletion, and secret disclosure require human approval.
