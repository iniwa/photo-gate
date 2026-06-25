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

function makeObject(text: string) {
  return { text: async () => text }
}

// ---------------------------------------------------------------------------
// Valid payload helper
// ---------------------------------------------------------------------------

function makeValidPayload(overrides: Record<string, unknown> = {}): string {
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
// Found - success
// ---------------------------------------------------------------------------

describe('AdminSyncStatusRepository - found', () => {
  it('returns found with valid JSON', async () => {
    const result = await getRepo(makeValidPayload())
    expect(result.status).toBe('found')
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

  it('error message is sanitized', async () => {
    const repo = new AdminSyncStatusRepository(makeR2(null, true))
    await expect(repo.getStatus()).rejects.toThrow('sync status read failed')
  })
})

// ---------------------------------------------------------------------------
// Schema validation failures
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

  it('throws when schema !== 1', async () => {
    await expect(getRepo(makeValidPayload({ schema: 2 }))).rejects.toThrow()
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
