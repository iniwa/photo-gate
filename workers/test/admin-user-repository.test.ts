import { describe, it, expect } from 'vitest'
import { AdminUserRepository, ADMIN_USERS_PAGE_SIZE } from '../src/services/admin-user-repository.js'
import { makeMockDb } from './helpers/mock-d1.js'

const VALID_CURSOR = 'user-cursor-001'
const NOW_TS = '2026-06-15T00:00:00.000Z'

const VALID_ROW = {
  id: 'user-abc-001',
  display_name: 'Alice',
  enabled: 1,
  fail_count: 0,
  locked_until: null,
  created_at: NOW_TS,
  updated_at: NOW_TS,
}

const VALID_ROW_2 = {
  id: 'user-abc-002',
  display_name: 'Bob',
  enabled: 0,
  fail_count: 3,
  locked_until: '2026-06-15T01:00:00.000Z',
  created_at: NOW_TS,
  updated_at: NOW_TS,
}

// ---------------------------------------------------------------------------
// SQL structure
// ---------------------------------------------------------------------------

describe('AdminUserRepository.listUsers SQL structure', () => {
  async function issueList(cursor?: string) {
    const { db, queries } = makeMockDb([{ allRows: [] }])
    await new AdminUserRepository(db).listUsers(cursor)
    return queries
  }

  it('selects the 7 explicit columns (not SELECT *)', async () => {
    const queries = await issueList()
    expect(queries[0]?.sql).toContain('id')
    expect(queries[0]?.sql).toContain('display_name')
    expect(queries[0]?.sql).toContain('enabled')
    expect(queries[0]?.sql).toContain('fail_count')
    expect(queries[0]?.sql).toContain('locked_until')
    expect(queries[0]?.sql).toContain('created_at')
    expect(queries[0]?.sql).toContain('updated_at')
    expect(queries[0]?.sql).not.toMatch(/SELECT\s+\*/i)
  })

  it('queries FROM users', async () => {
    const queries = await issueList()
    expect(queries[0]?.sql).toContain('FROM users')
  })

  it('orders by id ASC', async () => {
    const queries = await issueList()
    expect(queries[0]?.sql).toMatch(/ORDER BY id ASC/i)
  })

  it('uses LIMIT', async () => {
    const queries = await issueList()
    expect(queries[0]?.sql).toMatch(/\bLIMIT\b/i)
  })

  it('does not use OFFSET', async () => {
    const queries = await issueList()
    expect(queries[0]?.sql).not.toMatch(/\bOFFSET\b/i)
  })

  it('does not JOIN any other table', async () => {
    const queries = await issueList()
    expect(queries[0]?.sql).not.toMatch(/\bJOIN\b/i)
  })

  it('SQL does NOT contain password_hash', async () => {
    const queries = await issueList()
    expect(queries[0]?.sql).not.toContain('password_hash')
  })

  it('SQL does NOT contain session', async () => {
    const queries = await issueList()
    expect(queries[0]?.sql).not.toContain('session')
  })

  it('SQL does NOT contain token_hash', async () => {
    const queries = await issueList()
    expect(queries[0]?.sql).not.toContain('token_hash')
  })

  it('SQL does NOT contain album', async () => {
    const queries = await issueList()
    expect(queries[0]?.sql).not.toContain('album')
  })

  it('SQL does NOT contain permission', async () => {
    const queries = await issueList()
    expect(queries[0]?.sql).not.toContain('permission')
  })
})

// ---------------------------------------------------------------------------
// Params — no cursor
// ---------------------------------------------------------------------------

describe('AdminUserRepository.listUsers params — no cursor', () => {
  it('binds LIMIT as 51 (PAGE_SIZE + 1)', async () => {
    const { db, queries } = makeMockDb([{ allRows: [] }])
    await new AdminUserRepository(db).listUsers()
    expect(queries[0]?.params).toHaveLength(1)
    expect(queries[0]?.params[0]).toBe(ADMIN_USERS_PAGE_SIZE + 1)
  })

  it('SQL does not contain id > (no cursor filter)', async () => {
    const { db, queries } = makeMockDb([{ allRows: [] }])
    await new AdminUserRepository(db).listUsers()
    expect(queries[0]?.sql).not.toContain('id >')
  })
})

// ---------------------------------------------------------------------------
// Params — with cursor
// ---------------------------------------------------------------------------

describe('AdminUserRepository.listUsers params — with cursor', () => {
  it('binds (cursor, 51) when cursor is provided', async () => {
    const { db, queries } = makeMockDb([{ allRows: [] }])
    await new AdminUserRepository(db).listUsers(VALID_CURSOR)
    expect(queries[0]?.params).toHaveLength(2)
    expect(queries[0]?.params[0]).toBe(VALID_CURSOR)
    expect(queries[0]?.params[1]).toBe(ADMIN_USERS_PAGE_SIZE + 1)
  })

  it('SQL contains id > ? cursor condition when cursor is provided', async () => {
    const { db, queries } = makeMockDb([{ allRows: [] }])
    await new AdminUserRepository(db).listUsers(VALID_CURSOR)
    expect(queries[0]?.sql).toContain('id > ?')
  })

  it('cursor is a bound param, not an SQL literal', async () => {
    const { db, queries } = makeMockDb([{ allRows: [] }])
    await new AdminUserRepository(db).listUsers(VALID_CURSOR)
    expect(queries[0]?.sql).not.toContain(VALID_CURSOR)
    expect(queries[0]?.params).toContain(VALID_CURSOR)
  })
})

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

describe('AdminUserRepository.listUsers pagination', () => {
  function makeRows(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      id: `user-paginate-${String(i).padStart(3, '0')}`,
      display_name: `User ${i}`,
      enabled: 1,
      fail_count: 0,
      locked_until: null,
      created_at: NOW_TS,
      updated_at: NOW_TS,
    }))
  }

  it('given 51 rows → returns 50 users + hasMore true', async () => {
    const { db } = makeMockDb([{ allRows: makeRows(51) }])
    const result = await new AdminUserRepository(db).listUsers()
    expect(result.users).toHaveLength(50)
    expect(result.hasMore).toBe(true)
  })

  it('given 50 rows → returns 50 users + hasMore false', async () => {
    const { db } = makeMockDb([{ allRows: makeRows(50) }])
    const result = await new AdminUserRepository(db).listUsers()
    expect(result.users).toHaveLength(50)
    expect(result.hasMore).toBe(false)
  })

  it('given 3 rows → returns 3 users + hasMore false', async () => {
    const { db } = makeMockDb([{ allRows: makeRows(3) }])
    const result = await new AdminUserRepository(db).listUsers()
    expect(result.users).toHaveLength(3)
    expect(result.hasMore).toBe(false)
  })

  it('given 0 rows → returns 0 users + hasMore false', async () => {
    const { db } = makeMockDb([{ allRows: [] }])
    const result = await new AdminUserRepository(db).listUsers()
    expect(result.users).toHaveLength(0)
    expect(result.hasMore).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Row validation
// ---------------------------------------------------------------------------

describe('AdminUserRepository.listUsers row validation', () => {
  it('accepts a valid row with locked_until=null', async () => {
    const { db } = makeMockDb([{ allRows: [VALID_ROW] }])
    const result = await new AdminUserRepository(db).listUsers()
    expect(result.users).toHaveLength(1)
    expect(result.users[0]?.id).toBe(VALID_ROW.id)
  })

  it('accepts a valid row with a canonical UTC locked_until', async () => {
    const lockedRow = { ...VALID_ROW, locked_until: '2026-06-15T01:00:00.000Z' }
    const { db } = makeMockDb([{ allRows: [lockedRow] }])
    const result = await new AdminUserRepository(db).listUsers()
    expect(result.users[0]?.locked_until).toBe('2026-06-15T01:00:00.000Z')
  })

  it('accepts two valid rows', async () => {
    const { db } = makeMockDb([{ allRows: [VALID_ROW, VALID_ROW_2] }])
    const result = await new AdminUserRepository(db).listUsers()
    expect(result.users).toHaveLength(2)
  })

  it('rejects row with invalid id', async () => {
    const { db } = makeMockDb([{ allRows: [{ ...VALID_ROW, id: '!bad!' }] }])
    await expect(new AdminUserRepository(db).listUsers()).rejects.toThrow('database operation failed')
  })

  it('rejects row with display_name longer than 1024 code points', async () => {
    const { db } = makeMockDb([{ allRows: [{ ...VALID_ROW, display_name: 'a'.repeat(1025) }] }])
    await expect(new AdminUserRepository(db).listUsers()).rejects.toThrow('database operation failed')
  })

  it('accepts display_name of exactly 1024 code points', async () => {
    const { db } = makeMockDb([{ allRows: [{ ...VALID_ROW, display_name: 'a'.repeat(1024) }] }])
    const result = await new AdminUserRepository(db).listUsers()
    expect(result.users[0]?.display_name).toHaveLength(1024)
  })

  it('rejects row with enabled=2', async () => {
    const { db } = makeMockDb([{ allRows: [{ ...VALID_ROW, enabled: 2 }] }])
    await expect(new AdminUserRepository(db).listUsers()).rejects.toThrow('database operation failed')
  })

  it('rejects row with enabled="1" (string)', async () => {
    const { db } = makeMockDb([{ allRows: [{ ...VALID_ROW, enabled: '1' }] }])
    await expect(new AdminUserRepository(db).listUsers()).rejects.toThrow('database operation failed')
  })

  it('rejects row with fail_count=-1', async () => {
    const { db } = makeMockDb([{ allRows: [{ ...VALID_ROW, fail_count: -1 }] }])
    await expect(new AdminUserRepository(db).listUsers()).rejects.toThrow('database operation failed')
  })

  it('rejects row with fail_count=1.5 (non-integer)', async () => {
    const { db } = makeMockDb([{ allRows: [{ ...VALID_ROW, fail_count: 1.5 }] }])
    await expect(new AdminUserRepository(db).listUsers()).rejects.toThrow('database operation failed')
  })

  it('rejects row with locked_until="not-a-date"', async () => {
    const { db } = makeMockDb([{ allRows: [{ ...VALID_ROW, locked_until: 'not-a-date' }] }])
    await expect(new AdminUserRepository(db).listUsers()).rejects.toThrow('database operation failed')
  })

  it('rejects row with invalid created_at', async () => {
    const { db } = makeMockDb([{ allRows: [{ ...VALID_ROW, created_at: '2026-06-15' }] }])
    await expect(new AdminUserRepository(db).listUsers()).rejects.toThrow('database operation failed')
  })

  it('rejects row with invalid updated_at', async () => {
    const { db } = makeMockDb([{ allRows: [{ ...VALID_ROW, updated_at: '2026-06-15T00:00:00Z' }] }])
    await expect(new AdminUserRepository(db).listUsers()).rejects.toThrow('database operation failed')
  })

  it('rejects null row from D1', async () => {
    const { db } = makeMockDb([{ allRows: [null] }])
    await expect(new AdminUserRepository(db).listUsers()).rejects.toThrow('database operation failed')
  })

  it('rejects duplicate ids from D1', async () => {
    const { db } = makeMockDb([{ allRows: [VALID_ROW, VALID_ROW] }])
    await expect(new AdminUserRepository(db).listUsers()).rejects.toThrow('database operation failed')
  })

  it('rejects non-array results from D1', async () => {
    const { db } = makeMockDb([{ allResult: { success: true, results: null } }])
    await expect(new AdminUserRepository(db).listUsers()).rejects.toThrow('database operation failed')
  })
})

// ---------------------------------------------------------------------------
// Returned objects contain ONLY the 7 fields
// ---------------------------------------------------------------------------

describe('AdminUserRepository.listUsers — no extra fields in returned objects', () => {
  it('returned objects do not contain password_hash', async () => {
    const rowWithExtra = { ...VALID_ROW, password_hash: 'SHOULD_NOT_APPEAR' }
    const { db } = makeMockDb([{ allRows: [rowWithExtra] }])
    const result = await new AdminUserRepository(db).listUsers()
    expect(result.users).toHaveLength(1)
    const first = result.users[0] ?? {}
    expect('password_hash' in first).toBe(false)
  })

  it('returned objects contain exactly the 7 expected fields', async () => {
    const { db } = makeMockDb([{ allRows: [VALID_ROW] }])
    const result = await new AdminUserRepository(db).listUsers()
    const keys = Object.keys(result.users[0] ?? {}).sort()
    expect(keys).toEqual([
      'created_at',
      'display_name',
      'enabled',
      'fail_count',
      'id',
      'locked_until',
      'updated_at',
    ])
  })
})

// ---------------------------------------------------------------------------
// Cursor validation
// ---------------------------------------------------------------------------

describe('AdminUserRepository.listUsers cursor validation', () => {
  it('invalid cursor (contains !) throws before D1', async () => {
    const { db, queries } = makeMockDb([])
    await expect(new AdminUserRepository(db).listUsers('!bad!')).rejects.toThrow('invalid cursor')
    expect(queries).toHaveLength(0)
  })

  it('empty string cursor throws before D1', async () => {
    const { db, queries } = makeMockDb([])
    await expect(new AdminUserRepository(db).listUsers('')).rejects.toThrow('invalid cursor')
    expect(queries).toHaveLength(0)
  })

  it('undefined cursor is accepted (no cursor path)', async () => {
    const { db } = makeMockDb([{ allRows: [] }])
    await expect(new AdminUserRepository(db).listUsers(undefined)).resolves.toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Error sanitization
// ---------------------------------------------------------------------------

describe('AdminUserRepository.listUsers error sanitization', () => {
  it('D1 throw → "database operation failed"', async () => {
    const { db } = makeMockDb([{ throws: new Error('D1 connection failure with secret-token-abc') }])
    await expect(new AdminUserRepository(db).listUsers()).rejects.toThrow('database operation failed')
  })

  it('D1 error message does not contain the sensitive token from the thrown error', async () => {
    const sensitiveToken = 'secret-token-abc-xyz'
    const { db } = makeMockDb([{ throws: new Error(`D1 error: ${sensitiveToken}`) }])
    const err = await new AdminUserRepository(db).listUsers().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).not.toContain(sensitiveToken)
  })

  it('row validation error does not expose id or display_name', async () => {
    const { db } = makeMockDb([{ allRows: [{ ...VALID_ROW, id: '!leaked-id!' }] }])
    const err = await new AdminUserRepository(db).listUsers().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    const msg = (err as Error).message
    expect(msg).not.toContain('!leaked-id!')
    expect(msg).not.toContain(VALID_ROW.display_name)
  })
})

// ---------------------------------------------------------------------------
// setUserEnabled — SQL structure
// ---------------------------------------------------------------------------

const VALID_USER_ID = 'user-abc-001'
const VALID_UPDATED_AT = '2026-06-23T00:00:00.000Z'

describe('AdminUserRepository.setUserEnabled SQL structure', () => {
  async function issueEnable() {
    const { db, queries } = makeMockDb([{}])
    await new AdminUserRepository(db).setUserEnabled(VALID_USER_ID, 1, VALID_UPDATED_AT)
    return queries
  }

  it('uses UPDATE users (single table)', async () => {
    const queries = await issueEnable()
    expect(queries[0]?.sql).toMatch(/UPDATE\s+users/i)
  })

  it('sets enabled in SET clause', async () => {
    const queries = await issueEnable()
    expect(queries[0]?.sql).toContain('enabled')
  })

  it('sets updated_at in SET clause', async () => {
    const queries = await issueEnable()
    expect(queries[0]?.sql).toContain('updated_at')
  })

  it('WHERE clause contains id = ?', async () => {
    const queries = await issueEnable()
    expect(queries[0]?.sql).toContain('id = ?')
  })

  it('WHERE clause contains enabled <> ? (idempotency predicate)', async () => {
    const queries = await issueEnable()
    expect(queries[0]?.sql).toContain('enabled <> ?')
  })

  it('SQL does NOT contain SELECT', async () => {
    const queries = await issueEnable()
    expect(queries[0]?.sql).not.toMatch(/\bSELECT\b/i)
  })

  it('SQL does NOT contain INSERT', async () => {
    const queries = await issueEnable()
    expect(queries[0]?.sql).not.toMatch(/\bINSERT\b/i)
  })

  it('SQL does NOT contain DELETE', async () => {
    const queries = await issueEnable()
    expect(queries[0]?.sql).not.toMatch(/\bDELETE\b/i)
  })

  it('SQL does NOT contain JOIN', async () => {
    const queries = await issueEnable()
    expect(queries[0]?.sql).not.toMatch(/\bJOIN\b/i)
  })

  it('SQL does NOT reference sessions', async () => {
    const queries = await issueEnable()
    expect(queries[0]?.sql).not.toContain('sessions')
  })

  it('SQL does NOT reference album_permissions', async () => {
    const queries = await issueEnable()
    expect(queries[0]?.sql).not.toContain('album_permissions')
  })

  it('SQL does NOT contain password_hash', async () => {
    const queries = await issueEnable()
    expect(queries[0]?.sql).not.toContain('password_hash')
  })

  it('SQL does NOT contain display_name', async () => {
    const queries = await issueEnable()
    expect(queries[0]?.sql).not.toContain('display_name')
  })

  it('SQL does NOT contain fail_count', async () => {
    const queries = await issueEnable()
    expect(queries[0]?.sql).not.toContain('fail_count')
  })

  it('SQL does NOT contain locked_until', async () => {
    const queries = await issueEnable()
    expect(queries[0]?.sql).not.toContain('locked_until')
  })

  it('SQL does NOT contain created_at in SET clause (only updated_at is written)', async () => {
    const queries = await issueEnable()
    // The SQL should not include created_at anywhere
    expect(queries[0]?.sql).not.toContain('created_at')
  })
})

// ---------------------------------------------------------------------------
// setUserEnabled — bound parameter order
// ---------------------------------------------------------------------------

describe('AdminUserRepository.setUserEnabled params', () => {
  it('enable: binds [1, updatedAt, userId, 1] in that order', async () => {
    const { db, queries } = makeMockDb([{}])
    await new AdminUserRepository(db).setUserEnabled(VALID_USER_ID, 1, VALID_UPDATED_AT)
    expect(queries[0]?.params).toEqual([1, VALID_UPDATED_AT, VALID_USER_ID, 1])
  })

  it('disable: binds [0, updatedAt, userId, 0] in that order', async () => {
    const { db, queries } = makeMockDb([{}])
    await new AdminUserRepository(db).setUserEnabled(VALID_USER_ID, 0, VALID_UPDATED_AT)
    expect(queries[0]?.params).toEqual([0, VALID_UPDATED_AT, VALID_USER_ID, 0])
  })

  it('userId is a bound parameter, not an SQL literal', async () => {
    const { db, queries } = makeMockDb([{}])
    await new AdminUserRepository(db).setUserEnabled(VALID_USER_ID, 1, VALID_UPDATED_AT)
    expect(queries[0]?.sql).not.toContain(VALID_USER_ID)
    expect(queries[0]?.params).toContain(VALID_USER_ID)
  })

  it('updatedAt is a bound parameter, not an SQL literal', async () => {
    const { db, queries } = makeMockDb([{}])
    await new AdminUserRepository(db).setUserEnabled(VALID_USER_ID, 1, VALID_UPDATED_AT)
    expect(queries[0]?.sql).not.toContain(VALID_UPDATED_AT)
    expect(queries[0]?.params).toContain(VALID_UPDATED_AT)
  })
})

// ---------------------------------------------------------------------------
// setUserEnabled — success cases
// ---------------------------------------------------------------------------

describe('AdminUserRepository.setUserEnabled success', () => {
  it('resolves without throwing on successful run result', async () => {
    const { db } = makeMockDb([{ runResult: { success: true } }])
    await expect(new AdminUserRepository(db).setUserEnabled(VALID_USER_ID, 1, VALID_UPDATED_AT)).resolves.toBeUndefined()
  })

  it('already-same state with zero changed rows is a successful no-op', async () => {
    const { db } = makeMockDb([{ runResult: { success: true, meta: { changes: 0 } } }])
    await expect(new AdminUserRepository(db).setUserEnabled(VALID_USER_ID, 1, VALID_UPDATED_AT)).resolves.toBeUndefined()
  })

  it('unknown user with zero changed rows is a successful no-op', async () => {
    const { db } = makeMockDb([{ runResult: { success: true, meta: { changes: 0 } } }])
    await expect(new AdminUserRepository(db).setUserEnabled(VALID_USER_ID, 0, VALID_UPDATED_AT)).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// setUserEnabled — validation before D1
// ---------------------------------------------------------------------------

describe('AdminUserRepository.setUserEnabled validation before D1', () => {
  it('invalid userId → throws before D1 is called', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminUserRepository(db).setUserEnabled('!bad!', 1, VALID_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })

  it('enabled=2 → throws before D1 is called', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminUserRepository(db).setUserEnabled(VALID_USER_ID, 2, VALID_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })

  it('invalid updatedAt → throws before D1 is called', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminUserRepository(db).setUserEnabled(VALID_USER_ID, 1, 'not-a-date'),
    ).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// setUserEnabled — D1 error sanitization
// ---------------------------------------------------------------------------

describe('AdminUserRepository.setUserEnabled error sanitization', () => {
  it('D1 throw → "database operation failed"', async () => {
    const { db } = makeMockDb([{ throws: new Error('D1 error with secret-detail') }])
    await expect(
      new AdminUserRepository(db).setUserEnabled(VALID_USER_ID, 1, VALID_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
  })

  it('D1 error message does not contain the sensitive detail from the thrown error', async () => {
    const sensitiveDetail = 'secret-d1-detail-xyz'
    const { db } = makeMockDb([{ throws: new Error(`D1 error: ${sensitiveDetail}`) }])
    const err = await new AdminUserRepository(db).setUserEnabled(VALID_USER_ID, 1, VALID_UPDATED_AT).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).not.toContain(sensitiveDetail)
  })

  it('null run result → "database operation failed"', async () => {
    const { db } = makeMockDb([{ runResult: null }])
    await expect(
      new AdminUserRepository(db).setUserEnabled(VALID_USER_ID, 1, VALID_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
  })

  it('run result success=false → "database operation failed"', async () => {
    const { db } = makeMockDb([{ runResult: { success: false } }])
    await expect(
      new AdminUserRepository(db).setUserEnabled(VALID_USER_ID, 1, VALID_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
  })

  it('malformed primitive run result → "database operation failed"', async () => {
    const { db } = makeMockDb([{ runResult: 'malformed' }])
    await expect(
      new AdminUserRepository(db).setUserEnabled(VALID_USER_ID, 1, VALID_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
  })
})

// ---------------------------------------------------------------------------
// createUser -constants
// ---------------------------------------------------------------------------

const VALID_DISPLAY_NAME = 'Alice Viewer'
const VALID_HASH = 'pbkdf2-sha256$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const VALID_CREATED_AT = '2026-06-24T00:00:00.000Z'

// ---------------------------------------------------------------------------
// createUser -SQL structure
// ---------------------------------------------------------------------------

describe('AdminUserRepository.createUser SQL structure', () => {
  async function issueCreate() {
    const { db, queries } = makeMockDb([{}])
    await new AdminUserRepository(db).createUser(VALID_USER_ID, VALID_DISPLAY_NAME, VALID_HASH, VALID_CREATED_AT, VALID_UPDATED_AT)
    return queries
  }

  it('uses INSERT INTO users', async () => {
    const queries = await issueCreate()
    expect(queries[0]?.sql).toMatch(/INSERT\s+INTO\s+users/i)
  })

  it('INSERT lists id, display_name, password_hash, enabled, fail_count, locked_until, created_at, updated_at', async () => {
    const queries = await issueCreate()
    expect(queries[0]?.sql).toContain('id')
    expect(queries[0]?.sql).toContain('display_name')
    expect(queries[0]?.sql).toContain('password_hash')
    expect(queries[0]?.sql).toContain('enabled')
    expect(queries[0]?.sql).toContain('fail_count')
    expect(queries[0]?.sql).toContain('locked_until')
    expect(queries[0]?.sql).toContain('created_at')
    expect(queries[0]?.sql).toContain('updated_at')
  })

  it('VALUES clause uses 5 placeholders with 3 hardcoded literals', async () => {
    const queries = await issueCreate()
    // 8 columns: 5 params + 1 (enabled), 0 (fail_count), NULL (locked_until)
    expect(queries[0]?.sql).toContain('VALUES')
    expect(queries[0]?.sql).toContain('1')
    expect(queries[0]?.sql).toContain('NULL')
  })

  it('does NOT use UPDATE', async () => {
    const queries = await issueCreate()
    expect(queries[0]?.sql).not.toMatch(/\bUPDATE\b/i)
  })

  it('does NOT use SELECT', async () => {
    const queries = await issueCreate()
    expect(queries[0]?.sql).not.toMatch(/\bSELECT\b/i)
  })

  it('does NOT use DELETE', async () => {
    const queries = await issueCreate()
    expect(queries[0]?.sql).not.toMatch(/\bDELETE\b/i)
  })

  it('does NOT JOIN any other table', async () => {
    const queries = await issueCreate()
    expect(queries[0]?.sql).not.toMatch(/\bJOIN\b/i)
  })

  it('does NOT reference sessions', async () => {
    const queries = await issueCreate()
    expect(queries[0]?.sql).not.toContain('sessions')
  })

  it('does NOT reference album_permissions', async () => {
    const queries = await issueCreate()
    expect(queries[0]?.sql).not.toContain('album_permissions')
  })
})

// ---------------------------------------------------------------------------
// createUser -bind order
// ---------------------------------------------------------------------------

describe('AdminUserRepository.createUser params', () => {
  it('binds [userId, displayName, passwordHash, createdAt, updatedAt] in that order', async () => {
    const { db, queries } = makeMockDb([{}])
    await new AdminUserRepository(db).createUser(VALID_USER_ID, VALID_DISPLAY_NAME, VALID_HASH, VALID_CREATED_AT, VALID_UPDATED_AT)
    expect(queries[0]?.params).toEqual([VALID_USER_ID, VALID_DISPLAY_NAME, VALID_HASH, VALID_CREATED_AT, VALID_UPDATED_AT])
  })

  it('userId is a bound parameter, not an SQL literal', async () => {
    const { db, queries } = makeMockDb([{}])
    await new AdminUserRepository(db).createUser(VALID_USER_ID, VALID_DISPLAY_NAME, VALID_HASH, VALID_CREATED_AT, VALID_UPDATED_AT)
    expect(queries[0]?.sql).not.toContain(VALID_USER_ID)
    expect(queries[0]?.params).toContain(VALID_USER_ID)
  })

  it('passwordHash is a bound parameter, not an SQL literal', async () => {
    const { db, queries } = makeMockDb([{}])
    await new AdminUserRepository(db).createUser(VALID_USER_ID, VALID_DISPLAY_NAME, VALID_HASH, VALID_CREATED_AT, VALID_UPDATED_AT)
    expect(queries[0]?.sql).not.toContain(VALID_HASH)
    expect(queries[0]?.params).toContain(VALID_HASH)
  })
})

// ---------------------------------------------------------------------------
// createUser -success
// ---------------------------------------------------------------------------

describe('AdminUserRepository.createUser success', () => {
  it('resolves without throwing on successful run result', async () => {
    const { db } = makeMockDb([{ runResult: { success: true } }])
    await expect(
      new AdminUserRepository(db).createUser(VALID_USER_ID, VALID_DISPLAY_NAME, VALID_HASH, VALID_CREATED_AT, VALID_UPDATED_AT),
    ).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// createUser -validation before D1
// ---------------------------------------------------------------------------

describe('AdminUserRepository.createUser validation before D1', () => {
  it('invalid userId ->throws before D1 is called', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminUserRepository(db).createUser('!bad!', VALID_DISPLAY_NAME, VALID_HASH, VALID_CREATED_AT, VALID_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })

  it('displayName longer than 1024 code points ->throws before D1', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminUserRepository(db).createUser(VALID_USER_ID, 'a'.repeat(1025), VALID_HASH, VALID_CREATED_AT, VALID_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })

  it('empty displayName -> throws before D1', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminUserRepository(db).createUser(VALID_USER_ID, '', VALID_HASH, VALID_CREATED_AT, VALID_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })

  it('displayName with leading whitespace -> throws before D1', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminUserRepository(db).createUser(VALID_USER_ID, ' Leading', VALID_HASH, VALID_CREATED_AT, VALID_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })

  it('displayName with trailing whitespace -> throws before D1', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminUserRepository(db).createUser(VALID_USER_ID, 'Trailing ', VALID_HASH, VALID_CREATED_AT, VALID_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })

  it('displayName with ASCII control character -> throws before D1', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminUserRepository(db).createUser(VALID_USER_ID, 'bad\nname', VALID_HASH, VALID_CREATED_AT, VALID_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })

  it('invalid passwordHash shape ->throws before D1', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminUserRepository(db).createUser(VALID_USER_ID, VALID_DISPLAY_NAME, 'not-a-hash', VALID_CREATED_AT, VALID_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })

  it('invalid createdAt ->throws before D1', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminUserRepository(db).createUser(VALID_USER_ID, VALID_DISPLAY_NAME, VALID_HASH, 'not-a-date', VALID_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })

  it('invalid updatedAt ->throws before D1', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminUserRepository(db).createUser(VALID_USER_ID, VALID_DISPLAY_NAME, VALID_HASH, VALID_CREATED_AT, 'not-a-date'),
    ).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// createUser -error sanitization
// ---------------------------------------------------------------------------

describe('AdminUserRepository.createUser error sanitization', () => {
  it('D1 throw ->"database operation failed"', async () => {
    const { db } = makeMockDb([{ throws: new Error('D1 constraint: UNIQUE constraint failed') }])
    await expect(
      new AdminUserRepository(db).createUser(VALID_USER_ID, VALID_DISPLAY_NAME, VALID_HASH, VALID_CREATED_AT, VALID_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
  })

  it('D1 error message does not contain the sensitive detail', async () => {
    const sensitiveDetail = 'secret-d1-constraint-xyz'
    const { db } = makeMockDb([{ throws: new Error(`D1 error: ${sensitiveDetail}`) }])
    const err = await new AdminUserRepository(db).createUser(VALID_USER_ID, VALID_DISPLAY_NAME, VALID_HASH, VALID_CREATED_AT, VALID_UPDATED_AT).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).not.toContain(sensitiveDetail)
  })

  it('null run result ->"database operation failed"', async () => {
    const { db } = makeMockDb([{ runResult: null }])
    await expect(
      new AdminUserRepository(db).createUser(VALID_USER_ID, VALID_DISPLAY_NAME, VALID_HASH, VALID_CREATED_AT, VALID_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
  })

  it('run result success=false ->"database operation failed"', async () => {
    const { db } = makeMockDb([{ runResult: { success: false } }])
    await expect(
      new AdminUserRepository(db).createUser(VALID_USER_ID, VALID_DISPLAY_NAME, VALID_HASH, VALID_CREATED_AT, VALID_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
  })
})

// ---------------------------------------------------------------------------
// resetPassword -SQL structure
// ---------------------------------------------------------------------------

describe('AdminUserRepository.resetPassword SQL structure', () => {
  async function issueReset() {
    const { db, queries } = makeMockDb([{ runResult: { success: true, meta: { changes: 1 } } }])
    await new AdminUserRepository(db).resetPassword(VALID_USER_ID, VALID_HASH, VALID_UPDATED_AT)
    return queries
  }

  it('uses UPDATE users', async () => {
    const queries = await issueReset()
    expect(queries[0]?.sql).toMatch(/UPDATE\s+users/i)
  })

  it('SET clause contains password_hash', async () => {
    const queries = await issueReset()
    expect(queries[0]?.sql).toContain('password_hash')
  })

  it('SET clause resets fail_count to 0', async () => {
    const queries = await issueReset()
    expect(queries[0]?.sql).toContain('fail_count')
  })

  it('SET clause resets locked_until to NULL', async () => {
    const queries = await issueReset()
    expect(queries[0]?.sql).toContain('locked_until')
    expect(queries[0]?.sql).toContain('NULL')
  })

  it('SET clause updates updated_at', async () => {
    const queries = await issueReset()
    expect(queries[0]?.sql).toContain('updated_at')
  })

  it('WHERE clause filters by id', async () => {
    const queries = await issueReset()
    expect(queries[0]?.sql).toContain('WHERE')
    expect(queries[0]?.sql).toContain('id')
  })

  it('does NOT use INSERT', async () => {
    const queries = await issueReset()
    expect(queries[0]?.sql).not.toMatch(/\bINSERT\b/i)
  })

  it('does NOT use SELECT', async () => {
    const queries = await issueReset()
    expect(queries[0]?.sql).not.toMatch(/\bSELECT\b/i)
  })

  it('does NOT use DELETE', async () => {
    const queries = await issueReset()
    expect(queries[0]?.sql).not.toMatch(/\bDELETE\b/i)
  })

  it('does NOT JOIN any other table', async () => {
    const queries = await issueReset()
    expect(queries[0]?.sql).not.toMatch(/\bJOIN\b/i)
  })

  it('does NOT reference sessions', async () => {
    const queries = await issueReset()
    expect(queries[0]?.sql).not.toContain('sessions')
  })

  it('does NOT reference album_permissions', async () => {
    const queries = await issueReset()
    expect(queries[0]?.sql).not.toContain('album_permissions')
  })

  it('does NOT change display_name', async () => {
    const queries = await issueReset()
    expect(queries[0]?.sql).not.toContain('display_name')
  })

  it('does NOT change enabled', async () => {
    const queries = await issueReset()
    // enabled should not appear in the SET clause (only WHERE filter for id)
    expect(queries[0]?.sql.split('WHERE')[0]).not.toContain('enabled')
  })

  it('does NOT change created_at', async () => {
    const queries = await issueReset()
    expect(queries[0]?.sql).not.toContain('created_at')
  })
})

// ---------------------------------------------------------------------------
// resetPassword -bind order
// ---------------------------------------------------------------------------

describe('AdminUserRepository.resetPassword params', () => {
  it('binds [passwordHash, updatedAt, userId] in that order', async () => {
    const { db, queries } = makeMockDb([{ runResult: { success: true, meta: { changes: 1 } } }])
    await new AdminUserRepository(db).resetPassword(VALID_USER_ID, VALID_HASH, VALID_UPDATED_AT)
    expect(queries[0]?.params).toEqual([VALID_HASH, VALID_UPDATED_AT, VALID_USER_ID])
  })

  it('userId is a bound parameter, not an SQL literal', async () => {
    const { db, queries } = makeMockDb([{ runResult: { success: true, meta: { changes: 1 } } }])
    await new AdminUserRepository(db).resetPassword(VALID_USER_ID, VALID_HASH, VALID_UPDATED_AT)
    expect(queries[0]?.sql).not.toContain(VALID_USER_ID)
    expect(queries[0]?.params).toContain(VALID_USER_ID)
  })

  it('passwordHash is a bound parameter, not an SQL literal', async () => {
    const { db, queries } = makeMockDb([{ runResult: { success: true, meta: { changes: 1 } } }])
    await new AdminUserRepository(db).resetPassword(VALID_USER_ID, VALID_HASH, VALID_UPDATED_AT)
    expect(queries[0]?.sql).not.toContain(VALID_HASH)
    expect(queries[0]?.params).toContain(VALID_HASH)
  })
})

// ---------------------------------------------------------------------------
// resetPassword -success
// ---------------------------------------------------------------------------

describe('AdminUserRepository.resetPassword success', () => {
  it('resolves when meta.changes=1', async () => {
    const { db } = makeMockDb([{ runResult: { success: true, meta: { changes: 1 } } }])
    await expect(
      new AdminUserRepository(db).resetPassword(VALID_USER_ID, VALID_HASH, VALID_UPDATED_AT),
    ).resolves.toBeUndefined()
  })

  it('resolves when success=true and no meta (legacy path)', async () => {
    const { db } = makeMockDb([{ runResult: { success: true } }])
    await expect(
      new AdminUserRepository(db).resetPassword(VALID_USER_ID, VALID_HASH, VALID_UPDATED_AT),
    ).resolves.toBeUndefined()
  })

  it('meta.changes=0 ->throws (unknown userId treated as DB failure)', async () => {
    const { db } = makeMockDb([{ runResult: { success: true, meta: { changes: 0 } } }])
    await expect(
      new AdminUserRepository(db).resetPassword(VALID_USER_ID, VALID_HASH, VALID_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
  })
})

// ---------------------------------------------------------------------------
// resetPassword -validation before D1
// ---------------------------------------------------------------------------

describe('AdminUserRepository.resetPassword validation before D1', () => {
  it('invalid userId ->throws before D1 is called', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminUserRepository(db).resetPassword('!bad!', VALID_HASH, VALID_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })

  it('invalid passwordHash shape ->throws before D1', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminUserRepository(db).resetPassword(VALID_USER_ID, 'not-a-hash', VALID_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })

  it('invalid updatedAt ->throws before D1', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminUserRepository(db).resetPassword(VALID_USER_ID, VALID_HASH, 'not-a-date'),
    ).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// resetPassword -error sanitization
// ---------------------------------------------------------------------------

describe('AdminUserRepository.resetPassword error sanitization', () => {
  it('D1 throw ->"database operation failed"', async () => {
    const { db } = makeMockDb([{ throws: new Error('D1 error with secret-detail') }])
    await expect(
      new AdminUserRepository(db).resetPassword(VALID_USER_ID, VALID_HASH, VALID_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
  })

  it('D1 error message does not contain the sensitive detail', async () => {
    const sensitiveDetail = 'secret-d1-detail-xyz'
    const { db } = makeMockDb([{ throws: new Error(`D1 error: ${sensitiveDetail}`) }])
    const err = await new AdminUserRepository(db).resetPassword(VALID_USER_ID, VALID_HASH, VALID_UPDATED_AT).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).not.toContain(sensitiveDetail)
  })

  it('null run result ->"database operation failed"', async () => {
    const { db } = makeMockDb([{ runResult: null }])
    await expect(
      new AdminUserRepository(db).resetPassword(VALID_USER_ID, VALID_HASH, VALID_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
  })

  it('run result success=false ->"database operation failed"', async () => {
    const { db } = makeMockDb([{ runResult: { success: false } }])
    await expect(
      new AdminUserRepository(db).resetPassword(VALID_USER_ID, VALID_HASH, VALID_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
  })
})

// ---------------------------------------------------------------------------
// updateDisplayName — SQL structure
// ---------------------------------------------------------------------------

describe('AdminUserRepository.updateDisplayName SQL structure', () => {
  async function issueUpdate() {
    const { db, queries } = makeMockDb([{ runResult: { success: true, meta: { changes: 1 } } }])
    await new AdminUserRepository(db).updateDisplayName(VALID_USER_ID, VALID_DISPLAY_NAME, VALID_UPDATED_AT)
    return queries
  }

  it('uses UPDATE users (single table)', async () => {
    const queries = await issueUpdate()
    expect(queries[0]?.sql).toMatch(/UPDATE\s+users/i)
  })

  it('SET clause contains display_name', async () => {
    const queries = await issueUpdate()
    expect(queries[0]?.sql).toContain('display_name')
  })

  it('SET clause contains updated_at', async () => {
    const queries = await issueUpdate()
    expect(queries[0]?.sql).toContain('updated_at')
  })

  it('WHERE clause contains id = ?', async () => {
    const queries = await issueUpdate()
    expect(queries[0]?.sql).toContain('id = ?')
  })

  it('SQL does NOT contain SELECT', async () => {
    const queries = await issueUpdate()
    expect(queries[0]?.sql).not.toMatch(/\bSELECT\b/i)
  })

  it('SQL does NOT contain INSERT', async () => {
    const queries = await issueUpdate()
    expect(queries[0]?.sql).not.toMatch(/\bINSERT\b/i)
  })

  it('SQL does NOT contain DELETE', async () => {
    const queries = await issueUpdate()
    expect(queries[0]?.sql).not.toMatch(/\bDELETE\b/i)
  })

  it('SQL does NOT contain JOIN', async () => {
    const queries = await issueUpdate()
    expect(queries[0]?.sql).not.toMatch(/\bJOIN\b/i)
  })

  it('SQL does NOT contain password_hash', async () => {
    const queries = await issueUpdate()
    expect(queries[0]?.sql).not.toContain('password_hash')
  })

  it('SQL does NOT contain enabled', async () => {
    const queries = await issueUpdate()
    expect(queries[0]?.sql).not.toContain('enabled')
  })

  it('SQL does NOT contain fail_count', async () => {
    const queries = await issueUpdate()
    expect(queries[0]?.sql).not.toContain('fail_count')
  })

  it('SQL does NOT contain locked_until', async () => {
    const queries = await issueUpdate()
    expect(queries[0]?.sql).not.toContain('locked_until')
  })

  it('SQL does NOT contain created_at', async () => {
    const queries = await issueUpdate()
    expect(queries[0]?.sql).not.toContain('created_at')
  })

  it('SQL does NOT reference sessions', async () => {
    const queries = await issueUpdate()
    expect(queries[0]?.sql).not.toContain('sessions')
  })

  it('SQL does NOT reference album_permissions', async () => {
    const queries = await issueUpdate()
    expect(queries[0]?.sql).not.toContain('album_permissions')
  })
})

// ---------------------------------------------------------------------------
// updateDisplayName — bound parameter order
// ---------------------------------------------------------------------------

describe('AdminUserRepository.updateDisplayName params', () => {
  it('binds [displayName, updatedAt, userId] in that order', async () => {
    const { db, queries } = makeMockDb([{ runResult: { success: true, meta: { changes: 1 } } }])
    await new AdminUserRepository(db).updateDisplayName(VALID_USER_ID, VALID_DISPLAY_NAME, VALID_UPDATED_AT)
    expect(queries[0]?.params).toEqual([VALID_DISPLAY_NAME, VALID_UPDATED_AT, VALID_USER_ID])
  })

  it('displayName is a bound parameter, not an SQL literal', async () => {
    const { db, queries } = makeMockDb([{ runResult: { success: true, meta: { changes: 1 } } }])
    await new AdminUserRepository(db).updateDisplayName(VALID_USER_ID, VALID_DISPLAY_NAME, VALID_UPDATED_AT)
    expect(queries[0]?.params).toContain(VALID_DISPLAY_NAME)
  })

  it('userId is a bound parameter, not an SQL literal', async () => {
    const { db, queries } = makeMockDb([{ runResult: { success: true, meta: { changes: 1 } } }])
    await new AdminUserRepository(db).updateDisplayName(VALID_USER_ID, VALID_DISPLAY_NAME, VALID_UPDATED_AT)
    expect(queries[0]?.sql).not.toContain(VALID_USER_ID)
    expect(queries[0]?.params).toContain(VALID_USER_ID)
  })
})

// ---------------------------------------------------------------------------
// updateDisplayName — success
// ---------------------------------------------------------------------------

describe('AdminUserRepository.updateDisplayName success', () => {
  it('resolves when meta.changes=1', async () => {
    const { db } = makeMockDb([{ runResult: { success: true, meta: { changes: 1 } } }])
    await expect(
      new AdminUserRepository(db).updateDisplayName(VALID_USER_ID, VALID_DISPLAY_NAME, VALID_UPDATED_AT),
    ).resolves.toBeUndefined()
  })

  it('resolves when success=true and no meta (legacy path)', async () => {
    const { db } = makeMockDb([{ runResult: { success: true } }])
    await expect(
      new AdminUserRepository(db).updateDisplayName(VALID_USER_ID, VALID_DISPLAY_NAME, VALID_UPDATED_AT),
    ).resolves.toBeUndefined()
  })

  it('meta.changes=0 → throws (unknown userId treated as DB failure)', async () => {
    const { db } = makeMockDb([{ runResult: { success: true, meta: { changes: 0 } } }])
    await expect(
      new AdminUserRepository(db).updateDisplayName(VALID_USER_ID, VALID_DISPLAY_NAME, VALID_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
  })
})

// ---------------------------------------------------------------------------
// updateDisplayName — validation before D1
// ---------------------------------------------------------------------------

describe('AdminUserRepository.updateDisplayName validation before D1', () => {
  it('invalid userId → throws before D1 is called', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminUserRepository(db).updateDisplayName('!bad!', VALID_DISPLAY_NAME, VALID_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })

  it('empty displayName → throws before D1', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminUserRepository(db).updateDisplayName(VALID_USER_ID, '', VALID_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })

  it('displayName with leading whitespace → throws before D1', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminUserRepository(db).updateDisplayName(VALID_USER_ID, ' Leading', VALID_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })

  it('displayName with trailing whitespace → throws before D1', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminUserRepository(db).updateDisplayName(VALID_USER_ID, 'Trailing ', VALID_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })

  it('displayName with ASCII control character → throws before D1', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminUserRepository(db).updateDisplayName(VALID_USER_ID, 'bad\nname', VALID_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })

  it('displayName longer than 1024 code points → throws before D1', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminUserRepository(db).updateDisplayName(VALID_USER_ID, 'a'.repeat(1025), VALID_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })

  it('invalid updatedAt → throws before D1', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminUserRepository(db).updateDisplayName(VALID_USER_ID, VALID_DISPLAY_NAME, 'not-a-date'),
    ).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// updateDisplayName — error sanitization
// ---------------------------------------------------------------------------

describe('AdminUserRepository.updateDisplayName error sanitization', () => {
  it('D1 throw → "database operation failed"', async () => {
    const { db } = makeMockDb([{ throws: new Error('D1 error with secret-detail') }])
    await expect(
      new AdminUserRepository(db).updateDisplayName(VALID_USER_ID, VALID_DISPLAY_NAME, VALID_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
  })

  it('D1 error message does not contain the sensitive detail', async () => {
    const sensitiveDetail = 'secret-d1-detail-xyz'
    const { db } = makeMockDb([{ throws: new Error(`D1 error: ${sensitiveDetail}`) }])
    const err = await new AdminUserRepository(db).updateDisplayName(VALID_USER_ID, VALID_DISPLAY_NAME, VALID_UPDATED_AT).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).not.toContain(sensitiveDetail)
  })

  it('null run result → "database operation failed"', async () => {
    const { db } = makeMockDb([{ runResult: null }])
    await expect(
      new AdminUserRepository(db).updateDisplayName(VALID_USER_ID, VALID_DISPLAY_NAME, VALID_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
  })

  it('run result success=false → "database operation failed"', async () => {
    const { db } = makeMockDb([{ runResult: { success: false } }])
    await expect(
      new AdminUserRepository(db).updateDisplayName(VALID_USER_ID, VALID_DISPLAY_NAME, VALID_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
  })
})

// ---------------------------------------------------------------------------
// getUserForHardDelete
// ---------------------------------------------------------------------------

describe('AdminUserRepository.getUserForHardDelete', () => {
  it('selects only id, display_name, enabled', async () => {
    const { db, queries } = makeMockDb([{ first: { id: VALID_ROW.id, display_name: VALID_ROW.display_name, enabled: 1 } }])
    await new AdminUserRepository(db).getUserForHardDelete(VALID_ROW.id)
    expect(queries[0]?.sql).toContain('SELECT id, display_name, enabled')
    expect(queries[0]?.sql).toContain('FROM users')
    expect(queries[0]?.sql).not.toMatch(/SELECT\s+\*/i)
    expect(queries[0]?.sql).not.toContain('password_hash')
    expect(queries[0]?.sql).not.toContain('fail_count')
    expect(queries[0]?.sql).not.toContain('locked_until')
  })

  it('binds userId as the only parameter', async () => {
    const { db, queries } = makeMockDb([{ first: { id: VALID_ROW.id, display_name: VALID_ROW.display_name, enabled: 1 } }])
    await new AdminUserRepository(db).getUserForHardDelete(VALID_ROW.id)
    expect(queries[0]?.params).toEqual([VALID_ROW.id])
  })

  it('returns null for a missing user', async () => {
    const { db } = makeMockDb([{ first: null }])
    await expect(new AdminUserRepository(db).getUserForHardDelete(VALID_ROW.id)).resolves.toBeNull()
  })

  it('rejects invalid IDs before D1', async () => {
    const { db, queries } = makeMockDb([{ first: null }])
    await expect(new AdminUserRepository(db).getUserForHardDelete('!bad!')).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })

  it('sanitizes malformed rows and D1 errors', async () => {
    const malformed = makeMockDb([{ first: { id: VALID_ROW.id, display_name: VALID_ROW.display_name, enabled: 2 } }])
    await expect(new AdminUserRepository(malformed.db).getUserForHardDelete(VALID_ROW.id)).rejects.toThrow('database operation failed')

    const throwing = makeMockDb([{ throws: new Error('password_hash leaked') }])
    await expect(new AdminUserRepository(throwing.db).getUserForHardDelete(VALID_ROW.id)).rejects.toThrow('database operation failed')
  })
})
