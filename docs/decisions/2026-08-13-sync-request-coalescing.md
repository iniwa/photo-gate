# Sync Request Coalescing

Date: 2026-08-13

Status: Accepted

## Context

The Worker and Docker daemon use one fixed private R2 object for each pending
operation: `ops/sync-request.json` for image sync and
`ops/catalog-refresh-request.json` for catalog-only refresh. The original sync
request design allowed a later browser submission to overwrite an unconsumed
request at the same key. The daemon still executed at most one operation, but
the first request ID and timestamp could be lost before it observed them.

## Decision

The Worker creates each pending request with R2's create-only conditional write:
`onlyIf: { etagDoesNotMatch: '*' }`.

- A successful conditional write returns `created`.
- A pre-existing pending object returns `already-pending`; it is not replaced.
- Both outcomes redirect to the existing admin sync-status page. The page's
  existing pending indicator remains the operator-visible feedback.
- Docker continues to validate and consume the same schema-1 objects, then
  deletes them best-effort. Once the object is gone, a later request can be
  created normally.

This supersedes only the rapid-submission overwrite behavior in
`2026-06-25-sync-request-controls.md`; its R2 bridge, schema, validation,
staleness, and Docker boundary decisions remain in force.

## Consequences

There is one pending request per operation kind, not a queue. Repeated clicks
coalesce deliberately rather than creating a batch, adding D1 state, or adding
Workers-to-Docker connectivity. The change creates no public R2 access and does
not alter the request body, object key, daemon polling, image processing, or
manifest publication behavior.

R2 write failures remain fail-closed as sanitized admin 500 responses. Tests
cover the successful conditional write, the already-pending outcome, and the
unchanged Docker request contract.
