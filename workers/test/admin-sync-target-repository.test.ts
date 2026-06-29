import { describe, it, expect } from 'vitest'
import { AdminSyncTargetRepository, SYNC_TARGETS_KEY } from '../src/services/admin-sync-target-repository.js'

// ---------------------------------------------------------------------------
// R2 fakes
// ---------------------------------------------------------------------------

type PutCall = {
  key: string
  body: string
  options: { httpMetadata: { contentType: string; cacheControl: string } }
}

function makeObject(text: string) {
  return { text: async () => text, size: text.length }
}

function makeBucket(
  existing: string | null,
  opts: { throwOnGet?: boolean; throwOnPut?: boolean } = {},
): { bucket: R2Bucket; puts: PutCall[] } {
  const puts: PutCall[] = []
  const bucket = {
    get: async () => {
      if (opts.throwOnGet) throw new Error('R2 get exploded')
      return existing === null ? null : (makeObject(existing) as unknown as R2ObjectBody)
    },
    put: async (key: string, body: unknown, options: unknown) => {
      if (opts.throwOnPut) throw new Error('R2 put exploded')
      puts.push({ key, body: body as string, options: options as PutCall['options'] })
    },
  } as unknown as R2Bucket
  return { bucket, puts }
}

// ---------------------------------------------------------------------------
// Valid target JSON helpers
// ---------------------------------------------------------------------------

const VALID_PUBLISHED_AT = '2026-06-29T12:00:00.000Z'

function makeValidTargetList(targets: unknown[] = [], publishedAt = VALID_PUBLISHED_AT): string {
  return JSON.stringify({ schema: 1, publishedAt, targets })
}

function makeValidTarget(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    albumId: 'album-one',
    catalogId: 'a'.repeat(64),
    title: 'Album One',
    expiresAt: null,
    downloadEnabled: 0,
    thumb: { longEdge: 640, format: 'webp', quality: 80 },
    preview: { longEdge: 3840, format: 'jpg', quality: 88 },
    stripExif: 1,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Fixed key
// ---------------------------------------------------------------------------

describe('AdminSyncTargetRepository - fixed key', () => {
  it('reads from ops/sync-targets.json', async () => {
    let capturedKey: string | undefined
    const bucket = {
      get: async (key: string) => {
        capturedKey = key
        return null
      },
      put: async () => {},
    } as unknown as R2Bucket
    const repo = new AdminSyncTargetRepository(bucket)
    await repo.upsertTarget('album-a', 'b'.repeat(64), 'Title', null, 0, VALID_PUBLISHED_AT)
    expect(capturedKey).toBe(SYNC_TARGETS_KEY)
  })

  it('writes to ops/sync-targets.json', async () => {
    const { bucket, puts } = makeBucket(null)
    const repo = new AdminSyncTargetRepository(bucket)
    await repo.upsertTarget('album-a', 'b'.repeat(64), 'Title', null, 0, VALID_PUBLISHED_AT)
    expect(puts).toHaveLength(1)
    expect(puts[0]!.key).toBe(SYNC_TARGETS_KEY)
  })
})

// ---------------------------------------------------------------------------
// upsertTarget - new insert
// ---------------------------------------------------------------------------

describe('AdminSyncTargetRepository - upsertTarget new', () => {
  it('empty bucket → writes one target', async () => {
    const { bucket, puts } = makeBucket(null)
    const repo = new AdminSyncTargetRepository(bucket)
    await repo.upsertTarget('album-a', 'c'.repeat(64), 'Title A', null, 0, VALID_PUBLISHED_AT)
    expect(puts).toHaveLength(1)
    const written = JSON.parse(puts[0]!.body)
    expect(written.targets).toHaveLength(1)
    expect(written.targets[0].albumId).toBe('album-a')
    expect(written.targets[0].catalogId).toBe('c'.repeat(64))
  })

  it('writes schema=1', async () => {
    const { bucket, puts } = makeBucket(null)
    const repo = new AdminSyncTargetRepository(bucket)
    await repo.upsertTarget('album-a', 'c'.repeat(64), 'Title A', null, 0, VALID_PUBLISHED_AT)
    const written = JSON.parse(puts[0]!.body)
    expect(written.schema).toBe(1)
  })

  it('writes publishedAt from argument', async () => {
    const { bucket, puts } = makeBucket(null)
    const repo = new AdminSyncTargetRepository(bucket)
    await repo.upsertTarget('album-a', 'c'.repeat(64), 'Title A', null, 0, VALID_PUBLISHED_AT)
    const written = JSON.parse(puts[0]!.body)
    expect(written.publishedAt).toBe(VALID_PUBLISHED_AT)
  })

  it('writes fixed thumb settings', async () => {
    const { bucket, puts } = makeBucket(null)
    const repo = new AdminSyncTargetRepository(bucket)
    await repo.upsertTarget('album-a', 'c'.repeat(64), 'Title A', null, 0, VALID_PUBLISHED_AT)
    const written = JSON.parse(puts[0]!.body)
    expect(written.targets[0].thumb).toEqual({ longEdge: 640, format: 'webp', quality: 80 })
  })

  it('writes fixed preview settings', async () => {
    const { bucket, puts } = makeBucket(null)
    const repo = new AdminSyncTargetRepository(bucket)
    await repo.upsertTarget('album-a', 'c'.repeat(64), 'Title A', null, 0, VALID_PUBLISHED_AT)
    const written = JSON.parse(puts[0]!.body)
    expect(written.targets[0].preview).toEqual({ longEdge: 3840, format: 'jpg', quality: 88 })
  })

  it('writes stripExif=1', async () => {
    const { bucket, puts } = makeBucket(null)
    const repo = new AdminSyncTargetRepository(bucket)
    await repo.upsertTarget('album-a', 'c'.repeat(64), 'Title A', null, 0, VALID_PUBLISHED_AT)
    const written = JSON.parse(puts[0]!.body)
    expect(written.targets[0].stripExif).toBe(1)
  })

  it('sets content-type application/json', async () => {
    const { bucket, puts } = makeBucket(null)
    const repo = new AdminSyncTargetRepository(bucket)
    await repo.upsertTarget('album-a', 'c'.repeat(64), 'Title A', null, 0, VALID_PUBLISHED_AT)
    expect(puts[0]!.options.httpMetadata.contentType).toBe('application/json')
  })

  it('sets cache-control private, no-cache', async () => {
    const { bucket, puts } = makeBucket(null)
    const repo = new AdminSyncTargetRepository(bucket)
    await repo.upsertTarget('album-a', 'c'.repeat(64), 'Title A', null, 0, VALID_PUBLISHED_AT)
    expect(puts[0]!.options.httpMetadata.cacheControl).toBe('private, no-cache')
  })

  it('does not write photoprism_album_uid or uid to JSON', async () => {
    const { bucket, puts } = makeBucket(null)
    const repo = new AdminSyncTargetRepository(bucket)
    await repo.upsertTarget('album-a', 'c'.repeat(64), 'Title A', null, 0, VALID_PUBLISHED_AT)
    expect(puts[0]!.body).not.toContain('uid')
    expect(puts[0]!.body).not.toContain('photoprism')
  })
})

// ---------------------------------------------------------------------------
// upsertTarget - update existing
// ---------------------------------------------------------------------------

describe('AdminSyncTargetRepository - upsertTarget update', () => {
  it('replaces existing entry for same albumId', async () => {
    const existing = makeValidTargetList([makeValidTarget({ albumId: 'album-one', catalogId: 'a'.repeat(64), title: 'Old' })])
    const { bucket, puts } = makeBucket(existing)
    const repo = new AdminSyncTargetRepository(bucket)
    await repo.upsertTarget('album-one', 'a'.repeat(64), 'New Title', null, 1, VALID_PUBLISHED_AT)
    const written = JSON.parse(puts[0]!.body)
    expect(written.targets).toHaveLength(1)
    expect(written.targets[0].title).toBe('New Title')
    expect(written.targets[0].downloadEnabled).toBe(1)
  })

  it('appends new target when albumId is different', async () => {
    const existing = makeValidTargetList([makeValidTarget({ albumId: 'album-one', catalogId: 'a'.repeat(64) })])
    const { bucket, puts } = makeBucket(existing)
    const repo = new AdminSyncTargetRepository(bucket)
    await repo.upsertTarget('album-two', 'b'.repeat(64), 'Album Two', null, 0, VALID_PUBLISHED_AT)
    const written = JSON.parse(puts[0]!.body)
    expect(written.targets).toHaveLength(2)
  })

  it('allows same albumId to change catalogId', async () => {
    const existing = makeValidTargetList([makeValidTarget({ albumId: 'album-one', catalogId: 'a'.repeat(64) })])
    const { bucket, puts } = makeBucket(existing)
    const repo = new AdminSyncTargetRepository(bucket)
    await repo.upsertTarget('album-one', 'b'.repeat(64), 'Album One', null, 0, VALID_PUBLISHED_AT)
    const written = JSON.parse(puts[0]!.body)
    expect(written.targets[0].catalogId).toBe('b'.repeat(64))
  })
})

// ---------------------------------------------------------------------------
// upsertTarget - duplicate catalogId guard
// ---------------------------------------------------------------------------

describe('AdminSyncTargetRepository - upsertTarget duplicate catalogId', () => {
  it('throws when new catalogId duplicates another albumId catalogId', async () => {
    const existing = makeValidTargetList([makeValidTarget({ albumId: 'album-one', catalogId: 'a'.repeat(64) })])
    const { bucket } = makeBucket(existing)
    const repo = new AdminSyncTargetRepository(bucket)
    await expect(
      repo.upsertTarget('album-two', 'a'.repeat(64), 'Album Two', null, 0, VALID_PUBLISHED_AT)
    ).rejects.toThrow()
  })

  it('allows same albumId to re-upsert same catalogId', async () => {
    const existing = makeValidTargetList([makeValidTarget({ albumId: 'album-one', catalogId: 'a'.repeat(64) })])
    const { bucket, puts } = makeBucket(existing)
    const repo = new AdminSyncTargetRepository(bucket)
    await repo.upsertTarget('album-one', 'a'.repeat(64), 'Updated Title', null, 0, VALID_PUBLISHED_AT)
    expect(puts).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// upsertTarget - input validation
// ---------------------------------------------------------------------------

describe('AdminSyncTargetRepository - upsertTarget input validation', () => {
  const GOOD = { albumId: 'album-a', catalogId: 'd'.repeat(64), title: 'T', expiresAt: null, downloadEnabled: 0 as 0 | 1, publishedAt: VALID_PUBLISHED_AT }

  it('invalid albumId → throws', async () => {
    const { bucket } = makeBucket(null)
    const repo = new AdminSyncTargetRepository(bucket)
    await expect(repo.upsertTarget('!bad!', GOOD.catalogId, GOOD.title, GOOD.expiresAt, GOOD.downloadEnabled, GOOD.publishedAt)).rejects.toThrow()
  })

  it('invalid catalogId (not 64 hex) → throws', async () => {
    const { bucket } = makeBucket(null)
    const repo = new AdminSyncTargetRepository(bucket)
    await expect(repo.upsertTarget(GOOD.albumId, 'tooshort', GOOD.title, GOOD.expiresAt, GOOD.downloadEnabled, GOOD.publishedAt)).rejects.toThrow()
  })

  it('invalid catalogId (uppercase) → throws', async () => {
    const { bucket } = makeBucket(null)
    const repo = new AdminSyncTargetRepository(bucket)
    await expect(repo.upsertTarget(GOOD.albumId, 'A'.repeat(64), GOOD.title, GOOD.expiresAt, GOOD.downloadEnabled, GOOD.publishedAt)).rejects.toThrow()
  })

  it('empty title → throws', async () => {
    const { bucket } = makeBucket(null)
    const repo = new AdminSyncTargetRepository(bucket)
    await expect(repo.upsertTarget(GOOD.albumId, GOOD.catalogId, '', GOOD.expiresAt, GOOD.downloadEnabled, GOOD.publishedAt)).rejects.toThrow()
  })

  it('title with leading space → throws', async () => {
    const { bucket } = makeBucket(null)
    const repo = new AdminSyncTargetRepository(bucket)
    await expect(repo.upsertTarget(GOOD.albumId, GOOD.catalogId, ' Bad', GOOD.expiresAt, GOOD.downloadEnabled, GOOD.publishedAt)).rejects.toThrow()
  })

  it('title with control char → throws', async () => {
    const { bucket } = makeBucket(null)
    const repo = new AdminSyncTargetRepository(bucket)
    await expect(repo.upsertTarget(GOOD.albumId, GOOD.catalogId, 'Bad\x01', GOOD.expiresAt, GOOD.downloadEnabled, GOOD.publishedAt)).rejects.toThrow()
  })

  it('invalid expiresAt format → throws', async () => {
    const { bucket } = makeBucket(null)
    const repo = new AdminSyncTargetRepository(bucket)
    await expect(repo.upsertTarget(GOOD.albumId, GOOD.catalogId, GOOD.title, 'not-a-date', GOOD.downloadEnabled, GOOD.publishedAt)).rejects.toThrow()
  })

  it('downloadEnabled=2 → throws', async () => {
    const { bucket } = makeBucket(null)
    const repo = new AdminSyncTargetRepository(bucket)
    await expect(repo.upsertTarget(GOOD.albumId, GOOD.catalogId, GOOD.title, GOOD.expiresAt, 2 as unknown as 0 | 1, GOOD.publishedAt)).rejects.toThrow()
  })

  it('publishedAt without milliseconds → throws', async () => {
    const { bucket } = makeBucket(null)
    const repo = new AdminSyncTargetRepository(bucket)
    await expect(repo.upsertTarget(GOOD.albumId, GOOD.catalogId, GOOD.title, GOOD.expiresAt, GOOD.downloadEnabled, '2026-06-29T12:00:00Z')).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// upsertTarget - R2 failures
// ---------------------------------------------------------------------------

describe('AdminSyncTargetRepository - upsertTarget R2 failures', () => {
  it('R2 get throws → throws', async () => {
    const { bucket } = makeBucket(null, { throwOnGet: true })
    const repo = new AdminSyncTargetRepository(bucket)
    await expect(repo.upsertTarget('album-a', 'd'.repeat(64), 'T', null, 0, VALID_PUBLISHED_AT)).rejects.toThrow()
  })

  it('R2 put throws → throws', async () => {
    const { bucket } = makeBucket(null, { throwOnPut: true })
    const repo = new AdminSyncTargetRepository(bucket)
    await expect(repo.upsertTarget('album-a', 'd'.repeat(64), 'T', null, 0, VALID_PUBLISHED_AT)).rejects.toThrow()
  })

  it('oversized existing JSON → throws, no put attempted', async () => {
    const { bucket, puts } = makeBucket('x'.repeat(256 * 1024 + 1), { throwOnPut: false })
    const repo = new AdminSyncTargetRepository(bucket)
    await expect(repo.upsertTarget('album-a', 'd'.repeat(64), 'T', null, 0, VALID_PUBLISHED_AT)).rejects.toThrow()
    expect(puts).toHaveLength(0)
  })
  it('malformed existing JSON → throws, no put attempted', async () => {
    const { bucket, puts } = makeBucket('not valid json', { throwOnPut: false })
    const repo = new AdminSyncTargetRepository(bucket)
    await expect(repo.upsertTarget('album-a', 'd'.repeat(64), 'T', null, 0, VALID_PUBLISHED_AT)).rejects.toThrow()
    expect(puts).toHaveLength(0)
  })

  it('existing JSON with wrong schema → throws, no put attempted', async () => {
    const { bucket, puts } = makeBucket(JSON.stringify({ schema: 2, publishedAt: VALID_PUBLISHED_AT, targets: [] }))
    const repo = new AdminSyncTargetRepository(bucket)
    await expect(repo.upsertTarget('album-a', 'd'.repeat(64), 'T', null, 0, VALID_PUBLISHED_AT)).rejects.toThrow()
    expect(puts).toHaveLength(0)
  })

  it('existing JSON with extra root key → throws', async () => {
    const { bucket, puts } = makeBucket(JSON.stringify({ schema: 1, publishedAt: VALID_PUBLISHED_AT, targets: [], extra: true }))
    const repo = new AdminSyncTargetRepository(bucket)
    await expect(repo.upsertTarget('album-a', 'd'.repeat(64), 'T', null, 0, VALID_PUBLISHED_AT)).rejects.toThrow()
    expect(puts).toHaveLength(0)
  })

  it('existing JSON with malformed target entry → throws', async () => {
    const malformed = makeValidTargetList([{ albumId: 'bad', catalogId: 'not-hex' }])
    const { bucket, puts } = makeBucket(malformed)
    const repo = new AdminSyncTargetRepository(bucket)
    await expect(repo.upsertTarget('album-a', 'd'.repeat(64), 'T', null, 0, VALID_PUBLISHED_AT)).rejects.toThrow()
    expect(puts).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// removeTarget - success
// ---------------------------------------------------------------------------

describe('AdminSyncTargetRepository - removeTarget success', () => {
  it('removes existing albumId entry', async () => {
    const existing = makeValidTargetList([
      makeValidTarget({ albumId: 'album-one', catalogId: 'a'.repeat(64) }),
      makeValidTarget({ albumId: 'album-two', catalogId: 'b'.repeat(64) }),
    ])
    const { bucket, puts } = makeBucket(existing)
    const repo = new AdminSyncTargetRepository(bucket)
    await repo.removeTarget('album-one', VALID_PUBLISHED_AT)
    const written = JSON.parse(puts[0]!.body)
    expect(written.targets).toHaveLength(1)
    expect(written.targets[0].albumId).toBe('album-two')
  })

  it('non-existent albumId → writes unchanged list', async () => {
    const existing = makeValidTargetList([makeValidTarget({ albumId: 'album-one', catalogId: 'a'.repeat(64) })])
    const { bucket, puts } = makeBucket(existing)
    const repo = new AdminSyncTargetRepository(bucket)
    await repo.removeTarget('album-nonexistent', VALID_PUBLISHED_AT)
    const written = JSON.parse(puts[0]!.body)
    expect(written.targets).toHaveLength(1)
  })

  it('empty bucket → writes empty list', async () => {
    const { bucket, puts } = makeBucket(null)
    const repo = new AdminSyncTargetRepository(bucket)
    await repo.removeTarget('album-a', VALID_PUBLISHED_AT)
    const written = JSON.parse(puts[0]!.body)
    expect(written.targets).toHaveLength(0)
  })

  it('updates publishedAt in written object', async () => {
    const { bucket, puts } = makeBucket(null)
    const repo = new AdminSyncTargetRepository(bucket)
    const newTimestamp = '2026-06-30T08:00:00.000Z'
    await repo.removeTarget('album-a', newTimestamp)
    const written = JSON.parse(puts[0]!.body)
    expect(written.publishedAt).toBe(newTimestamp)
  })
})

// ---------------------------------------------------------------------------
// removeTarget - input validation
// ---------------------------------------------------------------------------

describe('AdminSyncTargetRepository - removeTarget input validation', () => {
  it('invalid albumId → throws', async () => {
    const { bucket } = makeBucket(null)
    const repo = new AdminSyncTargetRepository(bucket)
    await expect(repo.removeTarget('!bad!', VALID_PUBLISHED_AT)).rejects.toThrow()
  })

  it('publishedAt without milliseconds → throws', async () => {
    const { bucket } = makeBucket(null)
    const repo = new AdminSyncTargetRepository(bucket)
    await expect(repo.removeTarget('album-a', '2026-06-29T12:00:00Z')).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// removeTarget - R2 failures
// ---------------------------------------------------------------------------

describe('AdminSyncTargetRepository - removeTarget R2 failures', () => {
  it('R2 get throws → throws', async () => {
    const { bucket } = makeBucket(null, { throwOnGet: true })
    const repo = new AdminSyncTargetRepository(bucket)
    await expect(repo.removeTarget('album-a', VALID_PUBLISHED_AT)).rejects.toThrow()
  })

  it('R2 put throws → throws', async () => {
    const { bucket } = makeBucket(null, { throwOnPut: true })
    const repo = new AdminSyncTargetRepository(bucket)
    await expect(repo.removeTarget('album-a', VALID_PUBLISHED_AT)).rejects.toThrow()
  })

  it('malformed existing JSON → throws', async () => {
    const { bucket } = makeBucket('}{invalid')
    const repo = new AdminSyncTargetRepository(bucket)
    await expect(repo.removeTarget('album-a', VALID_PUBLISHED_AT)).rejects.toThrow()
  })
})
