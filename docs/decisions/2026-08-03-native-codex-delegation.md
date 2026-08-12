# Native Codex Delegation and Single Active Policy

Date: 2026-08-03
Status: Accepted

## Context

The project previously divided active instructions between `AGENTS.md` for
Codex coordination and `CLAUDE.md` for Claude Code execution. That split also
fixed model names, a `claude -p` launch path, and Claude-specific recovery
rules in project policy. The shared Codex policy now uses native subagents,
leaves primary-model selection to the user at runtime, and prohibits Claude
Code delegation unless the user explicitly changes policy.

Photo-gate still needs its strict architecture, privacy, approval, delivery,
and verification boundaries regardless of execution model. Those rules must
have one active source.

## Decision

- `AGENTS.md` is the single active project working agreement. It retains the
  Photo-gate-specific security invariants, protected-state rules, approval
  gates, branch/commit policy, handoff lifecycle, and verification commands.
- `CLAUDE.md` is reduced to a historical compatibility pointer. It does not
  define an active or parallel execution policy.
- The primary session owns task interpretation, material design, approval
  boundaries, delegation, integration, and user communication.
- Settled multi-step implementation defaults to one `bounded_implementer` as
  the cohesive writer. `bounded_explorer`, `adaptive_implementer`, and
  `bounded_reviewer` are used only for their named bounded purposes.
- Configured named roles are launched without inherited conversation history
  and without an explicit model or effort override so the role definition owns
  routing. If role selection is unavailable or unobservable, the primary uses
  an observable fallback with equivalent constraints.
- Only the primary delegates, delegated agents do not create nested agents,
  and overlapping behavior has one writer.
- Claude Code and the `claude` command are not approved routes without a later
  explicit user policy change.

## First Pilot

At pilot selection, the active V3-1 timeline handoff was the unimplemented
baseline and had accepted design, observable acceptance criteria, protected
behavior, non-goals, and focused verification. It is therefore the first
prepared `bounded_implementer` pilot.
The documentation migration itself does not implement, deploy, or publish
V3-1.

## Pilot outcome and refinements

The V3-1 pilot used one Luna `bounded_implementer` writer and one Terra
`bounded_reviewer`. The primary share was 56.73% (below the 60% target), with
no material defects remaining after review. Aggregate exposed tokens were
11,908,187 and the writer required three correction rounds, so shifting share
alone did not improve total token efficiency. The adopted refinement is a
mechanical initial delegation checklist, a mandatory writer self-gate before
independent review, and a safe repeatable JSONL exporter that records only
non-sensitive envelope telemetry. Browser QA remains separate and is not
claimed by this pilot.

A 2026-08-04 follow-up retained the single-writer route and made review and
task boundaries explicit. The cohesive implementer owns cheap related
discovery; multiple explorers are not a substitute for that writer.
Independent `bounded_reviewer` review is reserved for a concrete material
correctness, security, data, compatibility, cross-system, or verification risk
and is normally skipped for localized low-risk content or deterministic
documentation/configuration changes after self-review. A genuinely independent
phase with its own acceptance and verification is identified as a fresh Codex
task/chat boundary rather than silently inheriting unrelated long-lived
context.

## Historical Baseline

The previous active `CLAUDE.md` remains available at commit
`9b46f561fba0553093427733c1af92564ecc71a8`, blob
`5f6d212b48b37a61d2dcb80d6d263fd83cf48d4f`. Accepted decisions, completed
handoffs, and historical progress records are not rewritten merely to replace
old model terminology.

## 2026-08-04 Implementation Discipline Follow-up

Prefer the smallest correct change that satisfies the approved outcome,
requirements, and acceptance criteria. Before creating a new implementation or
adding a dependency, inspect existing code, the standard library, and
platform-native capabilities; reuse a suitable capability unless that would
weaken correctness, security, compatibility, or maintainability. The real
project `AGENTS.md` is authoritative; synchronization of its stored copy is
maintained separately by the shared-source repository.

## 2026-08-04 Common Policy Reconciliation

Photo-gate now aligns semantically with the shared priorities, single-writer
delegation, role thresholds and fallback, primary-only ownership, self-gate and
consolidated corrections, and fresh independent-task boundary. Its
photo-sharing security, approval, deployment, and verification rules remain
authoritative.

## 2026-08-11 Correction-Churn Follow-up

Normally one independent reviewer evaluates the stable self-reviewed outcome;
a second requires a distinct material risk or an unusable or blocked first
review. At the second correction round, or after two blocked or partial
implementation returns caused by unresolved acceptance, authority, or
environment, the primary pauses further corrective delegation and resets the
contract before selecting a bounded, adaptive, approval, or fresh-task route.
This token-efficiency circuit breaker does not weaken Photo-gate's privacy,
authorization, deletion, deployment, or verification gates.
