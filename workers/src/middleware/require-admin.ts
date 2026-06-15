import type { MiddlewareHandler } from 'hono'
import type { AdminAuthConfig } from '../types/admin-auth.js'
import { forbiddenResponse } from './auth-response.js'

/**
 * Admin authentication boundary for `/admin`.
 *
 * Reads ONLY the `Cf-Access-Jwt-Assertion` header (no `CF_Authorization`
 * fallback), verifies it through the injected Access verifier, then checks the
 * asserted email against the administrator allowlist. Every failure class —
 * missing/invalid configuration, missing/invalid JWT, verification/JWKS failure,
 * missing/malformed email, non-allowlisted email — returns the identical generic
 * `403 Forbidden` with `Cache-Control: no-store`. No cause is revealed, and no
 * JWT, claim, email, team domain, audience, or JWKS error is logged or echoed.
 */
export function requireAdmin(resolveAuth: () => AdminAuthConfig | null): MiddlewareHandler {
  return async (c, next) => {
    let auth: AdminAuthConfig | null
    try {
      auth = resolveAuth()
    } catch {
      return forbiddenResponse(c)
    }
    if (auth === null) return forbiddenResponse(c)

    const token = c.req.header('Cf-Access-Jwt-Assertion')
    if (token === undefined || token === '') return forbiddenResponse(c)

    let rawEmail: string
    try {
      rawEmail = (await auth.verifier(token)).email
    } catch {
      return forbiddenResponse(c)
    }

    const email = normalizeEmail(rawEmail)
    if (email === null || !auth.allowlist.has(email)) {
      return forbiddenResponse(c)
    }

    await next()
  }
}

// Any whitespace (including surrounding) or ASCII/DEL control characters.
const REJECTED_EMAIL_CHARS = /[\s\x00-\x1f\x7f]/
// Minimal structural shape: exactly one @, with non-empty, @/whitespace-free sides.
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+$/

/**
 * Normalize an email for exact allowlist comparison. Rejects (returns `null`) a
 * non-string, any value containing whitespace or control characters — which also
 * rejects surrounding whitespace on the JWT email claim — or a value without a
 * basic `local@domain` shape. Returns the lowercased value for case-insensitive
 * exact matching. Applied identically to allowlist entries (after the operator's
 * comma-trim) and to the verified claim, so both sides normalize the same way.
 */
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  if (value.length === 0 || value.length > 256) return null
  if (REJECTED_EMAIL_CHARS.test(value)) return null
  if (!EMAIL_SHAPE.test(value)) return null
  return value.toLowerCase()
}

/**
 * Parse `ADMIN_EMAILS` into a normalized allowlist. The value is a comma-separated
 * list; each entry is trimmed of surrounding whitespace and then normalized. The
 * configuration is rejected fail closed (returns `null`) when it is missing, has
 * an empty/whitespace-only entry (e.g. a trailing comma), contains a malformed
 * email, or yields no entries — never a silently empty allowlist.
 */
export function parseAdminAllowlist(raw: string | undefined): ReadonlySet<string> | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null
  const allowlist = new Set<string>()
  for (const part of raw.split(',')) {
    const normalized = normalizeEmail(part.trim())
    if (normalized === null) return null
    allowlist.add(normalized)
  }
  if (allowlist.size === 0) return null
  return allowlist
}
