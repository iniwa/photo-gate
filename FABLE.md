# FABLE.md

## Mission

Complete `photo-gate` as a secure, deployable, and operable private
photo-sharing gateway while preserving all architecture, privacy, and
data-safety invariants.

Continue from the current repository state. Do not restart or replace working
foundations without a documented technical reason.

## Document Precedence

When instructions conflict, use this order:

1. The latest explicit human instruction.
2. Security and privacy invariants in `AGENTS.md` and
   `docs/fable/project-context.md`.
3. Autonomous authority and stop conditions in
   `docs/fable/autonomy-contract.md`.
4. Accepted decisions in `docs/decisions/`.
5. The active handoff directly under `docs/handoffs/`.
6. `docs/fable/roadmap.md` and `docs/fable/progress.md`.
7. Historical `photo-gate-design.md` and archived handoffs.

Specific implementation constraints in an active handoff apply to its task.
Permissions in this file and `docs/fable/autonomy-contract.md` define what may
be authorized; they do not implicitly authorize Claude Code to commit, push,
deploy, mutate production, or archive a handoff.

## Codex Planning Sequence

1. Read `AGENTS.md`, this file, relevant files under `docs/fable/`, and
   `docs/operations/operator-actions.md`.
2. Inspect Git status and do not discard existing changes.
3. Inspect the active handoff, if present.
4. Verify that `docs/fable/current-state.md` still matches the code.
5. Review completed Claude Code work before selecting new work.
6. Select and scope the highest-priority unblocked task.
7. Create a concrete active handoff under `docs/handoffs/` for Claude Code.

## Codex And Claude Code Work Loop

For each task:

1. Codex inspects relevant code, tests, decisions, contracts, and project state.
2. Codex writes a scoped handoff with acceptance criteria, allowed files,
   constraints, non-goals, and verification.
3. Claude Code implements only the handoff, runs verification, self-reviews,
   and reports results and questions.
4. Codex reviews the report and diff for security, regressions, missing tests,
   documentation drift, and scope compliance.
5. Claude Code performs requested corrections through the same handoff, or
   Codex creates a follow-up handoff when scope changes.
6. Codex decides completion, updates durable project state, commits and
   delivers when appropriate, and archives the reviewed handoff.
7. CI and permitted deployment failures are repaired before unrelated feature
   work is selected.

Small, documentation-only, or design-sensitive changes may be completed
directly by Codex when a separate implementation handoff would add no value.

## Model And Subagent Delegation

Claude Code normally runs in auto mode (automatic model selection). Codex
handoffs must therefore be scoped so a Sonnet-class model can complete them
without making design decisions: explicit goal, files, constraints, non-goals,
and verification.

Subagents remain optional for scoped mechanical or parallel work. Subagents
must not change design intent, expand scope, touch secrets, weaken
authentication/authorization or any Non-Negotiable Invariant, or make
architectural decisions. Those questions return to Codex.

## Completion Target

Work toward Level 1, then Level 2, then Level 3 as defined in
`docs/fable/definition-of-done.md`.

Do not claim a level complete until every required item and verification gate
for that level passes.

## Decision Policy

For ordinary engineering choices, decide autonomously and record durable,
security-relevant, cross-component, schema, deployment, or operational choices
as an ADR under `docs/decisions/`.

Default decision principles:

- fail closed;
- private by default;
- least privilege;
- non-destructive and reversible;
- explicit validation at every trust boundary;
- versioned, observable, and rollback-capable delivery;
- reuse existing architecture before adding dependencies.

Use the approved defaults in `docs/fable/autonomy-contract.md`. Codex should not
stop just because multiple reasonable implementation options exist. Claude Code
must return design ambiguity to Codex instead of silently changing the handoff.

## Progress Persistence

Keep `docs/fable/progress.md` short and current. It must identify:

- current completion level;
- current task and acceptance criteria;
- last completed work;
- latest verification and deployment results;
- blockers and required human actions;
- next priority.

Update `docs/fable/current-state.md` and `docs/fable/roadmap.md` whenever their
facts change. These files are operational state, not historical logs.

## Stop Conditions

Stop and request human action only when required by
`docs/fable/autonomy-contract.md`, including:

- required login, credential, secret, account selection, or initial
  infrastructure setup is unavailable;
- a destructive or prohibited operation is required;
- security or responsibility boundaries must change;
- requirements are genuinely contradictory;
- an unexplained production failure or possible data-integrity incident occurs;
- the same blocking problem remains after three repair attempts;
- a paid external service or material recurring cost must be introduced.

When stopping, leave the repository in a reviewable state. Document the exact
blocker, evidence, attempted repairs, and requested human action in the Claude
Code report and, when appropriate, `docs/fable/progress.md`.
