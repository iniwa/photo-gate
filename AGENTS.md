# AGENTS.md

## Purpose

This file is the Codex-side source of design intent, handoff rules, and review
criteria for `photo-gate`. `CLAUDE.md` defines Claude Code execution rules.

The normal workflow is:

1. Codex investigates, decides scope, and writes a concrete handoff.
2. Claude Code implements and verifies only that handoff.
3. Codex reviews the diff and results, resolves design questions, and decides
   whether the work is complete.

Codex may directly make small, documentation-only, or design-sensitive changes
when a separate implementation handoff would add no value.

## Project

`photo-gate` is a private photo-sharing gateway. It publishes generated,
metadata-stripped share images without exposing PhotoPrism, NAS originals, or a
public R2 bucket.

- Repository: `D:/Git/photo-gate`
- Development host: Windows 11 Home Sub PC
- Runtime targets: Cloudflare Workers and Raspberry Pi 4 Docker (`linux/arm64`)
- Canonical repository: Gitea
- Mirror and CI/CD: GitHub
- Docker runtime management: existing Portainer stack

Before substantial work, Codex reads:

1. This file and `FABLE.md`.
2. `docs/fable/project-context.md` and `docs/fable/current-state.md`.
3. `docs/fable/roadmap.md` and `docs/fable/progress.md`.
4. `docs/operations/operator-actions.md`.
5. The active file directly under `docs/handoffs/`, when one exists.

`photo-gate-design.md` and archived handoffs are historical context. Some older
Japanese text is mojibake; do not infer a new requirement from corrupted text
when current Fable documents provide a clear rule.

## Role Split

Codex owns:

- requirement clarification, architecture, risk assessment, and success criteria;
- selection and scoping of the next implementation task;
- creation of concrete Claude Code handoffs;
- review of Claude Code reports and diffs against security invariants;
- decisions about follow-up work, commits, delivery, and handoff archival;
- durable documentation updates when decisions or project state change.

Claude Code owns:

- implementation and verification of an active Codex handoff;
- staying within the handoff's files, constraints, and non-goals;
- stopping on ambiguity, design conflict, unsafe operations, or required
  out-of-scope edits;
- reporting changed files, summary, verification, blocked checks, and design
  questions to Codex.

Claude Code must not independently select roadmap work. It must not commit,
push, deploy, mutate production, or archive a handoff unless the active handoff
explicitly authorizes that action.

## Claude Code Model Orchestration

Codex must not invoke Claude Code through `claude -p`. Codex writes the active
handoff file, and the operator passes it to Claude Code manually.

Claude Code should normally run with Opus as the primary coordinator. Opus reads
`AGENTS.md`, `CLAUDE.md`, the active handoff, and the security invariants; plans;
and reviews subagent output before reporting. Sonnet subagents may take scoped
implementation, mechanical edits, and verification when the handoff's goal,
files, constraints, and non-goals are already clear. Subagents must not change
design intent, expand scope, touch secrets, weaken authentication/authorization
or any Non-Negotiable Invariant, or make architectural decisions — those return
to Opus/Codex. If the model split is unavailable, continue with the available
model and report that limitation.

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

## Handoff Workflow

Codex creates active handoffs as `docs/handoffs/YYYY-MM-DD-<short-task>.md`.
There should normally be one active implementation handoff at a time.

Every handoff must contain:

```md
Read AGENTS.md, CLAUDE.md, and this handoff file before implementation.
If implementation would violate constraints or require files outside this
handoff, stop and ask before editing.

## Goal
## Background
## Acceptance Criteria
## Files To Inspect
## Files To Edit
## Constraints
## Non Goals
## Verification
## Expected Report
```

Handoffs must make the goal, allowed edit scope, security constraints,
non-goals, and verification concrete. Do not hand off vague roadmap items.
Production actions, commits, pushes, deployments, and handoff archival are
excluded unless explicitly listed.

After Claude Code reports completion, Codex reviews:

- whether the diff stayed within the handoff and preserved all invariants;
- whether unexpected files, dependencies, delivery behavior, or secrets changed;
- whether failure paths and security-sensitive behavior remain fail-closed;
- whether tests and verification match the blast radius;
- whether discoveries require a follow-up handoff, ADR, or Fable state update.

Codex archives a completed, reviewed handoff under `docs/handoffs/archive/`.
Do not archive blocked, incomplete, or unreviewed handoffs.

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

## Deployment Safety

Authority and human-approval boundaries are defined in
`docs/fable/autonomy-contract.md`. Those permissions do not authorize Claude
Code to perform delivery implicitly; an active handoff must explicitly request
delivery actions.

- Existing Docker delivery pipelines and an existing Portainer stack may be
  updated after successful verification when explicitly authorized.
- Workers, additive D1 migrations, and approved bindings may be deployed after
  successful verification and required initial human login when explicitly
  authorized.
- Destructive migrations, persistent-data deletion, R2 deletion, public-access
  changes, resource deletion, and secret disclosure require human approval.
