# AGENTS.md

## Purpose and Project

This is the active Codex working agreement for `photo-gate`. `CLAUDE.md` is a
historical compatibility pointer and does not define a separate execution
policy.

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

Before meaningful work, read this file, relevant accepted decisions, the
current project state under `docs/fable/`, applicable operations documents,
and the active handoff when one exists. `FABLE.md`,
`docs/fable/autonomy-contract.md`, `photo-gate-design.md`, and archived
handoffs are historical references, not current authority.

Shared generation sources are under `D:/Git/CLAUDEmdStrage/_base/`; this
project uses the common sources plus the Windows, Docker, and Web profiles.

## Instruction Precedence

Apply conflicting instructions in this order:

1. Runtime, tool, organization, and safety policy.
2. Explicit user instructions that establish or change project policy.
3. Durable project instructions.
4. The current task's approved outcome and explicit prohibitions.

The task defines the outcome. Named files are starting points unless the task
explicitly establishes an edit boundary. Verified repository facts override
base defaults. Report only conflicts that cannot be resolved from this order
and repository evidence.

## Primary Session, Delegation, and Ownership

- The user selects the primary model at runtime. The primary session owns task
  interpretation, material design, approval boundaries, delegation, final
  integration, and user communication.
- For settled, independently verifiable implementation with multiple steps,
  use one `bounded_implementer` as the default cohesive writer. Keep routine
  discovery, source edits, focused verification, and minor corrections with
  that writer rather than duplicating them in the primary session.
- Use `bounded_explorer` for behaviorally read-only repository exploration,
  extraction, log analysis, and test triage. Use `adaptive_implementer` when a
  bounded outcome clearly needs broader cross-file or cross-subsystem
  reasoning. Use `bounded_reviewer` only when independent read-only review is
  justified by risk, ambiguity, or breadth.
- When the active surface can select configured named roles, start them
  without inherited conversation history and without an explicit model or
  effort override; transfer only the compact task-specific goal, acceptance
  criteria, context, constraints, and verification. If role selection is
  unavailable or unobservable, use the primary session or an observable agent
  with equivalent inline constraints and record the actual route.
- Only the primary session delegates. Delegated agents do not create nested
  agents. Keep one active writer for overlapping files or behavior; read-only
  investigation may run in parallel.
- Parent permissions are chosen before delegation and live overrides remain
  authoritative. Explorers and reviewers stay behaviorally read-only even if
  write-capable tools are exposed.
- Claude Code is not an approved delegation route. Do not invoke `claude`
  unless an explicit user instruction changes project policy.

Keep small, conversation-dependent, design-heavy, approval-sensitive, or
transfer-negative work in the primary session. A delegated implementer owns
the approved outcome through directly related code, tests, fixtures,
documentation, configuration, dependencies, build or packaging files, CI,
local migrations, focused verification, and minor in-scope corrections when
reasonably necessary.

Before editing, capture `git status --short`; after editing, compare the final
status and diff with that baseline. Preserve unrelated work. Decide routine
naming, helper boundaries, internal types, fixtures, logging, error handling,
test layout, and small refactors autonomously. Return control only at an
approval gate, an unresolved material product/security/architecture choice,
an unresolvable overlap, a permission or environment blocker, or an unmet
acceptance criterion outside the delegated scope.

For each initial delegation, record the exact mechanics, edge/fallback matrix,
protected regressions, focused checks, any required stable-diff full-suite
check, stale-reference/static-asset sweep, and the required per-item
passed/blocked/unmet return-evidence shape. The
writer self-reviews the stable diff, fixes minor failures, and completes that
gate before any independent reviewer starts. Reviewer findings are sent back
as one packet to the same writer. Append only safe telemetry envelope fields;
never include prompts, messages, tool data, secrets, or private values.

If the user writes in Japanese, respond in Japanese. Preserve the repository's
established language for documentation, comments, identifiers, logs, and
user-facing text unless the task changes it.

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
  photo object may be read only after exact membership in the current
  validated manifest is confirmed. Authentication, authorization, membership,
  and data-integrity uncertainty must fail closed.
- R2 cleanup remains dry-run only. Actual R2 deletion requires a separately
  reviewed design and explicit human approval.
- Keep errors sanitized, parameterize D1 queries, and strictly validate IDs
  and object keys.

## Protected State and Approval Gates

- Treat unexpected diffs as unknown work and exclude them unless confirmed.
  Do not use reset, clean, broad destructive commands, or unrelated staging to
  make the tree look clean.
- Do not inspect secrets, credentials, or personal data unless their contents
  are strictly necessary. Never reproduce protected values in prompts,
  handoffs, reports, tests, commits, logs, or external tools.
- Do not edit secrets, credentials, `.env`, real local configuration,
  PhotoPrism/NAS originals, production D1 or R2 data, persistent volumes,
  runtime state, or generated heavy artifacts unless explicitly required.
- Reversible repository-local dependency, build, packaging, CI, migration,
  and example-configuration changes may proceed when reasonably required by
  the approved outcome and consistent with the established strategy. Report
  material changes.
- Approval is required before protected-data access beyond task need; push,
  merge, pull-request publication, deploy, restart, registry or hosted
  configuration changes; production, runtime, infrastructure, or remote
  mutation; authentication or external-exposure changes; destructive or
  live-data operations; or an unsettled material product, compatibility,
  persistent-data, security, deployment, or architecture decision.
- Local commits are allowed only on a dedicated task branch or worktree. Stage
  only task-owned changes and commit only after the cohesive diff is stable,
  required verification passes, and required reviews return Go.
- Preserve the established Wrangler configuration, container image,
  deployment, storage, network, and update flow. Do not introduce a second
  Workers configuration format or mutate bindings, registries, Portainer,
  ports, domains, tunnels, or external exposure without explicit approval.
- Preserve established historical or retired data unless deletion or migration
  is explicitly approved. Destructive or data-rewriting migrations,
  persistent-data deletion, R2 deletion, resource deletion, and public-access
  changes always require human approval.
- Fable documents grant no authority to edit, commit, push, deploy, mutate
  production, rotate credentials, or archive a handoff. Only the current user
  request and approved scope authorize operations.

## Handoffs and Recovery

Use a compact inline native-subagent task for ordinary work. Put substantial
cross-session, operationally risky, separately executed, or
interruption-sensitive work in `docs/handoffs/YYYY-MM-DD-<short-task>.md`.
One handoff covers one cohesive outcome, related regression coverage, and a
useful verification path; split only at a real architecture, live-data,
external-service, deployment, rollback, or independent product boundary.

Name observable acceptance, protected behavior, approval gates, and focused
verification. Starting points are not edit allowlists unless a strict boundary
and its reason are explicit. If work stops early, preserve usable partial work
and report completed and unmet criteria, verification, the blocker, and exact
resume conditions. Keep routine corrections with the same writer and
consolidate review findings into one packet. Archive a handoff only after
implementation, verification, review, required runtime work, and follow-up are
complete.

## Verification and Completion

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

Start with the smallest relevant check, then run the full affected component
suite when the blast radius requires it. Run a required full suite once after
the cohesive diff is stable and rerun it only after a later edit could
invalidate it. Build and smoke-test the Docker image for runtime changes when
Docker is available. For rendering, routing, accessibility, or interactive
behavior changes, use an available browser-level verification method. Always
run `git diff --check` for changed text and report blocked checks exactly.

The primary session reviews the stable diff, acceptance evidence, protected
boundaries, high-risk areas, unrelated diffs, and material dependency,
configuration, migration, build, CI, or cross-subsystem effects. Do not repeat
the implementer's full investigation by default. Add an independent review
only when its expected risk reduction justifies the tokens.

Report the concise result, changed files, material decisions, verification
commands and outcomes, and any material cross-subsystem effects. For incomplete
work, also report unmet criteria, partial edits, blocked checks, the blocker,
and exact resume conditions.

## Documentation Lifecycle

Keep `AGENTS.md` limited to current durable rules and links. Put decision
context and rejected alternatives in `docs/decisions/`, current project state
in `docs/fable/`, operational procedures in `docs/operations/`, active work in
`docs/handoffs/`, and completed handoffs in `docs/handoffs/archive/`. Do not
rewrite accepted decisions, archived handoffs, or historical progress merely
to replace old model terminology.
