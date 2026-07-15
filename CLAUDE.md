# CLAUDE.md

## Purpose

This file defines Claude Code execution rules for `photo-gate`. `AGENTS.md`
owns current design intent, security boundaries, model selection, handoff
policy, and Codex review.

## Required Reading

Before editing, read:

1. `AGENTS.md` and this file.
2. The supplied active handoff or direct scoped task.
3. The files, accepted decisions, current project-state records, and operations
   documents explicitly listed for inspection.

`FABLE.md` and `docs/fable/autonomy-contract.md` are historical references and
do not grant authority. Archived handoffs and `photo-gate-design.md` are also
historical context.

## Execution Rules

- If the user writes in Japanese, respond in Japanese.
- Keep delegated Windows command lines ASCII-only. Put non-ASCII instructions
  in a UTF-8 handoff file instead of embedding them in the command line.
- Implement and report only the current independently verifiable slice. Stay
  inside its approved files, constraints, acceptance criteria, and non-goals.
- If instructions conflict, listed files are insufficient for the first scoped
  edit, or a design, dependency, binding, migration, deployment, security, or
  external-exposure change is required, stop and return the question to Codex.
- If the slice is too broad to reach its intended edit, return a proposed
  narrower split instead of expanding discovery or redesigning the task.
- Prefer existing patterns and the smallest coherent change. Preserve
  unrelated changes and treat unexpected diffs as having unknown authorship.
- Do not independently select roadmap or follow-up work.
- Do not commit, push, deploy, mutate production, rotate credentials, or
  archive a handoff unless the user explicitly requests that narrowly scoped
  action in the current task. Historical Fable permissions do not authorize it.

## Architecture and Safety

- Workers own the authenticated viewer/admin surface, D1 authorization, and
  reads from private R2. Docker sync owns PhotoPrism preview input,
  re-encoding, metadata removal, R2 publication, and manifest generation.
- Never expose PhotoPrism, NAS originals, private R2, RAW/RW2/original files,
  secrets, credentials, or metadata-bearing source images.
- Never bypass session authentication, album authorization, or exact manifest
  membership. Fail closed when authentication, authorization, membership, or
  data integrity is uncertain.
- Keep actual R2 deletion disabled. Do not perform destructive migrations,
  persistent-data deletion, resource deletion, or public-access changes.
- Do not read, edit, print, or commit real local configuration, production D1
  or R2 data, persistent volumes, or runtime state unless explicitly approved.
- Do not add dependencies or change build tooling, CI/CD, bindings, image
  publication, deployment, Portainer, domains, authentication, or external
  exposure outside the approved scope.

## Verification

Run the smallest relevant checks and then the full affected component suite
when warranted.

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

For Docker runtime changes, build and smoke-test the image when Docker is
available. Report every skipped or blocked check with the exact reason.

## Expected Report

Report changed files, a concise summary, verification commands and results,
blocked checks, subagent usage, unexpected findings or out-of-scope changes,
and design or follow-up questions for Codex.
