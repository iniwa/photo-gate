import { describe, it, expect } from 'vitest'
import { AdminPermissionRepository, ADMIN_PERMISSIONS_PAGE_SIZE, ASSIGNMENT_OPTIONS_MAX } from '../src/services/admin-permission-repository.js'
import { makeMockDb } from './helpers/mock-d1.js'

const NOW_TS = '2026-06-15T00:00:00.000Z'

const VALID_ROW = {
  album_id: 'album-abc-001',
  user_id: 'user-abc-001',
  created_at: NOW_TS,
}

const VALID_ROW_2 = {
  album_id: 'album-abc-001',
  user_id: 'user-abc-002',
  created_at: NOW_TS,
}

const VALID_ROW_3 = {
  album_id: 'album-abc-002',
  user_id: 'user-abc-001',
  created_at: NOW_TS,
}

// ---------------------------------------------------------------------------
// SQL structure
// ---------------------------------------------------------------------------

describe('AdminPermissionRepository.listPermissions SQL structure', () => {
  async function issueList(after?: { albumId: string; userId: string }) {
    const { db, queries } = makeMockDb([{ allRows: [] }])
    await new AdminPermissionRepository(db).listPermissions(after)
    return queries
  }

  it('selects album_id, user_id, created_at (not SELECT *)', async () => {
    const queries = await issueList()
    expect(queries[0]?.sql).toContain('album_id')
    expect(queries[0]?.sql).toContain('user_id')
    expect(queries[0]?.sql).toContain('created_at')
    expect(queries[0]?.sql).not.toMatch(/SELECT\s+\*/i)
  })

  it('queries FROM album_permissions', async () => {
    const queries = await issueList()
    expect(queries[0]?.sql).toContain('FROM album_permissions')
  })

  it('orders by album_id ASC, user_id ASC', async () => {
    const queries = await issueList()
    expect(queries[0]?.sql).toMatch(/ORDER BY album_id ASC, user_id ASC/i)
  })

  it('uses LIMIT', async () => {
    const queries = await issueList()
    expect(queries[0]?.sql).toMatch(/\bLIMIT\b/i)
  })

  it('does not use OFFSET', async () => {
    const queries = await issueList()
    expect(queries[0]?.sql).not.toMatch(/\bOFFSET\b/i)
  })

  it('SQL does NOT contain JOIN', async () => {
    const queries = await issueList()
    expect(queries[0]?.sql).not.toContain(' JOIN ')
  })

  it('SQL does NOT contain password_hash', async () => {
    const queries = await issueList()
    expect(queries[0]?.sql).not.toContain('password_hash')
  })

  it('SQL does NOT contain display_name', async () => {
    const queries = await issueList()
    expect(queries[0]?.sql).not.toContain('display_name')
  })

  it('SQL does NOT contain title', async () => {
    const queries = await issueList()
    expect(queries[0]?.sql).not.toContain('title')
  })

  it('SQL does NOT contain photoprism_album_uid', async () => {
    const queries = await issueList()
    expect(queries[0]?.sql).not.toContain('photoprism_album_uid')
  })
})

// ---------------------------------------------------------------------------
// Params — no cursor
// ---------------------------------------------------------------------------

describe('AdminPermissionRepository.listPermissions params — no cursor', () => {
  it('binds LIMIT as 51 (PAGE_SIZE + 1)', async () => {
    const { db, queries } = makeMockDb([{ allRows: [] }])
    await new AdminPermissionRepository(db).listPermissions()
    expect(queries[0]?.params).toHaveLength(1)
    expect(queries[0]?.params[0]).toBe(ADMIN_PERMISSIONS_PAGE_SIZE + 1)
  })

  it('SQL does not contain album_id > (no cursor filter)', async () => {
    const { db, queries } = makeMockDb([{ allRows: [] }])
    await new AdminPermissionRepository(db).listPermissions()
    expect(queries[0]?.sql).not.toContain('album_id >')
  })
})

// ---------------------------------------------------------------------------
// Params — with composite cursor
// ---------------------------------------------------------------------------

describe('AdminPermissionRepository.listPermissions params — with cursor', () => {
  const CURSOR = { albumId: 'album-cursor-001', userId: 'user-cursor-001' }

  it('binds (albumId, albumId, userId, 51) when cursor is provided', async () => {
    const { db, queries } = makeMockDb([{ allRows: [] }])
    await new AdminPermissionRepository(db).listPermissions(CURSOR)
    expect(queries[0]?.params).toHaveLength(4)
    expect(queries[0]?.params[0]).toBe(CURSOR.albumId)
    expect(queries[0]?.params[1]).toBe(CURSOR.albumId)
    expect(queries[0]?.params[2]).toBe(CURSOR.userId)
    expect(queries[0]?.params[3]).toBe(ADMIN_PERMISSIONS_PAGE_SIZE + 1)
  })

  it('SQL contains album_id > ? condition when cursor is provided', async () => {
    const { db, queries } = makeMockDb([{ allRows: [] }])
    await new AdminPermissionRepository(db).listPermissions(CURSOR)
    expect(queries[0]?.sql).toContain('album_id > ?')
  })

  it('SQL contains album_id = ? AND user_id > ? condition when cursor is provided', async () => {
    const { db, queries } = makeMockDb([{ allRows: [] }])
    await new AdminPermissionRepository(db).listPermissions(CURSOR)
    expect(queries[0]?.sql).toContain('album_id = ? AND user_id > ?')
  })

  it('cursor values are bound params, not SQL literals', async () => {
    const { db, queries } = makeMockDb([{ allRows: [] }])
    await new AdminPermissionRepository(db).listPermissions(CURSOR)
    expect(queries[0]?.sql).not.toContain(CURSOR.albumId)
    expect(queries[0]?.sql).not.toContain(CURSOR.userId)
    expect(queries[0]?.params).toContain(CURSOR.albumId)
    expect(queries[0]?.params).toContain(CURSOR.userId)
  })
})

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

describe('AdminPermissionRepository.listPermissions pagination', () => {
  function makeRows(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      album_id: `album-paginate-${String(i).padStart(3, '0')}`,
      user_id: `user-paginate-${String(i).padStart(3, '0')}`,
      created_at: NOW_TS,
    }))
  }

  it('given 51 rows → returns 50 permissions + hasMore true', async () => {
    const { db } = makeMockDb([{ allRows: makeRows(51) }])
    const result = await new AdminPermissionRepository(db).listPermissions()
    expect(result.permissions).toHaveLength(50)
    expect(result.hasMore).toBe(true)
  })

  it('given 50 rows → returns 50 permissions + hasMore false', async () => {
    const { db } = makeMockDb([{ allRows: makeRows(50) }])
    const result = await new AdminPermissionRepository(db).listPermissions()
    expect(result.permissions).toHaveLength(50)
    expect(result.hasMore).toBe(false)
  })

  it('given 3 rows → returns 3 permissions + hasMore false', async () => {
    const { db } = makeMockDb([{ allRows: makeRows(3) }])
    const result = await new AdminPermissionRepository(db).listPermissions()
    expect(result.permissions).toHaveLength(3)
    expect(result.hasMore).toBe(false)
  })

  it('given 0 rows → returns 0 permissions + hasMore false', async () => {
    const { db } = makeMockDb([{ allRows: [] }])
    const result = await new AdminPermissionRepository(db).listPermissions()
    expect(result.permissions).toHaveLength(0)
    expect(result.hasMore).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Row validation
// ---------------------------------------------------------------------------

describe('AdminPermissionRepository.listPermissions row validation', () => {
  it('accepts a valid row', async () => {
    const { db } = makeMockDb([{ allRows: [VALID_ROW] }])
    const result = await new AdminPermissionRepository(db).listPermissions()
    expect(result.permissions).toHaveLength(1)
    expect(result.permissions[0]?.album_id).toBe(VALID_ROW.album_id)
    expect(result.permissions[0]?.user_id).toBe(VALID_ROW.user_id)
  })

  it('accepts two rows with same album_id but different user_id', async () => {
    const { db } = makeMockDb([{ allRows: [VALID_ROW, VALID_ROW_2] }])
    const result = await new AdminPermissionRepository(db).listPermissions()
    expect(result.permissions).toHaveLength(2)
  })

  it('accepts two rows with different album_id but same user_id', async () => {
    const { db } = makeMockDb([{ allRows: [VALID_ROW, VALID_ROW_3] }])
    const result = await new AdminPermissionRepository(db).listPermissions()
    expect(result.permissions).toHaveLength(2)
  })

  it('rejects row with invalid album_id', async () => {
    const { db } = makeMockDb([{ allRows: [{ ...VALID_ROW, album_id: '!bad!' }] }])
    await expect(new AdminPermissionRepository(db).listPermissions()).rejects.toThrow('database operation failed')
  })

  it('rejects row with invalid user_id', async () => {
    const { db } = makeMockDb([{ allRows: [{ ...VALID_ROW, user_id: '!bad!' }] }])
    await expect(new AdminPermissionRepository(db).listPermissions()).rejects.toThrow('database operation failed')
  })

  it('rejects row with invalid created_at', async () => {
    const { db } = makeMockDb([{ allRows: [{ ...VALID_ROW, created_at: '2026-06-15' }] }])
    await expect(new AdminPermissionRepository(db).listPermissions()).rejects.toThrow('database operation failed')
  })

  it('rejects null row from D1', async () => {
    const { db } = makeMockDb([{ allRows: [null] }])
    await expect(new AdminPermissionRepository(db).listPermissions()).rejects.toThrow('database operation failed')
  })

  it('rejects non-array results from D1', async () => {
    const { db } = makeMockDb([{ allResult: { success: true, results: null } }])
    await expect(new AdminPermissionRepository(db).listPermissions()).rejects.toThrow('database operation failed')
  })

  it('rejects duplicate composite (album_id, user_id) pair from D1', async () => {
    const { db } = makeMockDb([{ allRows: [VALID_ROW, VALID_ROW] }])
    await expect(new AdminPermissionRepository(db).listPermissions()).rejects.toThrow('database operation failed')
  })
})

// ---------------------------------------------------------------------------
// Cursor validation
// ---------------------------------------------------------------------------

describe('AdminPermissionRepository.listPermissions cursor validation', () => {
  it('invalid albumId in after throws before D1', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminPermissionRepository(db).listPermissions({ albumId: '!bad!', userId: 'user-abc-001' }),
    ).rejects.toThrow('invalid cursor')
    expect(queries).toHaveLength(0)
  })

  it('invalid userId in after throws before D1', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminPermissionRepository(db).listPermissions({ albumId: 'album-abc-001', userId: '!bad!' }),
    ).rejects.toThrow('invalid cursor')
    expect(queries).toHaveLength(0)
  })

  it('both invalid albumId and userId throws before D1', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminPermissionRepository(db).listPermissions({ albumId: '!bad!', userId: '!bad!' }),
    ).rejects.toThrow('invalid cursor')
    expect(queries).toHaveLength(0)
  })

  it('undefined after is accepted (no cursor path)', async () => {
    const { db } = makeMockDb([{ allRows: [] }])
    await expect(new AdminPermissionRepository(db).listPermissions(undefined)).resolves.toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Error sanitization
// ---------------------------------------------------------------------------

describe('AdminPermissionRepository.listPermissions error sanitization', () => {
  it('D1 throw → "database operation failed"', async () => {
    const { db } = makeMockDb([{ throws: new Error('D1 connection failure with secret-token-abc') }])
    await expect(new AdminPermissionRepository(db).listPermissions()).rejects.toThrow('database operation failed')
  })

  it('D1 error message does not contain the sensitive token from the thrown error', async () => {
    const sensitiveToken = 'secret-token-perm-xyz'
    const { db } = makeMockDb([{ throws: new Error(`D1 error: ${sensitiveToken}`) }])
    const err = await new AdminPermissionRepository(db).listPermissions().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).not.toContain(sensitiveToken)
  })
})

// ---------------------------------------------------------------------------
// grantPermission — SQL structure
// ---------------------------------------------------------------------------

const GRANT_ALBUM_ID = 'album-grant-001'
const GRANT_USER_ID = 'user-grant-001'
const GRANT_CREATED_AT = '2026-06-18T00:00:00.000Z'

async function issueGrant() {
  const { db, queries } = makeMockDb([{}])
  await new AdminPermissionRepository(db).grantPermission(GRANT_ALBUM_ID, GRANT_USER_ID, GRANT_CREATED_AT)
  return queries
}

describe('AdminPermissionRepository.grantPermission SQL structure', () => {
  it('SQL contains INSERT INTO album_permissions', async () => {
    const queries = await issueGrant()
    expect(queries[0]?.sql).toContain('INSERT INTO album_permissions')
  })

  it('SQL contains ON CONFLICT(album_id, user_id) DO NOTHING', async () => {
    const queries = await issueGrant()
    expect(queries[0]?.sql).toContain('ON CONFLICT(album_id, user_id) DO NOTHING')
  })

  it('SQL does NOT contain SELECT', async () => {
    const queries = await issueGrant()
    expect(queries[0]?.sql).not.toMatch(/\bSELECT\b/i)
  })

  it('SQL does NOT contain JOIN', async () => {
    const queries = await issueGrant()
    expect(queries[0]?.sql).not.toContain(' JOIN ')
  })

  it('params are exactly [albumId, userId, createdAt] in order', async () => {
    const queries = await issueGrant()
    expect(queries[0]?.params).toEqual([GRANT_ALBUM_ID, GRANT_USER_ID, GRANT_CREATED_AT])
  })

  it('SQL does not contain the literal albumId value', async () => {
    const queries = await issueGrant()
    expect(queries[0]?.sql).not.toContain(GRANT_ALBUM_ID)
  })

  it('SQL does not contain the literal userId value', async () => {
    const queries = await issueGrant()
    expect(queries[0]?.sql).not.toContain(GRANT_USER_ID)
  })

  it('SQL does not contain the literal createdAt value', async () => {
    const queries = await issueGrant()
    expect(queries[0]?.sql).not.toContain(GRANT_CREATED_AT)
  })
})

// ---------------------------------------------------------------------------
// grantPermission — success
// ---------------------------------------------------------------------------

describe('AdminPermissionRepository.grantPermission success', () => {
  it('default runResult {success:true} → resolves without throw', async () => {
    const { db } = makeMockDb([{}])
    await expect(
      new AdminPermissionRepository(db).grantPermission(GRANT_ALBUM_ID, GRANT_USER_ID, GRANT_CREATED_AT),
    ).resolves.toBeUndefined()
  })

  it('re-grant (ON CONFLICT no-op) is also a success', async () => {
    const { db } = makeMockDb([{}])
    await expect(
      new AdminPermissionRepository(db).grantPermission(GRANT_ALBUM_ID, GRANT_USER_ID, GRANT_CREATED_AT),
    ).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// grantPermission — validation before D1
// ---------------------------------------------------------------------------

describe('AdminPermissionRepository.grantPermission validation before D1', () => {
  it('invalid albumId → rejects with database operation failed, D1 not touched', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminPermissionRepository(db).grantPermission('!bad!', GRANT_USER_ID, GRANT_CREATED_AT),
    ).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })

  it('invalid userId → rejects with database operation failed, D1 not touched', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminPermissionRepository(db).grantPermission(GRANT_ALBUM_ID, '!bad!', GRANT_CREATED_AT),
    ).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })

  it('non-canonical createdAt → rejects with database operation failed, D1 not touched', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminPermissionRepository(db).grantPermission(GRANT_ALBUM_ID, GRANT_USER_ID, '2026-06-15'),
    ).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// grantPermission — error sanitization
// ---------------------------------------------------------------------------

describe('AdminPermissionRepository.grantPermission error sanitization', () => {
  it('run() throws → rejects with database operation failed', async () => {
    const { db } = makeMockDb([{ throws: new Error('secret-token-grant-xyz') }])
    await expect(
      new AdminPermissionRepository(db).grantPermission(GRANT_ALBUM_ID, GRANT_USER_ID, GRANT_CREATED_AT),
    ).rejects.toThrow('database operation failed')
  })

  it('run() throws → error message does not contain the sensitive token', async () => {
    const sensitiveToken = 'secret-token-grant-xyz'
    const { db } = makeMockDb([{ throws: new Error(sensitiveToken) }])
    const err = await new AdminPermissionRepository(db)
      .grantPermission(GRANT_ALBUM_ID, GRANT_USER_ID, GRANT_CREATED_AT)
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).not.toContain(sensitiveToken)
  })

  it('runResult {success:false} → rejects with database operation failed', async () => {
    const { db } = makeMockDb([{ runResult: { success: false } }])
    await expect(
      new AdminPermissionRepository(db).grantPermission(GRANT_ALBUM_ID, GRANT_USER_ID, GRANT_CREATED_AT),
    ).rejects.toThrow('database operation failed')
  })

  it('runResult null → rejects with database operation failed', async () => {
    const { db } = makeMockDb([{ runResult: null }])
    await expect(
      new AdminPermissionRepository(db).grantPermission(GRANT_ALBUM_ID, GRANT_USER_ID, GRANT_CREATED_AT),
    ).rejects.toThrow('database operation failed')
  })
})

// ---------------------------------------------------------------------------
// revokePermission — SQL structure
// ---------------------------------------------------------------------------

const REVOKE_ALBUM_ID = 'album-revoke-001'
const REVOKE_USER_ID = 'user-revoke-001'

async function issueRevoke() {
  const { db, queries } = makeMockDb([{}])
  await new AdminPermissionRepository(db).revokePermission(REVOKE_ALBUM_ID, REVOKE_USER_ID)
  return queries
}

describe('AdminPermissionRepository.revokePermission SQL structure', () => {
  it('SQL contains DELETE FROM album_permissions', async () => {
    const queries = await issueRevoke()
    expect(queries[0]?.sql).toContain('DELETE FROM album_permissions')
  })

  it('SQL contains WHERE album_id = ? AND user_id = ?', async () => {
    const queries = await issueRevoke()
    expect(queries[0]?.sql).toContain('WHERE album_id = ? AND user_id = ?')
  })

  it('SQL does NOT contain SELECT', async () => {
    const queries = await issueRevoke()
    expect(queries[0]?.sql).not.toMatch(/\bSELECT\b/i)
  })

  it('SQL does NOT contain JOIN', async () => {
    const queries = await issueRevoke()
    expect(queries[0]?.sql).not.toContain(' JOIN ')
  })

  it('SQL does NOT contain INSERT', async () => {
    const queries = await issueRevoke()
    expect(queries[0]?.sql).not.toMatch(/\bINSERT\b/i)
  })

  it('params are exactly [albumId, userId]', async () => {
    const queries = await issueRevoke()
    expect(queries[0]?.params).toEqual([REVOKE_ALBUM_ID, REVOKE_USER_ID])
  })

  it('SQL does not contain the literal albumId value', async () => {
    const queries = await issueRevoke()
    expect(queries[0]?.sql).not.toContain(REVOKE_ALBUM_ID)
  })

  it('SQL does not contain the literal userId value', async () => {
    const queries = await issueRevoke()
    expect(queries[0]?.sql).not.toContain(REVOKE_USER_ID)
  })
})

// ---------------------------------------------------------------------------
// revokePermission — success
// ---------------------------------------------------------------------------

describe('AdminPermissionRepository.revokePermission success', () => {
  it('default runResult {success:true} → resolves without throw', async () => {
    const { db } = makeMockDb([{}])
    await expect(
      new AdminPermissionRepository(db).revokePermission(REVOKE_ALBUM_ID, REVOKE_USER_ID),
    ).resolves.toBeUndefined()
  })

  it('revoking an absent pair is also a success (idempotent)', async () => {
    const { db } = makeMockDb([{}])
    await expect(
      new AdminPermissionRepository(db).revokePermission(REVOKE_ALBUM_ID, REVOKE_USER_ID),
    ).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// revokePermission — validation before D1
// ---------------------------------------------------------------------------

describe('AdminPermissionRepository.revokePermission validation before D1', () => {
  it('invalid albumId → rejects with database operation failed, D1 not touched', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminPermissionRepository(db).revokePermission('!bad!', REVOKE_USER_ID),
    ).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })

  it('invalid userId → rejects with database operation failed, D1 not touched', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminPermissionRepository(db).revokePermission(REVOKE_ALBUM_ID, '!bad!'),
    ).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// revokePermission — error sanitization
// ---------------------------------------------------------------------------

describe('AdminPermissionRepository.revokePermission error sanitization', () => {
  it('run() throws → rejects with database operation failed', async () => {
    const { db } = makeMockDb([{ throws: new Error('secret-token-revoke-xyz') }])
    await expect(
      new AdminPermissionRepository(db).revokePermission(REVOKE_ALBUM_ID, REVOKE_USER_ID),
    ).rejects.toThrow('database operation failed')
  })

  it('run() throws → error message does not contain the sensitive token', async () => {
    const sensitiveToken = 'secret-token-revoke-xyz'
    const { db } = makeMockDb([{ throws: new Error(sensitiveToken) }])
    const err = await new AdminPermissionRepository(db)
      .revokePermission(REVOKE_ALBUM_ID, REVOKE_USER_ID)
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).not.toContain(sensitiveToken)
  })

  it('runResult {success:false} → rejects with database operation failed', async () => {
    const { db } = makeMockDb([{ runResult: { success: false } }])
    await expect(
      new AdminPermissionRepository(db).revokePermission(REVOKE_ALBUM_ID, REVOKE_USER_ID),
    ).rejects.toThrow('database operation failed')
  })

  it('runResult null → rejects with database operation failed', async () => {
    const { db } = makeMockDb([{ runResult: null }])
    await expect(
      new AdminPermissionRepository(db).revokePermission(REVOKE_ALBUM_ID, REVOKE_USER_ID),
    ).rejects.toThrow('database operation failed')
  })
})

// ---------------------------------------------------------------------------
// ASSIGNMENT_OPTIONS_MAX exported constant
// ---------------------------------------------------------------------------

describe('ASSIGNMENT_OPTIONS_MAX', () => {
  it('equals 100', () => {
    expect(ASSIGNMENT_OPTIONS_MAX).toBe(100)
  })
})

// ---------------------------------------------------------------------------
// listAssignmentOptions — helper fixtures
// ---------------------------------------------------------------------------

const VALID_USER_ROW = { id: 'user-opt-001', display_name: 'Alice', enabled: 1 }
const VALID_USER_ROW_2 = { id: 'user-opt-002', display_name: 'Bob', enabled: 0 }
const VALID_ALBUM_ROW = { id: 'album-opt-001', title: 'Summer Trip', enabled: 1 }
const VALID_ALBUM_ROW_2 = { id: 'album-opt-002', title: 'Winter', enabled: 0 }

function makeOptionsDb(usersRows: unknown[], albumRows: unknown[], permRows?: unknown[]) {
  return makeMockDb([
    { allRows: usersRows },
    { allRows: albumRows },
    { allRows: permRows ?? [] },
  ])
}

// ---------------------------------------------------------------------------
// listAssignmentOptions — users SQL structure
// ---------------------------------------------------------------------------

describe('AdminPermissionRepository.listAssignmentOptions users SQL structure', () => {
  async function issueOptions() {
    const { db, queries } = makeOptionsDb([], [])
    await new AdminPermissionRepository(db).listAssignmentOptions()
    return queries
  }

  it('users query selects id, display_name, enabled', async () => {
    const queries = await issueOptions()
    expect(queries[0]?.sql).toContain('id')
    expect(queries[0]?.sql).toContain('display_name')
    expect(queries[0]?.sql).toContain('enabled')
  })

  it('users query queries FROM users', async () => {
    const queries = await issueOptions()
    expect(queries[0]?.sql).toMatch(/FROM\s+users/i)
  })

  it('users query does NOT select password_hash', async () => {
    const queries = await issueOptions()
    expect(queries[0]?.sql).not.toContain('password_hash')
  })

  it('users query does NOT select photoprism_album_uid', async () => {
    const queries = await issueOptions()
    expect(queries[0]?.sql).not.toContain('photoprism_album_uid')
  })

  it('users query does NOT select sessions', async () => {
    const queries = await issueOptions()
    expect(queries[0]?.sql).not.toContain('sessions')
  })

  it('users query does NOT select token_hash', async () => {
    const queries = await issueOptions()
    expect(queries[0]?.sql).not.toContain('token_hash')
  })

  it('users query does NOT select fail_count', async () => {
    const queries = await issueOptions()
    expect(queries[0]?.sql).not.toContain('fail_count')
  })

  it('users query does NOT select locked_until', async () => {
    const queries = await issueOptions()
    expect(queries[0]?.sql).not.toContain('locked_until')
  })

  it('users query does NOT use SELECT *', async () => {
    const queries = await issueOptions()
    expect(queries[0]?.sql).not.toMatch(/SELECT\s+\*/i)
  })

  it('users query uses LIMIT', async () => {
    const queries = await issueOptions()
    expect(queries[0]?.sql).toMatch(/\bLIMIT\b/i)
  })

  it('users query binds ASSIGNMENT_OPTIONS_MAX + 1 as limit', async () => {
    const queries = await issueOptions()
    expect(queries[0]?.params[0]).toBe(ASSIGNMENT_OPTIONS_MAX + 1)
  })
})

// ---------------------------------------------------------------------------
// listAssignmentOptions — albums SQL structure
// ---------------------------------------------------------------------------

describe('AdminPermissionRepository.listAssignmentOptions albums SQL structure', () => {
  async function issueOptions() {
    const { db, queries } = makeOptionsDb([], [])
    await new AdminPermissionRepository(db).listAssignmentOptions()
    return queries
  }

  it('albums query selects id, title, enabled', async () => {
    const queries = await issueOptions()
    expect(queries[1]?.sql).toContain('id')
    expect(queries[1]?.sql).toContain('title')
    expect(queries[1]?.sql).toContain('enabled')
  })

  it('albums query queries FROM albums', async () => {
    const queries = await issueOptions()
    expect(queries[1]?.sql).toMatch(/FROM\s+albums/i)
  })

  it('albums query does NOT select photoprism_album_uid', async () => {
    const queries = await issueOptions()
    expect(queries[1]?.sql).not.toContain('photoprism_album_uid')
  })

  it('albums query does NOT select transform settings', async () => {
    const queries = await issueOptions()
    expect(queries[1]?.sql).not.toContain('transform')
  })

  it('albums query does NOT use SELECT *', async () => {
    const queries = await issueOptions()
    expect(queries[1]?.sql).not.toMatch(/SELECT\s+\*/i)
  })

  it('albums query uses LIMIT', async () => {
    const queries = await issueOptions()
    expect(queries[1]?.sql).toMatch(/\bLIMIT\b/i)
  })

  it('albums query binds ASSIGNMENT_OPTIONS_MAX + 1 as limit', async () => {
    const queries = await issueOptions()
    expect(queries[1]?.params[0]).toBe(ASSIGNMENT_OPTIONS_MAX + 1)
  })
})

// ---------------------------------------------------------------------------
// listAssignmentOptions — limit enforcement
// ---------------------------------------------------------------------------

describe('AdminPermissionRepository.listAssignmentOptions limit enforcement', () => {
  function makeUserRows(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      id: `user-limit-${String(i).padStart(3, '0')}`,
      display_name: `User ${i}`,
      enabled: 1,
    }))
  }

  function makeAlbumRows(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      id: `album-limit-${String(i).padStart(3, '0')}`,
      title: `Album ${i}`,
      enabled: 1,
    }))
  }

  it('100 user rows → resolves OK', async () => {
    const { db } = makeOptionsDb(makeUserRows(100), [])
    await expect(new AdminPermissionRepository(db).listAssignmentOptions()).resolves.toBeDefined()
  })

  it('101 user rows → throws (fail closed)', async () => {
    const { db } = makeOptionsDb(makeUserRows(101), [])
    await expect(new AdminPermissionRepository(db).listAssignmentOptions()).rejects.toThrow('database operation failed')
  })

  it('100 album rows → resolves OK', async () => {
    const { db } = makeOptionsDb([], makeAlbumRows(100))
    await expect(new AdminPermissionRepository(db).listAssignmentOptions()).resolves.toBeDefined()
  })

  it('101 album rows → throws (fail closed)', async () => {
    const { db } = makeOptionsDb([], makeAlbumRows(101))
    await expect(new AdminPermissionRepository(db).listAssignmentOptions()).rejects.toThrow('database operation failed')
  })
})

// ---------------------------------------------------------------------------
// listAssignmentOptions — user row validation
// ---------------------------------------------------------------------------

describe('AdminPermissionRepository.listAssignmentOptions user row validation', () => {
  it('accepts a valid user row', async () => {
    const { db } = makeOptionsDb([VALID_USER_ROW], [])
    const result = await new AdminPermissionRepository(db).listAssignmentOptions()
    expect(result.users).toHaveLength(1)
    expect(result.users[0]?.id).toBe(VALID_USER_ROW.id)
    expect(result.users[0]?.display_name).toBe(VALID_USER_ROW.display_name)
    expect(result.users[0]?.enabled).toBe(1)
  })

  it('accepts a disabled user row (enabled=0)', async () => {
    const { db } = makeOptionsDb([VALID_USER_ROW_2], [])
    const result = await new AdminPermissionRepository(db).listAssignmentOptions()
    expect(result.users[0]?.enabled).toBe(0)
  })

  it('rejects user row with invalid id', async () => {
    const { db } = makeOptionsDb([{ ...VALID_USER_ROW, id: '!bad!' }], [])
    await expect(new AdminPermissionRepository(db).listAssignmentOptions()).rejects.toThrow('database operation failed')
  })

  it('rejects user row with display_name > 1024 code points', async () => {
    const { db } = makeOptionsDb([{ ...VALID_USER_ROW, display_name: 'a'.repeat(1025) }], [])
    await expect(new AdminPermissionRepository(db).listAssignmentOptions()).rejects.toThrow('database operation failed')
  })

  it('accepts user row with display_name of exactly 1024 code points', async () => {
    const { db } = makeOptionsDb([{ ...VALID_USER_ROW, display_name: 'a'.repeat(1024) }], [])
    const result = await new AdminPermissionRepository(db).listAssignmentOptions()
    expect(result.users).toHaveLength(1)
  })

  it('rejects user row with enabled=2', async () => {
    const { db } = makeOptionsDb([{ ...VALID_USER_ROW, enabled: 2 }], [])
    await expect(new AdminPermissionRepository(db).listAssignmentOptions()).rejects.toThrow('database operation failed')
  })

  it('rejects user row with null enabled', async () => {
    const { db } = makeOptionsDb([{ ...VALID_USER_ROW, enabled: null }], [])
    await expect(new AdminPermissionRepository(db).listAssignmentOptions()).rejects.toThrow('database operation failed')
  })

  it('rejects null user row from D1', async () => {
    const { db } = makeOptionsDb([null], [])
    await expect(new AdminPermissionRepository(db).listAssignmentOptions()).rejects.toThrow('database operation failed')
  })

  it('rejects duplicate user id', async () => {
    const { db } = makeOptionsDb([VALID_USER_ROW, VALID_USER_ROW], [])
    await expect(new AdminPermissionRepository(db).listAssignmentOptions()).rejects.toThrow('database operation failed')
  })

  it('accepts two user rows with distinct ids', async () => {
    const { db } = makeOptionsDb([VALID_USER_ROW, VALID_USER_ROW_2], [])
    const result = await new AdminPermissionRepository(db).listAssignmentOptions()
    expect(result.users).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// listAssignmentOptions — album row validation
// ---------------------------------------------------------------------------

describe('AdminPermissionRepository.listAssignmentOptions album row validation', () => {
  it('accepts a valid album row', async () => {
    const { db } = makeOptionsDb([], [VALID_ALBUM_ROW])
    const result = await new AdminPermissionRepository(db).listAssignmentOptions()
    expect(result.albums).toHaveLength(1)
    expect(result.albums[0]?.id).toBe(VALID_ALBUM_ROW.id)
    expect(result.albums[0]?.title).toBe(VALID_ALBUM_ROW.title)
    expect(result.albums[0]?.enabled).toBe(1)
  })

  it('accepts a disabled album row (enabled=0)', async () => {
    const { db } = makeOptionsDb([], [VALID_ALBUM_ROW_2])
    const result = await new AdminPermissionRepository(db).listAssignmentOptions()
    expect(result.albums[0]?.enabled).toBe(0)
  })

  it('rejects album row with invalid id', async () => {
    const { db } = makeOptionsDb([], [{ ...VALID_ALBUM_ROW, id: '!bad!' }])
    await expect(new AdminPermissionRepository(db).listAssignmentOptions()).rejects.toThrow('database operation failed')
  })

  it('rejects album row with title > 1024 code points', async () => {
    const { db } = makeOptionsDb([], [{ ...VALID_ALBUM_ROW, title: 'a'.repeat(1025) }])
    await expect(new AdminPermissionRepository(db).listAssignmentOptions()).rejects.toThrow('database operation failed')
  })

  it('rejects album row with enabled=2', async () => {
    const { db } = makeOptionsDb([], [{ ...VALID_ALBUM_ROW, enabled: 2 }])
    await expect(new AdminPermissionRepository(db).listAssignmentOptions()).rejects.toThrow('database operation failed')
  })

  it('rejects null album row from D1', async () => {
    const { db } = makeOptionsDb([], [null])
    await expect(new AdminPermissionRepository(db).listAssignmentOptions()).rejects.toThrow('database operation failed')
  })

  it('rejects duplicate album id', async () => {
    const { db } = makeOptionsDb([], [VALID_ALBUM_ROW, VALID_ALBUM_ROW])
    await expect(new AdminPermissionRepository(db).listAssignmentOptions()).rejects.toThrow('database operation failed')
  })

  it('accepts two album rows with distinct ids', async () => {
    const { db } = makeOptionsDb([], [VALID_ALBUM_ROW, VALID_ALBUM_ROW_2])
    const result = await new AdminPermissionRepository(db).listAssignmentOptions()
    expect(result.albums).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// listAssignmentOptions — permission pagination
// ---------------------------------------------------------------------------

describe('AdminPermissionRepository.listAssignmentOptions permission pagination', () => {
  function makePermRows(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      album_id: `album-p-${String(i).padStart(3, '0')}`,
      user_id: `user-p-${String(i).padStart(3, '0')}`,
      created_at: NOW_TS,
    }))
  }

  it('51 permission rows → 50 permissions + hasMore true', async () => {
    const { db } = makeOptionsDb([], [], makePermRows(51))
    const result = await new AdminPermissionRepository(db).listAssignmentOptions()
    expect(result.permissions).toHaveLength(50)
    expect(result.hasMore).toBe(true)
  })

  it('50 permission rows → 50 permissions + hasMore false', async () => {
    const { db } = makeOptionsDb([], [], makePermRows(50))
    const result = await new AdminPermissionRepository(db).listAssignmentOptions()
    expect(result.permissions).toHaveLength(50)
    expect(result.hasMore).toBe(false)
  })

  it('0 permission rows → 0 permissions + hasMore false', async () => {
    const { db } = makeOptionsDb([], [], [])
    const result = await new AdminPermissionRepository(db).listAssignmentOptions()
    expect(result.permissions).toHaveLength(0)
    expect(result.hasMore).toBe(false)
  })

  it('permissions do NOT expose password_hash, photoprism_album_uid, or title', async () => {
    const { db } = makeOptionsDb([], [], makePermRows(1))
    const result = await new AdminPermissionRepository(db).listAssignmentOptions()
    const perm = result.permissions[0]
    expect(perm).not.toHaveProperty('password_hash')
    expect(perm).not.toHaveProperty('photoprism_album_uid')
    expect(perm).not.toHaveProperty('title')
    expect(perm).not.toHaveProperty('display_name')
  })
})

// ---------------------------------------------------------------------------
// listAssignmentOptions — cursor validation
// ---------------------------------------------------------------------------

describe('AdminPermissionRepository.listAssignmentOptions cursor validation', () => {
  it('invalid albumId in after throws before D1', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminPermissionRepository(db).listAssignmentOptions({ albumId: '!bad!', userId: 'user-abc-001' }),
    ).rejects.toThrow('invalid cursor')
    expect(queries).toHaveLength(0)
  })

  it('invalid userId in after throws before D1', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminPermissionRepository(db).listAssignmentOptions({ albumId: 'album-abc-001', userId: '!bad!' }),
    ).rejects.toThrow('invalid cursor')
    expect(queries).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// listAssignmentOptions — error sanitization
// ---------------------------------------------------------------------------

describe('AdminPermissionRepository.listAssignmentOptions error sanitization', () => {
  it('users query D1 throw → "database operation failed"', async () => {
    const { db } = makeMockDb([{ throws: new Error('D1 users secret-detail') }])
    await expect(new AdminPermissionRepository(db).listAssignmentOptions()).rejects.toThrow('database operation failed')
  })

  it('albums query D1 throw → "database operation failed"', async () => {
    const { db } = makeMockDb([
      { allRows: [] },
      { throws: new Error('D1 albums secret-detail') },
    ])
    await expect(new AdminPermissionRepository(db).listAssignmentOptions()).rejects.toThrow('database operation failed')
  })

  it('permissions query D1 throw → "database operation failed"', async () => {
    const { db } = makeMockDb([
      { allRows: [] },
      { allRows: [] },
      { throws: new Error('D1 perms secret-detail') },
    ])
    await expect(new AdminPermissionRepository(db).listAssignmentOptions()).rejects.toThrow('database operation failed')
  })

  it('error message does not contain sensitive D1 detail', async () => {
    const sensitiveToken = 'secret-token-opts-xyz'
    const { db } = makeMockDb([{ throws: new Error(sensitiveToken) }])
    const err = await new AdminPermissionRepository(db).listAssignmentOptions().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).not.toContain(sensitiveToken)
  })
})
