import { describe, it, expect } from 'vitest'
import { AdminSyncRequestRepository } from '../src/services/admin-sync-request-repository.js'
import type { AdminSyncRequest } from '../src/types/admin-sync-request.js'

// ---------------------------------------------------------------------------
// R2 fakes
// ---------------------------------------------------------------------------

type PutCall = {
  key: string
  body: string
  options: {
    httpMetadata: { contentType: string; cacheControl: string }
    onlyIf: { etagDoesNotMatch: '*' }
  }
}

function makeCapturingBucket(
  putResult: R2Object | null = {} as R2Object,
): { bucket: R2Bucket; calls: PutCall[] } {
  const calls: PutCall[] = []
  const bucket = {
    put: async (key: string, body: unknown, options: unknown) => {
      calls.push({ key, body: body as string, options: options as PutCall['options'] })
      return putResult
    },
  } as unknown as R2Bucket
  return { bucket, calls }
}

function makeThrowingBucket(): R2Bucket {
  return {
    put: async () => { throw new Error('R2 exploded') },
  } as unknown as R2Bucket
}

// ---------------------------------------------------------------------------
// Valid request helper
// ---------------------------------------------------------------------------

function makeValidRequest(overrides: Partial<AdminSyncRequest> = {}): AdminSyncRequest {
  return {
    schema: 1,
    requestId: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
    requestedAt: new Date('2026-06-25T00:00:00.000Z').toISOString(),
    kind: 'sync-now',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Fixed key
// ---------------------------------------------------------------------------

describe('AdminSyncRequestRepository - fixed key', () => {
  it('writes to exactly ops/sync-request.json', async () => {
    const { bucket, calls } = makeCapturingBucket()
    const repo = new AdminSyncRequestRepository(bucket)
    await repo.writeRequest(makeValidRequest())
    expect(calls).toHaveLength(1)
    expect(calls[0]!.key).toBe('ops/sync-request.json')
  })

  it('uses create-only R2 precondition', async () => {
    const { bucket, calls } = makeCapturingBucket()
    await new AdminSyncRequestRepository(bucket).writeRequest(makeValidRequest())
    expect(calls[0]!.options.onlyIf).toEqual({ etagDoesNotMatch: '*' })
  })
})

// ---------------------------------------------------------------------------
// Success - metadata
// ---------------------------------------------------------------------------

describe('AdminSyncRequestRepository - metadata', () => {
  it('returns created after a new request is stored', async () => {
    const { bucket } = makeCapturingBucket()
    await expect(new AdminSyncRequestRepository(bucket).writeRequest(makeValidRequest())).resolves.toBe('created')
  })

  it('coalesces when a request is already pending', async () => {
    const { bucket } = makeCapturingBucket(null)
    await expect(new AdminSyncRequestRepository(bucket).writeRequest(makeValidRequest())).resolves.toBe('already-pending')
  })

  it('sets contentType to application/json', async () => {
    const { bucket, calls } = makeCapturingBucket()
    await new AdminSyncRequestRepository(bucket).writeRequest(makeValidRequest())
    expect(calls[0]!.options.httpMetadata.contentType).toBe('application/json')
  })

  it('sets cacheControl to private, no-cache', async () => {
    const { bucket, calls } = makeCapturingBucket()
    await new AdminSyncRequestRepository(bucket).writeRequest(makeValidRequest())
    expect(calls[0]!.options.httpMetadata.cacheControl).toBe('private, no-cache')
  })

  it('body is valid JSON with exactly 4 fields', async () => {
    const { bucket, calls } = makeCapturingBucket()
    await new AdminSyncRequestRepository(bucket).writeRequest(makeValidRequest())
    const parsed = JSON.parse(calls[0]!.body)
    expect(Object.keys(parsed)).toHaveLength(4)
  })

  it('body contains schema=1', async () => {
    const { bucket, calls } = makeCapturingBucket()
    await new AdminSyncRequestRepository(bucket).writeRequest(makeValidRequest())
    const parsed = JSON.parse(calls[0]!.body)
    expect(parsed.schema).toBe(1)
  })

  it('body contains the requestId', async () => {
    const { bucket, calls } = makeCapturingBucket()
    const req = makeValidRequest({ requestId: 'deadbeef12345678deadbeef12345678' })
    await new AdminSyncRequestRepository(bucket).writeRequest(req)
    const parsed = JSON.parse(calls[0]!.body)
    expect(parsed.requestId).toBe('deadbeef12345678deadbeef12345678')
  })

  it('body contains the requestedAt', async () => {
    const ts = new Date('2026-06-25T12:34:56.789Z').toISOString()
    const { bucket, calls } = makeCapturingBucket()
    await new AdminSyncRequestRepository(bucket).writeRequest(makeValidRequest({ requestedAt: ts }))
    const parsed = JSON.parse(calls[0]!.body)
    expect(parsed.requestedAt).toBe(ts)
  })

  it('body contains kind=sync-now', async () => {
    const { bucket, calls } = makeCapturingBucket()
    await new AdminSyncRequestRepository(bucket).writeRequest(makeValidRequest())
    const parsed = JSON.parse(calls[0]!.body)
    expect(parsed.kind).toBe('sync-now')
  })
})

// ---------------------------------------------------------------------------
// Validation failures
// ---------------------------------------------------------------------------

describe('AdminSyncRequestRepository - requestId validation', () => {
  it('throws on requestId with uppercase hex', async () => {
    const { bucket } = makeCapturingBucket()
    const repo = new AdminSyncRequestRepository(bucket)
    await expect(repo.writeRequest(makeValidRequest({ requestId: 'A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4' }))).rejects.toThrow('sync request write failed')
  })

  it('throws on requestId shorter than 32 chars', async () => {
    const { bucket } = makeCapturingBucket()
    const repo = new AdminSyncRequestRepository(bucket)
    await expect(repo.writeRequest(makeValidRequest({ requestId: 'abc123' }))).rejects.toThrow('sync request write failed')
  })

  it('throws on requestId longer than 32 chars', async () => {
    const { bucket } = makeCapturingBucket()
    const repo = new AdminSyncRequestRepository(bucket)
    await expect(repo.writeRequest(makeValidRequest({ requestId: 'a'.repeat(33) }))).rejects.toThrow('sync request write failed')
  })

  it('throws on requestId with non-hex chars', async () => {
    const { bucket } = makeCapturingBucket()
    const repo = new AdminSyncRequestRepository(bucket)
    await expect(repo.writeRequest(makeValidRequest({ requestId: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3zz' }))).rejects.toThrow('sync request write failed')
  })
})

describe('AdminSyncRequestRepository - requestedAt validation', () => {
  it('throws on requestedAt without milliseconds (non-canonical Worker ISO)', async () => {
    const { bucket } = makeCapturingBucket()
    const repo = new AdminSyncRequestRepository(bucket)
    await expect(repo.writeRequest(makeValidRequest({ requestedAt: '2026-06-25T00:00:00Z' }))).rejects.toThrow('sync request write failed')
  })

  it('throws on requestedAt with offset timezone', async () => {
    const { bucket } = makeCapturingBucket()
    const repo = new AdminSyncRequestRepository(bucket)
    await expect(repo.writeRequest(makeValidRequest({ requestedAt: '2026-06-25T09:00:00.000+09:00' }))).rejects.toThrow('sync request write failed')
  })

  it('throws on requestedAt that is not a valid date', async () => {
    const { bucket } = makeCapturingBucket()
    const repo = new AdminSyncRequestRepository(bucket)
    await expect(repo.writeRequest(makeValidRequest({ requestedAt: 'not-a-date' }))).rejects.toThrow('sync request write failed')
  })

  it('throws on expanded-year ISO strings that Date can normalize but Worker clock never emits', async () => {
    const { bucket } = makeCapturingBucket()
    const repo = new AdminSyncRequestRepository(bucket)
    await expect(repo.writeRequest(makeValidRequest({ requestedAt: '+010000-01-01T00:00:00.000Z' }))).rejects.toThrow('sync request write failed')
  })
})

describe('AdminSyncRequestRepository - kind validation', () => {
  it('throws on wrong kind', async () => {
    const { bucket } = makeCapturingBucket()
    const repo = new AdminSyncRequestRepository(bucket)
    // Type cast to test the runtime check
    await expect(repo.writeRequest(makeValidRequest({ kind: 'sync-later' as 'sync-now' }))).rejects.toThrow('sync request write failed')
  })
})

// ---------------------------------------------------------------------------
// R2 failure
// ---------------------------------------------------------------------------

describe('AdminSyncRequestRepository - R2 failure', () => {
  it('throws fixed error when R2 put throws', async () => {
    const repo = new AdminSyncRequestRepository(makeThrowingBucket())
    await expect(repo.writeRequest(makeValidRequest())).rejects.toThrow('sync request write failed')
  })

  it('error message does not contain R2 underlying message', async () => {
    const repo = new AdminSyncRequestRepository(makeThrowingBucket())
    try {
      await repo.writeRequest(makeValidRequest())
      expect.fail('should have thrown')
    } catch (err) {
      expect((err as Error).message).toBe('sync request write failed')
    }
  })

  it('error message does not contain requestId', async () => {
    const repo = new AdminSyncRequestRepository(makeThrowingBucket())
    const req = makeValidRequest({ requestId: 'deadbeef12345678deadbeef12345678' })
    try {
      await repo.writeRequest(req)
      expect.fail('should have thrown')
    } catch (err) {
      expect((err as Error).message).not.toContain('deadbeef12345678deadbeef12345678')
    }
  })

  it('error message does not contain R2 key', async () => {
    const repo = new AdminSyncRequestRepository(makeThrowingBucket())
    try {
      await repo.writeRequest(makeValidRequest())
      expect.fail('should have thrown')
    } catch (err) {
      expect((err as Error).message).not.toContain('ops/sync-request.json')
    }
  })
})

// ---------------------------------------------------------------------------
// No extra fields in written body
// ---------------------------------------------------------------------------

describe('AdminSyncRequestRepository - no extra fields', () => {
  it('body contains only schema, requestId, requestedAt, kind', async () => {
    const { bucket, calls } = makeCapturingBucket()
    await new AdminSyncRequestRepository(bucket).writeRequest(makeValidRequest())
    const parsed = JSON.parse(calls[0]!.body)
    expect(Object.keys(parsed).sort()).toEqual(['kind', 'requestId', 'requestedAt', 'schema'].sort())
  })
})

// ---------------------------------------------------------------------------
// getPendingRequest - helpers
// ---------------------------------------------------------------------------

const VALID_PENDING_JSON = JSON.stringify({
  schema: 1,
  requestId: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
  requestedAt: '2026-06-25T00:00:00.000Z',
  kind: 'sync-now',
})

function makeGetBucket(
  object: { text(): Promise<string>; size?: number } | null,
  throwOnGet = false,
): R2Bucket {
  return {
    get: async () => {
      if (throwOnGet) throw new Error('R2 get error')
      return object as R2ObjectBody | null
    },
    put: async () => {},
  } as unknown as R2Bucket
}

function makeGetObject(text: string, size?: number) {
  return { text: async () => text, ...(size !== undefined ? { size } : {}) }
}

async function getPending(json: string, size?: number, throwOnGet = false) {
  const bucket = makeGetBucket(makeGetObject(json, size), throwOnGet)
  const repo = new AdminSyncRequestRepository(bucket)
  return repo.getPendingRequest()
}

// ---------------------------------------------------------------------------
// getPendingRequest - fixed key
// ---------------------------------------------------------------------------

describe('AdminSyncRequestRepository getPendingRequest - fixed key', () => {
  it('reads exactly ops/sync-request.json', async () => {
    let capturedKey: string | undefined
    const bucket = {
      get: async (key: string) => {
        capturedKey = key
        return makeGetObject(VALID_PENDING_JSON)
      },
      put: async () => {},
    } as unknown as R2Bucket
    const repo = new AdminSyncRequestRepository(bucket)
    await repo.getPendingRequest()
    expect(capturedKey).toBe('ops/sync-request.json')
  })
})

// ---------------------------------------------------------------------------
// getPendingRequest - missing
// ---------------------------------------------------------------------------

describe('AdminSyncRequestRepository getPendingRequest - missing', () => {
  it('returns missing when R2 returns null', async () => {
    const bucket = makeGetBucket(null)
    const repo = new AdminSyncRequestRepository(bucket)
    const result = await repo.getPendingRequest()
    expect(result.status).toBe('missing')
  })
})

// ---------------------------------------------------------------------------
// getPendingRequest - found
// ---------------------------------------------------------------------------

describe('AdminSyncRequestRepository getPendingRequest - found', () => {
  it('returns found with valid JSON', async () => {
    const result = await getPending(VALID_PENDING_JSON)
    expect(result.status).toBe('found')
  })

  it('found value has schema=1', async () => {
    const result = await getPending(VALID_PENDING_JSON)
    if (result.status !== 'found') throw new Error('expected found')
    expect(result.value.schema).toBe(1)
  })

  it('found value has requestId', async () => {
    const result = await getPending(VALID_PENDING_JSON)
    if (result.status !== 'found') throw new Error('expected found')
    expect(result.value.requestId).toBe('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4')
  })

  it('found value has requestedAt', async () => {
    const result = await getPending(VALID_PENDING_JSON)
    if (result.status !== 'found') throw new Error('expected found')
    expect(result.value.requestedAt).toBe('2026-06-25T00:00:00.000Z')
  })

  it('found value has kind=sync-now', async () => {
    const result = await getPending(VALID_PENDING_JSON)
    if (result.status !== 'found') throw new Error('expected found')
    expect(result.value.kind).toBe('sync-now')
  })

  it('accepts object with size exactly 4096', async () => {
    const result = await getPending(VALID_PENDING_JSON, 4096)
    expect(result.status).toBe('found')
  })
})

// ---------------------------------------------------------------------------
// getPendingRequest - validation failures
// ---------------------------------------------------------------------------

describe('AdminSyncRequestRepository getPendingRequest - validation failures', () => {
  it('throws when R2 get throws', async () => {
    const bucket = makeGetBucket(null, true)
    const repo = new AdminSyncRequestRepository(bucket)
    await expect(repo.getPendingRequest()).rejects.toThrow('sync request read failed')
  })

  it('throws when object size > 4096', async () => {
    await expect(getPending(VALID_PENDING_JSON, 4097)).rejects.toThrow('sync request read failed')
  })

  it('throws on malformed JSON', async () => {
    await expect(getPending('not-json')).rejects.toThrow('sync request read failed')
  })

  it('throws on array root', async () => {
    await expect(getPending('[]')).rejects.toThrow('sync request read failed')
  })

  it('throws on missing fields (only 3 keys)', async () => {
    const p = JSON.parse(VALID_PENDING_JSON)
    delete p['kind']
    await expect(getPending(JSON.stringify(p))).rejects.toThrow('sync request read failed')
  })

  it('throws on extra fields (5 keys)', async () => {
    const p = JSON.parse(VALID_PENDING_JSON)
    p['extra'] = 'x'
    await expect(getPending(JSON.stringify(p))).rejects.toThrow('sync request read failed')
  })

  it('throws when schema !== 1', async () => {
    const p = JSON.parse(VALID_PENDING_JSON)
    p['schema'] = 2
    await expect(getPending(JSON.stringify(p))).rejects.toThrow('sync request read failed')
  })

  it('throws on requestId with uppercase hex', async () => {
    const p = JSON.parse(VALID_PENDING_JSON)
    p['requestId'] = 'A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4'
    await expect(getPending(JSON.stringify(p))).rejects.toThrow('sync request read failed')
  })

  it('throws on requestId too short', async () => {
    const p = JSON.parse(VALID_PENDING_JSON)
    p['requestId'] = 'abc123'
    await expect(getPending(JSON.stringify(p))).rejects.toThrow('sync request read failed')
  })

  it('throws on requestedAt without milliseconds (Docker form)', async () => {
    const p = JSON.parse(VALID_PENDING_JSON)
    p['requestedAt'] = '2026-06-25T00:00:00Z'
    await expect(getPending(JSON.stringify(p))).rejects.toThrow('sync request read failed')
  })

  it('throws on requestedAt with timezone offset', async () => {
    const p = JSON.parse(VALID_PENDING_JSON)
    p['requestedAt'] = '2026-06-25T09:00:00.000+09:00'
    await expect(getPending(JSON.stringify(p))).rejects.toThrow('sync request read failed')
  })

  it('throws on wrong kind', async () => {
    const p = JSON.parse(VALID_PENDING_JSON)
    p['kind'] = 'other'
    await expect(getPending(JSON.stringify(p))).rejects.toThrow('sync request read failed')
  })

  it('error message is sanitized (no requestId)', async () => {
    const bucket = makeGetBucket(null, true)
    const repo = new AdminSyncRequestRepository(bucket)
    try {
      await repo.getPendingRequest()
      expect.fail('should have thrown')
    } catch (err) {
      expect((err as Error).message).toBe('sync request read failed')
      expect((err as Error).message).not.toContain('a1b2c3d4')
    }
  })
})
