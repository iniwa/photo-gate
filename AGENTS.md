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

## Model and Role Policy

- Use GPT-5.3-Codex-Spark (`gpt-5.3-codex-spark`) proactively, when available,
  for low-risk, well-scoped, independently verifiable supporting work that
  requires no material design judgment or source-code implementation.
- GPT-5.6 Terra (`gpt-5.6-terra`) or Sol (`gpt-5.6-sol`) owns requirements and
  design. Whenever Terra is used, set its reasoning level to `high`. Prefer Sol
  for substantial ambiguity, risk, or cross-boundary reasoning.
- After design is fixed, delegate source-code implementation first to Claude
  Code Sonnet 5 at effort medium from the repository root.
- Only when Sonnet 5 is unavailable because of usage limits or service
  availability, use GPT-5.6 Luna (`gpt-5.6-luna`) with reasoning level `max`
  for the same implementation slice.
- Implementation failure, failed verification, or a design question is not
  model unavailability; return it to Codex.
- Apply this policy to every coordinating Codex model and its subagents. Do not
  create coordinator-specific exceptions.
- Codex may keep requirements, design, review, read-only investigation,
  synthesis, and small documentation-consistency changes in one context.
- Claude Code subagents are optional and limited to clearly parallel
  mechanical work inside the current handoff. They inherit its scope and all
  security constraints.

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

- Do not read, edit, print, or commit secrets, credentials, real local
  configuration, PhotoPrism/NAS originals, production D1 or R2 data,
  persistent volumes, or runtime state unless an explicitly approved task
  requires a narrowly defined operation.
- Preserve unrelated working-tree changes. Treat unexpected diffs as having
  unknown authorship and exclude them from the current task.
- Do not add dependencies or change build tooling, CI/CD, bindings, migrations,
  image publication, deployment, Portainer, domains, authentication, or
  external exposure outside explicit scope.
- Do not edit, commit, push, deploy, mutate production, rotate credentials, or
  archive a handoff merely because a historical Fable document permits it.
  These actions require a current, explicit, narrowly scoped user request.
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
- If a broad handoff times out or returns before its intended edit, do not
  rerun it unchanged. Narrow the behavior, files, and verification first.
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
