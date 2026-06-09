import { describe, it, expect } from 'vitest'
import { SessionRepository } from '../src/services/session-repository.js'
import { makeMockDb } from './helpers/mock-d1.js'
import type { SessionWithUser } from '../src/types/session.js'

const VALID_DIGEST = 'a'.repeat(64)
const VALID_USER_ID = 'user-abc-123'
const NOW = '2026-06-09T00:00:00.000Z'
const EXPIRES = '2026-06-16T00:00:00.000Z'

const SAMPLE_SESSION: SessionWithUser = {
  token_hash: VALID_DIGEST,
  user_id: VALID_USER_ID,
  expires_at: EXPIRES,
  last_seen_at: NOW,
  user_enabled: 1,
}

describe('SessionRepository.insertSession', () => {
  it('issues a parameterized INSERT with all fields', async () => {
    const { db, queries } = makeMockDb([{}])
    await new SessionRepository(db).insertSession(VALID_DIGEST, VALID_USER_ID, NOW, EXPIRES)
    expect(queries).toHaveLength(1)
    expect(queries[0]?.sql).toContain('INSERT INTO sessions')
    expect(queries[0]?.sql).toContain('?')
    expect(queries[0]?.params).toContain(VALID_DIGEST)
    expect(queries[0]?.params).toContain(VALID_USER_ID)
    expect(queries[0]?.params).toContain(NOW)
    expect(queries[0]?.params).toContain(EXPIRES)
  })

  it('SQL does not contain the digest or user ID as literals', async () => {
    const { db, queries } = makeMockDb([{}])
    await new SessionRepository(db).insertSession(VALID_DIGEST, VALID_USER_ID, NOW, EXPIRES)
    expect(queries[0]?.sql).not.toContain(VALID_DIGEST)
    expect(queries[0]?.sql).not.toContain(VALID_USER_ID)
  })

  it('sets last_seen_at to createdAt on insert', async () => {
    const { db, queries } = makeMockDb([{}])
    await new SessionRepository(db).insertSession(VALID_DIGEST, VALID_USER_ID, NOW, EXPIRES)
    const params = queries[0]?.params ?? []
    // createdAt (NOW) should appear twice: for created_at and last_seen_at
    expect(params.filter(p => p === NOW)).toHaveLength(2)
  })

  it('throws for a raw base64url token instead of a hex digest', async () => {
    const { db, queries } = makeMockDb([])
    // A base64url token is ~43 chars, not 64 hex chars
    const rawToken = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    await expect(
      new SessionRepository(db).insertSession(rawToken, VALID_USER_ID, NOW, EXPIRES),
    ).rejects.toThrow()
    expect(queries).toHaveLength(0)
  })

  it('throws for a digest that is not 64 hex characters', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new SessionRepository(db).insertSession('tooshort', VALID_USER_ID, NOW, EXPIRES),
    ).rejects.toThrow()
    expect(queries).toHaveLength(0)
  })

  it('throws for a digest containing uppercase hex', async () => {
    const { db, queries } = makeMockDb([])
    const upper = 'A'.repeat(64)
    await expect(
      new SessionRepository(db).insertSession(upper, VALID_USER_ID, NOW, EXPIRES),
    ).rejects.toThrow()
    expect(queries).toHaveLength(0)
  })

  it('throws for an invalid user ID', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new SessionRepository(db).insertSession(VALID_DIGEST, '!bad!', NOW, EXPIRES),
    ).rejects.toThrow()
    expect(queries).toHaveLength(0)
  })

  it('throws for invalid timestamps without hitting D1', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new SessionRepository(db).insertSession(VALID_DIGEST, VALID_USER_ID, 'not-a-date', EXPIRES),
    ).rejects.toThrow()
    expect(queries).toHaveLength(0)
  })

  it('does not expose D1 error details', async () => {
    const { db } = makeMockDb([{ throws: new Error('sensitive D1 details') }])
    await expect(
      new SessionRepository(db).insertSession(VALID_DIGEST, VALID_USER_ID, NOW, EXPIRES),
    ).rejects.toThrow('database operation failed')
  })
})

describe('SessionRepository.fetchValidSession', () => {
  it('issues a parameterized JOIN query with digest and now', async () => {
    const { db, queries } = makeMockDb([{ first: SAMPLE_SESSION }])
    await new SessionRepository(db).fetchValidSession(VALID_DIGEST, NOW)
    expect(queries).toHaveLength(1)
    expect(queries[0]?.sql).toContain('JOIN users')
    expect(queries[0]?.sql).toContain('expires_at')
    expect(queries[0]?.sql).toContain('enabled')
    expect(queries[0]?.sql).toContain('?')
    expect(queries[0]?.params).toContain(VALID_DIGEST)
    expect(queries[0]?.params).toContain(NOW)
  })

  it('SQL does not contain the digest as a literal', async () => {
    const { db, queries } = makeMockDb([{ first: SAMPLE_SESSION }])
    await new SessionRepository(db).fetchValidSession(VALID_DIGEST, NOW)
    expect(queries[0]?.sql).not.toContain(VALID_DIGEST)
  })

  it('returns the session when found', async () => {
    const { db } = makeMockDb([{ first: SAMPLE_SESSION }])
    const result = await new SessionRepository(db).fetchValidSession(VALID_DIGEST, NOW)
    expect(result).toEqual(SAMPLE_SESSION)
  })

  it('returns null when session not found (simulating expired or absent)', async () => {
    const { db } = makeMockDb([{ first: null }])
    const result = await new SessionRepository(db).fetchValidSession(VALID_DIGEST, NOW)
    expect(result).toBeNull()
  })

  it('returns null without hitting D1 for invalid digest', async () => {
    const { db, queries } = makeMockDb([])
    expect(await new SessionRepository(db).fetchValidSession('notadigest', NOW)).toBeNull()
    expect(queries).toHaveLength(0)
  })

  it('returns null for an empty digest', async () => {
    const { db, queries } = makeMockDb([])
    expect(await new SessionRepository(db).fetchValidSession('', NOW)).toBeNull()
    expect(queries).toHaveLength(0)
  })

  it('rejects a non-canonical timestamp without hitting D1', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new SessionRepository(db).fetchValidSession(VALID_DIGEST, '2026-06-09T00:00:00Z'),
    ).rejects.toThrow()
    expect(queries).toHaveLength(0)
  })

  it('expired sessions are excluded by the SQL WHERE clause', async () => {
    // Simulate D1 returning null because expires_at <= now
    const { db } = makeMockDb([{ first: null }])
    const result = await new SessionRepository(db).fetchValidSession(VALID_DIGEST, EXPIRES)
    expect(result).toBeNull()
  })

  it('disabled user sessions are excluded by the SQL WHERE clause', async () => {
    // Simulate D1 returning null because user.enabled = 0
    const { db } = makeMockDb([{ first: null }])
    const result = await new SessionRepository(db).fetchValidSession(VALID_DIGEST, NOW)
    expect(result).toBeNull()
  })
})

describe('SessionRepository.deleteSession', () => {
  it('issues a parameterized DELETE by digest', async () => {
    const { db, queries } = makeMockDb([{}])
    await new SessionRepository(db).deleteSession(VALID_DIGEST)
    expect(queries).toHaveLength(1)
    expect(queries[0]?.sql).toContain('DELETE FROM sessions')
    expect(queries[0]?.sql).toContain('?')
    expect(queries[0]?.params).toContain(VALID_DIGEST)
  })

  it('SQL does not contain the digest as a literal', async () => {
    const { db, queries } = makeMockDb([{}])
    await new SessionRepository(db).deleteSession(VALID_DIGEST)
    expect(queries[0]?.sql).not.toContain(VALID_DIGEST)
  })

  it('throws for an invalid digest without hitting D1', async () => {
    const { db, queries } = makeMockDb([])
    await expect(new SessionRepository(db).deleteSession('bad')).rejects.toThrow()
    expect(queries).toHaveLength(0)
  })
})

describe('SessionRepository.deleteExpiredSessions', () => {
  it('issues a parameterized DELETE with the cutoff timestamp', async () => {
    const { db, queries } = makeMockDb([{}])
    await new SessionRepository(db).deleteExpiredSessions(NOW)
    expect(queries).toHaveLength(1)
    expect(queries[0]?.sql).toContain('DELETE FROM sessions')
    expect(queries[0]?.sql).toContain('expires_at')
    expect(queries[0]?.sql).toContain('?')
    expect(queries[0]?.params).toContain(NOW)
  })

  it('SQL does not contain the timestamp as a literal', async () => {
    const { db, queries } = makeMockDb([{}])
    await new SessionRepository(db).deleteExpiredSessions(NOW)
    expect(queries[0]?.sql).not.toContain(NOW)
  })
})
