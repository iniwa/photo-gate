import { isCanonicalUtcTimestamp } from './repository-validation.js'

/**
 * Fixed session lifetime: 7 days. There is no sliding refresh in the initial
 * implementation (see ADR 2026-06-11). A session expires exactly
 * SESSION_LIFETIME_SECONDS after its creation timestamp.
 */
export const SESSION_LIFETIME_SECONDS = 604_800

/**
 * Number of consecutive login failures that triggers an account lockout.
 * The 5th failure sets `locked_until`.
 */
export const MAX_LOGIN_FAILURES = 5

/**
 * Lockout duration applied once MAX_LOGIN_FAILURES is reached: 15 minutes.
 */
export const LOCKOUT_DURATION_SECONDS = 900

/**
 * Production PBKDF2 iteration count: 100,000.
 *
 * This is the Cloudflare Workers (workerd) platform cap; iteration counts above
 * 100,000 fail at runtime. It is therefore the largest practical value within
 * the platform limit. The choice and its compensating controls are documented
 * in `docs/decisions/2026-06-11-login-session-policy-and-pbkdf2-iterations.md`.
 */
export const PBKDF2_PRODUCTION_ITERATIONS = 100_000

function genericTimestampError(): Error {
  // Never include the caller-supplied value in the message.
  return new Error('invalid UTC timestamp')
}

/**
 * Computes the session expiry timestamp from a creation timestamp.
 *
 * `createdAt` must be a canonical UTC timestamp in `Date.toISOString()` format.
 * Returns `createdAt + SESSION_LIFETIME_SECONDS` as a canonical UTC string.
 * Throws a generic error (no input value in the message) on invalid input.
 */
export function sessionExpiresAtFrom(createdAt: string): string {
  if (!isCanonicalUtcTimestamp(createdAt)) throw genericTimestampError()
  return new Date(Date.parse(createdAt) + SESSION_LIFETIME_SECONDS * 1000).toISOString()
}

/**
 * Computes the lockout expiry timestamp from the current time.
 *
 * `now` must be a canonical UTC timestamp in `Date.toISOString()` format.
 * Returns `now + LOCKOUT_DURATION_SECONDS` as a canonical UTC string.
 * Throws a generic error (no input value in the message) on invalid input.
 */
export function lockoutExpiresAtFrom(now: string): string {
  if (!isCanonicalUtcTimestamp(now)) throw genericTimestampError()
  return new Date(Date.parse(now) + LOCKOUT_DURATION_SECONDS * 1000).toISOString()
}

/**
 * Decides whether an account is currently locked.
 *
 * `now` must be a canonical UTC timestamp; otherwise a generic error is thrown.
 *
 * Fail-closed semantics on the stored `locked_until` value:
 * - `null` means no lockout is recorded -> not locked.
 * - A non-null value that is not a canonical UTC timestamp is treated as
 *   corrupt D1 data and reported as locked. Authentication uncertainty always
 *   resolves to the deny side.
 * - Otherwise the lock is active while `lockedUntil > now`. Lexicographic
 *   comparison is safe because `Date.toISOString()` produces fixed-width
 *   strings; an equal value means the lock has just expired -> not locked.
 */
export function isAccountLocked(lockedUntil: string | null, now: string): boolean {
  if (!isCanonicalUtcTimestamp(now)) throw genericTimestampError()
  if (lockedUntil === null) return false
  // Fail closed: corrupt (non-canonical) locked_until is treated as locked.
  if (!isCanonicalUtcTimestamp(lockedUntil)) return true
  return lockedUntil > now
}
