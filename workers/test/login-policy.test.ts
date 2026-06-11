import { describe, it, expect } from 'vitest'
import {
  SESSION_LIFETIME_SECONDS,
  MAX_LOGIN_FAILURES,
  LOCKOUT_DURATION_SECONDS,
  PBKDF2_PRODUCTION_ITERATIONS,
  sessionExpiresAtFrom,
  lockoutExpiresAtFrom,
  isAccountLocked,
} from '../src/services/login-policy.js'
import { MIN_ITERATIONS, MAX_ITERATIONS } from '../src/services/auth-crypto.js'

const INVALID_TIMESTAMPS = [
  '',
  '2026-06-11T00:00:00Z', // missing milliseconds
  '2026-06-11T09:00:00.000+09:00', // non-UTC offset
  'not-a-date',
  '2026-06-11T00:00:00.000z', // lowercase z
  '2026-06-11T00:00:00.000Z garbage', // valid prefix with suffix
]

describe('login-policy constants', () => {
  it('has the decided values', () => {
    expect(SESSION_LIFETIME_SECONDS).toBe(604800)
    expect(MAX_LOGIN_FAILURES).toBe(5)
    expect(LOCKOUT_DURATION_SECONDS).toBe(900)
    expect(PBKDF2_PRODUCTION_ITERATIONS).toBe(100000)
  })

  it('keeps PBKDF2_PRODUCTION_ITERATIONS within the crypto allowed range', () => {
    expect(PBKDF2_PRODUCTION_ITERATIONS).toBeGreaterThanOrEqual(MIN_ITERATIONS)
    expect(PBKDF2_PRODUCTION_ITERATIONS).toBeLessThanOrEqual(MAX_ITERATIONS)
  })
})

describe('sessionExpiresAtFrom', () => {
  it('adds exactly 7 days', () => {
    expect(sessionExpiresAtFrom('2026-06-11T00:00:00.000Z')).toBe('2026-06-18T00:00:00.000Z')
  })

  it('returns a canonical timestamp that round-trips', () => {
    const out = sessionExpiresAtFrom('2026-06-11T12:34:56.789Z')
    expect(new Date(out).toISOString()).toBe(out)
  })

  it('handles a month/year boundary', () => {
    expect(sessionExpiresAtFrom('2026-12-28T00:00:00.000Z')).toBe('2027-01-04T00:00:00.000Z')
  })

  it('rejects invalid timestamps without echoing the input', () => {
    for (const value of INVALID_TIMESTAMPS) {
      expect(() => sessionExpiresAtFrom(value)).toThrow()
      try {
        sessionExpiresAtFrom(value)
      } catch (e) {
        if (e instanceof Error && value.length > 0) expect(e.message).not.toContain(value)
      }
    }
  })
})

describe('lockoutExpiresAtFrom', () => {
  it('adds exactly 900 seconds', () => {
    expect(lockoutExpiresAtFrom('2026-06-11T00:00:00.000Z')).toBe('2026-06-11T00:15:00.000Z')
  })

  it('returns a canonical timestamp that round-trips', () => {
    const out = lockoutExpiresAtFrom('2026-06-11T23:59:59.999Z')
    expect(new Date(out).toISOString()).toBe(out)
  })

  it('rejects invalid timestamps without echoing the input', () => {
    for (const value of INVALID_TIMESTAMPS) {
      expect(() => lockoutExpiresAtFrom(value)).toThrow()
      try {
        lockoutExpiresAtFrom(value)
      } catch (e) {
        if (e instanceof Error && value.length > 0) expect(e.message).not.toContain(value)
      }
    }
  })
})

describe('isAccountLocked', () => {
  const NOW = '2026-06-11T00:00:00.000Z'

  it('returns false when lockedUntil is null', () => {
    expect(isAccountLocked(null, NOW)).toBe(false)
  })

  it('returns true when lockedUntil is in the future', () => {
    expect(isAccountLocked('2026-06-11T00:15:00.000Z', NOW)).toBe(true)
  })

  it('returns false when lockedUntil is in the past', () => {
    expect(isAccountLocked('2026-06-10T23:45:00.000Z', NOW)).toBe(false)
  })

  it('returns false when lockedUntil exactly equals now', () => {
    expect(isAccountLocked(NOW, NOW)).toBe(false)
  })

  it('fails closed (true) for a malformed non-null lockedUntil', () => {
    expect(isAccountLocked('not-a-date', NOW)).toBe(true)
    expect(isAccountLocked('2026-06-11T00:00:00Z', NOW)).toBe(true)
    expect(isAccountLocked('', NOW)).toBe(true)
  })

  it('throws when now is non-canonical', () => {
    expect(() => isAccountLocked(null, '2026-06-11T00:00:00Z')).toThrow()
    expect(() => isAccountLocked('2026-06-11T00:15:00.000Z', 'not-a-date')).toThrow()
  })

  it('distinguishes timestamps 1ms apart in both directions', () => {
    expect(isAccountLocked('2026-06-11T00:00:00.001Z', NOW)).toBe(true)
    expect(isAccountLocked('2026-06-10T23:59:59.999Z', NOW)).toBe(false)
  })
})
