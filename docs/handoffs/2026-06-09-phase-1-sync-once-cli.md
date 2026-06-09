Read `AGENTS.md`, `CLAUDE.md`, `photo-gate-design.md`, the existing Phase 1 handoffs, the Docker sync implementation, and this handoff file before implementation.
If implementation would violate constraints or require files outside this handoff, stop and ask before editing.

## Goal

Add a safe, testable one-shot command-line entrypoint that wires the existing PhotoPrism client, image settings, R2 object store, and `sync_album()` orchestration together.

The command is an operator/development entrypoint for syncing one explicitly specified album. It must not start an HTTP server, schedule jobs, delete objects, or contact real services during tests.

## Background

Phase 1 currently provides:

- PhotoPrism album photo listing and preview download
- metadata-stripped thumb/preview generation
- deterministic manifest generation
- manifest-last sync orchestration
- production Cloudflare R2 upload adapter

There is not yet an executable composition root that validates configuration and invokes these pieces. This handoff adds that composition root while keeping all destructive and server behavior out of scope.

Because this command can upload to real R2, accidental execution must be prevented. A real sync requires both a complete configuration and an explicit `--confirm-upload` flag.

## Files To Inspect

- `AGENTS.md`
- `CLAUDE.md`
- `photo-gate-design.md`
- `docs/handoffs/2026-06-09-phase-1-photoprism-preview-sync-core.md`
- `docs/handoffs/2026-06-09-phase-1-r2-object-store.md`
- `docker/pyproject.toml`
- `docker/README.md`
- `docker/src/photo_gate/models.py`
- `docker/src/photo_gate/photoprism_client.py`
- `docker/src/photo_gate/r2_store.py`
- `docker/src/photo_gate/sync.py`
- `docker/tests/test_sync.py`
- `.gitignore`

## Files To Create Or Edit

- `docker/pyproject.toml`
- `docker/README.md`
- `docker/src/photo_gate/config.py`
- `docker/src/photo_gate/main.py`
- `docker/tests/test_config.py`
- `docker/tests/test_main.py`
- `docker/scripts/sync-once.sh`
- `docker/scripts/.gitkeep` (remove after adding the real script)

Do not edit files outside this list unless a small documentation correction is strictly required. Ask before making a design change.

## Dependency Decision

Use only the Python standard library and existing runtime dependencies.

- CLI parsing: `argparse`
- environment access: `os.environ`
- timestamps: `datetime`
- async execution: `asyncio`

Do not add dotenv, Pydantic, Typer, Click, Rich, logging frameworks, or configuration libraries.

## Required CLI Contract

Add a console script in `docker/pyproject.toml`:

```toml
[project.scripts]
photo-gate-sync = "photo_gate.main:main"
```

Support:

```text
photo-gate-sync sync-once [options]
```

Required options:

- `--album-id`
- `--album-title`
- `--photoprism-album-uid`
- `--confirm-upload`

Optional options:

- `--concurrency`, default `2`
- `--thumb-long-edge`, default `640`
- `--thumb-quality`, default `80`
- `--preview-long-edge`, default `3840`
- `--preview-quality`, default `88`

Behavior:

- `sync-once` must refuse to run unless `--confirm-upload` is present.
- Refusal must happen before constructing service clients or making any network call.
- Invalid identifiers, image settings, and non-positive concurrency must fail before constructing service clients.
- Use a timezone-aware UTC generation timestamp.
- Create `PhotoPrismClient`, `R2ObjectStore`, and call `sync_album()` exactly once.
- Close `PhotoPrismClient` on success and failure.
- Return exit code:
  - `0`: success
  - `2`: argument/configuration/confirmation error
  - `1`: runtime sync failure
- Do not add dry-run semantics. The command either refuses before execution or performs the upload.
- Do not print per-object keys, PhotoPrism hashes, tokens, credentials, or service response bodies.

## Configuration Contract

Add an immutable typed application configuration model and a loader that reads only the current process environment.

Required environment variables:

```text
PHOTOPRISM_URL
PHOTOPRISM_TOKEN
R2_ENDPOINT_URL
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET
```

Optional environment variables:

```text
CF_ACCESS_CLIENT_ID
CF_ACCESS_CLIENT_SECRET
```

Validation:

- trim surrounding whitespace from non-secret URL/bucket values before validation
- do not silently trim or transform credential/token values
- required values must be non-empty
- `PHOTOPRISM_URL` must be an absolute `https://` URL with no embedded credentials, query, or fragment
- `PHOTOPRISM_URL` may have a path prefix but normalize away the trailing slash
- validate R2 fields by constructing the existing `R2Config`
- if only one Cloudflare Access credential is set, reject the configuration; both or neither are allowed
- configuration objects must use `repr=False` or explicit redaction so tokens and credentials never appear in representations
- configuration errors must name the missing/invalid variable but never include its secret value

Do not:

- read `.env`
- accept secrets as CLI flags
- write configuration files
- read Docker secrets files
- provide defaults for credentials or endpoints

## Composition And Testability

Keep `main()` thin.

Provide an async composition function for `sync-once` that accepts injectable factories/callables for the PhotoPrism client, R2 store, clock, and sync function. Production defaults may wire the real implementations.

Tests must be able to prove behavior without:

- network access
- real credentials
- boto3 requests
- PhotoPrism
- R2
- libvips

Do not import or initialize pyvips-dependent sync code at module import time if that would prevent CLI/config tests in environments without libvips. Defer imports or inject dependencies as needed.

## Output And Secret Safety

Use concise standard output/error messages.

Allowed output:

- success/failure summary
- safe album ID
- photo count only if the sync contract later returns it; do not change `sync_album()` solely for this

Never output:

- environment values
- PhotoPrism bearer token
- preview token
- Cloudflare Access client ID/secret
- R2 access key ID/secret
- complete exception representations from boto3/httpx when they might contain sensitive request data

For runtime failures, print a safe high-level message and return `1`. Preserve the original exception for tests/internal control flow only if it cannot leak through output.

## Shell Wrapper

Create `docker/scripts/sync-once.sh`:

- POSIX shell
- `set -eu`
- executes `photo-gate-sync sync-once "$@"`
- contains no defaults or secrets
- does not source `.env`

## Tests

At minimum test:

- all required environment variables load successfully
- each missing required variable is reported by name
- secrets do not appear in config `repr` or error messages
- invalid PhotoPrism URL is rejected
- invalid R2 configuration is rejected safely
- only one Cloudflare Access credential is rejected
- CLI refuses without `--confirm-upload` before any factory is called
- invalid concurrency/image settings/identifiers fail before any factory is called
- successful command constructs clients with expected safe values and calls sync exactly once
- PhotoPrism client is closed on success
- PhotoPrism client is closed on sync failure
- runtime failure returns `1` and does not print injected secret strings
- argument/configuration failures return `2`
- `--help` works without configuration or service imports

Use monkeypatch/fakes/injected factories. Tests must not contact real services or require libvips.

## Constraints

- Preserve all architecture and security invariants in `AGENTS.md`.
- This command uploads to R2 only after explicit `--confirm-upload`.
- Do not implement an HTTP API/server.
- Do not implement job state or scheduling.
- Do not implement R2 reads, listing, diffing, cleanup, deletion, or retries.
- Do not add `.env` loading.
- Do not accept secrets on CLI flags.
- Do not add Dockerfile, compose, GitHub Actions, deployment, or CI configuration.
- Do not contact real PhotoPrism, R2, or Cloudflare in tests.
- Do not touch real secrets, credentials, `.env`, or local settings.
- Do not commit automatically.

## Non Goals

- sync HTTP API
- background workers or queues
- persistent job status
- real integration testing
- R2 cleanup or deletion
- existing-object diff/skip logic
- retries/backoff
- Docker image creation
- Portainer configuration
- Cloudflare Tunnel configuration
- CI/CD
- Workers implementation

## Verification

From `docker/`:

```powershell
python -m pip install -e ".[dev]"
python -m pytest
python -m py_compile src/photo_gate/config.py src/photo_gate/main.py
photo-gate-sync --help
photo-gate-sync sync-once --help
```

Also run from the repository root:

```powershell
git diff --check
git status --short
```

Tests and help commands must work without network access, real credentials, PhotoPrism, R2, Cloudflare, or libvips. Existing libvips-dependent image/sync tests may remain skipped; report the count and reason.

## Expected Report

- Changed files
- Implementation summary
- CLI usage summary
- Verification results
- Existing and newly blocked checks with reasons
- Any configuration/CLI/security questions that should return to Codex
