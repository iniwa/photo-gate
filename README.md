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
| `docs/fable/` | Project state, roadmap, and autonomy contract (operational source of truth). |
| `docs/improvements.md` | Code-improvement checklist (investigated, evidence-backed items). |
| `docs/iniwa-issues.md` | Feature ideas and operator wishlist. |

Gitea is the canonical repository; GitHub (`iniwa/photo-gate`) is the mirror
and CI/CD platform. Portainer manages the Docker stack on the Pi.

## Development workflow

1. Codex investigates, decides scope, and writes a concrete handoff under
   `docs/handoffs/` (rules in `AGENTS.md`).
2. Codex delegates it with
   `claude -p --model sonnet --effort medium --permission-mode auto "<handoff/task prompt>"`;
   Claude Code implements and verifies exactly that handoff (rules in
   `CLAUDE.md`).
3. Codex reviews the diff and report, then archives the handoff.

Improvement candidates live in `docs/improvements.md`; feature ideas in
`docs/iniwa-issues.md`. Security invariants are listed in `AGENTS.md`
(“Non-Negotiable Invariants”) and must survive every change.

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
