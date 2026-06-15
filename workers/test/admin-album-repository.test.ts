import { describe, it, expect } from 'vitest'
import { AdminAlbumRepository, ADMIN_ALBUMS_PAGE_SIZE } from '../src/services/admin-album-repository.js'
import { makeMockDb } from './helpers/mock-d1.js'

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
