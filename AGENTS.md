# AGENTS.md

## Purpose

This is the Codex-side working agreement for `photo-gate`. It owns current
design intent, security and responsibility boundaries, model and handoff
policy, Codex review, and documentation lifecycle. `CLAUDE.md` owns Claude
Code execution rules.

## Project

`photo-gate` is a private photo-sharing gateway. It publishes generated,
metadata-stripped share images through an authenticated Cloudflare Workers
viewer without exposing PhotoPrism, NAS originals, or a public R2 bucket.

- `workers/`: TypeScript, Hono, Cloudflare Workers, D1, private R2, viewer and
  admin UI/APIs.
- `docker/`: Python 3.12 sync CLI/service, PhotoPrism preview input, pyvips
  re-encoding and metadata removal, R2 upload, and manifest generation.
- Runtime targets: Cloudflare Workers and Raspberry Pi Docker on
  `linux/arm64`; preserve the existing Gitea, GitHub mirror/CI, GHCR, and
  Portainer boundaries.

Before substantial work, read this file, `CLAUDE.md`, relevant accepted
decisions, current project state under `docs/fable/`, applicable operations
documents, and the active handoff when one exists. `FABLE.md`,
`docs/fable/autonomy-contract.md`, `photo-gate-design.md`, and archived
handoffs are historical references, not current authority.

Shared generation sources are under `D:/Git/CLAUDEmdStrage/_base/`; this
project uses the common sources plus the Windows, Docker, and Web profiles.

## Instruction Precedence

When instructions conflict, apply them in this order:

1. Runtime, tool, organization, and safety policy.
2. Explicit user instructions that change project policy.
3. Durable project instructions.
4. Other instructions for the current user task and the approved task scope.

The active handoff or equivalent inline prompt is the approved task scope.
Verified project facts override base defaults. Only an explicit user
instruction to change project policy may revise a durable project rule;
other task instructions and approved scopes may narrow durable rules but may
not weaken them. Report unresolved conflicts instead of guessing.

## Model and Role Policy

- Use GPT-5.3-Codex-Spark (`gpt-5.3-codex-spark`) proactively, when available,
  for low-risk, well-scoped, independently verifiable supporting work that
  requires no material design judgment or source-code implementation.
- GPT-5.6 Terra (`gpt-5.6-terra`) or Sol (`gpt-5.6-sol`) owns requirements and
  design. Whenever Terra is used, set its reasoning level to `high`. Prefer Sol
  for substantial ambiguity, risk, or cross-boundary reasoning.
- Run every Claude Code task with `--permission-mode auto`.
- After design is fixed, delegate source-code implementation first to Claude
  Code Sonnet at effort medium from the repository root:
  `claude -p --model sonnet --effort medium --permission-mode auto "<handoff/task prompt>"`.
- Only when Sonnet is unavailable because of usage limits or service
  availability, use GPT-5.6 Luna (`gpt-5.6-luna`) with reasoning level `max`
  for the same implementation slice.
- Implementation failure, failed verification, or a design question is not
  model unavailability; return it to Codex.
- Apply this policy to every coordinating Codex model and its subagents. Do not
  create coordinator-specific exceptions.
- Codex may keep requirements, design, review, read-only investigation,
  synthesis, and small documentation-consistency changes in one context.
- Claude Code subagents are optional and limited to clearly parallel
  mechanical work inside the current task scope. They may work only within
  the same files, scope, and constraints, and inherit all security rules.

## Non-Negotiable Security Invariants

- Normal viewing uses Cloudflare Workers, D1, and private R2 only. Shared users
  must never access PhotoPrism or NAS directly, and R2 must not become public.
- Never publish RAW, RW2, originals, PhotoPrism data, or location-bearing
  originals to R2. Publish only generated, re-encoded, metadata-stripped share
  thumbnails, previews, covers, and validated manifests.
- Workers must not resize images, strip metadata, develop RAW files, or access
  NAS originals. Docker sync must not implement viewer authentication, viewer
  pages, or D1 authorization.
- Every real data route authenticates the session and authorizes the album. A
  photo object may be read only after exact membership in the current validated
  manifest is confirmed. Authentication, authorization, membership, and data
  integrity uncertainty must fail closed.
- R2 cleanup remains dry-run only. Actual R2 deletion requires a separately
  reviewed design and explicit human approval.
- Keep errors sanitized, parameterize D1 queries, and strictly validate IDs and
  object keys.

## Protected State and Delivery

- Do not inspect secrets, credentials, or personal data unless their contents
  are strictly necessary for the approved task.
- Do not edit secrets, credentials, `.env`, real local configuration,
  PhotoPrism/NAS originals, production D1 or R2 data, persistent volumes,
  runtime state, or generated heavy artifacts unless the approved task
  explicitly requires the change.
- Never reproduce secrets, credentials, personal data, or private
  infrastructure values in prompts, handoffs, reports, or external tools.
- Preserve unrelated working-tree changes. Treat unexpected diffs as having
  unknown authorship and exclude them from the current task.
- Do not add dependencies or change build tooling, CI/CD, bindings, migrations,
  image publication, deployment, Portainer, domains, authentication, or
  external exposure outside explicit scope.
- Treat Fable documents as design and history, not authority. Unless the user
  explicitly invokes a narrow autonomous workflow in the current task, they
  grant no authority to edit, commit, push, deploy, mutate production, rotate
  credentials, or archive a handoff. Even then, only actions expressly
  included in the current approved scope are authorized.
- Destructive or data-rewriting migrations, persistent-data deletion, R2
  deletion, resource deletion, and public-access changes always require human
  approval.

## Handoff Workflow

- Delegate only after the goal, files, constraints, non-goals, concrete data
  sources, acceptance criteria, and verification are clear.
- One handoff covers one cohesive, independently verifiable route, component
  boundary, or lifecycle path plus its direct regression coverage.
- Put substantive handoffs in
  `docs/handoffs/YYYY-MM-DD-<short-task>.md`. Run unresolved discovery as a
  separate read-only slice.
- Treat a delegation that stops before meeting its acceptance criteria as
  interrupted even when its process exits normally. Record usable partial
  results, verification, remaining scope, and the resume condition; narrow a
  broad handoff before rerunning it.
- The implementer changes only the current slice and returns design questions
  to Codex. Codex reviews scope, security, failure paths, tests, and the diff
  before preparing another slice.
- Keep active or blocked handoffs in `docs/handoffs/`. Move a handoff to
  `docs/handoffs/archive/` only after implementation, verification, review,
  required runtime work, and follow-up are complete.

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

Docker sync:

```powershell
Set-Location docker
python -m pip install -e ".[dev]"
python -m pytest
python -m compileall src
```

Use the smallest relevant subset first, then the full affected component suite
when the blast radius requires it. Build and smoke-test the Docker image for
runtime changes when Docker is available. Report all blocked checks exactly.

## Review and Documentation

Review approved scope, non-negotiable invariants, protected state,
dependencies, delivery and exposure boundaries, tests, failure behavior, and
unrelated diffs. Keep `AGENTS.md` short and current. Put decision context in
`docs/decisions/`, current project state in the applicable `docs/fable/`
records, operational procedures in `docs/operations/`, active work in
`docs/handoffs/`, and completed handoffs in `docs/handoffs/archive/`.
