import { describe, it, expect } from 'vitest'
import { AdminAlbumRepository, ADMIN_ALBUMS_PAGE_SIZE } from '../src/services/admin-album-repository.js'
import { makeMockDb } from './helpers/mock-d1.js'

// ---------------------------------------------------------------------------
// createAlbum constants
// ---------------------------------------------------------------------------

const CREATE_ALBUM_ID = 'album-create-001'
const CREATE_TITLE = 'New Album Title'
const CREATE_UID = 'pxyz1234ABCD'
const CREATE_EXPIRES_AT = '2027-01-01T00:00:00.000Z'
const CREATE_CREATED_AT = '2026-06-26T00:00:00.000Z'
const CREATE_UPDATED_AT = '2026-06-26T00:00:00.000Z'

async function issueCreateAlbum(
  overrides: {
    albumId?: string
    title?: string
    uid?: string
    expiresAt?: string | null
    downloadEnabled?: 0 | 1
    createdAt?: string
    updatedAt?: string
  } = {},
) {
  const { db, queries } = makeMockDb([{}])
  await new AdminAlbumRepository(db).createAlbum(
    overrides.albumId ?? CREATE_ALBUM_ID,
    overrides.title ?? CREATE_TITLE,
    overrides.uid ?? CREATE_UID,
    overrides.expiresAt !== undefined ? overrides.expiresAt : CREATE_EXPIRES_AT,
    overrides.downloadEnabled ?? 0,
    overrides.createdAt ?? CREATE_CREATED_AT,
    overrides.updatedAt ?? CREATE_UPDATED_AT,
  )
  return queries
}

const VALID_CURSOR = 'album-cursor-001'
const NOW_TS = '2026-06-15T00:00:00.000Z'

const VALID_ROW = {
  id: 'album-abc-001',
  title: 'Summer Trip',
  enabled: 1,
  expires_at: null,
  download_enabled: 0,
  created_at: NOW_TS,
  updated_at: NOW_TS,
}

const VALID_ROW_2 = {
  id: 'album-abc-002',
  title: 'Winter Holidays',
  enabled: 0,
  expires_at: '2026-12-31T23:59:59.000Z',
  download_enabled: 1,
  created_at: NOW_TS,
  updated_at: NOW_TS,
}

// ---------------------------------------------------------------------------
// SQL structure
// ---------------------------------------------------------------------------

describe('AdminAlbumRepository.listAlbums SQL structure', () => {
  async function issueList(cursor?: string) {
    const { db, queries } = makeMockDb([{ allRows: [] }])
    await new AdminAlbumRepository(db).listAlbums(cursor)
    return queries
  }

  it('selects the 7 explicit album columns (not SELECT *)', async () => {
    const queries = await issueList()
    expect(queries[0]?.sql).toContain('id')
    expect(queries[0]?.sql).toContain('title')
    expect(queries[0]?.sql).toContain('enabled')
    expect(queries[0]?.sql).toContain('expires_at')
    expect(queries[0]?.sql).toContain('download_enabled')
    expect(queries[0]?.sql).toContain('created_at')
    expect(queries[0]?.sql).toContain('updated_at')
    expect(queries[0]?.sql).not.toMatch(/SELECT\s+\*/i)
  })

  it('queries FROM albums', async () => {
    const queries = await issueList()
    expect(queries[0]?.sql).toContain('FROM albums')
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

  it('SQL does NOT contain photoprism_album_uid', async () => {
    const queries = await issueList()
    expect(queries[0]?.sql).not.toContain('photoprism_album_uid')
  })

  it('SQL does NOT contain thumb_', async () => {
    const queries = await issueList()
    expect(queries[0]?.sql).not.toContain('thumb_')
  })

  it('SQL does NOT contain preview_', async () => {
    const queries = await issueList()
    expect(queries[0]?.sql).not.toContain('preview_')
  })

  it('SQL does NOT contain strip_exif', async () => {
    const queries = await issueList()
    expect(queries[0]?.sql).not.toContain('strip_exif')
  })
})

// ---------------------------------------------------------------------------
// Params — no cursor
// ---------------------------------------------------------------------------

describe('AdminAlbumRepository.listAlbums params — no cursor', () => {
  it('binds LIMIT as 51 (PAGE_SIZE + 1)', async () => {
    const { db, queries } = makeMockDb([{ allRows: [] }])
    await new AdminAlbumRepository(db).listAlbums()
    expect(queries[0]?.params).toHaveLength(1)
    expect(queries[0]?.params[0]).toBe(ADMIN_ALBUMS_PAGE_SIZE + 1)
  })

  it('SQL does not contain id > (no cursor filter)', async () => {
    const { db, queries } = makeMockDb([{ allRows: [] }])
    await new AdminAlbumRepository(db).listAlbums()
    expect(queries[0]?.sql).not.toContain('id >')
  })
})

// ---------------------------------------------------------------------------
// Params — with cursor
// ---------------------------------------------------------------------------

describe('AdminAlbumRepository.listAlbums params — with cursor', () => {
  it('binds (cursor, 51) when cursor is provided', async () => {
    const { db, queries } = makeMockDb([{ allRows: [] }])
    await new AdminAlbumRepository(db).listAlbums(VALID_CURSOR)
    expect(queries[0]?.params).toHaveLength(2)
    expect(queries[0]?.params[0]).toBe(VALID_CURSOR)
    expect(queries[0]?.params[1]).toBe(ADMIN_ALBUMS_PAGE_SIZE + 1)
  })

  it('SQL contains id > ? cursor condition when cursor is provided', async () => {
    const { db, queries } = makeMockDb([{ allRows: [] }])
    await new AdminAlbumRepository(db).listAlbums(VALID_CURSOR)
    expect(queries[0]?.sql).toContain('id > ?')
  })

  it('cursor is a bound param, not an SQL literal', async () => {
    const { db, queries } = makeMockDb([{ allRows: [] }])
    await new AdminAlbumRepository(db).listAlbums(VALID_CURSOR)
    expect(queries[0]?.sql).not.toContain(VALID_CURSOR)
    expect(queries[0]?.params).toContain(VALID_CURSOR)
  })
})

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

describe('AdminAlbumRepository.listAlbums pagination', () => {
  function makeRows(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      id: `album-paginate-${String(i).padStart(3, '0')}`,
      title: `Album ${i}`,
      enabled: 1,
      expires_at: null,
      download_enabled: 0,
      created_at: NOW_TS,
      updated_at: NOW_TS,
    }))
  }

  it('given 51 rows → returns 50 albums + hasMore true', async () => {
    const { db } = makeMockDb([{ allRows: makeRows(51) }])
    const result = await new AdminAlbumRepository(db).listAlbums()
    expect(result.albums).toHaveLength(50)
    expect(result.hasMore).toBe(true)
  })

  it('given 50 rows → returns 50 albums + hasMore false', async () => {
    const { db } = makeMockDb([{ allRows: makeRows(50) }])
    const result = await new AdminAlbumRepository(db).listAlbums()
    expect(result.albums).toHaveLength(50)
    expect(result.hasMore).toBe(false)
  })

  it('given 3 rows → returns 3 albums + hasMore false', async () => {
    const { db } = makeMockDb([{ allRows: makeRows(3) }])
    const result = await new AdminAlbumRepository(db).listAlbums()
    expect(result.albums).toHaveLength(3)
    expect(result.hasMore).toBe(false)
  })

  it('given 0 rows → returns 0 albums + hasMore false', async () => {
    const { db } = makeMockDb([{ allRows: [] }])
    const result = await new AdminAlbumRepository(db).listAlbums()
    expect(result.albums).toHaveLength(0)
    expect(result.hasMore).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Row validation
// ---------------------------------------------------------------------------

describe('AdminAlbumRepository.listAlbums row validation', () => {
  it('accepts a valid row with expires_at=null', async () => {
    const { db } = makeMockDb([{ allRows: [VALID_ROW] }])
    const result = await new AdminAlbumRepository(db).listAlbums()
    expect(result.albums).toHaveLength(1)
    expect(result.albums[0]?.id).toBe(VALID_ROW.id)
  })

  it('accepts a valid row with a canonical UTC expires_at', async () => {
    const rowWithExpiry = { ...VALID_ROW, expires_at: '2026-12-31T23:59:59.000Z' }
    const { db } = makeMockDb([{ allRows: [rowWithExpiry] }])
    const result = await new AdminAlbumRepository(db).listAlbums()
    expect(result.albums[0]?.expires_at).toBe('2026-12-31T23:59:59.000Z')
  })

  it('accepts two valid rows', async () => {
    const { db } = makeMockDb([{ allRows: [VALID_ROW, VALID_ROW_2] }])
    const result = await new AdminAlbumRepository(db).listAlbums()
    expect(result.albums).toHaveLength(2)
  })

  it('rejects row with invalid id', async () => {
    const { db } = makeMockDb([{ allRows: [{ ...VALID_ROW, id: '!bad!' }] }])
    await expect(new AdminAlbumRepository(db).listAlbums()).rejects.toThrow('database operation failed')
  })

  it('rejects row with title longer than 1024 code points', async () => {
    const { db } = makeMockDb([{ allRows: [{ ...VALID_ROW, title: 'a'.repeat(1025) }] }])
    await expect(new AdminAlbumRepository(db).listAlbums()).rejects.toThrow('database operation failed')
  })

  it('accepts title of exactly 1024 code points', async () => {
    const { db } = makeMockDb([{ allRows: [{ ...VALID_ROW, title: 'a'.repeat(1024) }] }])
    const result = await new AdminAlbumRepository(db).listAlbums()
    expect(Array.from(result.albums[0]?.title ?? '').length).toBe(1024)
  })

  it('rejects row with enabled=2', async () => {
    const { db } = makeMockDb([{ allRows: [{ ...VALID_ROW, enabled: 2 }] }])
    await expect(new AdminAlbumRepository(db).listAlbums()).rejects.toThrow('database operation failed')
  })

  it('rejects row with enabled="1" (string)', async () => {
    const { db } = makeMockDb([{ allRows: [{ ...VALID_ROW, enabled: '1' }] }])
    await expect(new AdminAlbumRepository(db).listAlbums()).rejects.toThrow('database operation failed')
  })

  it('rejects row with expires_at="bad"', async () => {
    const { db } = makeMockDb([{ allRows: [{ ...VALID_ROW, expires_at: 'bad' }] }])
    await expect(new AdminAlbumRepository(db).listAlbums()).rejects.toThrow('database operation failed')
  })

  it('rejects row with download_enabled=2', async () => {
    const { db } = makeMockDb([{ allRows: [{ ...VALID_ROW, download_enabled: 2 }] }])
    await expect(new AdminAlbumRepository(db).listAlbums()).rejects.toThrow('database operation failed')
  })

  it('rejects row with invalid created_at', async () => {
    const { db } = makeMockDb([{ allRows: [{ ...VALID_ROW, created_at: '2026-06-15' }] }])
    await expect(new AdminAlbumRepository(db).listAlbums()).rejects.toThrow('database operation failed')
  })

  it('rejects row with invalid updated_at', async () => {
    const { db } = makeMockDb([{ allRows: [{ ...VALID_ROW, updated_at: '2026-06-15T00:00:00Z' }] }])
    await expect(new AdminAlbumRepository(db).listAlbums()).rejects.toThrow('database operation failed')
  })

  it('rejects null row from D1', async () => {
    const { db } = makeMockDb([{ allRows: [null] }])
    await expect(new AdminAlbumRepository(db).listAlbums()).rejects.toThrow('database operation failed')
  })

  it('rejects duplicate ids from D1', async () => {
    const { db } = makeMockDb([{ allRows: [VALID_ROW, VALID_ROW] }])
    await expect(new AdminAlbumRepository(db).listAlbums()).rejects.toThrow('database operation failed')
  })

  it('rejects non-array results from D1', async () => {
    const { db } = makeMockDb([{ allResult: { success: true, results: null } }])
    await expect(new AdminAlbumRepository(db).listAlbums()).rejects.toThrow('database operation failed')
  })
})

// ---------------------------------------------------------------------------
// Returned objects contain ONLY the 7 fields — forbidden columns absent
// ---------------------------------------------------------------------------

describe('AdminAlbumRepository.listAlbums — no extra fields in returned objects', () => {
  it('returned objects do not contain photoprism_album_uid', async () => {
    const rowWithExtra = { ...VALID_ROW, photoprism_album_uid: 'SHOULD_NOT_APPEAR' }
    const { db } = makeMockDb([{ allRows: [rowWithExtra] }])
    const result = await new AdminAlbumRepository(db).listAlbums()
    expect(result.albums).toHaveLength(1)
    const first = result.albums[0] ?? {}
    expect('photoprism_album_uid' in first).toBe(false)
  })

  it('returned objects do not contain strip_exif', async () => {
    const rowWithExtra = { ...VALID_ROW, strip_exif: 1 }
    const { db } = makeMockDb([{ allRows: [rowWithExtra] }])
    const result = await new AdminAlbumRepository(db).listAlbums()
    expect(result.albums).toHaveLength(1)
    const first = result.albums[0] ?? {}
    expect('strip_exif' in first).toBe(false)
  })

  it('returned objects do not contain thumb_long_edge', async () => {
    const rowWithExtra = { ...VALID_ROW, thumb_long_edge: 640 }
    const { db } = makeMockDb([{ allRows: [rowWithExtra] }])
    const result = await new AdminAlbumRepository(db).listAlbums()
    expect(result.albums).toHaveLength(1)
    const first = result.albums[0] ?? {}
    expect('thumb_long_edge' in first).toBe(false)
  })

  it('returned objects contain exactly the 7 expected fields', async () => {
    const { db } = makeMockDb([{ allRows: [VALID_ROW] }])
    const result = await new AdminAlbumRepository(db).listAlbums()
    const keys = Object.keys(result.albums[0] ?? {}).sort()
    expect(keys).toEqual([
      'created_at',
      'download_enabled',
      'enabled',
      'expires_at',
      'id',
      'title',
      'updated_at',
    ])
  })
})

// ---------------------------------------------------------------------------
// Cursor validation
// ---------------------------------------------------------------------------

describe('AdminAlbumRepository.listAlbums cursor validation', () => {
  it('invalid cursor (contains !) throws before D1', async () => {
    const { db, queries } = makeMockDb([])
    await expect(new AdminAlbumRepository(db).listAlbums('!bad!')).rejects.toThrow('invalid cursor')
    expect(queries).toHaveLength(0)
  })

  it('empty string cursor throws before D1', async () => {
    const { db, queries } = makeMockDb([])
    await expect(new AdminAlbumRepository(db).listAlbums('')).rejects.toThrow('invalid cursor')
    expect(queries).toHaveLength(0)
  })

  it('undefined cursor is accepted (no cursor path)', async () => {
    const { db } = makeMockDb([{ allRows: [] }])
    await expect(new AdminAlbumRepository(db).listAlbums(undefined)).resolves.toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Error sanitization
// ---------------------------------------------------------------------------

describe('AdminAlbumRepository.listAlbums error sanitization', () => {
  it('D1 throw → "database operation failed"', async () => {
    const { db } = makeMockDb([{ throws: new Error('D1 connection failure with secret-token-abc') }])
    await expect(new AdminAlbumRepository(db).listAlbums()).rejects.toThrow('database operation failed')
  })

  it('D1 error message does not contain the sensitive token from the thrown error', async () => {
    const sensitiveToken = 'secret-token-album-xyz'
    const { db } = makeMockDb([{ throws: new Error(`D1 error: ${sensitiveToken}`) }])
    const err = await new AdminAlbumRepository(db).listAlbums().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).not.toContain(sensitiveToken)
  })
})

// ---------------------------------------------------------------------------
// setAlbumEnabled — SQL structure
// ---------------------------------------------------------------------------

const SET_ALBUM_ID = 'album-set-001'
const SET_UPDATED_AT = '2026-06-19T00:00:00.000Z'

async function issueSetEnabled(enabled: 0 | 1 = 1) {
  const { db, queries } = makeMockDb([{}])
  await new AdminAlbumRepository(db).setAlbumEnabled(SET_ALBUM_ID, enabled, SET_UPDATED_AT)
  return queries
}

describe('AdminAlbumRepository.setAlbumEnabled SQL structure', () => {
  it('SQL contains UPDATE albums', async () => {
    const queries = await issueSetEnabled()
    expect(queries[0]?.sql).toContain('UPDATE albums')
  })

  it('SQL contains SET enabled = ?, updated_at = ?', async () => {
    const queries = await issueSetEnabled()
    expect(queries[0]?.sql).toContain('SET enabled = ?, updated_at = ?')
  })

  it('SQL contains WHERE id = ? AND enabled <> ?', async () => {
    const queries = await issueSetEnabled()
    expect(queries[0]?.sql).toContain('WHERE id = ? AND enabled <> ?')
  })

  it('SQL does NOT contain SELECT', async () => {
    const queries = await issueSetEnabled()
    expect(queries[0]?.sql).not.toMatch(/\bSELECT\b/)
  })

  it('SQL does NOT contain JOIN', async () => {
    const queries = await issueSetEnabled()
    expect(queries[0]?.sql).not.toContain(' JOIN ')
  })

  it('SQL does NOT contain INSERT', async () => {
    const queries = await issueSetEnabled()
    expect(queries[0]?.sql).not.toMatch(/\bINSERT\b/)
  })

  it('SQL does NOT contain DELETE', async () => {
    const queries = await issueSetEnabled()
    expect(queries[0]?.sql).not.toMatch(/\bDELETE\b/)
  })

  it('SQL does NOT contain title', async () => {
    const queries = await issueSetEnabled()
    expect(queries[0]?.sql).not.toContain('title')
  })

  it('SQL does NOT contain download_enabled', async () => {
    const queries = await issueSetEnabled()
    expect(queries[0]?.sql).not.toContain('download_enabled')
  })

  it('SQL does NOT contain photoprism_album_uid', async () => {
    const queries = await issueSetEnabled()
    expect(queries[0]?.sql).not.toContain('photoprism_album_uid')
  })

  it('SQL does NOT contain strip_exif', async () => {
    const queries = await issueSetEnabled()
    expect(queries[0]?.sql).not.toContain('strip_exif')
  })
})

// ---------------------------------------------------------------------------
// setAlbumEnabled — params
// ---------------------------------------------------------------------------

describe('AdminAlbumRepository.setAlbumEnabled params', () => {
  it('enable: params are exactly [1, updatedAt, albumId, 1] in order', async () => {
    const queries = await issueSetEnabled(1)
    expect(queries[0]?.params).toEqual([1, SET_UPDATED_AT, SET_ALBUM_ID, 1])
  })

  it('disable: params are exactly [0, updatedAt, albumId, 0] in order', async () => {
    const queries = await issueSetEnabled(0)
    expect(queries[0]?.params).toEqual([0, SET_UPDATED_AT, SET_ALBUM_ID, 0])
  })

  it('SQL does not contain the literal albumId value', async () => {
    const queries = await issueSetEnabled()
    expect(queries[0]?.sql).not.toContain(SET_ALBUM_ID)
  })

  it('SQL does not contain the literal updatedAt value', async () => {
    const queries = await issueSetEnabled()
    expect(queries[0]?.sql).not.toContain(SET_UPDATED_AT)
  })
})

// ---------------------------------------------------------------------------
// setAlbumEnabled — success
// ---------------------------------------------------------------------------

describe('AdminAlbumRepository.setAlbumEnabled success', () => {
  it('default {success:true} → resolves without throw', async () => {
    const { db } = makeMockDb([{}])
    await expect(
      new AdminAlbumRepository(db).setAlbumEnabled(SET_ALBUM_ID, 1, SET_UPDATED_AT),
    ).resolves.toBeUndefined()
  })

  it('already enabled (same state) is a no-op success', async () => {
    const { db } = makeMockDb([{}])
    await expect(
      new AdminAlbumRepository(db).setAlbumEnabled(SET_ALBUM_ID, 1, SET_UPDATED_AT),
    ).resolves.toBeUndefined()
  })

  it('unknown album id is a no-op success', async () => {
    const { db } = makeMockDb([{}])
    await expect(
      new AdminAlbumRepository(db).setAlbumEnabled(SET_ALBUM_ID, 1, SET_UPDATED_AT),
    ).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// setAlbumEnabled — validation before D1
// ---------------------------------------------------------------------------

describe('AdminAlbumRepository.setAlbumEnabled validation before D1', () => {
  it('invalid albumId → rejects with database operation failed, D1 not touched', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminAlbumRepository(db).setAlbumEnabled('!bad!', 1, SET_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })

  it('enabled = 2 (not 0 or 1) → rejects with database operation failed, D1 not touched', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminAlbumRepository(db).setAlbumEnabled(SET_ALBUM_ID, 2, SET_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })

  it('non-canonical updatedAt → rejects with database operation failed, D1 not touched', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminAlbumRepository(db).setAlbumEnabled(SET_ALBUM_ID, 1, '2026-06-19'),
    ).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// setAlbumEnabled — error sanitization
// ---------------------------------------------------------------------------

describe('AdminAlbumRepository.setAlbumEnabled error sanitization', () => {
  it('run() throws → rejects with database operation failed', async () => {
    const { db } = makeMockDb([{ throws: new Error('secret-token-album-xyz') }])
    await expect(
      new AdminAlbumRepository(db).setAlbumEnabled(SET_ALBUM_ID, 1, SET_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
  })

  it('run() throws → error message does not contain the sensitive token', async () => {
    const sensitiveToken = 'secret-token-album-xyz'
    const { db } = makeMockDb([{ throws: new Error(sensitiveToken) }])
    const err = await new AdminAlbumRepository(db)
      .setAlbumEnabled(SET_ALBUM_ID, 1, SET_UPDATED_AT)
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).not.toContain(sensitiveToken)
  })

  it('runResult {success:false} → rejects with database operation failed', async () => {
    const { db } = makeMockDb([{ runResult: { success: false } }])
    await expect(
      new AdminAlbumRepository(db).setAlbumEnabled(SET_ALBUM_ID, 1, SET_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
  })

  it('runResult null → rejects with database operation failed', async () => {
    const { db } = makeMockDb([{ runResult: null }])
    await expect(
      new AdminAlbumRepository(db).setAlbumEnabled(SET_ALBUM_ID, 1, SET_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
  })
})

// ---------------------------------------------------------------------------
// updatePublicMetadata — SQL structure
// ---------------------------------------------------------------------------

const UPDATE_ALBUM_ID = 'album-update-001'
const UPDATE_TITLE = 'Updated Album Title'
const UPDATE_EXPIRES_AT = '2026-12-31T23:59:59.000Z'
const UPDATE_UPDATED_AT = '2026-06-24T00:00:00.000Z'

async function issueUpdatePublicMetadata(
  expiresAt: string | null = UPDATE_EXPIRES_AT,
  downloadEnabled: 0 | 1 = 0,
) {
  const { db, queries } = makeMockDb([{}])
  await new AdminAlbumRepository(db).updatePublicMetadata(
    UPDATE_ALBUM_ID,
    UPDATE_TITLE,
    expiresAt,
    downloadEnabled,
    UPDATE_UPDATED_AT,
  )
  return queries
}

describe('AdminAlbumRepository.updatePublicMetadata SQL structure', () => {
  it('SQL contains UPDATE albums', async () => {
    const queries = await issueUpdatePublicMetadata()
    expect(queries[0]?.sql).toContain('UPDATE albums')
  })

  it('SQL contains SET title = ?, expires_at = ?, download_enabled = ?, updated_at = ?', async () => {
    const queries = await issueUpdatePublicMetadata()
    expect(queries[0]?.sql).toContain('SET title = ?, expires_at = ?, download_enabled = ?, updated_at = ?')
  })

  it('SQL contains WHERE id = ?', async () => {
    const queries = await issueUpdatePublicMetadata()
    expect(queries[0]?.sql).toContain('WHERE id = ?')
  })

  it('SQL does NOT contain SELECT', async () => {
    const queries = await issueUpdatePublicMetadata()
    expect(queries[0]?.sql).not.toMatch(/\bSELECT\b/)
  })

  it('SQL does NOT contain INSERT', async () => {
    const queries = await issueUpdatePublicMetadata()
    expect(queries[0]?.sql).not.toMatch(/\bINSERT\b/)
  })

  it('SQL does NOT contain DELETE', async () => {
    const queries = await issueUpdatePublicMetadata()
    expect(queries[0]?.sql).not.toMatch(/\bDELETE\b/)
  })

  it('SQL does NOT contain JOIN', async () => {
    const queries = await issueUpdatePublicMetadata()
    expect(queries[0]?.sql).not.toMatch(/\bJOIN\b/)
  })

  it('SQL does NOT contain photoprism_album_uid', async () => {
    const queries = await issueUpdatePublicMetadata()
    expect(queries[0]?.sql).not.toContain('photoprism_album_uid')
  })

  it('SQL does NOT contain thumb_', async () => {
    const queries = await issueUpdatePublicMetadata()
    expect(queries[0]?.sql).not.toContain('thumb_')
  })

  it('SQL does NOT contain preview_', async () => {
    const queries = await issueUpdatePublicMetadata()
    expect(queries[0]?.sql).not.toContain('preview_')
  })

  it('SQL does NOT contain strip_exif', async () => {
    const queries = await issueUpdatePublicMetadata()
    expect(queries[0]?.sql).not.toContain('strip_exif')
  })

  it('SQL does NOT contain bare enabled keyword', async () => {
    const queries = await issueUpdatePublicMetadata()
    expect(queries[0]?.sql).not.toMatch(/\benabled\b/)
  })

  it('SQL does NOT contain created_at', async () => {
    const queries = await issueUpdatePublicMetadata()
    expect(queries[0]?.sql).not.toContain('created_at')
  })

  it('SQL does NOT contain sessions', async () => {
    const queries = await issueUpdatePublicMetadata()
    expect(queries[0]?.sql).not.toContain('sessions')
  })

  it('SQL does NOT contain album_permissions', async () => {
    const queries = await issueUpdatePublicMetadata()
    expect(queries[0]?.sql).not.toContain('album_permissions')
  })
})

// ---------------------------------------------------------------------------
// updatePublicMetadata — bind order
// ---------------------------------------------------------------------------

describe('AdminAlbumRepository.updatePublicMetadata bind order', () => {
  it('expiresAt string: params are [title, expiresAt, 0, updatedAt, albumId] in order', async () => {
    const queries = await issueUpdatePublicMetadata(UPDATE_EXPIRES_AT, 0)
    expect(queries[0]?.params).toEqual([UPDATE_TITLE, UPDATE_EXPIRES_AT, 0, UPDATE_UPDATED_AT, UPDATE_ALBUM_ID])
  })

  it('expiresAt null: params are [title, null, 1, updatedAt, albumId] in order', async () => {
    const { db, queries } = makeMockDb([{}])
    await new AdminAlbumRepository(db).updatePublicMetadata(
      UPDATE_ALBUM_ID, UPDATE_TITLE, null, 1, UPDATE_UPDATED_AT,
    )
    expect(queries[0]?.params).toEqual([UPDATE_TITLE, null, 1, UPDATE_UPDATED_AT, UPDATE_ALBUM_ID])
  })

  it('SQL does not contain the literal albumId value', async () => {
    const queries = await issueUpdatePublicMetadata()
    expect(queries[0]?.sql).not.toContain(UPDATE_ALBUM_ID)
  })

  it('SQL does not contain the literal updatedAt value', async () => {
    const queries = await issueUpdatePublicMetadata()
    expect(queries[0]?.sql).not.toContain(UPDATE_UPDATED_AT)
  })

  it('SQL does not contain the literal title value', async () => {
    const queries = await issueUpdatePublicMetadata()
    expect(queries[0]?.sql).not.toContain(UPDATE_TITLE)
  })
})

// ---------------------------------------------------------------------------
// updatePublicMetadata — success
// ---------------------------------------------------------------------------

describe('AdminAlbumRepository.updatePublicMetadata success', () => {
  it('default {success:true} → resolves without throw', async () => {
    const { db } = makeMockDb([{}])
    await expect(
      new AdminAlbumRepository(db).updatePublicMetadata(UPDATE_ALBUM_ID, UPDATE_TITLE, UPDATE_EXPIRES_AT, 0, UPDATE_UPDATED_AT),
    ).resolves.toBeUndefined()
  })

  it('{success:true, meta:{changes:1}} → resolves without throw', async () => {
    const { db } = makeMockDb([{ runResult: { success: true, meta: { changes: 1 } } }])
    await expect(
      new AdminAlbumRepository(db).updatePublicMetadata(UPDATE_ALBUM_ID, UPDATE_TITLE, UPDATE_EXPIRES_AT, 0, UPDATE_UPDATED_AT),
    ).resolves.toBeUndefined()
  })

  it('{success:true, meta:{changes:0}} → rejects with database operation failed', async () => {
    const { db } = makeMockDb([{ runResult: { success: true, meta: { changes: 0 } } }])
    await expect(
      new AdminAlbumRepository(db).updatePublicMetadata(UPDATE_ALBUM_ID, UPDATE_TITLE, UPDATE_EXPIRES_AT, 0, UPDATE_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
  })

  it('{success:true} with no meta → resolves without throw', async () => {
    const { db } = makeMockDb([{ runResult: { success: true } }])
    await expect(
      new AdminAlbumRepository(db).updatePublicMetadata(UPDATE_ALBUM_ID, UPDATE_TITLE, UPDATE_EXPIRES_AT, 0, UPDATE_UPDATED_AT),
    ).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// updatePublicMetadata — validation before D1
// ---------------------------------------------------------------------------

describe('AdminAlbumRepository.updatePublicMetadata validation before D1', () => {
  it('invalid albumId → rejects with database operation failed, D1 not touched', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminAlbumRepository(db).updatePublicMetadata('!bad!', UPDATE_TITLE, UPDATE_EXPIRES_AT, 0, UPDATE_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })

  it('empty title → rejects with database operation failed, D1 not touched', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminAlbumRepository(db).updatePublicMetadata(UPDATE_ALBUM_ID, '', UPDATE_EXPIRES_AT, 0, UPDATE_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })

  it('title with leading space → rejects with database operation failed, D1 not touched', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminAlbumRepository(db).updatePublicMetadata(UPDATE_ALBUM_ID, ' valid', UPDATE_EXPIRES_AT, 0, UPDATE_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })

  it('title with trailing space → rejects with database operation failed, D1 not touched', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminAlbumRepository(db).updatePublicMetadata(UPDATE_ALBUM_ID, 'valid ', UPDATE_EXPIRES_AT, 0, UPDATE_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })

  it('title with control char → rejects with database operation failed, D1 not touched', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminAlbumRepository(db).updatePublicMetadata(UPDATE_ALBUM_ID, '\x00title', UPDATE_EXPIRES_AT, 0, UPDATE_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })

  it('title exceeding 1024 codepoints → rejects with database operation failed, D1 not touched', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminAlbumRepository(db).updatePublicMetadata(UPDATE_ALBUM_ID, 'a'.repeat(1025), UPDATE_EXPIRES_AT, 0, UPDATE_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })

  it('non-canonical expiresAt ("2026-12-31") → rejects with database operation failed, D1 not touched', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminAlbumRepository(db).updatePublicMetadata(UPDATE_ALBUM_ID, UPDATE_TITLE, '2026-12-31', 0, UPDATE_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })

  it('expiresAt=null → D1 is called (valid)', async () => {
    const { db, queries } = makeMockDb([{}])
    await new AdminAlbumRepository(db).updatePublicMetadata(UPDATE_ALBUM_ID, UPDATE_TITLE, null, 0, UPDATE_UPDATED_AT)
    expect(queries).toHaveLength(1)
  })

  it('downloadEnabled = 2 → rejects with database operation failed, D1 not touched', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminAlbumRepository(db).updatePublicMetadata(UPDATE_ALBUM_ID, UPDATE_TITLE, UPDATE_EXPIRES_AT, 2, UPDATE_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })

  it('downloadEnabled = -1 → rejects with database operation failed, D1 not touched', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminAlbumRepository(db).updatePublicMetadata(UPDATE_ALBUM_ID, UPDATE_TITLE, UPDATE_EXPIRES_AT, -1, UPDATE_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })

  it('non-canonical updatedAt ("2026-06-24") → rejects with database operation failed, D1 not touched', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminAlbumRepository(db).updatePublicMetadata(UPDATE_ALBUM_ID, UPDATE_TITLE, UPDATE_EXPIRES_AT, 0, '2026-06-24'),
    ).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// updatePublicMetadata — error sanitization
// ---------------------------------------------------------------------------

describe('AdminAlbumRepository.updatePublicMetadata error sanitization', () => {
  it('run() throws → rejects with database operation failed', async () => {
    const { db } = makeMockDb([{ throws: new Error('secret-token-update-xyz') }])
    await expect(
      new AdminAlbumRepository(db).updatePublicMetadata(UPDATE_ALBUM_ID, UPDATE_TITLE, UPDATE_EXPIRES_AT, 0, UPDATE_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
  })

  it('run() throws → error message does not contain the sensitive token', async () => {
    const sensitiveToken = 'secret-token-update-xyz'
    const { db } = makeMockDb([{ throws: new Error(sensitiveToken) }])
    const err = await new AdminAlbumRepository(db)
      .updatePublicMetadata(UPDATE_ALBUM_ID, UPDATE_TITLE, UPDATE_EXPIRES_AT, 0, UPDATE_UPDATED_AT)
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).not.toContain(sensitiveToken)
  })

  it('runResult {success:false} → rejects with database operation failed', async () => {
    const { db } = makeMockDb([{ runResult: { success: false } }])
    await expect(
      new AdminAlbumRepository(db).updatePublicMetadata(UPDATE_ALBUM_ID, UPDATE_TITLE, UPDATE_EXPIRES_AT, 0, UPDATE_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
  })

  it('runResult null → rejects with database operation failed', async () => {
    const { db } = makeMockDb([{ runResult: null }])
    await expect(
      new AdminAlbumRepository(db).updatePublicMetadata(UPDATE_ALBUM_ID, UPDATE_TITLE, UPDATE_EXPIRES_AT, 0, UPDATE_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
  })
})

// ---------------------------------------------------------------------------
// createAlbum — SQL structure
// ---------------------------------------------------------------------------

describe('AdminAlbumRepository.createAlbum SQL structure', () => {
  it('SQL contains INSERT INTO albums', async () => {
    const queries = await issueCreateAlbum()
    expect(queries[0]?.sql).toMatch(/INSERT INTO albums/i)
  })

  it('SQL contains explicit column list with id', async () => {
    const queries = await issueCreateAlbum()
    expect(queries[0]?.sql).toContain('id')
  })

  it('SQL contains explicit column list with title', async () => {
    const queries = await issueCreateAlbum()
    expect(queries[0]?.sql).toContain('title')
  })

  it('SQL contains photoprism_album_uid in column list', async () => {
    const queries = await issueCreateAlbum()
    expect(queries[0]?.sql).toContain('photoprism_album_uid')
  })

  it('SQL contains enabled in column list', async () => {
    const queries = await issueCreateAlbum()
    expect(queries[0]?.sql).toContain('enabled')
  })

  it('SQL contains expires_at in column list', async () => {
    const queries = await issueCreateAlbum()
    expect(queries[0]?.sql).toContain('expires_at')
  })

  it('SQL contains download_enabled in column list', async () => {
    const queries = await issueCreateAlbum()
    expect(queries[0]?.sql).toContain('download_enabled')
  })

  it('SQL contains created_at in column list', async () => {
    const queries = await issueCreateAlbum()
    expect(queries[0]?.sql).toContain('created_at')
  })

  it('SQL contains updated_at in column list', async () => {
    const queries = await issueCreateAlbum()
    expect(queries[0]?.sql).toContain('updated_at')
  })

  it('SQL contains literal 0 for enabled (not a bound param)', async () => {
    const queries = await issueCreateAlbum()
    // The enabled value must appear as a literal "0" in VALUES, not as "?"
    expect(queries[0]?.sql).toMatch(/VALUES\s*\([^)]*,\s*0\s*,/i)
  })

  it('SQL does NOT contain SELECT', async () => {
    const queries = await issueCreateAlbum()
    expect(queries[0]?.sql).not.toMatch(/\bSELECT\b/i)
  })

  it('SQL does NOT contain UPDATE', async () => {
    const queries = await issueCreateAlbum()
    expect(queries[0]?.sql).not.toMatch(/\bUPDATE\b/i)
  })

  it('SQL does NOT contain DELETE', async () => {
    const queries = await issueCreateAlbum()
    expect(queries[0]?.sql).not.toMatch(/\bDELETE\b/i)
  })

  it('SQL does NOT contain thumb_', async () => {
    const queries = await issueCreateAlbum()
    expect(queries[0]?.sql).not.toContain('thumb_')
  })

  it('SQL does NOT contain preview_', async () => {
    const queries = await issueCreateAlbum()
    expect(queries[0]?.sql).not.toContain('preview_')
  })

  it('SQL does NOT contain strip_exif', async () => {
    const queries = await issueCreateAlbum()
    expect(queries[0]?.sql).not.toContain('strip_exif')
  })

  it('SQL does NOT contain album_permissions', async () => {
    const queries = await issueCreateAlbum()
    expect(queries[0]?.sql).not.toContain('album_permissions')
  })

  it('SQL does NOT contain sessions', async () => {
    const queries = await issueCreateAlbum()
    expect(queries[0]?.sql).not.toContain('sessions')
  })

  it('SQL does NOT contain users', async () => {
    const queries = await issueCreateAlbum()
    expect(queries[0]?.sql).not.toContain('users')
  })
})

// ---------------------------------------------------------------------------
// createAlbum — bind order
// ---------------------------------------------------------------------------

describe('AdminAlbumRepository.createAlbum bind order', () => {
  it('7 bound params in order: albumId, title, uid, expiresAt, downloadEnabled, createdAt, updatedAt', async () => {
    const queries = await issueCreateAlbum({ downloadEnabled: 1, expiresAt: CREATE_EXPIRES_AT })
    expect(queries[0]?.params).toEqual([
      CREATE_ALBUM_ID,
      CREATE_TITLE,
      CREATE_UID,
      CREATE_EXPIRES_AT,
      1,
      CREATE_CREATED_AT,
      CREATE_UPDATED_AT,
    ])
  })

  it('expiresAt null: null is bound at position 4', async () => {
    const queries = await issueCreateAlbum({ expiresAt: null, downloadEnabled: 0 })
    expect(queries[0]?.params).toEqual([
      CREATE_ALBUM_ID,
      CREATE_TITLE,
      CREATE_UID,
      null,
      0,
      CREATE_CREATED_AT,
      CREATE_UPDATED_AT,
    ])
  })

  it('SQL does not contain the literal albumId value', async () => {
    const queries = await issueCreateAlbum()
    expect(queries[0]?.sql).not.toContain(CREATE_ALBUM_ID)
  })

  it('SQL does not contain the literal title value', async () => {
    const queries = await issueCreateAlbum()
    expect(queries[0]?.sql).not.toContain(CREATE_TITLE)
  })

  it('SQL does not contain the literal UID value', async () => {
    const queries = await issueCreateAlbum()
    expect(queries[0]?.sql).not.toContain(CREATE_UID)
  })
})

// ---------------------------------------------------------------------------
// createAlbum — success
// ---------------------------------------------------------------------------

describe('AdminAlbumRepository.createAlbum success', () => {
  it('default {success:true} → resolves without throw', async () => {
    const { db } = makeMockDb([{}])
    await expect(
      new AdminAlbumRepository(db).createAlbum(CREATE_ALBUM_ID, CREATE_TITLE, CREATE_UID, null, 0, CREATE_CREATED_AT, CREATE_UPDATED_AT),
    ).resolves.toBeUndefined()
  })

  it('{success:true, meta:{changes:1}} → resolves without throw', async () => {
    const { db } = makeMockDb([{ runResult: { success: true, meta: { changes: 1 } } }])
    await expect(
      new AdminAlbumRepository(db).createAlbum(CREATE_ALBUM_ID, CREATE_TITLE, CREATE_UID, null, 0, CREATE_CREATED_AT, CREATE_UPDATED_AT),
    ).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// createAlbum — validation before D1
// ---------------------------------------------------------------------------

describe('AdminAlbumRepository.createAlbum validation before D1', () => {
  it('invalid albumId → rejects with database operation failed, D1 not touched', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminAlbumRepository(db).createAlbum('!bad!', CREATE_TITLE, CREATE_UID, null, 0, CREATE_CREATED_AT, CREATE_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })

  it('empty title → rejects with database operation failed, D1 not touched', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminAlbumRepository(db).createAlbum(CREATE_ALBUM_ID, '', CREATE_UID, null, 0, CREATE_CREATED_AT, CREATE_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })

  it('title with leading space → rejects with database operation failed, D1 not touched', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminAlbumRepository(db).createAlbum(CREATE_ALBUM_ID, ' title', CREATE_UID, null, 0, CREATE_CREATED_AT, CREATE_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })

  it('title with control char → rejects with database operation failed, D1 not touched', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminAlbumRepository(db).createAlbum(CREATE_ALBUM_ID, '\x00title', CREATE_UID, null, 0, CREATE_CREATED_AT, CREATE_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })

  it('title exceeding 1024 codepoints → rejects with database operation failed, D1 not touched', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminAlbumRepository(db).createAlbum(CREATE_ALBUM_ID, 'a'.repeat(1025), CREATE_UID, null, 0, CREATE_CREATED_AT, CREATE_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })

  it('empty photoprismAlbumUid → rejects with database operation failed, D1 not touched', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminAlbumRepository(db).createAlbum(CREATE_ALBUM_ID, CREATE_TITLE, '', null, 0, CREATE_CREATED_AT, CREATE_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })

  it('photoprismAlbumUid with space → rejects with database operation failed, D1 not touched', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminAlbumRepository(db).createAlbum(CREATE_ALBUM_ID, CREATE_TITLE, 'uid with space', null, 0, CREATE_CREATED_AT, CREATE_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })

  it('photoprismAlbumUid exceeding 128 chars → rejects with database operation failed, D1 not touched', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminAlbumRepository(db).createAlbum(CREATE_ALBUM_ID, CREATE_TITLE, 'a'.repeat(129), null, 0, CREATE_CREATED_AT, CREATE_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })

  it('non-canonical expiresAt → rejects with database operation failed, D1 not touched', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminAlbumRepository(db).createAlbum(CREATE_ALBUM_ID, CREATE_TITLE, CREATE_UID, '2027-01-01', 0, CREATE_CREATED_AT, CREATE_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })

  it('expiresAt=null is valid → D1 is called', async () => {
    const { db, queries } = makeMockDb([{}])
    await new AdminAlbumRepository(db).createAlbum(CREATE_ALBUM_ID, CREATE_TITLE, CREATE_UID, null, 0, CREATE_CREATED_AT, CREATE_UPDATED_AT)
    expect(queries).toHaveLength(1)
  })

  it('downloadEnabled = 2 → rejects with database operation failed, D1 not touched', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminAlbumRepository(db).createAlbum(CREATE_ALBUM_ID, CREATE_TITLE, CREATE_UID, null, 2 as 0 | 1, CREATE_CREATED_AT, CREATE_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })

  it('non-canonical createdAt → rejects with database operation failed, D1 not touched', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminAlbumRepository(db).createAlbum(CREATE_ALBUM_ID, CREATE_TITLE, CREATE_UID, null, 0, '2026-06-26', CREATE_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })

  it('non-canonical updatedAt → rejects with database operation failed, D1 not touched', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AdminAlbumRepository(db).createAlbum(CREATE_ALBUM_ID, CREATE_TITLE, CREATE_UID, null, 0, CREATE_CREATED_AT, '2026-06-26'),
    ).rejects.toThrow('database operation failed')
    expect(queries).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// createAlbum — error sanitization
// ---------------------------------------------------------------------------

describe('AdminAlbumRepository.createAlbum error sanitization', () => {
  it('run() throws → rejects with database operation failed', async () => {
    const { db } = makeMockDb([{ throws: new Error('secret-token-create-xyz') }])
    await expect(
      new AdminAlbumRepository(db).createAlbum(CREATE_ALBUM_ID, CREATE_TITLE, CREATE_UID, null, 0, CREATE_CREATED_AT, CREATE_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
  })

  it('run() throws → error message does not contain the sensitive token', async () => {
    const sensitiveToken = 'secret-token-create-xyz'
    const { db } = makeMockDb([{ throws: new Error(sensitiveToken) }])
    const err = await new AdminAlbumRepository(db)
      .createAlbum(CREATE_ALBUM_ID, CREATE_TITLE, CREATE_UID, null, 0, CREATE_CREATED_AT, CREATE_UPDATED_AT)
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).not.toContain(sensitiveToken)
  })

  it('runResult {success:false} → rejects with database operation failed', async () => {
    const { db } = makeMockDb([{ runResult: { success: false } }])
    await expect(
      new AdminAlbumRepository(db).createAlbum(CREATE_ALBUM_ID, CREATE_TITLE, CREATE_UID, null, 0, CREATE_CREATED_AT, CREATE_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
  })

  it('runResult null → rejects with database operation failed', async () => {
    const { db } = makeMockDb([{ runResult: null }])
    await expect(
      new AdminAlbumRepository(db).createAlbum(CREATE_ALBUM_ID, CREATE_TITLE, CREATE_UID, null, 0, CREATE_CREATED_AT, CREATE_UPDATED_AT),
    ).rejects.toThrow('database operation failed')
  })
})
