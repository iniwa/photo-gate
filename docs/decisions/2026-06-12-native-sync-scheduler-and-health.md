# Native sync scheduler and health file (0.2.0)

Date: 2026-06-12

## Context

Until 0.1.x the container ran a shell loop (`while true; do ... sleep; done`)
around `sync-once` and had no structured health visibility.  The loop had three
drawbacks:

1. **Signal handling**: SIGTERM sent by Docker/Portainer hit the `sh` PID; the
   Python process was killed mid-sync rather than finishing gracefully.
2. **Health visibility**: there was no machine-readable indication of how many
   consecutive failures had occurred, when the last sync ran, or whether the
   process was still alive.
3. **Junk-env defence**: the INTERVAL normalization shell code had to live
   outside Python and could not be unit-tested.

## Decision

Introduce a `sync-daemon` subcommand that replaces the shell loop and a
`healthcheck` subcommand for Docker HEALTHCHECK.

### Why in-process scheduler over cron / external loop

* Python asyncio can register `SIGTERM` / `SIGINT` handlers and finish an
  in-progress sync before exiting — the shell loop could not.
* The daemon writes a JSON health file (`HealthState`) on every heartbeat and
  after every attempt, giving operators structured visibility.
* The junk-env defence (INTERVAL normalization, CF_ACCESS guard) stays in
  the compose shell snippet because Portainer injects environment variables
  before the entrypoint shell runs; Python can read the already-normalized
  `$$INTERVAL` value.

### Health model

`HealthState` (frozen dataclass, schema=1) written to a JSON file atomically
(`<path>.tmp` then `os.replace`):

| Field | Purpose |
|---|---|
| `heartbeat_at` | Updated every `heartbeat_period` seconds (default 60s) |
| `consecutive_failures` | Reset to 0 on success; incremented on exit-code 1 |
| `last_result` | `"ok"` / `"failed"` / `None` |
| `last_error` | The sanitized failure description from `_describe_error` (the exact text `run_sync_once` prints to stderr), or `None`. Unknown exception types — including all httpx types, whose messages can embed PhotoPrism preview-token URLs — are reduced to their class name before they reach this field. |
| `runs_completed` | Monotonically increasing; useful for detecting a stuck daemon |

Docker HEALTHCHECK (`HEALTHCHECK --interval=60s ...`) calls
`photo-gate-sync healthcheck` which checks:

1. Health file exists and parses as schema=1.
2. `consecutive_failures` < threshold (default 3).
3. `heartbeat_at` is not stale (default 300 s).

Docker marks a container `unhealthy` but does **not** restart it by default
(restart policy is on the `photo-gate-sync` service, not HEALTHCHECK).  The
healthcheck is **visibility-only**: operators see the unhealthy status in
Portainer and can investigate without an automated restart loop masking
persistent failures.

### Log sanitization rule

`run_sync_once` already enforces `_SANITIZED_ERROR_TYPES`: only exception
types whose messages are known-safe (no tokens, no URLs) are printed; all
others print class name only.  `run_sync_daemon` does not bypass this — it
records exactly the string `run_sync_once` produced (via an `error_sink`
callback) into `last_error`, so the health file and stderr share one
sanitization boundary and the file adds no new exposure.

### Shutdown semantics

On SIGTERM/SIGINT the daemon stops promptly when sleeping; an in-flight
sync attempt is allowed to finish rather than being cancelled.  Docker's
stop grace period (10 s by default) may SIGKILL the process before a long
sync completes — this is safe by design: every upload is a whole-object
PUT and the manifest is uploaded last, so an interrupted sync leaves the
album at its previous consistent state.

## Consequences

* The `while true` shell loop and `sleep` in `portainer-stack.yml` are
  replaced by `exec photo-gate-sync sync-daemon ...`.  The junk-env normalization
  case guards remain in the shell snippet.
* `pyproject.toml` version bumped to 0.2.0.
* Docker image gains a HEALTHCHECK instruction.
* New test file `docker/tests/test_daemon.py` covers arg validation, run
  counting, failure counting, health file content, and healthcheck exit codes
  without any network or libvips dependency.
