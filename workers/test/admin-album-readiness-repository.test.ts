import { describe, expect, it } from 'vitest'
import { AdminAlbumReadinessRepository } from '../src/services/admin-album-readiness-repository.js'
import { makeMockDb } from './helpers/mock-d1.js'

const ALBUM_A = 'album-ready-001'
const ALBUM_B = 'album-ready-002'

function bucketWithHeads(
  heads: Record<string, 'present' | 'missing' | 'throws'>,
): { bucket: R2Bucket; calls: string[]; prohibitedCalls: string[] } {
  const calls: string[] = []
  const prohibitedCalls: string[] = []
  const bucket = {
    head: async (key: string) => {
      calls.push(key)
      const state = heads[key] ?? 'missing'
      if (state === 'throws') throw new Error('R2 unavailable')
      return state === 'present' ? ({ key } as unknown as R2Object) : null
    },
    get: async () => { prohibitedCalls.push('get'); return null },
    list: async () => { prohibitedCalls.push('list'); return { objects: [], truncated: false } },
    put: async () => { prohibitedCalls.push('put') },
    delete: async () => { prohibitedCalls.push('delete') },
  } as unknown as R2Bucket
  return { bucket, calls, prohibitedCalls }
}

describe('AdminAlbumReadinessRepository', () => {
  it('uses one aggregate permission query and manifest head probes only', async () => {
    const { db, queries } = makeMockDb([{ allRows: [{ album_id: ALBUM_A, permission_count: 2 }] }])
    const { bucket, calls, prohibitedCalls } = bucketWithHeads({
      [`albums/${ALBUM_A}/manifest.json`]: 'present',
      [`albums/${ALBUM_B}/manifest.json`]: 'missing',
    })
    const facts = await new AdminAlbumReadinessRepository(db, bucket).getFacts([ALBUM_A, ALBUM_B])
    expect(facts).toEqual([
      { albumId: ALBUM_A, permissionCount: 2, manifest: 'present' },
      { albumId: ALBUM_B, permissionCount: 0, manifest: 'missing' },
    ])
    expect(queries[0]?.sql).toMatch(/SELECT\s+album_permissions\.album_id,\s+COUNT\(\*\)/i)
    expect(queries[0]?.sql).toContain('FROM album_permissions')
    expect(queries[0]?.sql).toContain('INNER JOIN users ON users.id = album_permissions.user_id')
    expect(queries[0]?.sql).toContain('AND users.enabled = 1')
    expect(queries[0]?.sql).not.toMatch(/photoprism|title|password|session/i)
    expect(queries[0]?.params).toEqual([ALBUM_A, ALBUM_B])
    expect(calls).toEqual([
      `albums/${ALBUM_A}/manifest.json`,
      `albums/${ALBUM_B}/manifest.json`,
    ])
    expect(prohibitedCalls).toEqual([])
  })

  it('marks an individual R2 probe unknown instead of claiming a missing manifest', async () => {
    const { db } = makeMockDb([{ allRows: [] }])
    const { bucket } = bucketWithHeads({ [`albums/${ALBUM_A}/manifest.json`]: 'throws' })
    await expect(new AdminAlbumReadinessRepository(db, bucket).getFacts([ALBUM_A])).resolves.toEqual([
      { albumId: ALBUM_A, permissionCount: 0, manifest: 'unknown' },
    ])
  })

  it('fails closed on malformed D1 aggregate rows', async () => {
    const { db } = makeMockDb([{ allRows: [{ album_id: ALBUM_A, permission_count: -1 }] }])
    const { bucket } = bucketWithHeads({})
    await expect(new AdminAlbumReadinessRepository(db, bucket).getFacts([ALBUM_A])).rejects.toThrow('database operation failed')
  })

  it('rejects duplicated, invalid, or too many album IDs before I/O', async () => {
    const { db, queries } = makeMockDb()
    const { bucket, calls } = bucketWithHeads({})
    const repo = new AdminAlbumReadinessRepository(db, bucket)
    await expect(repo.getFacts([ALBUM_A, ALBUM_A])).rejects.toThrow('album readiness read failed')
    await expect(repo.getFacts(['!bad!'])).rejects.toThrow('album readiness read failed')
    await expect(repo.getFacts(Array.from({ length: 51 }, (_, i) => `album-${i}`))).rejects.toThrow('album readiness read failed')
    expect(queries).toEqual([])
    expect(calls).toEqual([])
  })
})
