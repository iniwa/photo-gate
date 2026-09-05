# AGENTS.md

## Purpose and entry

`photo-gate` privately shares selected PhotoPrism albums. Docker sync publishes
only generated, re-encoded, metadata-stripped derivatives to private R2;
Workers owns login, sessions, D1 authorization, manifests, viewer/admin routes,
and private object delivery. Workers never accesses PhotoPrism or NAS; Docker
never implements viewer authentication or D1 authorization.

`CLAUDE.md` is a compatibility pointer only. It does not define policy. Before
meaningful work, read this entry, the applicable accepted decision, the current
state, and the relevant conditional document:

- [project context](docs/fable/project-context.md) and [current state](docs/fable/current-state.md)
- [engineering rules](docs/fable/engineering-rules.md) and [definition of done](docs/fable/definition-of-done.md)
- [operator actions](docs/operations/operator-actions.md), [bootstrap](docs/operations/bootstrap.md), [backup](docs/operations/backup.md), or [rollback](docs/operations/rollback.md) when operational work is in scope
- active [handoffs](docs/handoffs/) and relevant [accepted decisions](docs/decisions/)

FABLE, `photo-gate-design.md`, archived handoffs, and historical progress are
context only. The real project documents and accepted decisions are canonical;
shared generation policy supplies only common defaults and does not override
these project contracts.

## Authority, scope, and ownership

Apply runtime, tool, organization, and safety policy first, then explicit user
policy, current task prohibitions/edit limits, durable project rules, the
approved outcome, and verified facts. Task prohibitions narrow standing
permissions; facts show what exists, not what is authorized. Resolve conflicts
through accepted decisions and current state. Preserve unrelated work and
retained history; keep one writer for overlapping files. Choose the smallest
correct change. Select one route: `small-primary`, `bounded`, `adaptive`, or
`non-implementation`. Select work by role when delegation is useful;
configuration owns model, effort, and role-specific instructions, and the
user's runtime choice remains authoritative. The primary owns interpretation,
approval boundaries, integration, and communication. Delegated work does not
redelegate. If a configured role is unavailable or unobservable, use the
primary or an observable equivalent and record the actual route.

Do not edit secrets, credentials, `.env`, real local configuration, PhotoPrism
or NAS originals, production D1/R2 data, persistent volumes, runtime state, or
heavy generated artifacts unless explicitly required. Do not push, merge,
publish, deploy, mutate infrastructure or remote state, change authentication
or exposure, delete data/resources, rotate credentials, or change a protected
contract without the current user's explicit approval and the relevant project
gate. Routine bounded reversible changes may use the established known
procedure on the existing user-controlled target; this allowance does not
cover the protected operations above, and a task prohibition overrides it.
Local commits require a stable owned diff and passed required checks; primary
handles repository operations.

## Non-negotiable product and security gates

- R2 stays private. Publish only generated share thumbnails, previews, covers,
  and validated manifests; never publish RAW/RW2, originals, PhotoPrism data,
  GPS/location-bearing files, secrets, or credentials.
- Every real viewer data route validates the session, enabled user, album
  permission, and (for photos) exact membership in the current validated
  manifest before constructing a standard private R2 key. Uncertainty fails
  closed; do not forward R2 metadata or caller-controlled content types.
- Docker re-encodes every source and validates removal of EXIF, XMP, IPTC, GPS,
  and related metadata. Upload referenced objects before publishing the
  manifest. Workers does not resize, develop RAW, strip metadata, or access
  NAS originals.
- R2 cleanup is dry-run only. Actual deletion, D1 destructive migration,
  persistent-data deletion, resource deletion, public access, and exposure
  changes require a separately reviewed design and explicit human approval.
- Keep D1 queries parameterized, IDs/object keys strictly validated, errors
  sanitized, and authenticated HTML/objects out of shared caches. Preserve
  `DB` and `PHOTO_BUCKET` binding names, immutable Docker release tags,
  additive-only migration policy, and the existing Gitea → GitHub CI → GHCR →
  Portainer flow.
- Human responsibilities remain for initial account/infrastructure selection,
  secret values, Access/DNS decisions, and protected live operations. Never
  place protected values in reports, prompts, logs, fixtures, or commits.

## Execution and verification

For implementation, inspect the relevant code and accepted decision, establish
acceptance and protected behavior, make the focused change, and self-review the
stable diff. A writer owns related discovery, implementation, verification, and
minor corrections through that self-gate. Use conditional review only for a
named material correctness, security, data, compatibility, cross-system, or
verification risk. Review starts only after the candidate is stable; any later
candidate change invalidates that review and requires restabilization before a
fresh review. At the second correction round, or after two qualifying blocked
or partial returns, pause and reset acceptance, authority, permissions,
environment, and evidence, then choose one writer (bounded or adaptive as
warranted). Parent permissions remain authoritative; explorers/reviewers stay
read-only. Run the smallest relevant check, then the affected component suite
when its contract requires it. Required target application or smoke is
separate from source readiness; unavailable checks are reported as blocked,
never passed. For documentation-only work, verify links, fences, commands,
scope, and `git diff --check` without inventing runtime tests.

Workers verification:

```powershell
Set-Location workers
npm run lint
npm run typecheck
npm test
npm run build
npm audit
```

Docker verification:

```powershell
Set-Location docker
python -m pytest
python -m compileall src
```

Cheap direct regression tests are optional when they directly verify the
change; do not add a full suite, independent review, or defensive hardening solely
because an optional check was omitted. Add focused regression coverage when a
behavioral bug or security contract requires it. Never auto-update golden
expectations. Before any authorized application, complete the stable-diff and
required pre-application gate; smoke normal use only through the established
target procedure and record observed failures and exact resume conditions.

## Documentation lifecycle

Keep durable current rules here, rationale in `docs/decisions/`, current facts
in `docs/fable/current-state.md`, operational procedures in `docs/operations/`,
and active work in `docs/handoffs/`. Archive handoffs only after implementation,
verification, review, required runtime work, and follow-up are complete. Do not
rewrite accepted decisions, archived history, immutable evidence, or historical
FABLE text merely to normalize vocabulary. Update current state and operator
docs when verified deployment facts change.

If work is delegated, the writer owns related discovery, implementation,
verification, and minor corrections through a stable self-gate. Return only at
an approval/design gate, unsafe overlap, permission/environment blocker, or
acceptance outside scope. Report changed files, material effects, focused
checks and outcomes, preserved gates, blocked/unmet criteria, and exact resume
conditions. Do not claim runtime or deployment success from documentation
checks.
