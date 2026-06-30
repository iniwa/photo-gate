import { describe, it, expect } from 'vitest'
import { AuthorizedAlbumRepository } from '../src/services/authorized-album-repository.js'
import { makeMockDb } from './helpers/mock-d1.js'

const VALID_USER_ID = 'user-abc-123'
const VALID_ALBUM_ID = 'album-xyz-456'
const VALID_CURSOR = 'album-cursor-789'
const NOW = '2026-06-09T00:00:00.000Z'
const LIMIT = 20

const VALID_ROW = { id: VALID_ALBUM_ID, title: 'My Album', download_enabled: 1 }
const VALID_ROW_2 = { id: 'album-second-001', title: 'Second Album', download_enabled: 0 }

// ---------------------------------------------------------------------------
// listAuthorizedAlbums — SQL structure
// ---------------------------------------------------------------------------

describe('AuthorizedAlbumRepository.listAuthorizedAlbums SQL structure', () => {
  async function issueList(opts: { cursor?: string; limit?: number } = {}) {
    const { db, queries } = makeMockDb([{ allRows: [] }])
    await new AuthorizedAlbumRepository(db).listAuthorizedAlbums(
      VALID_USER_ID,
      NOW,
      opts.limit ?? LIMIT,
      opts.cursor,
    )
    return queries
  }

  it('selects a.id and a.title (not SELECT *)', async () => {
    const queries = await issueList()
    expect(queries[0]?.sql).toContain('a.id')
    expect(queries[0]?.sql).toContain('a.title')
    expect(queries[0]?.sql).not.toMatch(/SELECT\s+\*/i)
  })

  it('joins album_permissions, albums, and users', async () => {
    const queries = await issueList()
    expect(queries[0]?.sql).toContain('album_permissions')
    expect(queries[0]?.sql).toContain('JOIN albums')
    expect(queries[0]?.sql).toContain('JOIN users')
  })

  it('requires ap.user_id = ?', async () => {
    const queries = await issueList()
    expect(queries[0]?.sql).toContain('ap.user_id')
  })

  it('requires a.enabled = 1', async () => {
    const queries = await issueList()
    expect(queries[0]?.sql).toMatch(/a\.enabled\s*=\s*1/)
  })

  it('requires expires_at check', async () => {
    const queries = await issueList()
    expect(queries[0]?.sql).toContain('expires_at')
  })

  it('requires u.enabled = 1', async () => {
    const queries = await issueList()
    expect(queries[0]?.sql).toMatch(/u\.enabled\s*=\s*1/)
  })

  it('orders by a.id ASC', async () => {
    const queries = await issueList()
    expect(queries[0]?.sql).toMatch(/ORDER BY a\.id ASC/i)
  })

  it('does not use OFFSET', async () => {
    const queries = await issueList()
    expect(queries[0]?.sql).not.toMatch(/\bOFFSET\b/i)
  })

  it('uses LIMIT', async () => {
    const queries = await issueList()
    expect(queries[0]?.sql).toMatch(/\bLIMIT\b/i)
  })

  it('does not include photoprism_album_uid in query', async () => {
    const queries = await issueList()
    expect(queries[0]?.sql).not.toContain('photoprism_album_uid')
  })

  it('does not include strip_exif in query', async () => {
    const queries = await issueList()
    expect(queries[0]?.sql).not.toContain('strip_exif')
  })

  it('selects a.download_enabled', async () => {
    const queries = await issueList()
    expect(queries[0]?.sql).toContain('a.download_enabled')
  })
})

// ---------------------------------------------------------------------------
// listAuthorizedAlbums — without cursor
// ---------------------------------------------------------------------------

describe('AuthorizedAlbumRepository.listAuthorizedAlbums without cursor', () => {
  async function issueList() {
    const { db, queries } = makeMockDb([{ allRows: [] }])
    await new AuthorizedAlbumRepository(db).listAuthorizedAlbums(VALID_USER_ID, NOW, LIMIT)
    return queries
  }

  it('binds exactly 3 params: userId, now, limit', async () => {
    const queries = await issueList()
    expect(queries[0]?.params).toHaveLength(3)
    expect(queries[0]?.params[0]).toBe(VALID_USER_ID)
    expect(queries[0]?.params[1]).toBe(NOW)
    expect(queries[0]?.params[2]).toBe(LIMIT)
  })

  it('SQL does not contain a.id > (no cursor filter)', async () => {
    const queries = await issueList()
    expect(queries[0]?.sql).not.toContain('a.id >')
  })

  it('SQL does not contain userId as literal', async () => {
    const queries = await issueList()
    expect(queries[0]?.sql).not.toContain(VALID_USER_ID)
  })

  it('SQL does not contain NOW as literal', async () => {
    const queries = await issueList()
    expect(queries[0]?.sql).not.toContain(NOW)
  })

  it('SQL does not contain limit as literal', async () => {
    const queries = await issueList()
    expect(queries[0]?.sql).not.toContain(String(LIMIT))
  })
})

// ---------------------------------------------------------------------------
// listAuthorizedAlbums — with cursor
// ---------------------------------------------------------------------------

describe('AuthorizedAlbumRepository.listAuthorizedAlbums with cursor', () => {
  async function issueListWithCursor() {
    const { db, queries } = makeMockDb([{ allRows: [] }])
    await new AuthorizedAlbumRepository(db).listAuthorizedAlbums(
      VALID_USER_ID,
      NOW,
      LIMIT,
      VALID_CURSOR,
    )
    return queries
  }

  it('binds 4 params: userId, now, cursor, limit', async () => {
    const queries = await issueListWithCursor()
    expect(queries[0]?.params).toHaveLength(4)
    expect(queries[0]?.params[0]).toBe(VALID_USER_ID)
    expect(queries[0]?.params[1]).toBe(NOW)
    expect(queries[0]?.params[2]).toBe(VALID_CURSOR)
    expect(queries[0]?.params[3]).toBe(LIMIT)
  })

  it('SQL contains a.id > ? cursor condition', async () => {
    const queries = await issueListWithCursor()
    expect(queries[0]?.sql).toContain('a.id >')
  })

  it('cursor is a bound param, not an SQL literal', async () => {
    const queries = await issueListWithCursor()
    expect(queries[0]?.sql).not.toContain(VALID_CURSOR)
    expect(queries[0]?.params).toContain(VALID_CURSOR)
  })
})

// ---------------------------------------------------------------------------
// listAuthorizedAlbums — input validation
// ---------------------------------------------------------------------------

describe('AuthorizedAlbumRepository.listAuthorizedAlbums input validation', () => {
  it('invalid userId (empty string) returns [] without querying D1', async () => {
    const { db, queries } = makeMockDb([])
    const result = await new AuthorizedAlbumRepository(db).listAuthorizedAlbums('', NOW, LIMIT)
    expect(result).toEqual([])
    expect(queries).toHaveLength(0)
  })

  it('invalid userId (contains !) returns [] without querying D1', async () => {
    const { db, queries } = makeMockDb([])
    const result = await new AuthorizedAlbumRepository(db).listAuthorizedAlbums('!bad!', NOW, LIMIT)
    expect(result).toEqual([])
    expect(queries).toHaveLength(0)
  })

  it('invalid userId (starts with -) returns [] without querying D1', async () => {
    const { db, queries } = makeMockDb([])
    const result = await new AuthorizedAlbumRepository(db).listAuthorizedAlbums(
      '-bad',
      NOW,
      LIMIT,
    )
    expect(result).toEqual([])
    expect(queries).toHaveLength(0)
  })

  it('non-canonical timestamp throws before D1', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AuthorizedAlbumRepository(db).listAuthorizedAlbums(
        VALID_USER_ID,
        '2026-06-09T00:00:00Z',
        LIMIT,
      ),
    ).rejects.toThrow()
    expect(queries).toHaveLength(0)
  })

  it('limit 0 throws before D1', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AuthorizedAlbumRepository(db).listAuthorizedAlbums(VALID_USER_ID, NOW, 0),
    ).rejects.toThrow('invalid limit')
    expect(queries).toHaveLength(0)
  })

  it('limit 101 throws before D1', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AuthorizedAlbumRepository(db).listAuthorizedAlbums(VALID_USER_ID, NOW, 101),
    ).rejects.toThrow('invalid limit')
    expect(queries).toHaveLength(0)
  })

  it('limit 1 is accepted', async () => {
    const { db } = makeMockDb([{ allRows: [] }])
    await expect(
      new AuthorizedAlbumRepository(db).listAuthorizedAlbums(VALID_USER_ID, NOW, 1),
    ).resolves.toEqual([])
  })

  it('limit 100 is accepted', async () => {
    const { db } = makeMockDb([{ allRows: [] }])
    await expect(
      new AuthorizedAlbumRepository(db).listAuthorizedAlbums(VALID_USER_ID, NOW, 100),
    ).resolves.toEqual([])
  })

  it('fractional limit throws before D1', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AuthorizedAlbumRepository(db).listAuthorizedAlbums(VALID_USER_ID, NOW, 10.5),
    ).rejects.toThrow('invalid limit')
    expect(queries).toHaveLength(0)
  })

  it('NaN limit throws before D1', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AuthorizedAlbumRepository(db).listAuthorizedAlbums(VALID_USER_ID, NOW, NaN),
    ).rejects.toThrow('invalid limit')
    expect(queries).toHaveLength(0)
  })

  it('Infinity limit throws before D1', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AuthorizedAlbumRepository(db).listAuthorizedAlbums(VALID_USER_ID, NOW, Infinity),
    ).rejects.toThrow('invalid limit')
    expect(queries).toHaveLength(0)
  })

  it('invalid cursor (contains !) throws before D1', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AuthorizedAlbumRepository(db).listAuthorizedAlbums(VALID_USER_ID, NOW, LIMIT, '!bad!'),
    ).rejects.toThrow('invalid cursor')
    expect(queries).toHaveLength(0)
  })

  it('empty string cursor throws before D1', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AuthorizedAlbumRepository(db).listAuthorizedAlbums(VALID_USER_ID, NOW, LIMIT, ''),
    ).rejects.toThrow('invalid cursor')
    expect(queries).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// listAuthorizedAlbums — row validation
// ---------------------------------------------------------------------------

describe('AuthorizedAlbumRepository.listAuthorizedAlbums row validation', () => {
  it('returns empty array when D1 returns no rows', async () => {
    const { db } = makeMockDb([{ allRows: [] }])
    const result = await new AuthorizedAlbumRepository(db).listAuthorizedAlbums(
      VALID_USER_ID,
      NOW,
      LIMIT,
    )
    expect(result).toEqual([])
  })

  it('returns minimal reconstructed objects for valid rows', async () => {
    const { db } = makeMockDb([{ allRows: [VALID_ROW, VALID_ROW_2] }])
    const result = await new AuthorizedAlbumRepository(db).listAuthorizedAlbums(
      VALID_USER_ID,
      NOW,
      LIMIT,
    )
    expect(result).toEqual([
      { id: VALID_ALBUM_ID, title: 'My Album', download_enabled: 1 },
      { id: 'album-second-001', title: 'Second Album', download_enabled: 0 },
    ])
  })

  it('does not propagate extra fields from D1 rows (only id, title, download_enabled)', async () => {
    const rowWithExtras = {
      id: VALID_ALBUM_ID,
      title: 'My Album',
      download_enabled: 0,
      photoprism_album_uid: 'uid001',
      strip_exif: 1,
      enabled: 1,
      thumb_long_edge: 640,
    }
    const { db } = makeMockDb([{ allRows: [rowWithExtras] }])
    const result = await new AuthorizedAlbumRepository(db).listAuthorizedAlbums(
      VALID_USER_ID,
      NOW,
      LIMIT,
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ id: VALID_ALBUM_ID, title: 'My Album', download_enabled: 0 })
    const first = result[0] ?? {}
    expect('photoprism_album_uid' in first).toBe(false)
    expect('strip_exif' in first).toBe(false)
    expect('enabled' in first).toBe(false)
    expect('thumb_long_edge' in first).toBe(false)
  })

  it('rejects row with invalid album ID (bad format)', async () => {
    const { db } = makeMockDb([{ allRows: [{ id: '!bad!', title: 'OK' }] }])
    await expect(
      new AuthorizedAlbumRepository(db).listAuthorizedAlbums(VALID_USER_ID, NOW, LIMIT),
    ).rejects.toThrow('database operation failed')
  })

  it('rejects row with non-string id (number)', async () => {
    const { db } = makeMockDb([{ allRows: [{ id: 123, title: 'OK' }] }])
    await expect(
      new AuthorizedAlbumRepository(db).listAuthorizedAlbums(VALID_USER_ID, NOW, LIMIT),
    ).rejects.toThrow('database operation failed')
  })

  it('rejects row with non-string id (null)', async () => {
    const { db } = makeMockDb([{ allRows: [{ id: null, title: 'OK' }] }])
    await expect(
      new AuthorizedAlbumRepository(db).listAuthorizedAlbums(VALID_USER_ID, NOW, LIMIT),
    ).rejects.toThrow('database operation failed')
  })

  it('rejects row with non-string title', async () => {
    const { db } = makeMockDb([{ allRows: [{ id: VALID_ALBUM_ID, title: 42 }] }])
    await expect(
      new AuthorizedAlbumRepository(db).listAuthorizedAlbums(VALID_USER_ID, NOW, LIMIT),
    ).rejects.toThrow('database operation failed')
  })

  it('rejects row with null title', async () => {
    const { db } = makeMockDb([{ allRows: [{ id: VALID_ALBUM_ID, title: null }] }])
    await expect(
      new AuthorizedAlbumRepository(db).listAuthorizedAlbums(VALID_USER_ID, NOW, LIMIT),
    ).rejects.toThrow('database operation failed')
  })

  it('rejects row with title over 1024 Unicode code points', async () => {
    const longTitle = 'a'.repeat(1025)
    const { db } = makeMockDb([{ allRows: [{ id: VALID_ALBUM_ID, title: longTitle }] }])
    await expect(
      new AuthorizedAlbumRepository(db).listAuthorizedAlbums(VALID_USER_ID, NOW, LIMIT),
    ).rejects.toThrow('database operation failed')
  })

  it('accepts title of exactly 1024 code points', async () => {
    const title = 'a'.repeat(1024)
    const { db } = makeMockDb([{ allRows: [{ id: VALID_ALBUM_ID, title, download_enabled: 1 }] }])
    const result = await new AuthorizedAlbumRepository(db).listAuthorizedAlbums(
      VALID_USER_ID,
      NOW,
      LIMIT,
    )
    expect(result[0]?.title).toBe(title)
  })

  it('counts emoji by code points not UTF-16 length (1024 emoji accepted)', async () => {
    const title = '🎵'.repeat(1024)
    expect(title.length).toBe(2048)
    const { db } = makeMockDb([{ allRows: [{ id: VALID_ALBUM_ID, title, download_enabled: 1 }] }])
    const result = await new AuthorizedAlbumRepository(db).listAuthorizedAlbums(
      VALID_USER_ID,
      NOW,
      LIMIT,
    )
    expect(result[0]?.title).toBe(title)
  })

  it('rejects emoji title with 1025 code points', async () => {
    const title = '🎵'.repeat(1025)
    const { db } = makeMockDb([{ allRows: [{ id: VALID_ALBUM_ID, title }] }])
    await expect(
      new AuthorizedAlbumRepository(db).listAuthorizedAlbums(VALID_USER_ID, NOW, LIMIT),
    ).rejects.toThrow('database operation failed')
  })

  it('accepts empty title', async () => {
    const { db } = makeMockDb([{ allRows: [{ id: VALID_ALBUM_ID, title: '', download_enabled: 0 }] }])
    const result = await new AuthorizedAlbumRepository(db).listAuthorizedAlbums(
      VALID_USER_ID,
      NOW,
      LIMIT,
    )
    expect(result[0]?.title).toBe('')
  })

  it('rejects duplicate album IDs from D1', async () => {
    const { db } = makeMockDb([{
      allRows: [
        { id: VALID_ALBUM_ID, title: 'Album A', download_enabled: 1 },
        { id: VALID_ALBUM_ID, title: 'Album B', download_enabled: 1 },
      ],
    }])
    await expect(
      new AuthorizedAlbumRepository(db).listAuthorizedAlbums(VALID_USER_ID, NOW, LIMIT),
    ).rejects.toThrow('database operation failed')
  })

  it('rejects null row from D1', async () => {
    const { db } = makeMockDb([{ allRows: [null] }])
    await expect(
      new AuthorizedAlbumRepository(db).listAuthorizedAlbums(VALID_USER_ID, NOW, LIMIT),
    ).rejects.toThrow('database operation failed')
  })

  it('rejects row with missing download_enabled', async () => {
    const { db } = makeMockDb([{ allRows: [{ id: VALID_ALBUM_ID, title: 'My Album' }] }])
    await expect(
      new AuthorizedAlbumRepository(db).listAuthorizedAlbums(VALID_USER_ID, NOW, LIMIT),
    ).rejects.toThrow('database operation failed')
  })

  it('rejects row with download_enabled = 2', async () => {
    const { db } = makeMockDb([{ allRows: [{ id: VALID_ALBUM_ID, title: 'My Album', download_enabled: 2 }] }])
    await expect(
      new AuthorizedAlbumRepository(db).listAuthorizedAlbums(VALID_USER_ID, NOW, LIMIT),
    ).rejects.toThrow('database operation failed')
  })

  it('accepts download_enabled = 0', async () => {
    const { db } = makeMockDb([{ allRows: [{ id: VALID_ALBUM_ID, title: 'My Album', download_enabled: 0 }] }])
    const result = await new AuthorizedAlbumRepository(db).listAuthorizedAlbums(VALID_USER_ID, NOW, LIMIT)
    expect(result[0]?.download_enabled).toBe(0)
  })

  it('accepts download_enabled = 1', async () => {
    const { db } = makeMockDb([{ allRows: [{ id: VALID_ALBUM_ID, title: 'My Album', download_enabled: 1 }] }])
    const result = await new AuthorizedAlbumRepository(db).listAuthorizedAlbums(VALID_USER_ID, NOW, LIMIT)
    expect(result[0]?.download_enabled).toBe(1)
  })

  it('rejects malformed D1 results with a sanitized error', async () => {
    const { db } = makeMockDb([{ allResult: { success: true, results: null } }])
    await expect(
      new AuthorizedAlbumRepository(db).listAuthorizedAlbums(VALID_USER_ID, NOW, LIMIT),
    ).rejects.toThrow('database operation failed')
  })
})

// ---------------------------------------------------------------------------
// listAuthorizedAlbums — error sanitization
// ---------------------------------------------------------------------------

describe('AuthorizedAlbumRepository.listAuthorizedAlbums error sanitization', () => {
  it('D1 failure throws only "database operation failed"', async () => {
    const { db } = makeMockDb([{ throws: new Error('D1 connection failure with user=secret') }])
    await expect(
      new AuthorizedAlbumRepository(db).listAuthorizedAlbums(VALID_USER_ID, NOW, LIMIT),
    ).rejects.toThrow('database operation failed')
  })

  it('D1 error does not expose userId, timestamp, or limit', async () => {
    const { db } = makeMockDb([{ throws: new Error('failure') }])
    const error = await new AuthorizedAlbumRepository(db)
      .listAuthorizedAlbums(VALID_USER_ID, NOW, LIMIT)
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    const msg = (error as Error).message
    expect(msg).not.toContain(VALID_USER_ID)
    expect(msg).not.toContain(NOW)
    expect(msg).not.toContain(String(LIMIT))
  })

  it('row validation error does not expose album ID or title', async () => {
    const { db } = makeMockDb([{ allRows: [{ id: '!leaked-id!', title: 'leaked title' }] }])
    const error = await new AuthorizedAlbumRepository(db)
      .listAuthorizedAlbums(VALID_USER_ID, NOW, LIMIT)
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    const msg = (error as Error).message
    expect(msg).not.toContain('!leaked-id!')
    expect(msg).not.toContain('leaked title')
  })
})

// ---------------------------------------------------------------------------
// getAuthorizedAlbum — SQL structure
// ---------------------------------------------------------------------------

describe('AuthorizedAlbumRepository.getAuthorizedAlbum SQL structure', () => {
  async function issueGet() {
    const { db, queries } = makeMockDb([{ first: VALID_ROW }])
    await new AuthorizedAlbumRepository(db).getAuthorizedAlbum(VALID_USER_ID, VALID_ALBUM_ID, NOW)
    return queries
  }

  it('selects a.id and a.title (not SELECT *)', async () => {
    const queries = await issueGet()
    expect(queries[0]?.sql).toContain('a.id')
    expect(queries[0]?.sql).toContain('a.title')
    expect(queries[0]?.sql).not.toMatch(/SELECT\s+\*/i)
  })

  it('joins album_permissions, albums, and users', async () => {
    const queries = await issueGet()
    expect(queries[0]?.sql).toContain('album_permissions')
    expect(queries[0]?.sql).toContain('JOIN albums')
    expect(queries[0]?.sql).toContain('JOIN users')
  })

  it('requires ap.user_id = ?', async () => {
    const queries = await issueGet()
    expect(queries[0]?.sql).toContain('ap.user_id')
  })

  it('requires ap.album_id = ?', async () => {
    const queries = await issueGet()
    expect(queries[0]?.sql).toContain('ap.album_id')
  })

  it('requires a.enabled = 1', async () => {
    const queries = await issueGet()
    expect(queries[0]?.sql).toMatch(/a\.enabled\s*=\s*1/)
  })

  it('requires expires_at check', async () => {
    const queries = await issueGet()
    expect(queries[0]?.sql).toContain('expires_at')
  })

  it('requires u.enabled = 1', async () => {
    const queries = await issueGet()
    expect(queries[0]?.sql).toMatch(/u\.enabled\s*=\s*1/)
  })

  it('binds userId, albumId, and now', async () => {
    const queries = await issueGet()
    expect(queries[0]?.params).toContain(VALID_USER_ID)
    expect(queries[0]?.params).toContain(VALID_ALBUM_ID)
    expect(queries[0]?.params).toContain(NOW)
  })

  it('SQL does not contain userId as literal', async () => {
    const queries = await issueGet()
    expect(queries[0]?.sql).not.toContain(VALID_USER_ID)
  })

  it('SQL does not contain albumId as literal', async () => {
    const queries = await issueGet()
    expect(queries[0]?.sql).not.toContain(VALID_ALBUM_ID)
  })

  it('does not include photoprism_album_uid in query', async () => {
    const queries = await issueGet()
    expect(queries[0]?.sql).not.toContain('photoprism_album_uid')
  })

  it('does not include strip_exif in query', async () => {
    const queries = await issueGet()
    expect(queries[0]?.sql).not.toContain('strip_exif')
  })

  it('selects a.download_enabled', async () => {
    const queries = await issueGet()
    expect(queries[0]?.sql).toContain('a.download_enabled')
  })
})

// ---------------------------------------------------------------------------
// getAuthorizedAlbum — input validation
// ---------------------------------------------------------------------------

describe('AuthorizedAlbumRepository.getAuthorizedAlbum input validation', () => {
  it('invalid userId (contains !) returns null without querying D1', async () => {
    const { db, queries } = makeMockDb([])
    const result = await new AuthorizedAlbumRepository(db).getAuthorizedAlbum(
      '!bad!',
      VALID_ALBUM_ID,
      NOW,
    )
    expect(result).toBeNull()
    expect(queries).toHaveLength(0)
  })

  it('empty userId returns null without querying D1', async () => {
    const { db, queries } = makeMockDb([])
    const result = await new AuthorizedAlbumRepository(db).getAuthorizedAlbum(
      '',
      VALID_ALBUM_ID,
      NOW,
    )
    expect(result).toBeNull()
    expect(queries).toHaveLength(0)
  })

  it('invalid albumId (contains !) returns null without querying D1', async () => {
    const { db, queries } = makeMockDb([])
    const result = await new AuthorizedAlbumRepository(db).getAuthorizedAlbum(
      VALID_USER_ID,
      '!bad!',
      NOW,
    )
    expect(result).toBeNull()
    expect(queries).toHaveLength(0)
  })

  it('empty albumId returns null without querying D1', async () => {
    const { db, queries } = makeMockDb([])
    const result = await new AuthorizedAlbumRepository(db).getAuthorizedAlbum(
      VALID_USER_ID,
      '',
      NOW,
    )
    expect(result).toBeNull()
    expect(queries).toHaveLength(0)
  })

  it('non-canonical timestamp throws before D1', async () => {
    const { db, queries } = makeMockDb([])
    await expect(
      new AuthorizedAlbumRepository(db).getAuthorizedAlbum(
        VALID_USER_ID,
        VALID_ALBUM_ID,
        '2026-06-09T00:00:00Z',
      ),
    ).rejects.toThrow()
    expect(queries).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// getAuthorizedAlbum — row handling
// ---------------------------------------------------------------------------

describe('AuthorizedAlbumRepository.getAuthorizedAlbum row handling', () => {
  it('returns null when D1 returns no row', async () => {
    const { db } = makeMockDb([{ first: null }])
    const result = await new AuthorizedAlbumRepository(db).getAuthorizedAlbum(
      VALID_USER_ID,
      VALID_ALBUM_ID,
      NOW,
    )
    expect(result).toBeNull()
  })

  it('returns minimal summary for valid row', async () => {
    const { db } = makeMockDb([{ first: VALID_ROW }])
    const result = await new AuthorizedAlbumRepository(db).getAuthorizedAlbum(
      VALID_USER_ID,
      VALID_ALBUM_ID,
      NOW,
    )
    expect(result).toEqual({ id: VALID_ALBUM_ID, title: 'My Album', download_enabled: 1 })
  })

  it('does not propagate extra fields from D1 row (only id, title, download_enabled)', async () => {
    const rowWithExtras = {
      id: VALID_ALBUM_ID,
      title: 'My Album',
      download_enabled: 0,
      photoprism_album_uid: 'uid001',
      strip_exif: 1,
    }
    const { db } = makeMockDb([{ first: rowWithExtras }])
    const result = await new AuthorizedAlbumRepository(db).getAuthorizedAlbum(
      VALID_USER_ID,
      VALID_ALBUM_ID,
      NOW,
    )
    expect(result).toEqual({ id: VALID_ALBUM_ID, title: 'My Album', download_enabled: 0 })
    const r = result ?? {}
    expect('photoprism_album_uid' in r).toBe(false)
    expect('strip_exif' in r).toBe(false)
  })

  it('rejects row with missing download_enabled', async () => {
    const { db } = makeMockDb([{ first: { id: VALID_ALBUM_ID, title: 'My Album' } }])
    await expect(
      new AuthorizedAlbumRepository(db).getAuthorizedAlbum(VALID_USER_ID, VALID_ALBUM_ID, NOW),
    ).rejects.toThrow('database operation failed')
  })

  it('rejects row with download_enabled = 2', async () => {
    const { db } = makeMockDb([{ first: { id: VALID_ALBUM_ID, title: 'My Album', download_enabled: 2 } }])
    await expect(
      new AuthorizedAlbumRepository(db).getAuthorizedAlbum(VALID_USER_ID, VALID_ALBUM_ID, NOW),
    ).rejects.toThrow('database operation failed')
  })

  it('rejects row with invalid album ID', async () => {
    const { db } = makeMockDb([{ first: { id: '!bad!', title: 'OK' } }])
    await expect(
      new AuthorizedAlbumRepository(db).getAuthorizedAlbum(VALID_USER_ID, VALID_ALBUM_ID, NOW),
    ).rejects.toThrow('database operation failed')
  })

  it('rejects row with non-string title', async () => {
    const { db } = makeMockDb([{ first: { id: VALID_ALBUM_ID, title: null } }])
    await expect(
      new AuthorizedAlbumRepository(db).getAuthorizedAlbum(VALID_USER_ID, VALID_ALBUM_ID, NOW),
    ).rejects.toThrow('database operation failed')
  })

  it('rejects row with over-limit title', async () => {
    const { db } = makeMockDb([{ first: { id: VALID_ALBUM_ID, title: 'a'.repeat(1025) } }])
    await expect(
      new AuthorizedAlbumRepository(db).getAuthorizedAlbum(VALID_USER_ID, VALID_ALBUM_ID, NOW),
    ).rejects.toThrow('database operation failed')
  })

  it('accepts empty title', async () => {
    const { db } = makeMockDb([{ first: { id: VALID_ALBUM_ID, title: '', download_enabled: 0 } }])
    const result = await new AuthorizedAlbumRepository(db).getAuthorizedAlbum(
      VALID_USER_ID,
      VALID_ALBUM_ID,
      NOW,
    )
    expect(result?.title).toBe('')
  })
})

// ---------------------------------------------------------------------------
// getAuthorizedAlbum — error sanitization
// ---------------------------------------------------------------------------

describe('AuthorizedAlbumRepository.getAuthorizedAlbum error sanitization', () => {
  it('D1 failure throws only "database operation failed"', async () => {
    const { db } = makeMockDb([{ throws: new Error('sensitive_table_name user=secret') }])
    await expect(
      new AuthorizedAlbumRepository(db).getAuthorizedAlbum(VALID_USER_ID, VALID_ALBUM_ID, NOW),
    ).rejects.toThrow('database operation failed')
  })

  it('error does not expose userId or albumId', async () => {
    const { db } = makeMockDb([{ throws: new Error('failure') }])
    const error = await new AuthorizedAlbumRepository(db)
      .getAuthorizedAlbum(VALID_USER_ID, VALID_ALBUM_ID, NOW)
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    const msg = (error as Error).message
    expect(msg).not.toContain(VALID_USER_ID)
    expect(msg).not.toContain(VALID_ALBUM_ID)
  })

  it('row validation error does not expose album ID or title', async () => {
    const { db } = makeMockDb([{ first: { id: '!leaked-id!', title: 'leaked title' } }])
    const error = await new AuthorizedAlbumRepository(db)
      .getAuthorizedAlbum(VALID_USER_ID, VALID_ALBUM_ID, NOW)
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    const msg = (error as Error).message
    expect(msg).not.toContain('!leaked-id!')
    expect(msg).not.toContain('leaked title')
  })
})
