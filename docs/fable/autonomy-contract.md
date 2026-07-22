# Autonomy Contract

## Historical Status

This document is retained as historical project context. It is not a current
authority or permission grant. `AGENTS.md` and `CLAUDE.md` take precedence over
every autonomous action, approved default, delivery permission, and stop
condition below.

Nothing in this document authorizes autonomous editing, committing, pushing,
deployment, production mutation, or handoff archival. The historical contract
may be consulted only when the user explicitly requests a narrow task, and any
such work remains subject to the current constraints in `AGENTS.md` and
`CLAUDE.md`.

The remainder of this file is intentionally preserved as historical text.

## Workflow Scope

This document defines available project authority and human-approval
boundaries. It does not assign every permitted action to every agent.

- Codex decides scope, creates handoffs, reviews results, and decides delivery.
- Claude Code implements and verifies the active handoff.
- Claude Code may commit, push, deploy, mutate production, or archive a handoff
  only when the active handoff explicitly authorizes that action.
- Human approval requirements in this document always apply.

## Approved Defaults

Fable may adopt and implement these without asking:

- D1 binding: `DB`.
- R2 binding: `PHOTO_BUCKET`.
- Viewer session lifetime: fixed seven days, no sliding refresh initially.
- Login lockout: five failed attempts, locked for fifteen minutes.
- Expired-session cleanup: daily scheduled task.
- PBKDF2 iterations: benchmark and choose the highest practical safe value
  within Workers limits; record the result as an ADR.
- R2 cleanup: dry-run only.
- Admin authentication: Cloudflare Access JWT validation plus admin email
  allowlist.
- Docker releases: immutable version tags; do not rely on `latest` for stable
  operation.
- Workers deployment: automatic after successful required checks.
- D1 migration automation: additive/non-destructive migrations only.

## Autonomous Engineering Authority

Fable may decide, implement, document, commit, and push:

- internal modules, APIs, UI details, tests, error handling, and logging;
- non-destructive schema additions and migrations;
- binding configuration using approved names;
- dependencies that are justified, maintained, and compatible;
- CI/CD workflows and least-privilege permissions;
- versioning, release, health-check, and rollback mechanisms;
- local and production deployment after verification;
- ADRs for durable choices.

## Docker And Portainer Authority

Human responsibilities:

- initial Portainer environment, stack, and container creation;
- initial registry authentication;
- initial persistent volume, network, environment variable, and secret setup;
- provision of the dedicated existing stack update mechanism.

Fable may:

- create/update Dockerfiles, Compose files, and delivery workflows;
- commit and push to canonical Gitea;
- rely on Gitea-to-GitHub mirroring;
- build/test/package versioned multi-arch images in GitHub Actions;
- publish approved images to GHCR;
- update only the existing human-created photo-gate Portainer stack through its
  dedicated webhook/GitOps path;
- verify deployment health and roll back to a prior known-good immutable image.

Fable must not create/delete Portainer environments or stacks, modify unrelated
containers, delete volumes, or use broad Portainer admin/API authority.

## Cloudflare Workers Authority

Human responsibilities:

- perform initial interactive login/account selection when required;
- provide required secret values and initial external Access/DNS decisions when
  requested.

Fable may:

- create/configure approved Worker, D1, R2, binding, Cron, and CI/CD resources;
- register provided secrets without displaying or storing their values;
- apply additive migrations;
- deploy and roll back Workers;
- perform post-deployment verification and repair.

## Human Approval Required

Stop before:

- destructive or data-rewriting D1 migration;
- R2 object deletion or enabling non-dry-run cleanup;
- persistent volume or production data deletion;
- Portainer stack/environment deletion;
- Cloudflare Worker, D1, R2, Access application, DNS, or other resource
  deletion;
- making R2, PhotoPrism, NAS, admin, or viewer data more public;
- changing core security or component responsibility boundaries;
- force-push, published-history rewrite, or existing tag replacement;
- introducing a paid external service or material recurring cost;
- generating, exposing, committing, or rotating secrets without explicit human
  instruction.

## Stop Conditions

Stop and request human action only if:

- required authentication, credentials, secret values, account selection, or
  initial infrastructure is unavailable;
- a human-approval operation above is required;
- requirements are contradictory and no safe interpretation exists;
- an unexplained production incident or possible data-integrity issue occurs;
- the same blocker remains after three repair attempts;
- an external-state change controlled by the human is required.

Do not stop for ordinary design choices. Choose the safest reasonable option,
record important decisions, and continue.

## Failure And Recovery

- Diagnose logs, diffs, and the last known-good version first.
- Keep repairs narrow and rerun all affected checks.
- Do not continue feature work while CI or deployment is failing.
- On Worker deployment failure, roll back the Worker; do not automatically
  reverse a migration.
- On Docker deployment failure, restore the previous known-good immutable image.
- If data integrity is uncertain, stop writes and request human review.
- Authentication/authorization uncertainty must fail closed.
