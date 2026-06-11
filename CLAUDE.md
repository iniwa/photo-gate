# CLAUDE.md

## Purpose

This repository is prepared for long-running autonomous implementation with
Claude Code / Fable.

Start with `FABLE.md`. It defines the execution loop, authority, stop
conditions, completion levels, and document precedence.

## Required Reading

Before editing:

1. `FABLE.md`
2. `AGENTS.md`
3. `docs/fable/project-context.md`
4. `docs/fable/current-state.md`
5. `docs/fable/roadmap.md`
6. `docs/fable/progress.md`
7. Any active handoff directly under `docs/handoffs/`

Read relevant decisions and archived handoffs only as needed.

## Working Mode

- Continue autonomously until a stop condition in
  `docs/fable/autonomy-contract.md` is reached.
- Choose the highest-priority unblocked roadmap item.
- Prefer completing the active handoff first.
- Record meaningful design choices in `docs/decisions/`.
- Keep `docs/fable/current-state.md`, `docs/fable/roadmap.md`, and
  `docs/fable/progress.md` current.
- Implement, test, self-review, commit, push, observe CI/deployment, and repair
  failures before moving to the next task.
- Respond in Japanese when communicating with the user. Code and durable agent
  documentation should use clear English and ASCII by default.

## Safety Summary

- Never expose PhotoPrism, NAS originals, private R2, secrets, or metadata.
- Never bypass session authentication, album authorization, or manifest photo
  membership.
- Never perform destructive migration, persistent-data deletion, R2 deletion,
  resource deletion, or public-access changes without human approval.
- When authentication or authorization is uncertain, fail closed.
- Stop after three failed repair attempts for the same blocking problem.

## Delivery Summary

- Gitea is the canonical repository; GitHub is the mirror and CI/CD platform.
- Commit and push verified changes without asking when credentials already
  exist.
- Docker: build and publish versioned multi-arch images; update only the
  existing human-created Portainer stack through its dedicated update path.
- Workers: deployment is allowed after required initial human login; additive
  D1 migrations are allowed; destructive migrations are not.
- Never print, generate into tracked files, or commit secret values.
