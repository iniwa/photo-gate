# photo-gate

Private photo-sharing gateway for family use. It publishes generated,
metadata-stripped share images through an authenticated viewer, without
exposing PhotoPrism, NAS originals, or a public storage bucket.

Production viewer: `https://share-photo.iniwach.com` (Cloudflare Workers).

## Architecture

```
PhotoPrism (NAS) --> Docker sync (Raspberry Pi 4, Portainer)
                       | re-encode via pyvips, strip metadata,
                       | upload derivatives + validated manifests
                       v
                  Private R2 bucket
                       ^
                       | reads only (session + album authorization
                       |             + manifest membership)
                  Cloudflare Workers viewer/admin (Hono + D1)
                       ^
                       v
                  Shared users (browser)
```

- Shared users only ever talk to the Workers viewer. Workers never access
  PhotoPrism or NAS, never resize images, and serve R2 objects only after
  session authentication, album authorization, and manifest membership checks.
- The Docker sync service is the only writer of photo content to R2. It
  publishes re-encoded, metadata-stripped thumbs/previews/covers and
  validated manifests — never RAW, originals, or location-bearing sources.
- R2 stays private; actual R2 deletion is intentionally disabled (dry-run
  reporting only) pending a separately reviewed deletion design.

## Repository layout

| Path | Contents |
|---|---|
| `workers/` | Cloudflare Workers viewer/admin (TypeScript, Hono, D1, private R2). See `workers/README.md`. |
| `docker/` | Python 3.12 sync CLI/daemon (PhotoPrism previews → pyvips re-encode → R2). Runtime target: Raspberry Pi 4 (`linux/arm64`). |
| `docs/decisions/` | Accepted ADRs. |
| `docs/handoffs/` | Active Codex→Claude Code handoffs (archive under `archive/`). |
| `docs/operations/` | Operator runbooks (bootstrap, deploy, rollback, backup, admin access). |
| `docs/fable/` | Project state and historical roadmap records; these do not grant authority. |
| `docs/improvements.md` | Code-improvement checklist (investigated, evidence-backed items). |
| `docs/iniwa-issues.md` | Feature ideas and operator wishlist. |

Gitea is the canonical repository; GitHub (`iniwa/photo-gate`) is the mirror
and CI/CD platform. Portainer manages the Docker stack on the Pi.

## Development workflow

1. Codex resolves requirements and material design choices. Ordinary work may
   use an inline task; substantial, cross-session, risky, or
   interruption-sensitive work uses a handoff under `docs/handoffs/`.
2. Once the outcome and protected boundaries are clear, the implementation
   writer completes the cohesive change, directly related tests and
   documentation, and focused verification (rules in `CLAUDE.md`).
3. Codex reviews the stable diff. Completed handoffs are archived only after
   implementation, verification, review, required runtime work, and follow-up
   are complete.

Improvement candidates live in `docs/improvements.md`; feature ideas in
`docs/iniwa-issues.md`. Current authority and security invariants are defined
by `AGENTS.md` and `CLAUDE.md`; `FABLE.md` and
`docs/fable/autonomy-contract.md` are historical references.

## Verification

Workers:

```powershell
Set-Location workers
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

Docker sync:

```powershell
Set-Location docker
python -m pip install -e ".[dev]"
python -m pytest
python -m compileall src
```

Some pyvips/libvips tests skip on hosts without libvips; CI runs the full
suite inside the published container image.
