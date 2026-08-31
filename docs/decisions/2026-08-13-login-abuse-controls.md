# Login Abuse Controls

Date: 2026-08-13

Status: Accepted

## Context

Password verification uses PBKDF2 in the Worker. The existing D1 account
lockout protects a known account over time, but it does not prevent many cheap
malformed or unknown-account submissions from consuming Worker CPU before the
database policy can help.

## Decision

`POST /api/auth/login` now accepts only a streamed, URL-encoded form no larger
than 4 KiB. It rejects an excessive `Content-Length`, streamed oversize body,
or invalid UTF-8 before rate-limit, D1, or PBKDF2 work.

After shape validation and before D1/PBKDF2, the Worker consumes two native
Cloudflare Rate Limit bindings:

| Binding | Key | Limit |
|---|---|---|
| `LOGIN_ACCOUNT_RATE_LIMIT` | canonical submitted user ID, or one `invalid` bucket | 5 attempts / 60 seconds |
| `LOGIN_NETWORK_RATE_LIMIT` | validated `CF-Connecting-IP`, or `unknown` | 30 attempts / 60 seconds |

When either binding denies an attempt, the Worker returns sanitized `429` with
`Cache-Control: no-store` and `Retry-After: 60`. Binding failure returns a
sanitized `503`, rather than bypassing a security control.

The account limit and the existing D1 lockout remain the primary controls. The
network limit is intentionally looser and only prevents high-cardinality
unknown-ID attempts from turning into an unbounded PBKDF2 workload. It may
group legitimate users behind a mobile carrier or NAT, so it is not an identity
or authorization mechanism.

## Consequences

The binding namespaces are distinct positive integers in `wrangler.toml`, and
the integration smoke executes the deployed route stack with both local Rate
Limit bindings. Rate limits are a per-location best-effort layer; they do not
replace password verification, D1 account state, or session authorization.

No password, token, submitted identifier, or client IP is rendered or logged by
this control. The Worker still returns the pre-existing generic login failure
for ordinary credential failures.
