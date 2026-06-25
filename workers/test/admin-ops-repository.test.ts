import { describe, it, expect } from 'vitest'
import { AdminOpsRepository } from '../src/services/admin-ops-repository.js'
import { makeMockDb } from './helpers/mock-d1.js'

const NOW = '2026-06-25T00:00:00.000Z'
const EXPIRING_SOON_UNTIL = '2026-07-02T00:00:00.000Z'

const USERS_FIRST = { total: 10, enabled: 7, disabled: 3, locked: 1 }
const ALBUMS_FIRST = { total: 5, enabled: 4, disabled: 1, expired: 1, expiring_soon: 2, downloadable: 3 }
const PERMISSIONS_FIRST = { total: 8 }
const SESSIONS_FIRST = { total: 20, expired: 5 }

function makeSuccessDb() {
  return makeMockDb([
    { first: USERS_FIRST },
    { first: ALBUMS_FIRST },
    { first: PERMISSIONS_FIRST },
    { first: SESSIONS_FIRST },
  ])
}

// ---------------------------------------------------------------------------
// A. SQL structure
// ---------------------------------------------------------------------------

describe('AdminOpsRepository getSummary - SQL structure', () => {
  it('issues exactly 4 queries', async () => {
    const { db, queries } = makeSuccessDb()
    const repo = new AdminOpsRepository(db)
    await repo.getSummary(NOW, EXPIRING_SOON_UNTIL)
    expect(queries).toHaveLength(4)
  })

  describe('users query', () => {
    it('contains COUNT(*)', async () => {
      const { db, queries } = makeSuccessDb()
      await new AdminOpsRepository(db).getSummary(NOW, EXPIRING_SOON_UNTIL)
      expect(queries[0]!.sql).toContain('COUNT(*)')
    })
    it('contains SUM(CASE WHEN enabled = 1', async () => {
      const { db, queries } = makeSuccessDb()
      await new AdminOpsRepository(db).getSummary(NOW, EXPIRING_SOON_UNTIL)
      expect(queries[0]!.sql).toContain('SUM(CASE WHEN enabled = 1')
    })
    it('contains SUM(CASE WHEN locked_until IS NOT NULL', async () => {
      const { db, queries } = makeSuccessDb()
      await new AdminOpsRepository(db).getSummary(NOW, EXPIRING_SOON_UNTIL)
      expect(queries[0]!.sql).toContain('SUM(CASE WHEN locked_until IS NOT NULL')
    })
    it('queries FROM users', async () => {
      const { db, queries } = makeSuccessDb()
      await new AdminOpsRepository(db).getSummary(NOW, EXPIRING_SOON_UNTIL)
      expect(queries[0]!.sql).toContain('FROM users')
    })
    it('does not use SELECT *', async () => {
      const { db, queries } = makeSuccessDb()
      await new AdminOpsRepository(db).getSummary(NOW, EXPIRING_SOON_UNTIL)
      expect(queries[0]!.sql).not.toContain('SELECT *')
    })
    it('does not contain JOIN', async () => {
      const { db, queries } = makeSuccessDb()
      await new AdminOpsRepository(db).getSummary(NOW, EXPIRING_SOON_UNTIL)
      expect(queries[0]!.sql).not.toContain('JOIN')
    })
    it('does not contain password_hash', async () => {
      const { db, queries } = makeSuccessDb()
      await new AdminOpsRepository(db).getSummary(NOW, EXPIRING_SOON_UNTIL)
      expect(queries[0]!.sql).not.toContain('password_hash')
    })
    it('does not contain display_name', async () => {
      const { db, queries } = makeSuccessDb()
      await new AdminOpsRepository(db).getSummary(NOW, EXPIRING_SOON_UNTIL)
      expect(queries[0]!.sql).not.toContain('display_name')
    })
    it('does not contain photoprism_album_uid', async () => {
      const { db, queries } = makeSuccessDb()
      await new AdminOpsRepository(db).getSummary(NOW, EXPIRING_SOON_UNTIL)
      expect(queries[0]!.sql).not.toContain('photoprism_album_uid')
    })
  })

  describe('albums query', () => {
    it('contains COUNT(*)', async () => {
      const { db, queries } = makeSuccessDb()
      await new AdminOpsRepository(db).getSummary(NOW, EXPIRING_SOON_UNTIL)
      expect(queries[1]!.sql).toContain('COUNT(*)')
    })
    it('contains expires_at', async () => {
      const { db, queries } = makeSuccessDb()
      await new AdminOpsRepository(db).getSummary(NOW, EXPIRING_SOON_UNTIL)
      expect(queries[1]!.sql).toContain('expires_at')
    })
    it('contains download_enabled', async () => {
      const { db, queries } = makeSuccessDb()
      await new AdminOpsRepository(db).getSummary(NOW, EXPIRING_SOON_UNTIL)
      expect(queries[1]!.sql).toContain('download_enabled')
    })
    it('queries FROM albums', async () => {
      const { db, queries } = makeSuccessDb()
      await new AdminOpsRepository(db).getSummary(NOW, EXPIRING_SOON_UNTIL)
      expect(queries[1]!.sql).toContain('FROM albums')
    })
    it('does not use SELECT *', async () => {
      const { db, queries } = makeSuccessDb()
      await new AdminOpsRepository(db).getSummary(NOW, EXPIRING_SOON_UNTIL)
      expect(queries[1]!.sql).not.toContain('SELECT *')
    })
    it('does not contain JOIN', async () => {
      const { db, queries } = makeSuccessDb()
      await new AdminOpsRepository(db).getSummary(NOW, EXPIRING_SOON_UNTIL)
      expect(queries[1]!.sql).not.toContain('JOIN')
    })
    it('does not contain title column selection', async () => {
      const { db, queries } = makeSuccessDb()
      await new AdminOpsRepository(db).getSummary(NOW, EXPIRING_SOON_UNTIL)
      // The word "title" should not appear as a column name
      expect(queries[1]!.sql).not.toMatch(/\btitle\b/)
    })
    it('does not contain photoprism_album_uid', async () => {
      const { db, queries } = makeSuccessDb()
      await new AdminOpsRepository(db).getSummary(NOW, EXPIRING_SOON_UNTIL)
      expect(queries[1]!.sql).not.toContain('photoprism_album_uid')
    })
  })

  describe('permissions query', () => {
    it('contains COUNT(*)', async () => {
      const { db, queries } = makeSuccessDb()
      await new AdminOpsRepository(db).getSummary(NOW, EXPIRING_SOON_UNTIL)
      expect(queries[2]!.sql).toContain('COUNT(*)')
    })
    it('queries FROM album_permissions', async () => {
      const { db, queries } = makeSuccessDb()
      await new AdminOpsRepository(db).getSummary(NOW, EXPIRING_SOON_UNTIL)
      expect(queries[2]!.sql).toContain('FROM album_permissions')
    })
    it('does not use SELECT *', async () => {
      const { db, queries } = makeSuccessDb()
      await new AdminOpsRepository(db).getSummary(NOW, EXPIRING_SOON_UNTIL)
      expect(queries[2]!.sql).not.toContain('SELECT *')
    })
    it('does not contain JOIN', async () => {
      const { db, queries } = makeSuccessDb()
      await new AdminOpsRepository(db).getSummary(NOW, EXPIRING_SOON_UNTIL)
      expect(queries[2]!.sql).not.toContain('JOIN')
    })
  })

  describe('sessions query', () => {
    it('contains COUNT(*)', async () => {
      const { db, queries } = makeSuccessDb()
      await new AdminOpsRepository(db).getSummary(NOW, EXPIRING_SOON_UNTIL)
      expect(queries[3]!.sql).toContain('COUNT(*)')
    })
    it('contains expires_at', async () => {
      const { db, queries } = makeSuccessDb()
      await new AdminOpsRepository(db).getSummary(NOW, EXPIRING_SOON_UNTIL)
      expect(queries[3]!.sql).toContain('expires_at')
    })
    it('queries FROM sessions', async () => {
      const { db, queries } = makeSuccessDb()
      await new AdminOpsRepository(db).getSummary(NOW, EXPIRING_SOON_UNTIL)
      expect(queries[3]!.sql).toContain('FROM sessions')
    })
    it('does not use SELECT *', async () => {
      const { db, queries } = makeSuccessDb()
      await new AdminOpsRepository(db).getSummary(NOW, EXPIRING_SOON_UNTIL)
      expect(queries[3]!.sql).not.toContain('SELECT *')
    })
    it('does not contain JOIN', async () => {
      const { db, queries } = makeSuccessDb()
      await new AdminOpsRepository(db).getSummary(NOW, EXPIRING_SOON_UNTIL)
      expect(queries[3]!.sql).not.toContain('JOIN')
    })
    it('does not contain token_hash', async () => {
      const { db, queries } = makeSuccessDb()
      await new AdminOpsRepository(db).getSummary(NOW, EXPIRING_SOON_UNTIL)
      expect(queries[3]!.sql).not.toContain('token_hash')
    })
    it('does not contain user_id column selection', async () => {
      const { db, queries } = makeSuccessDb()
      await new AdminOpsRepository(db).getSummary(NOW, EXPIRING_SOON_UNTIL)
      expect(queries[3]!.sql).not.toMatch(/\buser_id\b/)
    })
  })
})

// ---------------------------------------------------------------------------
// B. Bind parameter order
// ---------------------------------------------------------------------------

describe('AdminOpsRepository getSummary - bind parameters', () => {
  it('users query binds [now]', async () => {
    const { db, queries } = makeSuccessDb()
    await new AdminOpsRepository(db).getSummary(NOW, EXPIRING_SOON_UNTIL)
    expect(queries[0]!.params).toEqual([NOW])
  })

  it('albums query binds [now, now, expiringSoonUntil]', async () => {
    const { db, queries } = makeSuccessDb()
    await new AdminOpsRepository(db).getSummary(NOW, EXPIRING_SOON_UNTIL)
    expect(queries[1]!.params).toEqual([NOW, NOW, EXPIRING_SOON_UNTIL])
  })

  it('permissions query binds []', async () => {
    const { db, queries } = makeSuccessDb()
    await new AdminOpsRepository(db).getSummary(NOW, EXPIRING_SOON_UNTIL)
    expect(queries[2]!.params).toEqual([])
  })

  it('sessions query binds [now]', async () => {
    const { db, queries } = makeSuccessDb()
    await new AdminOpsRepository(db).getSummary(NOW, EXPIRING_SOON_UNTIL)
    expect(queries[3]!.params).toEqual([NOW])
  })
})

// ---------------------------------------------------------------------------
// C. Success
// ---------------------------------------------------------------------------

describe('AdminOpsRepository getSummary - success', () => {
  it('returns correct AdminOpsSummary', async () => {
    const { db } = makeSuccessDb()
    const summary = await new AdminOpsRepository(db).getSummary(NOW, EXPIRING_SOON_UNTIL)
    expect(summary.generatedAt).toBe(NOW)
    expect(summary.users.total).toBe(10)
    expect(summary.users.enabled).toBe(7)
    expect(summary.users.disabled).toBe(3)
    expect(summary.users.locked).toBe(1)
    expect(summary.albums.total).toBe(5)
    expect(summary.albums.enabled).toBe(4)
    expect(summary.albums.disabled).toBe(1)
    expect(summary.albums.expired).toBe(1)
    expect(summary.albums.expiringSoon).toBe(2)
    expect(summary.albums.downloadable).toBe(3)
    expect(summary.permissions.total).toBe(8)
    expect(summary.sessions.total).toBe(20)
    expect(summary.sessions.expired).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// D. Input validation (before any D1 call)
// ---------------------------------------------------------------------------

describe('AdminOpsRepository getSummary - input validation', () => {
  it('throws when now is not a canonical UTC timestamp', async () => {
    const { db, queries } = makeMockDb()
    const repo = new AdminOpsRepository(db)
    await expect(repo.getSummary('not-a-date', EXPIRING_SOON_UNTIL)).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })

  it('throws when now is a non-UTC timestamp', async () => {
    const { db, queries } = makeMockDb()
    const repo = new AdminOpsRepository(db)
    await expect(repo.getSummary('2026-06-25T00:00:00+09:00', EXPIRING_SOON_UNTIL)).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })

  it('throws when expiringSoonUntil is not a canonical UTC timestamp', async () => {
    const { db, queries } = makeMockDb()
    const repo = new AdminOpsRepository(db)
    await expect(repo.getSummary(NOW, 'not-a-date')).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })

  it('throws when expiringSoonUntil equals now', async () => {
    const { db, queries } = makeMockDb()
    const repo = new AdminOpsRepository(db)
    await expect(repo.getSummary(NOW, NOW)).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })

  it('throws when expiringSoonUntil is less than now', async () => {
    const { db, queries } = makeMockDb()
    const repo = new AdminOpsRepository(db)
    await expect(repo.getSummary(NOW, '2026-06-24T00:00:00.000Z')).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// E. D1 failure tests
// ---------------------------------------------------------------------------

describe('AdminOpsRepository getSummary - D1 failures', () => {
  it('throws when users query throws, and makes no further queries', async () => {
    const { db, queries } = makeMockDb([{ throws: new Error('D1 exploded') }])
    await expect(new AdminOpsRepository(db).getSummary(NOW, EXPIRING_SOON_UNTIL)).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(1)
  })

  it('throws when users first() returns null', async () => {
    const { db } = makeMockDb([{ first: null }])
    await expect(new AdminOpsRepository(db).getSummary(NOW, EXPIRING_SOON_UNTIL)).rejects.toThrow('database operation failed')
  })

  it('throws when albums query throws', async () => {
    const { db, queries } = makeMockDb([
      { first: USERS_FIRST },
      { throws: new Error('D1 exploded') },
    ])
    await expect(new AdminOpsRepository(db).getSummary(NOW, EXPIRING_SOON_UNTIL)).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(2)
  })

  it('throws when albums first() returns null', async () => {
    const { db } = makeMockDb([
      { first: USERS_FIRST },
      { first: null },
    ])
    await expect(new AdminOpsRepository(db).getSummary(NOW, EXPIRING_SOON_UNTIL)).rejects.toThrow('database operation failed')
  })

  it('throws when permissions query throws', async () => {
    const { db, queries } = makeMockDb([
      { first: USERS_FIRST },
      { first: ALBUMS_FIRST },
      { throws: new Error('D1 exploded') },
    ])
    await expect(new AdminOpsRepository(db).getSummary(NOW, EXPIRING_SOON_UNTIL)).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(3)
  })

  it('throws when permissions first() returns null', async () => {
    const { db } = makeMockDb([
      { first: USERS_FIRST },
      { first: ALBUMS_FIRST },
      { first: null },
    ])
    await expect(new AdminOpsRepository(db).getSummary(NOW, EXPIRING_SOON_UNTIL)).rejects.toThrow('database operation failed')
  })

  it('throws when sessions query throws', async () => {
    const { db, queries } = makeMockDb([
      { first: USERS_FIRST },
      { first: ALBUMS_FIRST },
      { first: PERMISSIONS_FIRST },
      { throws: new Error('D1 exploded') },
    ])
    await expect(new AdminOpsRepository(db).getSummary(NOW, EXPIRING_SOON_UNTIL)).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(4)
  })

  it('throws when sessions first() returns null', async () => {
    const { db } = makeMockDb([
      { first: USERS_FIRST },
      { first: ALBUMS_FIRST },
      { first: PERMISSIONS_FIRST },
      { first: null },
    ])
    await expect(new AdminOpsRepository(db).getSummary(NOW, EXPIRING_SOON_UNTIL)).rejects.toThrow('database operation failed')
  })
})

// ---------------------------------------------------------------------------
// F. Row validation
// ---------------------------------------------------------------------------

describe('AdminOpsRepository getSummary - row validation', () => {
  describe('users row - invalid total', () => {
    for (const bad of [null, -1, 1.5, '10', NaN, undefined]) {
      it(`throws when users.total is ${JSON.stringify(bad)}`, async () => {
        const { db } = makeMockDb([
          { first: { total: bad, enabled: 7, disabled: 3, locked: 1 } },
        ])
        await expect(new AdminOpsRepository(db).getSummary(NOW, EXPIRING_SOON_UNTIL)).rejects.toThrow('database operation failed')
      })
    }
  })

  it('throws when users.total is not a safe integer', async () => {
    const { db } = makeMockDb([
      { first: { total: Number.MAX_SAFE_INTEGER + 1, enabled: 7, disabled: 3, locked: 1 } },
    ])
    await expect(new AdminOpsRepository(db).getSummary(NOW, EXPIRING_SOON_UNTIL)).rejects.toThrow('database operation failed')
  })

  it('throws when users row is missing enabled', async () => {
    const { db } = makeMockDb([{ first: { total: 5 } }])
    await expect(new AdminOpsRepository(db).getSummary(NOW, EXPIRING_SOON_UNTIL)).rejects.toThrow('database operation failed')
  })

  it('throws when users row is not an object', async () => {
    const { db } = makeMockDb([{ first: 'bad-row' }])
    await expect(new AdminOpsRepository(db).getSummary(NOW, EXPIRING_SOON_UNTIL)).rejects.toThrow('database operation failed')
  })

  describe('albums row - invalid expiring_soon', () => {
    for (const bad of [null, -1, 1.5, '2', NaN, undefined]) {
      it(`throws when albums.expiring_soon is ${JSON.stringify(bad)}`, async () => {
        const { db } = makeMockDb([
          { first: USERS_FIRST },
          { first: { total: 5, enabled: 4, disabled: 1, expired: 1, expiring_soon: bad, downloadable: 3 } },
        ])
        await expect(new AdminOpsRepository(db).getSummary(NOW, EXPIRING_SOON_UNTIL)).rejects.toThrow('database operation failed')
      })
    }
  })

  it('throws when albums row is not an object', async () => {
    const { db } = makeMockDb([
      { first: USERS_FIRST },
      { first: 42 },
    ])
    await expect(new AdminOpsRepository(db).getSummary(NOW, EXPIRING_SOON_UNTIL)).rejects.toThrow('database operation failed')
  })

  describe('sessions row - invalid expired', () => {
    for (const bad of [null, -1, 1.5, '5', NaN, undefined]) {
      it(`throws when sessions.expired is ${JSON.stringify(bad)}`, async () => {
        const { db } = makeMockDb([
          { first: USERS_FIRST },
          { first: ALBUMS_FIRST },
          { first: PERMISSIONS_FIRST },
          { first: { total: 20, expired: bad } },
        ])
        await expect(new AdminOpsRepository(db).getSummary(NOW, EXPIRING_SOON_UNTIL)).rejects.toThrow('database operation failed')
      })
    }
  })

  it('throws when sessions row is not an object', async () => {
    const { db } = makeMockDb([
      { first: USERS_FIRST },
      { first: ALBUMS_FIRST },
      { first: PERMISSIONS_FIRST },
      { first: [] },
    ])
    await expect(new AdminOpsRepository(db).getSummary(NOW, EXPIRING_SOON_UNTIL)).rejects.toThrow('database operation failed')
  })
})

// ---------------------------------------------------------------------------
// G. Error sanitization
// ---------------------------------------------------------------------------

describe('AdminOpsRepository getSummary - error sanitization', () => {
  it('always throws "database operation failed" regardless of D1 error', async () => {
    const { db } = makeMockDb([{ throws: new Error('SELECT * FROM secrets -- raw SQL error') }])
    let err: unknown
    try {
      await new AdminOpsRepository(db).getSummary(NOW, EXPIRING_SOON_UNTIL)
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toBe('database operation failed')
  })

  it('always throws "database operation failed" for invalid input', async () => {
    const { db } = makeMockDb()
    let err: unknown
    try {
      await new AdminOpsRepository(db).getSummary('bad', EXPIRING_SOON_UNTIL)
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toBe('database operation failed')
  })

  it('always throws "database operation failed" for malformed row', async () => {
    const { db } = makeMockDb([{ first: { total: -1, enabled: 0, disabled: 0, locked: 0 } }])
    let err: unknown
    try {
      await new AdminOpsRepository(db).getSummary(NOW, EXPIRING_SOON_UNTIL)
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toBe('database operation failed')
  })
})
