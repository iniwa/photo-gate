import { describe, expect, it } from 'vitest'
import { AdminSyncResultRepository, SYNC_RESULT_KEY } from '../src/services/admin-sync-result-repository.js'

function validPayload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema: 1,
    publishedAt: '2026-08-12T00:00:00Z',
    operation: 'sync',
    triggerKind: 'manual',
    result: 'ok',
    startedAt: '2026-08-12T00:00:00Z',
    completedAt: '2026-08-12T00:00:01Z',
    targets: { attempted: 2, succeeded: 2, failed: 0 },
    photos: { total: 10, uploaded: 1, skipped: 9 },
    catalogRefreshed: true,
    ...overrides,
  })
}

function bucketFor(payload: string | null, size = payload?.length): R2Bucket {
  return {
    get: async () => payload === null ? null : ({ text: async () => payload, size } as unknown as R2ObjectBody),
  } as unknown as R2Bucket
}

describe('AdminSyncResultRepository', () => {
  it('reads exactly the one fixed aggregate result key', async () => {
    let key: string | undefined
    const bucket = {
      get: async (value: string) => {
        key = value
        return { text: async () => validPayload() } as unknown as R2ObjectBody
      },
    } as unknown as R2Bucket
    const result = await new AdminSyncResultRepository(bucket).getResult()
    expect(key).toBe(SYNC_RESULT_KEY)
    expect(result.status).toBe('found')
  })

  it('returns all and only safe aggregate fields', async () => {
    const result = await new AdminSyncResultRepository(bucketFor(validPayload())).getResult()
    if (result.status !== 'found') throw new Error('expected result')
    expect(result.value.photos).toEqual({ total: 10, uploaded: 1, skipped: 9 })
    expect(JSON.stringify(result.value)).not.toMatch(/albumId|photoId|uid|token|https?:|error/i)
  })

  it('accepts catalog-only results with zero image counts', async () => {
    const result = await new AdminSyncResultRepository(bucketFor(validPayload({
      operation: 'catalog-refresh',
      targets: { attempted: 0, succeeded: 0, failed: 0 },
      photos: { total: 0, uploaded: 0, skipped: 0 },
    }))).getResult()
    expect(result.status).toBe('found')
  })

  it('returns missing without parsing', async () => {
    await expect(new AdminSyncResultRepository(bucketFor(null)).getResult()).resolves.toEqual({ status: 'missing' })
  })

  it('rejects inconsistent or extra aggregate data', async () => {
    const invalid = [
      validPayload({ targets: { attempted: 1, succeeded: 2, failed: 0 } }),
      validPayload({ photos: { total: 1, uploaded: 1, skipped: 1 } }),
      validPayload({ extra: 'sensitive' }),
      validPayload({ operation: 'wrong' }),
    ]
    for (const payload of invalid) {
      await expect(new AdminSyncResultRepository(bucketFor(payload)).getResult()).rejects.toThrow('sync result read failed')
    }
  })

  it('rejects a too-large body and a bucket failure with one sanitized error', async () => {
    await expect(new AdminSyncResultRepository(bucketFor(validPayload(), 8193)).getResult()).rejects.toThrow('sync result read failed')
    const bucket = { get: async () => { throw new Error('bucket=private token=hidden') } } as unknown as R2Bucket
    await expect(new AdminSyncResultRepository(bucket).getResult()).rejects.toThrow('sync result read failed')
  })
})
