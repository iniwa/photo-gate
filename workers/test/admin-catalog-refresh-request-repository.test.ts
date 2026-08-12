import { describe, expect, it } from 'vitest'
import {
  AdminCatalogRefreshRequestRepository,
  CATALOG_REFRESH_REQUEST_KEY,
} from '../src/services/admin-catalog-refresh-request-repository.js'
import type { AdminCatalogRefreshRequest } from '../src/types/admin-catalog-refresh-request.js'

const REQUEST: AdminCatalogRefreshRequest = {
  schema: 1,
  requestId: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
  requestedAt: '2026-08-12T00:00:00.000Z',
  kind: 'publish-catalog',
}

function object(text: string, size = text.length): R2ObjectBody {
  return { text: async () => text, size } as unknown as R2ObjectBody
}

describe('AdminCatalogRefreshRequestRepository', () => {
  it('writes only the separate catalog-refresh key with private metadata', async () => {
    const puts: Array<{ key: string; body: string; options: unknown }> = []
    const bucket = {
      put: async (key: string, body: unknown, options: unknown) => { puts.push({ key, body: body as string, options }) },
    } as unknown as R2Bucket

    await new AdminCatalogRefreshRequestRepository(bucket).writeRequest(REQUEST)

    expect(puts).toHaveLength(1)
    expect(puts[0]?.key).toBe(CATALOG_REFRESH_REQUEST_KEY)
    expect(puts[0]?.key).not.toBe('ops/sync-request.json')
    expect(JSON.parse(puts[0]!.body)).toEqual(REQUEST)
    expect(puts[0]?.options).toEqual({
      httpMetadata: { contentType: 'application/json', cacheControl: 'private, no-cache' },
    })
  })

  it('rejects a non-catalog request before writing', async () => {
    let writes = 0
    const bucket = { put: async () => { writes++ } } as unknown as R2Bucket
    await expect(new AdminCatalogRefreshRequestRepository(bucket).writeRequest({
      ...REQUEST,
      kind: 'sync-now' as never,
    })).rejects.toThrow('catalog refresh request write failed')
    expect(writes).toBe(0)
  })

  it('reads a valid pending catalog-refresh request', async () => {
    let key: string | undefined
    const bucket = {
      get: async (value: string) => {
        key = value
        return object(JSON.stringify(REQUEST))
      },
    } as unknown as R2Bucket
    const result = await new AdminCatalogRefreshRequestRepository(bucket).getPendingRequest()
    expect(key).toBe(CATALOG_REFRESH_REQUEST_KEY)
    expect(result).toEqual({ status: 'found', value: REQUEST })
  })

  it('treats a missing object as no pending request', async () => {
    const bucket = { get: async () => null } as unknown as R2Bucket
    await expect(new AdminCatalogRefreshRequestRepository(bucket).getPendingRequest()).resolves.toEqual({ status: 'missing' })
  })

  it('rejects malformed, oversized, or wrong-kind objects without exposing their body', async () => {
    for (const value of [
      object('not-json'),
      object(JSON.stringify({ ...REQUEST, kind: 'sync-now' })),
      object(JSON.stringify(REQUEST), 4097),
    ]) {
      const bucket = { get: async () => value } as unknown as R2Bucket
      await expect(new AdminCatalogRefreshRequestRepository(bucket).getPendingRequest()).rejects.toThrow('catalog refresh request read failed')
    }
  })

  it('sanitizes R2 failures', async () => {
    const bucket = { get: async () => { throw new Error('https://secret.example/token') } } as unknown as R2Bucket
    await expect(new AdminCatalogRefreshRequestRepository(bucket).getPendingRequest()).rejects.toThrow('catalog refresh request read failed')
  })
})
