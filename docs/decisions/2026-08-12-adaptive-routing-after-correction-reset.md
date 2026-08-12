# Adaptive Routing After Correction Reset

Date: 2026-08-12
Status: Accepted
Supersedes: The routing detail in the 2026-08-11 correction-churn follow-up to
`2026-08-03-native-codex-delegation.md`

## Context

The correction-churn follow-up requires the primary to pause and reset the
contract at the second correction round or after two blocked/partial returns.
It did not make the initial adaptive-routing threshold or post-reset writer
ownership explicit enough. A known broad lifecycle, runtime, or operability
contract should not be routed to a bounded writer solely to establish that the
task is broader than its role can handle.

## Decision

- Select `adaptive_implementer` directly when acceptance materially depends on
  unresolved native or platform lifecycle, cross-layer runtime, or broad
  operability contracts.
- After the correction-reset contract is restated, select one writer for the
  substantive remaining corrections and keep them with that writer; choose the
  adaptive route when the reset establishes broader reasoning is required.
- The primary may edit source after the reset only for a demonstrably small
  transfer-negative fix or when named-role delegation is unavailable. It must
  otherwise avoid parallel corrective writing.

This refines delegation routing only. Photo-gate's security, privacy,
authorization, approval, deployment, and verification gates remain unchanged.
It does not adopt a worklog or telemetry system.
