import { describe, it, expect } from 'vitest'
import { AdminAlbumCatalogRepository, CATALOG_KEY } from '../src/services/admin-album-catalog-repository.js'

// ---------------------------------------------------------------------------
// R2 fakes
// ---------------------------------------------------------------------------

function makeObject(text: string) {
  return { text: async () => text, size: text.length }
}

function makeBucket(
  existing: string | null,
  opts: { throwOnGet?: boolean } = {},
): R2Bucket {
  return {
    get: async () => {
      if (opts.throwOnGet) throw new Error('R2 get exploded')
      return existing === null ? null : (makeObject(existing) as unknown as R2ObjectBody)
    },
  } as unknown as R2Bucket
}

// ---------------------------------------------------------------------------
// Payload helpers
// ---------------------------------------------------------------------------

const VALID_PUBLISHED_AT = '2026-06-29T12:00:00Z'
const VALID_CATALOG_ID = 'a'.repeat(64)
const VALID_CATALOG_ID_2 = 'b'.repeat(64)

function makeEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    catalogId: VALID_CATALOG_ID,
    title: 'Ise Ryokou',
    photoCount: 42,
    updatedAt: VALID_PUBLISHED_AT,
    ...overrides,
  }
}

function makePayload(
  entries: unknown[] = [],
  overrides: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    schema: 1,
    publishedAt: VALID_PUBLISHED_AT,
    albums: entries,
    ...overrides,
  })
}

// ---------------------------------------------------------------------------
// Fixed key
// ---------------------------------------------------------------------------

describe('AdminAlbumCatalogRepository - fixed key', () => {
  it('CATALOG_KEY is ops/album-catalog.json', () => {
    expect(CATALOG_KEY).toBe('ops/album-catalog.json')
  })

  it('getCatalog reads from ops/album-catalog.json', async () => {
    let capturedKey: string | undefined
    const bucket = {
      get: async (key: string) => { capturedKey = key; return null },
    } as unknown as R2Bucket
    const repo = new AdminAlbumCatalogRepository(bucket)
    await repo.getCatalog()
    expect(capturedKey).toBe(CATALOG_KEY)
  })
})

// ---------------------------------------------------------------------------
// getCatalog - missing object
// ---------------------------------------------------------------------------

describe('AdminAlbumCatalogRepository - getCatalog missing', () => {
  it('missing object → { status: "missing" }', async () => {
    const repo = new AdminAlbumCatalogRepository(makeBucket(null))
    const result = await repo.getCatalog()
    expect(result.status).toBe('missing')
  })
})

// ---------------------------------------------------------------------------
// getCatalog - valid objects
// ---------------------------------------------------------------------------

describe('AdminAlbumCatalogRepository - getCatalog valid', () => {
  it('empty albums array → status available, albums []', async () => {
    const repo = new AdminAlbumCatalogRepository(makeBucket(makePayload([])))
    const result = await repo.getCatalog()
    expect(result.status).toBe('available')
    if (result.status === 'available') {
      expect(result.albums).toEqual([])
    }
  })

  it('valid single entry → status available with entry', async () => {
    const repo = new AdminAlbumCatalogRepository(makeBucket(makePayload([makeEntry()])))
    const result = await repo.getCatalog()
    expect(result.status).toBe('available')
    if (result.status === 'available') {
      expect(result.albums).toHaveLength(1)
      expect(result.albums[0]!.catalogId).toBe(VALID_CATALOG_ID)
      expect(result.albums[0]!.title).toBe('Ise Ryokou')
      expect(result.albums[0]!.photoCount).toBe(42)
      expect(result.albums[0]!.updatedAt).toBe(VALID_PUBLISHED_AT)
    }
  })

  it('publishedAt is returned correctly', async () => {
    const repo = new AdminAlbumCatalogRepository(makeBucket(makePayload([])))
    const result = await repo.getCatalog()
    if (result.status === 'available') {
      expect(result.publishedAt).toBe(VALID_PUBLISHED_AT)
    }
  })

  it('photoCount null accepted', async () => {
    const repo = new AdminAlbumCatalogRepository(makeBucket(makePayload([makeEntry({ photoCount: null })])))
    const result = await repo.getCatalog()
    if (result.status === 'available') {
      expect(result.albums[0]!.photoCount).toBeNull()
    }
  })

  it('updatedAt null accepted', async () => {
    const repo = new AdminAlbumCatalogRepository(makeBucket(makePayload([makeEntry({ updatedAt: null })])))
    const result = await repo.getCatalog()
    if (result.status === 'available') {
      expect(result.albums[0]!.updatedAt).toBeNull()
    }
  })

  it('result does not include raw UID or photoprism fields', async () => {
    const repo = new AdminAlbumCatalogRepository(makeBucket(makePayload([makeEntry()])))
    const result = await repo.getCatalog()
    const str = JSON.stringify(result)
    expect(str).not.toContain('uid')
    expect(str).not.toContain('photoprism')
  })

  it('two entries → both returned', async () => {
    const repo = new AdminAlbumCatalogRepository(makeBucket(makePayload([
      makeEntry({ catalogId: VALID_CATALOG_ID }),
      makeEntry({ catalogId: VALID_CATALOG_ID_2, title: 'Kyoto' }),
    ])))
    const result = await repo.getCatalog()
    if (result.status === 'available') {
      expect(result.albums).toHaveLength(2)
    }
  })
})

// ---------------------------------------------------------------------------
// getCatalog - R2 errors
// ---------------------------------------------------------------------------

describe('AdminAlbumCatalogRepository - getCatalog R2 errors', () => {
  it('R2 get throws → throws', async () => {
    const repo = new AdminAlbumCatalogRepository(makeBucket(null, { throwOnGet: true }))
    await expect(repo.getCatalog()).rejects.toThrow()
  })

  it('oversized object → throws', async () => {
    const repo = new AdminAlbumCatalogRepository(makeBucket('x'.repeat(256 * 1024 + 1)))
    await expect(repo.getCatalog()).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// getCatalog - parse failures
// ---------------------------------------------------------------------------

describe('AdminAlbumCatalogRepository - getCatalog parse failures', () => {
  it('malformed JSON → throws', async () => {
    const repo = new AdminAlbumCatalogRepository(makeBucket('not json'))
    await expect(repo.getCatalog()).rejects.toThrow()
  })

  it('JSON array at root → throws', async () => {
    const repo = new AdminAlbumCatalogRepository(makeBucket('[]'))
    await expect(repo.getCatalog()).rejects.toThrow()
  })

  it('schema !== 1 → throws', async () => {
    const repo = new AdminAlbumCatalogRepository(makeBucket(makePayload([], { schema: 2 })))
    await expect(repo.getCatalog()).rejects.toThrow()
  })

  it('schema: true (boolean) → throws', async () => {
    const repo = new AdminAlbumCatalogRepository(makeBucket(makePayload([], { schema: true })))
    await expect(repo.getCatalog()).rejects.toThrow()
  })

  it('extra root key → throws', async () => {
    const repo = new AdminAlbumCatalogRepository(makeBucket(JSON.stringify({
      schema: 1, publishedAt: VALID_PUBLISHED_AT, albums: [], extra: true,
    })))
    await expect(repo.getCatalog()).rejects.toThrow()
  })

  it('publishedAt with milliseconds (Worker format) → throws', async () => {
    const repo = new AdminAlbumCatalogRepository(makeBucket(makePayload([], { publishedAt: '2026-06-29T12:00:00.000Z' })))
    await expect(repo.getCatalog()).rejects.toThrow()
  })

  it('publishedAt not a string → throws', async () => {
    const repo = new AdminAlbumCatalogRepository(makeBucket(makePayload([], { publishedAt: 12345 })))
    await expect(repo.getCatalog()).rejects.toThrow()
  })

  it('albums not an array → throws', async () => {
    const repo = new AdminAlbumCatalogRepository(makeBucket(makePayload([], { albums: {} })))
    await expect(repo.getCatalog()).rejects.toThrow()
  })

  it('too many albums (> 1000) → throws', async () => {
    const entries = Array.from({ length: 1001 }, (_, i) => makeEntry({ catalogId: hex64(i), title: `A${i}` }))
    const repo = new AdminAlbumCatalogRepository(makeBucket(makePayload(entries)))
    await expect(repo.getCatalog()).rejects.toThrow()
  })

  it('duplicate catalogId → throws', async () => {
    const repo = new AdminAlbumCatalogRepository(makeBucket(makePayload([
      makeEntry({ catalogId: VALID_CATALOG_ID }),
      makeEntry({ catalogId: VALID_CATALOG_ID, title: 'Second' }),
    ])))
    await expect(repo.getCatalog()).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// getCatalog - entry-level validation
// ---------------------------------------------------------------------------

describe('AdminAlbumCatalogRepository - getCatalog entry validation', () => {
  it('entry not an object → throws', async () => {
    const repo = new AdminAlbumCatalogRepository(makeBucket(makePayload(['not an object'])))
    await expect(repo.getCatalog()).rejects.toThrow()
  })

  it('entry extra key → throws', async () => {
    const repo = new AdminAlbumCatalogRepository(makeBucket(makePayload([{ ...makeEntry(), extra: true }])))
    await expect(repo.getCatalog()).rejects.toThrow()
  })

  it('entry missing key → throws', async () => {
    const missing = { title: 'Ise Ryokou', photoCount: 42, updatedAt: VALID_PUBLISHED_AT }
    const repo = new AdminAlbumCatalogRepository(makeBucket(makePayload([missing])))
    await expect(repo.getCatalog()).rejects.toThrow()
  })

  it('catalogId too short → throws', async () => {
    const repo = new AdminAlbumCatalogRepository(makeBucket(makePayload([makeEntry({ catalogId: 'tooshort' })])))
    await expect(repo.getCatalog()).rejects.toThrow()
  })

  it('catalogId uppercase → throws', async () => {
    const repo = new AdminAlbumCatalogRepository(makeBucket(makePayload([makeEntry({ catalogId: 'A'.repeat(64) })])))
    await expect(repo.getCatalog()).rejects.toThrow()
  })

  it('title empty → throws', async () => {
    const repo = new AdminAlbumCatalogRepository(makeBucket(makePayload([makeEntry({ title: '' })])))
    await expect(repo.getCatalog()).rejects.toThrow()
  })

  it('title with leading space → throws', async () => {
    const repo = new AdminAlbumCatalogRepository(makeBucket(makePayload([makeEntry({ title: ' bad' })])))
    await expect(repo.getCatalog()).rejects.toThrow()
  })

  it('title with control char → throws', async () => {
    const repo = new AdminAlbumCatalogRepository(makeBucket(makePayload([makeEntry({ title: 'bad\x01' })])))
    await expect(repo.getCatalog()).rejects.toThrow()
  })

  it('photoCount negative → throws', async () => {
    const repo = new AdminAlbumCatalogRepository(makeBucket(makePayload([makeEntry({ photoCount: -1 })])))
    await expect(repo.getCatalog()).rejects.toThrow()
  })

  it('photoCount boolean (true) → throws', async () => {
    const repo = new AdminAlbumCatalogRepository(makeBucket(makePayload([makeEntry({ photoCount: true })])))
    await expect(repo.getCatalog()).rejects.toThrow()
  })

  it('photoCount string → throws', async () => {
    const repo = new AdminAlbumCatalogRepository(makeBucket(makePayload([makeEntry({ photoCount: '42' })])))
    await expect(repo.getCatalog()).rejects.toThrow()
  })

  it('updatedAt with milliseconds → throws', async () => {
    const repo = new AdminAlbumCatalogRepository(makeBucket(makePayload([makeEntry({ updatedAt: '2026-06-29T12:00:00.000Z' })])))
    await expect(repo.getCatalog()).rejects.toThrow()
  })

  it('updatedAt not a date string → throws', async () => {
    const repo = new AdminAlbumCatalogRepository(makeBucket(makePayload([makeEntry({ updatedAt: 'not-a-date' })])))
    await expect(repo.getCatalog()).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// hasCatalogId
// ---------------------------------------------------------------------------

describe('AdminAlbumCatalogRepository - hasCatalogId', () => {
  it('catalog missing → throws', async () => {
    const repo = new AdminAlbumCatalogRepository(makeBucket(null))
    await expect(repo.hasCatalogId(VALID_CATALOG_ID)).rejects.toThrow()
  })

  it('catalogId present in catalog → true', async () => {
    const repo = new AdminAlbumCatalogRepository(makeBucket(makePayload([makeEntry()])))
    const result = await repo.hasCatalogId(VALID_CATALOG_ID)
    expect(result).toBe(true)
  })

  it('catalogId absent from valid catalog → false', async () => {
    const repo = new AdminAlbumCatalogRepository(makeBucket(makePayload([makeEntry()])))
    const result = await repo.hasCatalogId(VALID_CATALOG_ID_2)
    expect(result).toBe(false)
  })

  it('empty catalog → false', async () => {
    const repo = new AdminAlbumCatalogRepository(makeBucket(makePayload([])))
    const result = await repo.hasCatalogId(VALID_CATALOG_ID)
    expect(result).toBe(false)
  })

  it('malformed catalog → throws', async () => {
    const repo = new AdminAlbumCatalogRepository(makeBucket('not json'))
    await expect(repo.hasCatalogId(VALID_CATALOG_ID)).rejects.toThrow()
  })

  it('R2 throws → throws', async () => {
    const repo = new AdminAlbumCatalogRepository(makeBucket(null, { throwOnGet: true }))
    await expect(repo.hasCatalogId(VALID_CATALOG_ID)).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hex64(n: number): string {
  return n.toString(16).padStart(64, '0')
}
