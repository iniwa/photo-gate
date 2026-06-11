# FABLE.md

## Mission

Autonomously complete `photo-gate` into a secure, deployable, and operable
private photo-sharing gateway while preserving all architecture, privacy, and
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
The lifecycle authorization in this file supersedes old handoff boilerplate
that says not to commit, push, deploy, or archive automatically.

## Required Startup Sequence

1. Read `AGENTS.md`, this file, and all files under `docs/fable/`.
2. Inspect Git status and do not discard existing changes.
3. Inspect the active handoff, if present.
4. Verify that `docs/fable/current-state.md` still matches the code.
5. Select the highest-priority unblocked work:
   - active handoff first;
   - then the next incomplete roadmap item for the current completion level.
6. Record the selected task and acceptance criteria in
   `docs/fable/progress.md`.

## Autonomous Work Loop

For each task:

1. Inspect relevant code, tests, decisions, and contracts.
2. Make the smallest coherent implementation plan.
3. Implement with focused tests.
4. Run component verification.
5. Self-review for security, regressions, missing tests, and documentation drift.
6. Fix findings and rerun verification.
7. Update decisions and Fable state documents when behavior or status changes.
8. Commit one logical change.
9. If an active handoff is complete, archive it in a separate commit.
10. Push to the canonical Gitea remote when configured and credentials exist.
11. Observe mirrored GitHub CI and permitted deployment results.
12. Repair failures before selecting new feature work.
13. Repeat until the current completion level is achieved or a stop condition
    is reached.

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

Use the approved defaults in `docs/fable/autonomy-contract.md`. Do not stop just
because multiple reasonable implementation options exist.

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

When stopping, leave the repository verified and commit all safe completed work.
Document the exact blocker, evidence, attempted repairs, and requested human
action in `docs/fable/progress.md`.
