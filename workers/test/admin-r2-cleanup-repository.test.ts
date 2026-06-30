import { describe, it, expect } from 'vitest'
import {
  AdminR2CleanupRepository,
  R2_CLEANUP_MAX_ALBUM_ROWS,
  R2_CLEANUP_MAX_R2_PAGES,
  R2_CLEANUP_MAX_R2_OBJECTS,
} from '../src/services/admin-r2-cleanup-repository.js'
import { makeMockDb } from './helpers/mock-d1.js'

function makeObj(key: string, size: number): R2Object {
  return { key, size } as unknown as R2Object
}

function makeListResult(
  objects: R2Object[],
  truncated = false,
  cursor?: string,
): R2Objects {
  return { objects, truncated, cursor, delimitedPrefixes: [] } as unknown as R2Objects
}

type ListCall = { prefix?: string; cursor?: string }

function makeR2Bucket(impl: (opts: { prefix?: string; cursor?: string }) => Promise<R2Objects>): {
  bucket: R2Bucket
  listCalls: ListCall[]
  getCalls: number
  putCalls: number
  deleteCalls: number
} {
  const listCalls: ListCall[] = []
  let getCalls = 0
  let putCalls = 0
  let deleteCalls = 0
  const bucket = {
    list: async (opts: { prefix?: string; limit?: number; cursor?: string }) => {
      listCalls.push({ prefix: opts.prefix, cursor: opts.cursor })
      return impl(opts)
    },
    get: async () => { getCalls++; throw new Error('get must not be called') },
    put: async () => { putCalls++; throw new Error('put must not be called') },
    delete: async () => { deleteCalls++; throw new Error('delete must not be called') },
    head: async () => { throw new Error('head must not be called') },
  } as unknown as R2Bucket
  return { bucket, listCalls, getCalls, putCalls, deleteCalls }
}

function makeSimpleR2Bucket(
  albumsResult: R2Objects | Error = makeListResult([]),
  opsResult: R2Objects | Error = makeListResult([]),
): ReturnType<typeof makeR2Bucket> {
  return makeR2Bucket(async (opts) => {
    if (opts.prefix === 'albums/') {
      if (albumsResult instanceof Error) throw albumsResult
      return albumsResult
    }
    if (opts.prefix === 'ops/') {
      if (opsResult instanceof Error) throw opsResult
      return opsResult
    }
    throw new Error(`unexpected prefix: ${opts.prefix}`)
  })
}

const VALID_ROW = { id: 'album-001', enabled: 1 }
const DISABLED_ROW = { id: 'album-002', enabled: 0 }

describe('AdminR2CleanupRepository.getReport', () => {
  it('queries D1 with correct SQL and LIMIT max+1', async () => {
    const { db, queries } = makeMockDb([{ allRows: [] }])
    const { bucket } = makeSimpleR2Bucket()
    const repo = new AdminR2CleanupRepository(db, bucket)
    await repo.getReport()
    expect(queries[0]?.sql).toMatch(/SELECT\s+id,\s+enabled\s+FROM\s+albums/i)
    expect(queries[0]?.sql).toMatch(/ORDER BY id ASC/i)
    expect(queries[0]?.params[0]).toBe(R2_CLEANUP_MAX_ALBUM_ROWS + 1)
  })

  it('D1 SQL does not select title, photoprism_album_uid, or timestamps', async () => {
    const { db, queries } = makeMockDb([{ allRows: [] }])
    const { bucket } = makeSimpleR2Bucket()
    await new AdminR2CleanupRepository(db, bucket).getReport()
    const sql = queries[0]?.sql ?? ''
    expect(sql).not.toContain('title')
    expect(sql).not.toContain('photoprism')
    expect(sql).not.toContain('created_at')
    expect(sql).not.toContain('updated_at')
  })

  it('D1 failure throws sanitized error', async () => {
    const { db } = makeMockDb([{ throws: new Error('SQL secret info') }])
    const { bucket } = makeSimpleR2Bucket()
    const repo = new AdminR2CleanupRepository(db, bucket)
    await expect(repo.getReport()).rejects.toThrow('r2 cleanup operation failed')
  })

  it('invalid D1 row id throws sanitized error', async () => {
    const { db } = makeMockDb([{ allRows: [{ id: '', enabled: 1 }] }])
    const { bucket } = makeSimpleR2Bucket()
    await expect(new AdminR2CleanupRepository(db, bucket).getReport()).rejects.toThrow('r2 cleanup operation failed')
  })

  it('invalid D1 row enabled throws sanitized error', async () => {
    const { db } = makeMockDb([{ allRows: [{ id: 'album-001', enabled: 2 }] }])
    const { bucket } = makeSimpleR2Bucket()
    await expect(new AdminR2CleanupRepository(db, bucket).getReport()).rejects.toThrow('r2 cleanup operation failed')
  })

  it('D1 row overflow (> max) throws sanitized error', async () => {
    const overflowRows = Array.from({ length: R2_CLEANUP_MAX_ALBUM_ROWS + 1 }, (_, i) => ({
      id: `a${String(i).padStart(4, '0')}`,
      enabled: 1,
    }))
    const { db } = makeMockDb([{ allRows: overflowRows }])
    const { bucket } = makeSimpleR2Bucket()
    await expect(new AdminR2CleanupRepository(db, bucket).getReport()).rejects.toThrow('r2 cleanup operation failed')
  })

  it('R2 albums/ list failure throws sanitized error', async () => {
    const { db } = makeMockDb([{ allRows: [VALID_ROW] }])
    const { bucket } = makeSimpleR2Bucket(new Error('bucket internal'))
    await expect(new AdminR2CleanupRepository(db, bucket).getReport()).rejects.toThrow('r2 cleanup operation failed')
  })

  it('R2 ops/ list failure throws sanitized error', async () => {
    const { db } = makeMockDb([{ allRows: [] }])
    const { bucket } = makeSimpleR2Bucket(makeListResult([]), new Error('ops bucket error'))
    await expect(new AdminR2CleanupRepository(db, bucket).getReport()).rejects.toThrow('r2 cleanup operation failed')
  })

  it('classifies owned-active album correctly', async () => {
    const { db } = makeMockDb([{ allRows: [VALID_ROW] }])
    const objects = [makeObj('albums/album-001/manifest.json', 100)]
    const { bucket } = makeSimpleR2Bucket(makeListResult(objects))
    const report = await new AdminR2CleanupRepository(db, bucket).getReport()
    expect(report.albums).toHaveLength(1)
    expect(report.albums[0]?.category).toBe('owned-active')
    expect(report.albums[0]?.albumId).toBe('album-001')
    expect(report.albums[0]?.objectCount).toBe(1)
    expect(report.albums[0]?.totalBytes).toBe(100)
  })

  it('classifies owned-disabled album correctly', async () => {
    const { db } = makeMockDb([{ allRows: [DISABLED_ROW] }])
    const objects = [makeObj('albums/album-002/cover.webp', 200)]
    const { bucket } = makeSimpleR2Bucket(makeListResult(objects))
    const report = await new AdminR2CleanupRepository(db, bucket).getReport()
    expect(report.albums[0]?.category).toBe('owned-disabled')
    expect(report.albums[0]?.albumId).toBe('album-002')
  })

  it('classifies orphan album correctly', async () => {
    const { db } = makeMockDb([{ allRows: [] }])
    const objects = [makeObj('albums/orphan-album/manifest.json', 50)]
    const { bucket } = makeSimpleR2Bucket(makeListResult(objects))
    const report = await new AdminR2CleanupRepository(db, bucket).getReport()
    expect(report.albums[0]?.category).toBe('orphan')
    expect(report.albums[0]?.albumId).toBe('orphan-album')
  })

  it('aggregates multiple objects per album', async () => {
    const { db } = makeMockDb([{ allRows: [VALID_ROW] }])
    const objects = [
      makeObj('albums/album-001/manifest.json', 100),
      makeObj('albums/album-001/cover.webp', 200),
      makeObj('albums/album-001/thumbs/photo-1.webp', 50),
    ]
    const { bucket } = makeSimpleR2Bucket(makeListResult(objects))
    const report = await new AdminR2CleanupRepository(db, bucket).getReport()
    expect(report.albums[0]?.objectCount).toBe(3)
    expect(report.albums[0]?.totalBytes).toBe(350)
  })

  it('counts malformed keys separately', async () => {
    const { db } = makeMockDb([{ allRows: [] }])
    const objects = [
      makeObj('albums/bad-album/unknown-file.bin', 77),
      makeObj('albums/', 10),
    ]
    const { bucket } = makeSimpleR2Bucket(makeListResult(objects))
    const report = await new AdminR2CleanupRepository(db, bucket).getReport()
    expect(report.albums).toHaveLength(0)
    expect(report.malformedCount).toBe(2)
    expect(report.malformedBytes).toBe(87)
  })

  it('populates excludedOpsCount from ops/ listing', async () => {
    const { db } = makeMockDb([{ allRows: [] }])
    const opsObjects = [
      makeObj('ops/sync-status.json', 500),
      makeObj('ops/album-catalog.json', 2000),
    ]
    const { bucket } = makeSimpleR2Bucket(makeListResult([]), makeListResult(opsObjects))
    const report = await new AdminR2CleanupRepository(db, bucket).getReport()
    expect(report.excludedOpsCount).toBe(2)
  })

  it('sets truncated=true when object limit reached', async () => {
    const { db } = makeMockDb([{ allRows: [] }])
    const objects = Array.from({ length: R2_CLEANUP_MAX_R2_OBJECTS + 1 }, (_, i) =>
      makeObj(`albums/album-${String(i).padStart(5, '0')}/manifest.json`, 10),
    )
    const { bucket } = makeSimpleR2Bucket(makeListResult(objects))
    const report = await new AdminR2CleanupRepository(db, bucket).getReport()
    expect(report.truncated).toBe(true)
  })

  it('sets truncated=true when R2 page limit reached', async () => {
    const { db } = makeMockDb([{ allRows: [] }])
    let page = 0
    const { bucket } = makeR2Bucket(async (opts) => {
      if (opts.prefix === 'ops/') return makeListResult([])
      page++
      return makeListResult([], true, `cursor-${page}`)
    })
    const report = await new AdminR2CleanupRepository(db, bucket).getReport()
    expect(report.truncated).toBe(true)
    expect(page).toBe(R2_CLEANUP_MAX_R2_PAGES)
  })

  it('sets truncated=true when ops/ R2 page limit reached', async () => {
    const { db } = makeMockDb([{ allRows: [] }])
    let opsPage = 0
    const { bucket } = makeR2Bucket(async (opts) => {
      if (opts.prefix === 'albums/') return makeListResult([])
      opsPage++
      return makeListResult([], true, `ops-cursor-${opsPage}`)
    })
    const report = await new AdminR2CleanupRepository(db, bucket).getReport()
    expect(report.truncated).toBe(true)
    expect(opsPage).toBe(R2_CLEANUP_MAX_R2_PAGES)
  })

  it('does not call R2 get, put, or delete', async () => {
    const { db } = makeMockDb([{ allRows: [VALID_ROW] }])
    const { bucket, getCalls, putCalls, deleteCalls } = makeSimpleR2Bucket(
      makeListResult([makeObj('albums/album-001/manifest.json', 10)]),
    )
    await new AdminR2CleanupRepository(db, bucket).getReport()
    expect(getCalls).toBe(0)
    expect(putCalls).toBe(0)
    expect(deleteCalls).toBe(0)
  })

  it('returns empty report when no R2 objects and no D1 rows', async () => {
    const { db } = makeMockDb([{ allRows: [] }])
    const { bucket } = makeSimpleR2Bucket()
    const report = await new AdminR2CleanupRepository(db, bucket).getReport()
    expect(report.albums).toHaveLength(0)
    expect(report.malformedCount).toBe(0)
    expect(report.malformedBytes).toBe(0)
    expect(report.excludedOpsCount).toBe(0)
    expect(report.truncated).toBe(false)
  })

  it('sorts albums: owned-active, owned-disabled, orphan, then by albumId', async () => {
    const { db } = makeMockDb([{ allRows: [
      { id: 'z-album', enabled: 1 },
      { id: 'a-album', enabled: 0 },
    ] }])
    const objects = [
      makeObj('albums/orphan-x/manifest.json', 10),
      makeObj('albums/z-album/manifest.json', 10),
      makeObj('albums/a-album/manifest.json', 10),
    ]
    const { bucket } = makeSimpleR2Bucket(makeListResult(objects))
    const report = await new AdminR2CleanupRepository(db, bucket).getReport()
    expect(report.albums.map((a) => a.category)).toEqual(['owned-active', 'owned-disabled', 'orphan'])
    expect(report.albums[0]?.albumId).toBe('z-album')
    expect(report.albums[1]?.albumId).toBe('a-album')
    expect(report.albums[2]?.albumId).toBe('orphan-x')
  })
})
