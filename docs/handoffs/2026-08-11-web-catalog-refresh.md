# Web Catalog Refresh

Date: 2026-08-11

## Goal

Remove the Raspberry Pi shell step from the normal new-album sharing flow. An
administrator must be able to refresh the safe PhotoPrism album catalog by
using the existing Access-protected **Sync Now** control in the web UI.

## Accepted Basis

`docs/decisions/2026-06-26-admin-browser-management.md` already specifies
best-effort catalog publication at daemon startup and after each successful
sync. This work implements that approved cadence without changing the existing
single-object sync request protocol.

## Scope

- `sync-daemon` invokes the existing `publish-catalog` composition function:
  - once after daemon startup; and
  - once after each successful sync attempt.
- A catalog publication failure is a sanitized warning only. It must not alter
  the sync result, health file, `runsCompleted`, Docker HEALTHCHECK, manual
  request consumption, or retry behavior.
- The existing `POST /admin/sync/request` request remains exactly
  `kind=sync-now`; no new Worker route, R2 request key, schema version, D1
  migration, secret, PhotoPrism/NAS access path, or public exposure is added.
- Docker package version advances from `0.4.2` to `0.4.3`.
- Operator guidance changes from a Pi command to `/admin/sync` -> **Sync Now**
  -> wait for completion -> reload `/admin/albums`.

## Explicit Non-Goals

- No Worker calls to PhotoPrism, NAS, Docker, Portainer, or the Docker socket.
- No R2 public access, R2 deletion, D1 access from Docker, or raw PhotoPrism
  UID in HTML, logs, catalog JSON, sync-request JSON, or sync-target JSON.
- No catalog-based D1 album creation. The existing write-only PhotoPrism UID
  field and current album creation flow remain unchanged.
- No push, image tag, GHCR release, Portainer update, or production mutation
  without a separate operator approval.

## Acceptance Criteria

1. A daemon started through `photo-gate-sync sync-daemon` attempts a catalog
   publication once before its first sync attempt.
2. Each successful attempt triggers one further catalog publication; failed
   attempts do not.
3. A publisher return code other than zero or an exception leaves the daemon
   exit code, health state, sync result, and completed-run counter unchanged,
   and its warning reveals no exception message or sensitive value.
4. The normal web workflow requires only the existing admin **Sync Now**
   request and a page reload after sync completion.
5. Focused daemon tests, the full Docker pytest suite, `compileall`, and
   `git diff --check` pass. A Docker image build/smoke runs when the local
   daemon is available; otherwise its exact block is recorded.

## Release And Live Verification

After local review and explicit approval:

1. Commit the scoped Docker and documentation changes on a dedicated branch.
2. Push `main`, create and push `sync-v0.4.3`, and wait for docker-ci to build
   the immutable GHCR image.
3. Update the Portainer stack from `0.4.2` to `0.4.3`.
4. In the web admin UI, create a disposable PhotoPrism album, press **Sync
   Now**, wait for completion, reload `/admin/albums`, and verify that only
   sanitized catalog fields appear in the picker. Do not expose or copy a raw
   PhotoPrism UID into the report.

## Implementation Record

- Implemented locally: daemon wiring, Docker `0.4.3` package version, tests,
  Docker README, and operator workflow.
- Focused verification: `python -m pytest tests/test_daemon.py
  tests/test_main.py` -> 106 passed.
- Full Docker verification: `python -m pytest` -> 446 passed, 46 skipped;
  `python -m compileall src` -> success; `git diff --check` -> no diff errors.
- Not run locally: Docker image build/smoke because Docker Desktop's Linux
  engine is unavailable. `python -m pip install -e ".[dev]"` is also blocked
  because this Windows host has Python 3.11 only while the package requires
  Python 3.12+. CI and the target image remain the 3.12 verification path.
- No commit, push, tag, GHCR release, Portainer update, or production mutation
  has been performed by this handoff.
