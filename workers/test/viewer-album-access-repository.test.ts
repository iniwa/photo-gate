import { describe, expect, it } from 'vitest'
import { ViewerAlbumAccessRepository } from '../src/services/viewer-album-access-repository.js'
import { makeMockDb } from './helpers/mock-d1.js'

const DIGEST = 'a'.repeat(64)
const NOW = '2026-08-13T00:00:00.000Z'
const USER_ID = 'viewer-1'
const ALBUM_ID = 'album-1'

describe('ViewerAlbumAccessRepository', () => {
  it('uses one parameterized statement for the session, permission, and album summary', async () => {
    const { db, queries } = makeMockDb([{ first: null }])
    await new ViewerAlbumAccessRepository(db).getAuthorizedAlbumAccess(DIGEST, ALBUM_ID, NOW)
    expect(queries).toHaveLength(1)
    expect(queries[0]?.sql).toContain('FROM sessions s')
    expect(queries[0]?.sql).toContain('JOIN users u')
    expect(queries[0]?.sql).toContain('LEFT JOIN album_permissions ap')
    expect(queries[0]?.sql).toContain('LEFT JOIN albums a')
    expect(queries[0]?.sql).not.toMatch(/SELECT\s+\*/i)
    expect(queries[0]?.params).toEqual([ALBUM_ID, NOW, DIGEST, NOW])
    expect(queries[0]?.sql).not.toContain(ALBUM_ID)
    expect(queries[0]?.sql).not.toContain(DIGEST)
  })

  it('returns null when there is no active session', async () => {
    const { db } = makeMockDb([{ first: null }])
    await expect(new ViewerAlbumAccessRepository(db).getAuthorizedAlbumAccess(DIGEST, ALBUM_ID, NOW)).resolves.toBeNull()
  })

  it('returns the authorized album summary from the same row', async () => {
    const { db } = makeMockDb([{
      first: { user_id: USER_ID, id: ALBUM_ID, title: 'Private Album', download_enabled: 1 },
    }])
    await expect(new ViewerAlbumAccessRepository(db).getAuthorizedAlbumAccess(DIGEST, ALBUM_ID, NOW)).resolves.toEqual({
      userId: USER_ID,
      album: { id: ALBUM_ID, title: 'Private Album', download_enabled: 1 },
    })
  })

  it('returns a valid session with no authorized album as a denied album result', async () => {
    const { db } = makeMockDb([{
      first: { user_id: USER_ID, id: null, title: null, download_enabled: null },
    }])
    await expect(new ViewerAlbumAccessRepository(db).getAuthorizedAlbumAccess(DIGEST, ALBUM_ID, NOW)).resolves.toEqual({
      userId: USER_ID,
      album: null,
    })
  })

  it('binds an invalid route album id as null after retaining session lookup semantics', async () => {
    const { db, queries } = makeMockDb([{
      first: { user_id: USER_ID, id: null, title: null, download_enabled: null },
    }])
    const result = await new ViewerAlbumAccessRepository(db).getAuthorizedAlbumAccess(DIGEST, '!bad!', NOW)
    expect(result).toEqual({ userId: USER_ID, album: null })
    expect(queries[0]?.params).toEqual([null, NOW, DIGEST, NOW])
  })

  it('returns null without querying for an invalid digest', async () => {
    const { db, queries } = makeMockDb()
    await expect(new ViewerAlbumAccessRepository(db).getAuthorizedAlbumAccess('not-a-digest', ALBUM_ID, NOW)).resolves.toBeNull()
    expect(queries).toHaveLength(0)
  })

  it('rejects malformed rows and database errors with the generic repository error', async () => {
    const malformed = makeMockDb([{ first: { user_id: USER_ID, id: ALBUM_ID, title: 'x', download_enabled: 2 } }])
    await expect(new ViewerAlbumAccessRepository(malformed.db).getAuthorizedAlbumAccess(DIGEST, ALBUM_ID, NOW)).rejects.toThrow('database operation failed')

    const failed = makeMockDb([{ throws: new Error('D1 connection details') }])
    await expect(new ViewerAlbumAccessRepository(failed.db).getAuthorizedAlbumAccess(DIGEST, ALBUM_ID, NOW)).rejects.toThrow('database operation failed')
  })
})
