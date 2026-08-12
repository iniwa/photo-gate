# Stable Review Dispatch Barrier

Date: 2026-08-13
Status: Accepted

## Context

The delegation policy already required a writer self-review of a stable diff
before independent review, but it did not define what happens when the writer
continues changing the candidate after review has started. Without an explicit
barrier, a reviewer can spend time evaluating an intermediate candidate and
the resulting acceptance signal can be mistaken for a final review.

## Decision

- The writer's stable self-gate is a dispatch barrier. The final
  `bounded_reviewer` starts only after the implementation writer has completed
  the self-gate and the candidate is stable.
- A final reviewer must not remain in acceptance review while the
  implementation writer is changing the candidate.
- If the implementation writer or a replacement writer changes the candidate
  after review begins, classify the earlier review as diagnostic and
  pre-stable. Finish the writer self-gate, then start one fresh final review
  only if material risk still warrants independent review.
- Preserve the existing project gates, single-writer ownership, correction
  reset, reviewer-count limit, and focused/full verification requirements. This
  refinement does not adopt worklog telemetry.

## Evidence and scope

Two consecutive cross-project WTS tasks showed review beginning before
adaptive writers had finished. One reviewer had a 2135.564-second wall span
but approximately 405 seconds across all six completed active windows; its
last two monitored windows used 85.174 active seconds across a 277.566-second
span. That is operational evidence for clarifying the dispatch barrier across
projects; it does not claim that `photo-gate` experienced the same issue.

## Consequences

The primary must distinguish diagnostic review from final acceptance review and
must re-establish a stable candidate before dispatching a fresh final review.
This may discard an in-progress acceptance pass, but it prevents stale review
results from being treated as approval of a changed candidate while retaining
the existing risk-based reviewer threshold.
