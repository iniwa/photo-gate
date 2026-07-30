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

Before meaningful work, read this file, `CLAUDE.md`, relevant accepted
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

The active handoff or equivalent inline prompt is the approved task scope. The
task defines the outcome and explicit prohibitions. Named files are starting
points unless the task explicitly marks them as an edit boundary. Verified
project facts override base defaults. Only an explicit user instruction to
change project policy may revise a durable project rule; other task
instructions and approved scopes may narrow durable rules but may not weaken
them. Report unresolved conflicts instead of guessing.

## Model and Role Policy

- Use GPT-5.3-Codex-Spark (`gpt-5.3-codex-spark`) proactively, when available,
  for low-risk, well-scoped, independently verifiable supporting work that
  requires no material design judgment or source-code implementation.
- GPT-5.6 Terra (`gpt-5.6-terra`) or Sol (`gpt-5.6-sol`) owns requirements and
  design. Whenever Terra is used, set its reasoning level to `high`. Prefer Sol
  for substantial ambiguity, risk, or cross-boundary reasoning.
- Run every Claude Code task with `--permission-mode auto`.
- After design is fixed, delegate source-code implementation first to Claude
  Code Sonnet at effort medium from the repository root. On Windows, keep the
  command line ASCII-only and put non-ASCII instructions in a UTF-8 handoff:
  `claude -p --model sonnet --effort medium --permission-mode auto "ROLE=IMPLEMENTER. Read AGENTS.md, CLAUDE.md, and <handoff>. Complete the task and report."`.
- Only when Sonnet is unavailable because of usage limits or service
  availability, use GPT-5.6 Luna (`gpt-5.6-luna`) with reasoning level `max`
  for the same cohesive outcome. Implementation failure, failed verification,
  or a design question is not model unavailability; return it to Codex.
- Apply this policy to every coordinating Codex model and its subagents. Do not
  create coordinator-specific exceptions unless the user explicitly changes
  the policy.
- Identify implementation prompts with `ROLE=IMPLEMENTER`. Implementers
  execute the approved task directly and do not re-delegate merely because
  another primary model is named. Identify review-only prompts with
  `ROLE=REVIEWER`; reviewers do not edit unless asked to fix findings.
- Claude Code subagents are optional and limited to clearly parallel work
  inside the same cohesive task. They inherit its constraints and must not
  overlap writers.
- Record a delegated writer's root PID when observable. After exit,
  cancellation, or timeout, confirm that exact process tree is absent before
  starting a replacement writer.

## Task Ownership

Keep work in Codex when its main value is requirements, design, read-only
investigation, review, synthesis, or a small documentation-consistency change.
Delegate implementation when the goal, observable acceptance criteria,
protected boundaries, and useful verification are clear enough to execute.
Resolve material design choices first.

For reversible repository-local work, complete the approved outcome end to
end:

- Include directly related tests, documentation, callers, fixtures,
  configuration, examples, build or packaging files, CI, and local migrations
  when reasonably required by the outcome.
- Decide routine naming, helper boundaries, internal types, test layout,
  logging, error handling, and small refactors without intermediate approval.
- Do not wait for review between internal implementation steps unless the task
  requires a checkpoint, reaches an approval boundary, or encounters a
  material unresolved choice.
- A dirty worktree is not itself a blocker. Preserve unrelated work and stop
  only when overlapping intent cannot be resolved without guessing or
  discarding another intent.
- One implementation writer owns the cohesive outcome through focused
  verification and minor in-scope corrections.

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
- Repository-local dependency, build, packaging, CI, migration, and
  example-configuration changes may proceed when reasonably required by the
  approved outcome and consistent with the established strategy. Report
  material changes.
- Approval is required before inspecting or changing protected data; mutating
  production, runtime, infrastructure, or remote services; pushing, merging,
  publishing a pull request, deploying, or restarting; changing
  authentication or external exposure; performing destructive or live-data
  operations; or resolving a material product, compatibility, persistent-data,
  security, deployment, or architecture choice not settled by current design.
- Local commits are allowed only on a dedicated task branch or worktree. Stage
  only task-owned changes, and create the normal task commit only after the
  cohesive diff is stable, required verification passes, and required reviews
  return Go. An interim checkpoint commit requires an explicit recovery need
  and is not completion.
- Preserve the established Wrangler configuration, container image,
  deployment, storage, network, and update flow. Do not introduce a second
  Workers configuration format or mutate bindings, registries, Portainer,
  ports, domains, tunnels, or external exposure without explicit approval.
- Treat Fable documents as design and history, not authority. Unless the user
  explicitly invokes a narrow autonomous workflow in the current task, they
  grant no authority to edit, commit, push, deploy, mutate production, rotate
  credentials, or archive a handoff. Even then, only actions expressly
  included in the current approved scope are authorized.
- Preserve established historical or retired data unless the approved task
  explicitly authorizes deletion or migration.
- Destructive or data-rewriting migrations, persistent-data deletion, R2
  deletion, resource deletion, and public-access changes always require human
  approval.

## Handoff Workflow

- Use an inline task for ordinary work. Put substantial, cross-session,
  operationally risky, or interruption-sensitive work in
  `docs/handoffs/YYYY-MM-DD-<short-task>.md`.
- One handoff covers one cohesive outcome, directly related regression
  coverage, and a useful verification path. Split at a real architecture,
  live-data, external-service, deployment, rollback, or independent product
  boundary, not solely by file or test count.
- Name concrete data sources, current state, observable acceptance criteria,
  approval gates, and protected behavior. Starting points are not edit
  allowlists unless a strict boundary is stated with its reason.
- Treat a delegation that stops before meeting its acceptance criteria as
  interrupted even when its process exits normally. Record usable partial
  results, verification, remaining scope, and exact resume conditions. Review
  that evidence before replacing or rerunning the writer.
- The same implementer owns directly related edits, focused verification, and
  minor corrections. Freeze a stable diff, then run independent source, test,
  and material-design reviews in parallel when useful. Consolidate duplicate
  findings into one correction packet; require another correction round only
  for a new material finding, failed verification, or unresolved boundary.
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
when the blast radius requires it. Run a required full suite once after the
cohesive diff is stable and rerun it only after a later edit that could
invalidate it. Build and smoke-test the Docker image for runtime changes when
Docker is available. For rendering, routing, accessibility, or interactive
behavior changes, use an available browser-level verification method. Report
all blocked checks exactly.

## Review and Documentation

Review the stable diff for approved scope, non-negotiable invariants,
protected state, dependencies, delivery and exposure boundaries, tests,
failure behavior, unrelated diffs, and material cross-subsystem effects.

Keep `AGENTS.md` short and current. Put decision context and rejected options
in `docs/decisions/`, current project state in the applicable `docs/fable/`
records, operational procedures in `docs/operations/`, active work in
`docs/handoffs/`, and completed handoffs in `docs/handoffs/archive/`. Archive
an accepted decision only after it is fully implemented and no longer needed
for current guidance.
