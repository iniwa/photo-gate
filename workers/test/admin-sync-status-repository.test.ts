import { describe, it, expect } from 'vitest'
import { AdminSyncStatusRepository } from '../src/services/admin-sync-status-repository.js'

// ---------------------------------------------------------------------------
// R2 fakes
// ---------------------------------------------------------------------------

function makeR2(object: { text(): Promise<string> } | null, throwOnGet = false): R2Bucket {
  return {
    get: async () => {
      if (throwOnGet) throw new Error('R2 error')
      return object as R2ObjectBody | null
    },
  } as unknown as R2Bucket
}

function makeObject(text: string, size?: number) {
  return { text: async () => text, ...(size === undefined ? {} : { size }) }
}

// ---------------------------------------------------------------------------
// Valid payload helpers
// ---------------------------------------------------------------------------

function makeValidPayloadV1(overrides: Record<string, unknown> = {}): string {
  const base: Record<string, unknown> = {
    schema: 1,
    publishedAt: '2026-06-25T00:00:00Z',
    albumId: 'my-album',
    intervalSeconds: 86400,
    startedAt: '2026-06-25T00:00:00Z',
    heartbeatAt: '2026-06-25T00:01:00Z',
    lastAttemptStartedAt: '2026-06-25T00:00:00Z',
    lastAttemptCompletedAt: '2026-06-25T00:02:00Z',
    lastResult: 'ok',
    lastError: null,
    consecutiveFailures: 0,
    runsCompleted: 1,
  }
  return JSON.stringify({ ...base, ...overrides })
}

// Keep alias for existing tests
const makeValidPayload = makeValidPayloadV1

function makeValidPayloadV2(overrides: Record<string, unknown> = {}): string {
  const base: Record<string, unknown> = {
    schema: 2,
    publishedAt: '2026-06-25T00:00:00Z',
    albumId: 'my-album',
    intervalSeconds: 86400,
    startedAt: '2026-06-25T00:00:00Z',
    heartbeatAt: '2026-06-25T00:01:00Z',
    lastAttemptStartedAt: '2026-06-25T00:00:00Z',
    lastAttemptCompletedAt: '2026-06-25T00:02:00Z',
    lastResult: 'ok',
    lastError: null,
    consecutiveFailures: 0,
    runsCompleted: 1,
    lastTriggerKind: null,
    lastHandledRequestId: null,
  }
  return JSON.stringify({ ...base, ...overrides })
}

async function getRepo(json: string, throwOnGet = false) {
  const repo = new AdminSyncStatusRepository(makeR2(makeObject(json), throwOnGet))
  return repo.getStatus()
}

// ---------------------------------------------------------------------------
// Fixed key
// ---------------------------------------------------------------------------

describe('AdminSyncStatusRepository - fixed key', () => {
  it('reads exactly ops/sync-status.json', async () => {
    let capturedKey: string | undefined
    const bucket = {
      get: async (key: string) => {
        capturedKey = key
        return makeObject(makeValidPayload()) as unknown as R2ObjectBody
      },
    } as unknown as R2Bucket
    const repo = new AdminSyncStatusRepository(bucket)
    await repo.getStatus()
    expect(capturedKey).toBe('ops/sync-status.json')
  })
})

// ---------------------------------------------------------------------------
// Missing object
// ---------------------------------------------------------------------------

describe('AdminSyncStatusRepository - missing', () => {
  it('returns missing when R2 returns null', async () => {
    const repo = new AdminSyncStatusRepository(makeR2(null))
    const result = await repo.getStatus()
    expect(result.status).toBe('missing')
  })
})

// ---------------------------------------------------------------------------
// Schema 1 - success and normalization
// ---------------------------------------------------------------------------

describe('AdminSyncStatusRepository - schema 1 found', () => {
  it('returns found with valid schema 1 JSON', async () => {
    const result = await getRepo(makeValidPayloadV1())
    expect(result.status).toBe('found')
  })

  it('schema 1 normalizes lastTriggerKind to null', async () => {
    const result = await getRepo(makeValidPayloadV1())
    if (result.status !== 'found') throw new Error('expected found')
    expect(result.value.lastTriggerKind).toBeNull()
  })

  it('schema 1 normalizes lastHandledRequestId to null', async () => {
    const result = await getRepo(makeValidPayloadV1())
    if (result.status !== 'found') throw new Error('expected found')
    expect(result.value.lastHandledRequestId).toBeNull()
  })

  it('accepts Docker second-form timestamp (no ms)', async () => {
    const result = await getRepo(makeValidPayload({ publishedAt: '2026-06-25T00:00:00Z' }))
    expect(result.status).toBe('found')
  })

  it('accepts millisecond-form timestamp', async () => {
    const result = await getRepo(makeValidPayload({ publishedAt: '2026-06-25T00:00:00.000Z' }))
    expect(result.status).toBe('found')
  })

  it('accepts null nullable timestamps', async () => {
    const result = await getRepo(makeValidPayload({
      lastAttemptStartedAt: null,
      lastAttemptCompletedAt: null,
    }))
    expect(result.status).toBe('found')
  })

  it('accepts null lastResult', async () => {
    const result = await getRepo(makeValidPayload({ lastResult: null }))
    expect(result.status).toBe('found')
  })

  it('accepts ok lastResult', async () => {
    const result = await getRepo(makeValidPayload({ lastResult: 'ok' }))
    expect(result.status).toBe('found')
  })

  it('accepts failed lastResult', async () => {
    const result = await getRepo(makeValidPayload({ lastResult: 'failed' }))
    expect(result.status).toBe('found')
  })

  it('accepts null lastError', async () => {
    const result = await getRepo(makeValidPayload({ lastError: null }))
    expect(result.status).toBe('found')
  })

  it('accepts short sanitized lastError string', async () => {
    const result = await getRepo(makeValidPayload({ lastError: 'ConfigError: bad config' }))
    expect(result.status).toBe('found')
  })
})

// ---------------------------------------------------------------------------
// Schema 2 - success
// ---------------------------------------------------------------------------

describe('AdminSyncStatusRepository - schema 2 found', () => {
  it('returns found with valid schema 2 JSON', async () => {
    const result = await getRepo(makeValidPayloadV2())
    expect(result.status).toBe('found')
  })

  it('schema 2 with lastTriggerKind=scheduled', async () => {
    const result = await getRepo(makeValidPayloadV2({ lastTriggerKind: 'scheduled' }))
    if (result.status !== 'found') throw new Error('expected found')
    expect(result.value.lastTriggerKind).toBe('scheduled')
  })

  it('schema 2 with lastTriggerKind=manual', async () => {
    const result = await getRepo(makeValidPayloadV2({ lastTriggerKind: 'manual' }))
    if (result.status !== 'found') throw new Error('expected found')
    expect(result.value.lastTriggerKind).toBe('manual')
  })

  it('schema 2 with lastTriggerKind=null', async () => {
    const result = await getRepo(makeValidPayloadV2({ lastTriggerKind: null }))
    if (result.status !== 'found') throw new Error('expected found')
    expect(result.value.lastTriggerKind).toBeNull()
  })

  it('schema 2 with valid lastHandledRequestId', async () => {
    const result = await getRepo(makeValidPayloadV2({ lastHandledRequestId: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4' }))
    if (result.status !== 'found') throw new Error('expected found')
    expect(result.value.lastHandledRequestId).toBe('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4')
  })

  it('schema 2 with lastHandledRequestId=null', async () => {
    const result = await getRepo(makeValidPayloadV2({ lastHandledRequestId: null }))
    if (result.status !== 'found') throw new Error('expected found')
    expect(result.value.lastHandledRequestId).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Schema 2 - validation failures
// ---------------------------------------------------------------------------

describe('AdminSyncStatusRepository - schema 2 validation failures', () => {
  it('throws on invalid lastTriggerKind (not a known kind)', async () => {
    await expect(getRepo(makeValidPayloadV2({ lastTriggerKind: 'unknown' }))).rejects.toThrow()
  })

  it('throws on lastTriggerKind as boolean', async () => {
    await expect(getRepo(makeValidPayloadV2({ lastTriggerKind: true }))).rejects.toThrow()
  })

  it('throws on lastTriggerKind as number', async () => {
    await expect(getRepo(makeValidPayloadV2({ lastTriggerKind: 1 }))).rejects.toThrow()
  })

  it('throws on lastHandledRequestId with uppercase hex', async () => {
    await expect(getRepo(makeValidPayloadV2({ lastHandledRequestId: 'A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4' }))).rejects.toThrow()
  })

  it('throws on lastHandledRequestId too short', async () => {
    await expect(getRepo(makeValidPayloadV2({ lastHandledRequestId: 'abc123' }))).rejects.toThrow()
  })

  it('throws on lastHandledRequestId too long', async () => {
    await expect(getRepo(makeValidPayloadV2({ lastHandledRequestId: 'a'.repeat(33) }))).rejects.toThrow()
  })

  it('throws on lastHandledRequestId as boolean', async () => {
    await expect(getRepo(makeValidPayloadV2({ lastHandledRequestId: true }))).rejects.toThrow()
  })

  it('throws on lastHandledRequestId as number', async () => {
    await expect(getRepo(makeValidPayloadV2({ lastHandledRequestId: 0 }))).rejects.toThrow()
  })

  it('throws on schema 2 missing lastTriggerKind', async () => {
    const p = JSON.parse(makeValidPayloadV2())
    delete p['lastTriggerKind']
    await expect(getRepo(JSON.stringify(p))).rejects.toThrow()
  })

  it('throws on schema 2 missing lastHandledRequestId', async () => {
    const p = JSON.parse(makeValidPayloadV2())
    delete p['lastHandledRequestId']
    await expect(getRepo(JSON.stringify(p))).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Schema mixing rejected
// ---------------------------------------------------------------------------

describe('AdminSyncStatusRepository - schema mixing rejected', () => {
  it('schema 1 with trigger fields (14 keys) throws', async () => {
    const p = JSON.parse(makeValidPayloadV1())
    p['lastTriggerKind'] = null
    p['lastHandledRequestId'] = null
    await expect(getRepo(JSON.stringify(p))).rejects.toThrow()
  })

  it('schema 2 with only 12 keys throws', async () => {
    const p = JSON.parse(makeValidPayloadV1())
    p['schema'] = 2
    await expect(getRepo(JSON.stringify(p))).rejects.toThrow()
  })

  it('throws when schema is 3', async () => {
    await expect(getRepo(makeValidPayload({ schema: 3 }))).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// R2 and JSON failures
// ---------------------------------------------------------------------------

describe('AdminSyncStatusRepository - R2/JSON failures', () => {
  it('throws when R2 get throws', async () => {
    const repo = new AdminSyncStatusRepository(makeR2(null, true))
    await expect(repo.getStatus()).rejects.toThrow()
  })

  it('throws on malformed JSON', async () => {
    await expect(getRepo('not-json')).rejects.toThrow()
  })

  it('rejects oversized status metadata before reading its text', async () => {
    let textCalled = false
    const bucket = {
      get: async () => ({
        size: 8193,
        text: async () => {
          textCalled = true
          return makeValidPayload()
        },
      }),
    } as unknown as R2Bucket
    await expect(new AdminSyncStatusRepository(bucket).getStatus()).rejects.toThrow('sync status read failed')
    expect(textCalled).toBe(false)
  })

  it('error message is sanitized', async () => {
    const repo = new AdminSyncStatusRepository(makeR2(null, true))
    await expect(repo.getStatus()).rejects.toThrow('sync status read failed')
  })
})

// ---------------------------------------------------------------------------
// Schema validation failures (schema 1 base)
// ---------------------------------------------------------------------------

describe('AdminSyncStatusRepository - schema validation', () => {
  it('throws on missing field (no schema)', async () => {
    const p = JSON.parse(makeValidPayload())
    delete p['schema']
    await expect(getRepo(JSON.stringify(p))).rejects.toThrow()
  })

  it('throws on extra field', async () => {
    const p = JSON.parse(makeValidPayload())
    p['extra'] = 'value'
    await expect(getRepo(JSON.stringify(p))).rejects.toThrow()
  })

  it('throws on invalid albumId (with spaces)', async () => {
    await expect(getRepo(makeValidPayload({ albumId: 'my album' }))).rejects.toThrow()
  })

  it('throws on invalid publishedAt timestamp', async () => {
    await expect(getRepo(makeValidPayload({ publishedAt: 'not-a-ts' }))).rejects.toThrow()
  })

  it('throws on offset timestamp', async () => {
    await expect(getRepo(makeValidPayload({ publishedAt: '2026-06-25T00:00:00+09:00' }))).rejects.toThrow()
  })

  it('throws on invalid lastResult', async () => {
    await expect(getRepo(makeValidPayload({ lastResult: 'pending' }))).rejects.toThrow()
  })

  it('throws on negative consecutiveFailures', async () => {
    await expect(getRepo(makeValidPayload({ consecutiveFailures: -1 }))).rejects.toThrow()
  })

  it('throws on negative runsCompleted', async () => {
    await expect(getRepo(makeValidPayload({ runsCompleted: -1 }))).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// lastError validation
// ---------------------------------------------------------------------------

describe('AdminSyncStatusRepository - lastError validation', () => {
  it('throws on lastError too long (257 chars)', async () => {
    const longError = 'a'.repeat(257)
    await expect(getRepo(makeValidPayload({ lastError: longError }))).rejects.toThrow()
  })

  it('throws on lastError with control character', async () => {
    await expect(getRepo(makeValidPayload({ lastError: 'error\x00here' }))).rejects.toThrow()
  })

  it('throws on lastError with http:// URL', async () => {
    await expect(getRepo(makeValidPayload({ lastError: 'see http://example.com for details' }))).rejects.toThrow()
  })

  it('throws on lastError with https:// URL', async () => {
    await expect(getRepo(makeValidPayload({ lastError: 'see https://example.com' }))).rejects.toThrow()
  })

  it('throws on lastError containing "token" (case-insensitive)', async () => {
    await expect(getRepo(makeValidPayload({ lastError: 'my Token value' }))).rejects.toThrow()
  })

  it('throws on lastError containing "secret"', async () => {
    await expect(getRepo(makeValidPayload({ lastError: 'secret=abc' }))).rejects.toThrow()
  })

  it('throws on lastError containing "password"', async () => {
    await expect(getRepo(makeValidPayload({ lastError: 'password=abc' }))).rejects.toThrow()
  })

  it('throws on lastError containing "Authorization"', async () => {
    await expect(getRepo(makeValidPayload({ lastError: 'Authorization header missing' }))).rejects.toThrow()
  })

  it('throws on lastError containing "Cf-Access-Jwt-Assertion"', async () => {
    await expect(getRepo(makeValidPayload({ lastError: 'Cf-Access-Jwt-Assertion=xyz' }))).rejects.toThrow()
  })

  it('accepts 256-char lastError with safe content', async () => {
    const okError = 'ConfigError: '.padEnd(256, 'x')
    const result = await getRepo(makeValidPayload({ lastError: okError }))
    expect(result.status).toBe('found')
  })
})
