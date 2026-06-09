Read `AGENTS.md`, `CLAUDE.md`, `photo-gate-design.md`, the relevant decision record, the existing Docker sync implementation, and this handoff file before implementation.
If implementation would violate constraints or require files outside this handoff, stop and ask before editing.

## Goal

Complete the non-destructive R2 upload portion of Phase 1 by implementing a production `ObjectStore` adapter for Cloudflare R2's S3-compatible API.

The adapter must support uploading generated image assets and `manifest.json` through the existing `ObjectStore.put()` contract while remaining fully testable without real R2 credentials or network access.

## Background

The existing Phase 1 sync core:

- lists PhotoPrism album photos
- fetches PhotoPrism-generated previews
- re-encodes and validates metadata-stripped share assets
- uploads image assets through an `ObjectStore` protocol
- uploads manifest last

`ObjectStore` currently has no production implementation. This handoff adds only the upload adapter. R2 reads, diff calculation, cleanup, deletion, retries, API server, and deployment remain separate work.

## Files To Inspect

- `AGENTS.md`
- `CLAUDE.md`
- `photo-gate-design.md`
- `docs/decisions/2026-06-09-use-photoprism-previews-as-sync-source.md`
- `docs/handoffs/2026-06-09-phase-1-photoprism-preview-sync-core.md`
- `docker/pyproject.toml`
- `docker/README.md`
- `docker/src/photo_gate/object_store.py`
- `docker/src/photo_gate/sync.py`
- `docker/tests/test_sync.py`
- `.gitignore`

## Files To Create Or Edit

- `docker/pyproject.toml`
- `docker/README.md`
- `docker/src/photo_gate/object_store.py`
- `docker/src/photo_gate/r2_store.py`
- `docker/tests/test_r2_store.py`

Do not edit files outside this list unless a small documentation correction is strictly required. Ask before making a design change.

## Dependency Decision

Add `boto3` as a runtime dependency.

Reason:

- Cloudflare R2 provides an S3-compatible API.
- boto3 provides mature request signing and upload behavior.
- It avoids implementing AWS Signature Version 4 manually.

Do not add aioboto3, aiobotocore, Cloudflare SDKs, retry libraries, configuration libraries, or CLI frameworks.

The existing object-store contract is async. boto3 calls are synchronous, so isolate each network call with `asyncio.to_thread()` to avoid blocking the event loop.

## Required Contracts

### R2 Configuration

Define an immutable typed configuration model for the adapter. It must contain:

- endpoint URL
- access key ID
- secret access key
- bucket name

Validation requirements:

- endpoint must be an absolute `https://` URL
- endpoint must not contain query parameters, fragments, embedded credentials, or an object path
- bucket name must be non-empty and contain only safe S3/R2 bucket-name characters
- credentials must be non-empty
- validation errors and object representations must never expose secret values

Do not read environment variables in this handoff. Configuration loading belongs to a later service/bootstrap handoff.

### R2 Object Store

Implement an `R2ObjectStore` that satisfies `ObjectStore`.

Required behavior:

- construct an S3 client configured for:
  - the supplied R2 endpoint
  - supplied access key ID and secret
  - SigV4 signing
  - `region_name="auto"`
  - path-style addressing unless a tested R2-compatible alternative is required
- `put(key, data, content_type)` uploads with:
  - bucket from configuration
  - exact object key
  - exact bytes
  - exact `ContentType`
  - `CacheControl` selected by object type:
    - image assets: `public, max-age=31536000, immutable`
    - `manifest.json`: `private, no-cache`
- reject invalid keys before calling boto3:
  - empty keys
  - leading slash
  - backslashes
  - `.` or `..` path segments
  - control characters
  - keys outside `albums/{safeAlbumId}/...`
- only allow the current schema paths:
  - `albums/{albumId}/manifest.json`
  - `albums/{albumId}/cover.webp`
  - `albums/{albumId}/thumbs/{photoUid}.webp`
  - `albums/{albumId}/previews/{photoUid}.jpg`
- reject empty content type and content types inconsistent with the key suffix
- convert boto3/botocore failures into a project-level `ObjectStoreError`
- error messages may include safe operation/key/bucket context but must never include:
  - access key ID
  - secret access key
  - endpoint query or credentials
  - request authorization headers
- do not log credentials or full boto3 request/response objects

### Object Store Contract

Keep `ObjectStore.put()` compatible with the existing sync code.

Add `ObjectStoreError` to `object_store.py` if appropriate so production adapters expose a stable project-level failure type.

Do not add read, list, head, delete, copy, or multipart-specific methods in this handoff.

## Tests

Tests must not use real R2, network access, or credentials.

Use botocore's `Stubber`, an injected/mock S3 client, or another focused boto3 testing approach that validates actual arguments passed to `put_object`.

At minimum test:

- image upload sends expected bucket, key, bytes, content type, and immutable cache control
- manifest upload sends `private, no-cache`
- boto3 call runs through the async adapter contract
- boto3/botocore error becomes `ObjectStoreError`
- error text excludes access key ID and secret
- endpoint validation rejects:
  - `http://`
  - embedded credentials
  - query strings
  - fragments
  - object paths
- key validation rejects traversal, backslashes, leading slash, unknown prefixes, unsupported suffixes, and unsafe album/photo IDs
- content type mismatch is rejected before any boto3 call
- valid cover, thumb, preview, and manifest keys are accepted

Keep tests focused on adapter behavior. Do not modify the existing sync tests to use real boto3.

## Constraints

- Preserve all architecture and security invariants in `AGENTS.md`.
- R2 remains private. Do not add public bucket configuration, ACLs, public URLs, or presigned URLs.
- Upload only. Do not implement R2 reads, listing, diffing, cleanup, or deletion.
- Do not add retries. Retry/backoff policy remains future work.
- Do not add environment-variable loading or secret files.
- Do not add a sync CLI or API server.
- Do not add Dockerfile, compose, GitHub Actions, deployment, or CI configuration.
- Do not contact real R2 during tests or verification.
- Do not touch secrets, credentials, `.env`, or local settings.
- Do not commit automatically.

## Non Goals

- real R2 integration testing
- bucket creation or configuration
- public asset URLs
- Workers changes
- manifest reads or existing-object comparison
- skip logic, cleanup, delete, trash prefix, or lifecycle rules
- multipart upload tuning
- retry/backoff
- metrics or logging framework
- service configuration loading
- sync API server
- Docker image creation
- CI/CD or deployment

## Verification

From `docker/`:

```powershell
python -m pip install -e ".[dev]"
python -m pytest
python -m py_compile src/photo_gate/object_store.py src/photo_gate/r2_store.py
```

Also run from the repository root:

```powershell
git diff --check
git status --short
```

Tests must pass without network access, Cloudflare, R2, or credentials. Existing libvips-dependent tests may remain skipped in environments without libvips; report the skip count and reason.

## Expected Report

- Changed files
- Implementation summary
- boto3/botocore versions selected
- Verification results
- Existing and newly blocked checks with reasons
- Any R2/API/security questions that should return to Codex
