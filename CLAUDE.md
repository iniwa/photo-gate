# CLAUDE.md

## Purpose

This file defines Claude Code execution rules for `photo-gate`.

The normal workflow is that Codex creates a scoped handoff under
`docs/handoffs/`, then Claude Code implements and verifies that handoff. Treat
`AGENTS.md` as the Codex-side source of design intent, handoff rules, and review
criteria.

## Required Reading

Before editing:

1. `AGENTS.md`
2. `CLAUDE.md`
3. The active handoff directly under `docs/handoffs/`
4. The files and decisions named by that handoff

Read `FABLE.md`, relevant `docs/fable/` state, and
`docs/operations/operator-actions.md` when the handoff requires broader project
or operational context. Archived handoffs and `photo-gate-design.md` are
historical references only.

If no active handoff exists, or multiple active handoffs make the task
ambiguous, stop and ask Codex before editing.

## Execution Rules

- Implement only the active handoff's goal and acceptance criteria.
- Stay within `Files To Edit`. If another file must change, stop and explain why
  before editing it.
- Preserve the handoff's constraints and non-goals.
- Prefer existing patterns and the smallest coherent change.
- Run the requested verification and any narrowly necessary checks discovered
  during implementation.
- Self-review for security regressions, missing failure paths, unrelated
  changes, and documentation drift.
- Do not independently select roadmap work or continue into a follow-up task.
- Do not commit, push, deploy, mutate production, rotate credentials, or
  archive the handoff unless the active handoff explicitly authorizes it.
- Respond in Japanese when communicating with the user. Use clear English and
  ASCII for code and durable agent documentation by default.

Stop and report to Codex when:

- the handoff is ambiguous or conflicts with `AGENTS.md` or a security invariant;
- implementation requires files or behavior outside the handoff;
- a documented architecture or responsibility boundary must change;
- secrets, credentials, local configuration, or a human-approved operation are
  required;
- a possible production, security, privacy, or data-integrity incident is found;
- the same blocking problem remains after three repair attempts.

## Model / Subagent Policy

- Use Opus as the primary Claude Code coordinator by default: it reads the handoff,
  `AGENTS.md`, `CLAUDE.md`, and security invariants, plans, and does final review.
- Delegate scoped implementation, mechanical edits, and verification to Sonnet
  subagents only when goal, files, constraints, and non-goals are already explicit.
- Subagents must not change design intent, expand scope, touch secrets, alter
  security/authorization boundaries, or make architectural decisions — those
  return to Opus.
- For small edits, Opus may implement directly. If the model split is unavailable,
  continue with the available model and report that limitation.

## Safety Summary

- Never expose PhotoPrism, NAS originals, private R2, secrets, or metadata.
- Never bypass session authentication, album authorization, or manifest photo
  membership.
- Never perform destructive migration, persistent-data deletion, R2 deletion,
  resource deletion, or public-access changes without human approval.
- Never print, generate into tracked files, or commit secret values.
- When authentication, authorization, object membership, or data integrity is
  uncertain, fail closed.

## Environment

- Working repository: `D:/Git/photo-gate` on Windows 11 Home Sub PC.
- Workers: Node.js 22, TypeScript, Hono, D1, and private R2.
- Docker sync: Python 3.12; runtime target Raspberry Pi 4 (`linux/arm64`).
- Gitea is canonical; GitHub is the mirror and CI/CD platform.
- Portainer manages the existing Docker stack.

Do not assume that permission to edit code also grants permission to operate
Cloudflare, Portainer, Gitea, GitHub, PhotoPrism, NAS, or production data.

## Expected Report

At completion or when blocked, report:

- changed files;
- concise implementation summary;
- verification commands and results;
- skipped or blocked checks with exact reasons;
- unexpected findings or out-of-scope changes;
- design or follow-up questions for Codex.
