import { describe, it, expect } from 'vitest'
import { AuthRepository } from '../src/services/auth-repository.js'
import { makeMockDb } from './helpers/mock-d1.js'
import type { UserAuthRow } from '../src/types/user.js'

const VALID_USER_ID = 'user-abc-123'
const NOW = '2026-06-09T00:00:00.000Z'
const LOCKED_UNTIL = '2026-06-09T00:15:00.000Z'
const THRESHOLD = 5

const SAMPLE_ROW: UserAuthRow = {
  id: VALID_USER_ID,
  password_hash: 'pbkdf2-sha256$100000$salt$digest',
  enabled: 1,
  fail_count: 0,
  locked_until: null,
}

describe('AuthRepository.fetchUserForAuth', () => {
  it('issues a parameterized SELECT with the user ID', async () => {
    const { db, queries } = makeMockDb([{ first: SAMPLE_ROW }])
    const repo = new AuthRepository(db)
    await repo.fetchUserForAuth(VALID_USER_ID)
    expect(queries).toHaveLength(1)
    expect(queries[0]?.sql).toContain('SELECT')
    expect(queries[0]?.sql).toContain('FROM users')
    expect(queries[0]?.sql).toContain('?')
    expect(queries[0]?.params).toContain(VALID_USER_ID)
  })

  it('SQL does not contain the user ID as a literal string', async () => {
    const { db, queries } = makeMockDb([{ first: SAMPLE_ROW }])
    await new AuthRepository(db).fetchUserForAuth(VALID_USER_ID)
    expect(queries[0]?.sql).not.toContain(VALID_USER_ID)
  })

  it('returns the user row when found', async () => {
    const { db } = makeMockDb([{ first: SAMPLE_ROW }])
    const result = await new AuthRepository(db).fetchUserForAuth(VALID_USER_ID)
    expect(result).toEqual(SAMPLE_ROW)
  })

  it('returns null when not found', async () => {
    const { db } = makeMockDb([{ first: null }])
    const result = await new AuthRepository(db).fetchUserForAuth(VALID_USER_ID)
    expect(result).toBeNull()
  })

  it('returns null without hitting D1 for an invalid ID', async () => {
    const { db, queries } = makeMockDb([])
    const result = await new AuthRepository(db).fetchUserForAuth('!invalid!')
    expect(result).toBeNull()
    expect(queries).toHaveLength(0)
  })

  it('returns null for an empty string ID', async () => {
    const { db, queries } = makeMockDb([])
    expect(await new AuthRepository(db).fetchUserForAuth('')).toBeNull()
    expect(queries).toHaveLength(0)
  })

  it('does not expose D1 error details when D1 throws', async () => {
    const { db } = makeMockDb([{ throws: new Error('sensitive D1 details') }])
    await expect(new AuthRepository(db).fetchUserForAuth(VALID_USER_ID)).rejects.toThrow(
      'database operation failed',
    )
  })

  it('only fetches enabled users', async () => {
    const { db, queries } = makeMockDb([{ first: SAMPLE_ROW }])
    await new AuthRepository(db).fetchUserForAuth(VALID_USER_ID)
    expect(queries[0]?.sql).toMatch(/enabled\s*=\s*1/)
  })
})

describe('AuthRepository.recordLoginFailure', () => {
  it('issues a parameterized UPDATE binding the 4 params in order', async () => {
    const { db, queries } = makeMockDb([{}])
    await new AuthRepository(db).recordLoginFailure(VALID_USER_ID, NOW, THRESHOLD, LOCKED_UNTIL)
    expect(queries).toHaveLength(1)
    expect(queries[0]?.sql).toContain('UPDATE users')
    expect(queries[0]?.sql).toContain('fail_count')
    expect(queries[0]?.sql).toContain('?')
    expect(queries[0]?.params).toEqual([THRESHOLD, LOCKED_UNTIL, NOW, VALID_USER_ID])
  })

  it('SQL does not contain caller values as literals', async () => {
    const { db, queries } = makeMockDb([{}])
    await new AuthRepository(db).recordLoginFailure(VALID_USER_ID, NOW, THRESHOLD, LOCKED_UNTIL)
    expect(queries[0]?.sql).not.toContain(VALID_USER_ID)
    expect(queries[0]?.sql).not.toContain(NOW)
    expect(queries[0]?.sql).not.toContain(LOCKED_UNTIL)
  })

  it('increments fail_count via SQL expression, not application logic', async () => {
    const { db, queries } = makeMockDb([{}])
    await new AuthRepository(db).recordLoginFailure(VALID_USER_ID, NOW, THRESHOLD, LOCKED_UNTIL)
    expect(queries[0]?.sql).toMatch(/fail_count\s*=\s*fail_count\s*\+\s*1/)
  })

  it('applies the lockout atomically via a CASE WHEN threshold expression', async () => {
    const { db, queries } = makeMockDb([{}])
    await new AuthRepository(db).recordLoginFailure(VALID_USER_ID, NOW, THRESHOLD, LOCKED_UNTIL)
    expect(queries[0]?.sql).toMatch(/locked_until\s*=\s*CASE\s+WHEN/i)
    expect(queries[0]?.sql).toMatch(/fail_count\s*\+\s*1\s*>=\s*\?/)
    expect(queries[0]?.sql).toMatch(/ELSE\s+locked_until\s+END/i)
  })

  it('throws for an invalid user ID without hitting D1', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AuthRepository(db).recordLoginFailure('!bad!', NOW, THRESHOLD, LOCKED_UNTIL),
    ).rejects.toThrow()
    expect(queries).toHaveLength(0)
  })

  it('throws for a non-canonical now without hitting D1', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AuthRepository(db).recordLoginFailure(VALID_USER_ID, '2026-06-09T00:00:00Z', THRESHOLD, LOCKED_UNTIL),
    ).rejects.toThrow()
    expect(queries).toHaveLength(0)
  })

  it('throws for a non-canonical lockedUntil without hitting D1', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AuthRepository(db).recordLoginFailure(VALID_USER_ID, NOW, THRESHOLD, '2026-06-09T00:15:00Z'),
    ).rejects.toThrow()
    expect(queries).toHaveLength(0)
  })

  it('throws for invalid lockout thresholds without hitting D1', async () => {
    for (const bad of [0, -1, 1.5, NaN, Infinity]) {
      const { db, queries } = makeMockDb([])
      await expect(
        new AuthRepository(db).recordLoginFailure(VALID_USER_ID, NOW, bad, LOCKED_UNTIL),
      ).rejects.toThrow()
      expect(queries).toHaveLength(0)
    }
  })

  it('does not expose D1 error details when D1 throws', async () => {
    const { db } = makeMockDb([{ throws: new Error('sensitive D1 details') }])
    await expect(
      new AuthRepository(db).recordLoginFailure(VALID_USER_ID, NOW, THRESHOLD, LOCKED_UNTIL),
    ).rejects.toThrow('database operation failed')
  })
})

describe('AuthRepository.resetLoginFailure', () => {
  it('issues a parameterized UPDATE resetting fail_count and locked_until', async () => {
    const { db, queries } = makeMockDb([{}])
    await new AuthRepository(db).resetLoginFailure(VALID_USER_ID, NOW)
    expect(queries).toHaveLength(1)
    expect(queries[0]?.sql).toContain('UPDATE users')
    expect(queries[0]?.sql).toContain('fail_count = 0')
    expect(queries[0]?.sql).toContain('locked_until')
    expect(queries[0]?.sql).toContain('?')
    expect(queries[0]?.params).toContain(VALID_USER_ID)
    expect(queries[0]?.params).toContain(NOW)
  })

  it('throws for an invalid user ID without hitting D1', async () => {
    const { db, queries } = makeMockDb([])
    await expect(new AuthRepository(db).resetLoginFailure('', NOW)).rejects.toThrow()
    expect(queries).toHaveLength(0)
  })
})
