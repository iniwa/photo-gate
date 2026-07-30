# CLAUDE.md

## Purpose

This file defines Claude Code execution rules for `photo-gate`. `AGENTS.md`
owns current design intent, security boundaries, model selection, handoff
policy, and Codex review.

## Required Reading

Before editing, read:

1. `AGENTS.md` and this file.
2. The supplied active handoff or direct scoped task.
3. The repository files, accepted decisions, current project-state records,
   and operations documents needed to perform the work safely.

`FABLE.md` and `docs/fable/autonomy-contract.md` are design and history, not
authority. Unless the user explicitly invokes a narrow autonomous workflow in
the current task, they grant no editing, commit, push, deploy, production
mutation, or handoff-archival authority. Even then, only actions expressly in
the current approved scope are authorized. Archived handoffs and
`photo-gate-design.md` are also historical context.

## Communication and Implementation

- If the user writes in Japanese, respond in Japanese.
- Preserve the repository's established language for documentation, comments,
  identifiers, logs, and user-facing text unless the task explicitly changes
  it.
- Follow the existing stack, conventions, and dependency-management approach.
- Prefer readable changes and minimal dependencies.
- With `ROLE=IMPLEMENTER`, execute the approved task directly rather than
  re-delegating because another primary model is named.
- Keep delegated Windows command lines ASCII-only. Put non-ASCII instructions
  in a UTF-8 handoff file instead of embedding them in the command line.

## Execution Rules

- The handoff or equivalent inline prompt defines the approved outcome and
  explicit prohibitions. Named files are starting points unless explicitly
  marked as an edit boundary. Follow directly related imports, callers, tests,
  fixtures, configuration, and adjacent code as needed.
- Before editing, capture `git status --short` when Git is available. After
  editing, compare final status and diff with that baseline. A dirty worktree
  alone is not a blocker; preserve unrelated changes and stop when overlapping
  intent cannot be resolved safely.
- Complete implementation, directly related tests, documentation, examples,
  focused verification, and necessary in-scope fixes without waiting for
  intermediate review.
- Retain implementation ownership through focused verification and minor
  in-scope corrections. Return only availability, interruption, blockers, or
  material design boundaries to Codex.
- Decide routine naming, helpers, internal types, fixtures, logging, error
  handling, test layout, and small refactors autonomously.
- Repository-local dependency, build, packaging, CI, migration, and
  example-configuration changes are allowed when reasonably required by the
  approved outcome and consistent with established strategy. Report material
  changes.
- Stop when instructions conflict, the work reaches an approval boundary, or
  a material product, compatibility, persistent-data, security, deployment, or
  architecture choice remains unresolved.
- Claude Code subagents are optional and limited to clearly parallel work in
  the same cohesive task. Avoid overlapping writers.
- Do not independently select roadmap or follow-up work.
- Preserve useful partial work and evidence when interrupted. Report completed
  and unmet criteria, remaining scope, and exact resume conditions.

## Architecture and Safety

- Workers own the authenticated viewer/admin surface, D1 authorization, and
  reads from private R2. Docker sync owns PhotoPrism preview input,
  re-encoding, metadata removal, R2 publication, and manifest generation.
- Never expose PhotoPrism, NAS originals, private R2, RAW/RW2/original files,
  secrets, credentials, or metadata-bearing source images.
- Never bypass session authentication, album authorization, or exact manifest
  membership. Fail closed when authentication, authorization, membership, or
  data integrity is uncertain.
- Keep actual R2 deletion disabled. Do not perform destructive migrations,
  persistent-data deletion, resource deletion, or public-access changes.
- Preserve the existing Hono/JSX Workers stack, Wrangler configuration,
  private bindings, Docker image and deployment flow. Do not replace or add a
  configuration format merely for convenience.

## Working Tree and Protected Operations

- Preserve unrelated user and other-agent changes. Treat unexpected diffs as
  having unknown authorship and keep them outside the current task unless
  confirmed.
- Do not inspect secrets, credentials, or personal data unless their contents
  are strictly necessary for the approved task.
- Do not edit secrets, credentials, `.env`, real local configuration,
  PhotoPrism/NAS originals, production D1 or R2 data, persistent volumes,
  runtime state, or generated heavy artifacts unless the approved task
  explicitly requires the change.
- Never reproduce secrets, credentials, personal data, or private
  infrastructure values in prompts, handoffs, reports, or external tools.
- Do not use broad destructive commands or reset, clean, overwrite, stage, or
  rewrite unrelated changes.
- Local commits are allowed only on a dedicated task branch or worktree,
  staging only task-owned changes. Create the normal task commit only after
  the cohesive diff is stable, required verification passes, and required
  reviews return Go. An interim checkpoint commit requires an explicit
  recovery need and is not completion.
- Do not push, merge, publish a pull request, deploy, restart services, mutate
  remote systems, rotate credentials, change authentication or external
  exposure, or perform destructive or live-data operations without explicit
  approval.
- Preserve established historical or retired data unless the approved task
  explicitly authorizes deletion or migration.

## Verification

Start with the narrowest check that proves the changed behavior. Add broader
checks for cross-cutting behavior, integration or release validation, or when
focused evidence is insufficient. Run a required full component suite once
after the cohesive diff is stable and rerun it only after a later edit that
could invalidate the result. Always run `git diff --check` for changed text.

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

For Docker runtime changes, build and smoke-test the image when Docker is
available. For rendering, routing, accessibility, or interactive behavior
changes, use an available browser-level verification method. Report every
skipped or blocked check with the exact reason.

## Expected Report

For completed work, report changed files, a concise summary, material
decisions, each verification command and result, and material dependency,
build, CI, migration, or cross-subsystem changes. For incomplete work, also
report unmet criteria, partial edits, failed or blocked checks, the blocker,
and exact resume conditions. Report subagent usage and reusable discoveries to
Codex.
