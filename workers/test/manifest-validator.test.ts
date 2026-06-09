import { describe, it, expect } from 'vitest'
import { parseManifest, MANIFEST_LIMITS } from '../src/services/manifest-validator.js'

// ---------------------------------------------------------------------------
// Realistic fixture matching current Docker output
// ---------------------------------------------------------------------------

const ALBUM_ID = 'family-trip-2026'
const PHOTO_ID = 'pp-abc001'

// Mirrors the output of Python's build_manifest with a timezone-offset generatedAt
// and takenAt values as produced by datetime.fromisoformat / datetime.isoformat.
const MINIMAL_MANIFEST = JSON.stringify({
  schemaVersion: 1,
  albumId: ALBUM_ID,
  title: '家族旅行 2026',
  source: { type: 'photoprism', albumUid: 'as6g7xxxxxxx' },
  generatedAt: '2026-06-09T09:00:00+00:00',
  images: {
    thumb: { longEdge: 640, format: 'webp', quality: 80 },
    preview: { longEdge: 3840, format: 'jpg', quality: 88 },
    stripExif: true,
  },
  photos: [],
})

const PHOTO_ENTRY = {
  id: PHOTO_ID,
  title: 'Photo pp-abc001',
  thumb: `thumbs/${PHOTO_ID}.webp`,
  preview: `previews/${PHOTO_ID}.jpg`,
  takenAt: '2026-06-01T14:22:00+09:00',
  width: 3840,
  height: 2560,
}

const POPULATED_MANIFEST = JSON.stringify({
  schemaVersion: 1,
  albumId: ALBUM_ID,
  title: '家族旅行 2026',
  source: { type: 'photoprism', albumUid: 'as6g7xxxxxxx' },
  generatedAt: '2026-06-09T09:00:00+00:00',
  images: {
    thumb: { longEdge: 640, format: 'webp', quality: 80 },
    preview: { longEdge: 3840, format: 'jpg', quality: 88 },
    stripExif: true,
  },
  photos: [PHOTO_ENTRY],
})

function withOverride(base: object, ...overrides: object[]): string {
  return JSON.stringify(Object.assign({}, base, ...overrides))
}

function parseMinimal(overrides: object = {}): ReturnType<typeof parseManifest> {
  const obj = JSON.parse(MINIMAL_MANIFEST) as object
  return parseManifest(JSON.stringify({ ...obj, ...overrides }), ALBUM_ID)
}

// ---------------------------------------------------------------------------
// MANIFEST_LIMITS exports
// ---------------------------------------------------------------------------

describe('MANIFEST_LIMITS', () => {
  it('exports MAX_JSON_BYTES as 8 MiB', () => {
    expect(MANIFEST_LIMITS.MAX_JSON_BYTES).toBe(8 * 1024 * 1024)
  })

  it('exports MAX_PHOTOS as 20000', () => {
    expect(MANIFEST_LIMITS.MAX_PHOTOS).toBe(20_000)
  })

  it('exports MAX_TITLE_CODE_POINTS as 1024', () => {
    expect(MANIFEST_LIMITS.MAX_TITLE_CODE_POINTS).toBe(1_024)
  })

  it('exports MAX_DIMENSION as 100000', () => {
    expect(MANIFEST_LIMITS.MAX_DIMENSION).toBe(100_000)
  })

  it('exports MAX_LONG_EDGE as 100000', () => {
    expect(MANIFEST_LIMITS.MAX_LONG_EDGE).toBe(100_000)
  })
})

// ---------------------------------------------------------------------------
// Valid manifest parsing
// ---------------------------------------------------------------------------

describe('parseManifest valid manifests', () => {
  it('parses a minimal valid manifest with empty photos array', () => {
    const result = parseManifest(MINIMAL_MANIFEST, ALBUM_ID)
    expect(result.schemaVersion).toBe(1)
    expect(result.albumId).toBe(ALBUM_ID)
    expect(result.photos).toHaveLength(0)
  })

  it('parses a realistic Docker-compatible manifest with photos and timezone-offset timestamps', () => {
    const result = parseManifest(POPULATED_MANIFEST, ALBUM_ID)
    expect(result.photos).toHaveLength(1)
    expect(result.photos[0]?.id).toBe(PHOTO_ID)
    expect(result.photos[0]?.takenAt).toBe('2026-06-01T14:22:00+09:00')
    expect(result.generatedAt).toBe('2026-06-09T09:00:00+00:00')
  })

  it('accepts generatedAt with Z timezone suffix', () => {
    const result = parseMinimal({ generatedAt: '2026-06-09T09:00:00Z' })
    expect(result.generatedAt).toBe('2026-06-09T09:00:00Z')
  })

  it('accepts generatedAt with fractional seconds and offset', () => {
    const result = parseMinimal({ generatedAt: '2026-06-09T09:00:00.123456+09:00' })
    expect(result.generatedAt).toBe('2026-06-09T09:00:00.123456+09:00')
  })

  it('accepts empty string album title', () => {
    const result = parseMinimal({ title: '' })
    expect(result.title).toBe('')
  })

  it('returns only the declared schema fields at root level', () => {
    const result = parseManifest(MINIMAL_MANIFEST, ALBUM_ID)
    const keys = Object.keys(result).sort()
    expect(keys).toEqual(['albumId', 'generatedAt', 'images', 'photos', 'schemaVersion', 'source', 'title'])
  })

  it('returns only the declared schema fields inside images', () => {
    const result = parseManifest(MINIMAL_MANIFEST, ALBUM_ID)
    const keys = Object.keys(result.images).sort()
    expect(keys).toEqual(['preview', 'stripExif', 'thumb'])
  })

  it('returns only the declared schema fields inside each photo', () => {
    const result = parseManifest(POPULATED_MANIFEST, ALBUM_ID)
    const photo = result.photos[0]
    if (!photo) throw new Error('no photo')
    const keys = Object.keys(photo).sort()
    expect(keys).toEqual(['height', 'id', 'preview', 'takenAt', 'thumb', 'title', 'width'])
  })

  it('returns a new object not derived from the parsed input', () => {
    const result = parseManifest(MINIMAL_MANIFEST, ALBUM_ID)
    expect(result).not.toBe(JSON.parse(MINIMAL_MANIFEST))
  })

  it('images.stripExif is true (literal)', () => {
    const result = parseManifest(MINIMAL_MANIFEST, ALBUM_ID)
    expect(result.images.stripExif).toBe(true)
  })

  it('source.type is photoprism', () => {
    const result = parseManifest(MINIMAL_MANIFEST, ALBUM_ID)
    expect(result.source.type).toBe('photoprism')
  })
})

// ---------------------------------------------------------------------------
// JSON input validation
// ---------------------------------------------------------------------------

describe('parseManifest invalid JSON', () => {
  it('rejects invalid JSON', () => {
    expect(() => parseManifest('{not json}', ALBUM_ID)).toThrowError('invalid manifest')
  })

  it('rejects empty string', () => {
    expect(() => parseManifest('', ALBUM_ID)).toThrowError('invalid manifest')
  })

  it('rejects JSON that exceeds MAX_JSON_BYTES', () => {
    const oversize = 'x'.repeat(MANIFEST_LIMITS.MAX_JSON_BYTES + 1)
    expect(() => parseManifest(oversize, ALBUM_ID)).toThrowError('invalid manifest')
  })

  it('accepts JSON at exactly MAX_JSON_BYTES in byte length', () => {
    const baseBytes = new TextEncoder().encode(MINIMAL_MANIFEST).byteLength
    const json = MINIMAL_MANIFEST + ' '.repeat(MANIFEST_LIMITS.MAX_JSON_BYTES - baseBytes)
    expect(new TextEncoder().encode(json).byteLength).toBe(MANIFEST_LIMITS.MAX_JSON_BYTES)
    expect(parseManifest(json, ALBUM_ID).albumId).toBe(ALBUM_ID)
  })
})

// ---------------------------------------------------------------------------
// Root structure
// ---------------------------------------------------------------------------

describe('parseManifest root structure rejection', () => {
  it('rejects JSON null', () => {
    expect(() => parseManifest('null', ALBUM_ID)).toThrowError('invalid manifest')
  })

  it('rejects JSON array root', () => {
    expect(() => parseManifest('[]', ALBUM_ID)).toThrowError('invalid manifest')
  })

  it('rejects JSON number root', () => {
    expect(() => parseManifest('42', ALBUM_ID)).toThrowError('invalid manifest')
  })

  it('rejects JSON string root', () => {
    expect(() => parseManifest('"hello"', ALBUM_ID)).toThrowError('invalid manifest')
  })

  it('rejects unexpected extra field at root level', () => {
    const json = JSON.stringify({ ...JSON.parse(MINIMAL_MANIFEST) as object, extra: true })
    expect(() => parseManifest(json, ALBUM_ID)).toThrowError('invalid manifest')
  })

  it('rejects missing required root field', () => {
    const obj = JSON.parse(MINIMAL_MANIFEST) as Record<string, unknown>
    delete obj['title']
    expect(() => parseManifest(JSON.stringify(obj), ALBUM_ID)).toThrowError('invalid manifest')
  })
})

// ---------------------------------------------------------------------------
// schemaVersion
// ---------------------------------------------------------------------------

describe('parseManifest schemaVersion validation', () => {
  it('rejects schemaVersion 0', () => {
    expect(() => parseMinimal({ schemaVersion: 0 })).toThrowError('invalid manifest')
  })

  it('rejects schemaVersion 2', () => {
    expect(() => parseMinimal({ schemaVersion: 2 })).toThrowError('invalid manifest')
  })

  it('rejects schemaVersion as string "1"', () => {
    expect(() => parseMinimal({ schemaVersion: '1' })).toThrowError('invalid manifest')
  })

  it('rejects schemaVersion null', () => {
    expect(() => parseMinimal({ schemaVersion: null })).toThrowError('invalid manifest')
  })

  it('rejects missing schemaVersion', () => {
    const obj = JSON.parse(MINIMAL_MANIFEST) as Record<string, unknown>
    delete obj['schemaVersion']
    expect(() => parseManifest(JSON.stringify(obj), ALBUM_ID)).toThrowError('invalid manifest')
  })
})

// ---------------------------------------------------------------------------
// albumId
// ---------------------------------------------------------------------------

describe('parseManifest albumId validation', () => {
  it('rejects albumId that does not match expectedAlbumId', () => {
    expect(() => parseManifest(MINIMAL_MANIFEST, 'different-album')).toThrowError('invalid manifest')
  })

  it('rejects albumId with invalid format', () => {
    expect(() => parseManifest(
      withOverride(JSON.parse(MINIMAL_MANIFEST) as object, { albumId: '!invalid!' }),
      '!invalid!',
    )).toThrowError('invalid manifest')
  })

  it('rejects albumId that is a number', () => {
    expect(() => parseMinimal({ albumId: 1 })).toThrowError('invalid manifest')
  })

  it('rejects missing albumId', () => {
    const obj = JSON.parse(MINIMAL_MANIFEST) as Record<string, unknown>
    delete obj['albumId']
    expect(() => parseManifest(JSON.stringify(obj), ALBUM_ID)).toThrowError('invalid manifest')
  })

  it('rejects an invalid expected album ID', () => {
    expect(() => parseManifest(MINIMAL_MANIFEST, '!invalid!')).toThrowError('invalid manifest')
  })
})

// ---------------------------------------------------------------------------
// title
// ---------------------------------------------------------------------------

describe('parseManifest title validation', () => {
  it('rejects title that is a number', () => {
    expect(() => parseMinimal({ title: 42 })).toThrowError('invalid manifest')
  })

  it('rejects title that is null', () => {
    expect(() => parseMinimal({ title: null })).toThrowError('invalid manifest')
  })

  it('accepts title at exactly MAX_TITLE_CODE_POINTS', () => {
    const title = 'あ'.repeat(MANIFEST_LIMITS.MAX_TITLE_CODE_POINTS)
    const result = parseMinimal({ title })
    expect(result.title).toBe(title)
  })

  it('rejects title exceeding MAX_TITLE_CODE_POINTS', () => {
    const title = 'a'.repeat(MANIFEST_LIMITS.MAX_TITLE_CODE_POINTS + 1)
    expect(() => parseMinimal({ title })).toThrowError('invalid manifest')
  })

  it('accepts empty title', () => {
    const result = parseMinimal({ title: '' })
    expect(result.title).toBe('')
  })
})

// ---------------------------------------------------------------------------
// source
// ---------------------------------------------------------------------------

describe('parseManifest source validation', () => {
  it('rejects source.type other than photoprism', () => {
    expect(() => parseMinimal({ source: { type: 'other', albumUid: 'uid123' } })).toThrowError('invalid manifest')
  })

  it('rejects source.type as number', () => {
    expect(() => parseMinimal({ source: { type: 1, albumUid: 'uid123' } })).toThrowError('invalid manifest')
  })

  it('rejects invalid source.albumUid', () => {
    expect(() => parseMinimal({ source: { type: 'photoprism', albumUid: '!bad!' } })).toThrowError('invalid manifest')
  })

  it('rejects empty source.albumUid', () => {
    expect(() => parseMinimal({ source: { type: 'photoprism', albumUid: '' } })).toThrowError('invalid manifest')
  })

  it('rejects extra field in source', () => {
    expect(() => parseMinimal({ source: { type: 'photoprism', albumUid: 'uid123', extra: true } })).toThrowError('invalid manifest')
  })

  it('rejects missing albumUid in source', () => {
    expect(() => parseMinimal({ source: { type: 'photoprism' } })).toThrowError('invalid manifest')
  })

  it('rejects source as null', () => {
    expect(() => parseMinimal({ source: null })).toThrowError('invalid manifest')
  })

  it('rejects source as array', () => {
    expect(() => parseMinimal({ source: [] })).toThrowError('invalid manifest')
  })
})

// ---------------------------------------------------------------------------
// generatedAt
// ---------------------------------------------------------------------------

describe('parseManifest generatedAt validation', () => {
  it('rejects generatedAt without timezone', () => {
    expect(() => parseMinimal({ generatedAt: '2026-06-09T09:00:00' })).toThrowError('invalid manifest')
  })

  it('rejects date-only generatedAt', () => {
    expect(() => parseMinimal({ generatedAt: '2026-06-09' })).toThrowError('invalid manifest')
  })

  it('rejects generatedAt as number', () => {
    expect(() => parseMinimal({ generatedAt: 1234567890 })).toThrowError('invalid manifest')
  })

  it('rejects generatedAt as null', () => {
    expect(() => parseMinimal({ generatedAt: null })).toThrowError('invalid manifest')
  })

  it('rejects empty string generatedAt', () => {
    expect(() => parseMinimal({ generatedAt: '' })).toThrowError('invalid manifest')
  })

  it('rejects a calendar date that JavaScript would normalize', () => {
    expect(() => parseMinimal({ generatedAt: '2026-02-31T09:00:00+00:00' })).toThrowError('invalid manifest')
  })

  it('rejects hour 24 and invalid timezone offsets', () => {
    expect(() => parseMinimal({ generatedAt: '2026-06-09T24:00:00+00:00' })).toThrowError('invalid manifest')
    expect(() => parseMinimal({ generatedAt: '2026-06-09T09:00:00+24:00' })).toThrowError('invalid manifest')
    expect(() => parseMinimal({ generatedAt: '2026-06-09T09:00:00+09:60' })).toThrowError('invalid manifest')
  })

  it('accepts generatedAt with positive offset', () => {
    const result = parseMinimal({ generatedAt: '2026-06-09T18:00:00+09:00' })
    expect(result.generatedAt).toBe('2026-06-09T18:00:00+09:00')
  })

  it('accepts generatedAt with negative offset', () => {
    const result = parseMinimal({ generatedAt: '2026-06-09T01:00:00-08:00' })
    expect(result.generatedAt).toBe('2026-06-09T01:00:00-08:00')
  })
})

// ---------------------------------------------------------------------------
// images
// ---------------------------------------------------------------------------

describe('parseManifest images.stripExif validation', () => {
  it('rejects stripExif: false', () => {
    expect(() => parseMinimal({
      images: { thumb: { longEdge: 640, format: 'webp', quality: 80 }, preview: { longEdge: 3840, format: 'jpg', quality: 88 }, stripExif: false },
    })).toThrowError('invalid manifest')
  })

  it('rejects stripExif: null', () => {
    expect(() => parseMinimal({
      images: { thumb: { longEdge: 640, format: 'webp', quality: 80 }, preview: { longEdge: 3840, format: 'jpg', quality: 88 }, stripExif: null },
    })).toThrowError('invalid manifest')
  })

  it('rejects extra field in images', () => {
    expect(() => parseMinimal({
      images: { thumb: { longEdge: 640, format: 'webp', quality: 80 }, preview: { longEdge: 3840, format: 'jpg', quality: 88 }, stripExif: true, extra: 1 },
    })).toThrowError('invalid manifest')
  })
})

describe('parseManifest images.thumb validation', () => {
  function makeImages(thumbOverride: object) {
    return {
      images: {
        thumb: { longEdge: 640, format: 'webp', quality: 80, ...thumbOverride },
        preview: { longEdge: 3840, format: 'jpg', quality: 88 },
        stripExif: true,
      },
    }
  }

  it('rejects thumb format "jpg"', () => {
    expect(() => parseMinimal(makeImages({ format: 'jpg' }))).toThrowError('invalid manifest')
  })

  it('rejects thumb format "png"', () => {
    expect(() => parseMinimal(makeImages({ format: 'png' }))).toThrowError('invalid manifest')
  })

  it('rejects thumb longEdge of 0', () => {
    expect(() => parseMinimal(makeImages({ longEdge: 0 }))).toThrowError('invalid manifest')
  })

  it('rejects thumb longEdge that is not an integer', () => {
    expect(() => parseMinimal(makeImages({ longEdge: 640.5 }))).toThrowError('invalid manifest')
  })

  it('accepts thumb longEdge at MAX_LONG_EDGE', () => {
    const result = parseMinimal(makeImages({ longEdge: MANIFEST_LIMITS.MAX_LONG_EDGE }))
    expect(result.images.thumb.longEdge).toBe(MANIFEST_LIMITS.MAX_LONG_EDGE)
  })

  it('rejects thumb longEdge exceeding MAX_LONG_EDGE', () => {
    expect(() => parseMinimal(makeImages({ longEdge: MANIFEST_LIMITS.MAX_LONG_EDGE + 1 }))).toThrowError('invalid manifest')
  })

  it('rejects thumb quality 0', () => {
    expect(() => parseMinimal(makeImages({ quality: 0 }))).toThrowError('invalid manifest')
  })

  it('accepts thumb quality 1 (minimum)', () => {
    const result = parseMinimal(makeImages({ quality: 1 }))
    expect(result.images.thumb.quality).toBe(1)
  })

  it('accepts thumb quality 100 (maximum)', () => {
    const result = parseMinimal(makeImages({ quality: 100 }))
    expect(result.images.thumb.quality).toBe(100)
  })

  it('rejects thumb quality 101', () => {
    expect(() => parseMinimal(makeImages({ quality: 101 }))).toThrowError('invalid manifest')
  })

  it('rejects extra field in thumb', () => {
    expect(() => parseMinimal(makeImages({ extra: true }))).toThrowError('invalid manifest')
  })

  it('rejects thumb as null', () => {
    expect(() => parseMinimal({
      images: { thumb: null, preview: { longEdge: 3840, format: 'jpg', quality: 88 }, stripExif: true },
    })).toThrowError('invalid manifest')
  })
})

describe('parseManifest images.preview validation', () => {
  function makeImages(previewOverride: object) {
    return {
      images: {
        thumb: { longEdge: 640, format: 'webp', quality: 80 },
        preview: { longEdge: 3840, format: 'jpg', quality: 88, ...previewOverride },
        stripExif: true,
      },
    }
  }

  it('rejects preview format "webp"', () => {
    expect(() => parseMinimal(makeImages({ format: 'webp' }))).toThrowError('invalid manifest')
  })

  it('rejects preview format "png"', () => {
    expect(() => parseMinimal(makeImages({ format: 'png' }))).toThrowError('invalid manifest')
  })

  it('rejects preview longEdge of 0', () => {
    expect(() => parseMinimal(makeImages({ longEdge: 0 }))).toThrowError('invalid manifest')
  })

  it('accepts preview longEdge at MAX_LONG_EDGE', () => {
    const result = parseMinimal(makeImages({ longEdge: MANIFEST_LIMITS.MAX_LONG_EDGE }))
    expect(result.images.preview.longEdge).toBe(MANIFEST_LIMITS.MAX_LONG_EDGE)
  })

  it('rejects preview longEdge exceeding MAX_LONG_EDGE', () => {
    expect(() => parseMinimal(makeImages({ longEdge: MANIFEST_LIMITS.MAX_LONG_EDGE + 1 }))).toThrowError('invalid manifest')
  })

  it('rejects preview quality 0', () => {
    expect(() => parseMinimal(makeImages({ quality: 0 }))).toThrowError('invalid manifest')
  })

  it('accepts preview quality 100 (maximum)', () => {
    const result = parseMinimal(makeImages({ quality: 100 }))
    expect(result.images.preview.quality).toBe(100)
  })

  it('rejects preview quality 101', () => {
    expect(() => parseMinimal(makeImages({ quality: 101 }))).toThrowError('invalid manifest')
  })

  it('rejects extra field in preview', () => {
    expect(() => parseMinimal(makeImages({ extra: true }))).toThrowError('invalid manifest')
  })
})

// ---------------------------------------------------------------------------
// photos array
// ---------------------------------------------------------------------------

describe('parseManifest photos array validation', () => {
  it('rejects photos as an object', () => {
    expect(() => parseMinimal({ photos: {} })).toThrowError('invalid manifest')
  })

  it('rejects photos as null', () => {
    expect(() => parseMinimal({ photos: null })).toThrowError('invalid manifest')
  })

  it('rejects photos count exceeding MAX_PHOTOS', () => {
    const photos = Array.from({ length: MANIFEST_LIMITS.MAX_PHOTOS + 1 }, (_, i) => ({
      id: `p${i}`,
      title: '',
      thumb: `thumbs/p${i}.webp`,
      preview: `previews/p${i}.jpg`,
      takenAt: '2026-06-01T00:00:00Z',
      width: 100,
      height: 100,
    }))
    expect(() => parseMinimal({ photos })).toThrowError('invalid manifest')
  })

  it('rejects duplicate photo IDs', () => {
    const photo = { ...PHOTO_ENTRY }
    expect(() => parseMinimal({ photos: [photo, photo] })).toThrowError('invalid manifest')
  })

  it('rejects a photo entry that is null', () => {
    expect(() => parseMinimal({ photos: [null] })).toThrowError('invalid manifest')
  })

  it('rejects a photo entry that is a string', () => {
    expect(() => parseMinimal({ photos: ['not an object'] })).toThrowError('invalid manifest')
  })

  it('rejects extra field in photo entry', () => {
    expect(() => parseMinimal({ photos: [{ ...PHOTO_ENTRY, extra: true }] })).toThrowError('invalid manifest')
  })

  it('rejects missing field in photo entry', () => {
    const noTitle = { id: PHOTO_ENTRY.id, thumb: PHOTO_ENTRY.thumb, preview: PHOTO_ENTRY.preview, takenAt: PHOTO_ENTRY.takenAt, width: PHOTO_ENTRY.width, height: PHOTO_ENTRY.height }
    expect(() => parseMinimal({ photos: [noTitle] })).toThrowError('invalid manifest')
  })
})

// ---------------------------------------------------------------------------
// photo ID validation
// ---------------------------------------------------------------------------

describe('parseManifest photo ID validation', () => {
  it('rejects invalid photo ID with special characters', () => {
    const photo = { ...PHOTO_ENTRY, id: '!bad!', thumb: 'thumbs/!bad!.webp', preview: 'previews/!bad!.jpg' }
    expect(() => parseMinimal({ photos: [photo] })).toThrowError('invalid manifest')
  })

  it('rejects empty photo ID', () => {
    const photo = { ...PHOTO_ENTRY, id: '', thumb: 'thumbs/.webp', preview: 'previews/.jpg' }
    expect(() => parseMinimal({ photos: [photo] })).toThrowError('invalid manifest')
  })

  it('rejects photo ID as number', () => {
    const photo = { ...PHOTO_ENTRY, id: 1 }
    expect(() => parseMinimal({ photos: [photo] })).toThrowError('invalid manifest')
  })
})

// ---------------------------------------------------------------------------
// photo title validation
// ---------------------------------------------------------------------------

describe('parseManifest photo title validation', () => {
  it('rejects photo title as number', () => {
    expect(() => parseMinimal({ photos: [{ ...PHOTO_ENTRY, title: 42 }] })).toThrowError('invalid manifest')
  })

  it('accepts empty photo title', () => {
    const result = parseManifest(
      JSON.stringify({ ...JSON.parse(MINIMAL_MANIFEST) as object, photos: [{ ...PHOTO_ENTRY, title: '' }] }),
      ALBUM_ID,
    )
    expect(result.photos[0]?.title).toBe('')
  })

  it('accepts photo title at exactly MAX_TITLE_CODE_POINTS', () => {
    const title = 'あ'.repeat(MANIFEST_LIMITS.MAX_TITLE_CODE_POINTS)
    const result = parseManifest(
      JSON.stringify({ ...JSON.parse(MINIMAL_MANIFEST) as object, photos: [{ ...PHOTO_ENTRY, title }] }),
      ALBUM_ID,
    )
    expect(result.photos[0]?.title).toBe(title)
  })

  it('rejects photo title exceeding MAX_TITLE_CODE_POINTS', () => {
    const title = 'a'.repeat(MANIFEST_LIMITS.MAX_TITLE_CODE_POINTS + 1)
    expect(() => parseMinimal({ photos: [{ ...PHOTO_ENTRY, title }] })).toThrowError('invalid manifest')
  })
})

// ---------------------------------------------------------------------------
// Photo paths: exact match and unsafe path rejection
// ---------------------------------------------------------------------------

describe('parseManifest photo path validation', () => {
  it('rejects thumb path that does not match photo ID', () => {
    const photo = { ...PHOTO_ENTRY, thumb: `thumbs/other-id.webp` }
    expect(() => parseMinimal({ photos: [photo] })).toThrowError('invalid manifest')
  })

  it('rejects preview path that does not match photo ID', () => {
    const photo = { ...PHOTO_ENTRY, preview: `previews/other-id.jpg` }
    expect(() => parseMinimal({ photos: [photo] })).toThrowError('invalid manifest')
  })

  it('rejects absolute thumb path', () => {
    const photo = { ...PHOTO_ENTRY, thumb: `/thumbs/${PHOTO_ID}.webp` }
    expect(() => parseMinimal({ photos: [photo] })).toThrowError('invalid manifest')
  })

  it('rejects path traversal in thumb', () => {
    const photo = { ...PHOTO_ENTRY, thumb: `../thumbs/${PHOTO_ID}.webp` }
    expect(() => parseMinimal({ photos: [photo] })).toThrowError('invalid manifest')
  })

  it('rejects backslash in thumb path', () => {
    const photo = { ...PHOTO_ENTRY, thumb: `thumbs\\${PHOTO_ID}.webp` }
    expect(() => parseMinimal({ photos: [photo] })).toThrowError('invalid manifest')
  })

  it('rejects URL-like thumb path', () => {
    const photo = { ...PHOTO_ENTRY, thumb: `https://example.com/thumbs/${PHOTO_ID}.webp` }
    expect(() => parseMinimal({ photos: [photo] })).toThrowError('invalid manifest')
  })

  it('rejects thumb path with query string', () => {
    const photo = { ...PHOTO_ENTRY, thumb: `thumbs/${PHOTO_ID}.webp?x=1` }
    expect(() => parseMinimal({ photos: [photo] })).toThrowError('invalid manifest')
  })

  it('rejects thumb path with fragment', () => {
    const photo = { ...PHOTO_ENTRY, thumb: `thumbs/${PHOTO_ID}.webp#x` }
    expect(() => parseMinimal({ photos: [photo] })).toThrowError('invalid manifest')
  })

  it('rejects thumb path with wrong extension', () => {
    const photo = { ...PHOTO_ENTRY, thumb: `thumbs/${PHOTO_ID}.jpg` }
    expect(() => parseMinimal({ photos: [photo] })).toThrowError('invalid manifest')
  })

  it('rejects preview path with wrong extension', () => {
    const photo = { ...PHOTO_ENTRY, preview: `previews/${PHOTO_ID}.webp` }
    expect(() => parseMinimal({ photos: [photo] })).toThrowError('invalid manifest')
  })

  it('rejects thumb path that swaps thumb and preview roles', () => {
    const photo = { ...PHOTO_ENTRY, thumb: `previews/${PHOTO_ID}.jpg` }
    expect(() => parseMinimal({ photos: [photo] })).toThrowError('invalid manifest')
  })

  it('rejects thumb path as number', () => {
    const photo = { ...PHOTO_ENTRY, thumb: 42 }
    expect(() => parseMinimal({ photos: [photo] })).toThrowError('invalid manifest')
  })
})

// ---------------------------------------------------------------------------
// photo takenAt validation
// ---------------------------------------------------------------------------

describe('parseManifest photo takenAt validation', () => {
  it('rejects takenAt without timezone', () => {
    const photo = { ...PHOTO_ENTRY, takenAt: '2026-06-01T10:00:00' }
    expect(() => parseMinimal({ photos: [photo] })).toThrowError('invalid manifest')
  })

  it('rejects takenAt as date only', () => {
    const photo = { ...PHOTO_ENTRY, takenAt: '2026-06-01' }
    expect(() => parseMinimal({ photos: [photo] })).toThrowError('invalid manifest')
  })

  it('rejects takenAt as number', () => {
    const photo = { ...PHOTO_ENTRY, takenAt: 1234567890 }
    expect(() => parseMinimal({ photos: [photo] })).toThrowError('invalid manifest')
  })

  it('rejects a non-existent calendar date', () => {
    const photo = { ...PHOTO_ENTRY, takenAt: '2026-04-31T10:00:00+00:00' }
    expect(() => parseMinimal({ photos: [photo] })).toThrowError('invalid manifest')
  })

  it('accepts takenAt with positive timezone offset', () => {
    const photo = { ...PHOTO_ENTRY, takenAt: '2026-06-01T19:00:00+09:00' }
    const result = parseManifest(
      JSON.stringify({ ...JSON.parse(MINIMAL_MANIFEST) as object, photos: [photo] }),
      ALBUM_ID,
    )
    expect(result.photos[0]?.takenAt).toBe('2026-06-01T19:00:00+09:00')
  })

  it('accepts takenAt with Z timezone', () => {
    const photo = { ...PHOTO_ENTRY, takenAt: '2026-06-01T10:00:00Z' }
    const result = parseManifest(
      JSON.stringify({ ...JSON.parse(MINIMAL_MANIFEST) as object, photos: [photo] }),
      ALBUM_ID,
    )
    expect(result.photos[0]?.takenAt).toBe('2026-06-01T10:00:00Z')
  })
})

// ---------------------------------------------------------------------------
// photo dimensions
// ---------------------------------------------------------------------------

describe('parseManifest photo dimension validation', () => {
  it('rejects width of 0', () => {
    expect(() => parseMinimal({ photos: [{ ...PHOTO_ENTRY, width: 0 }] })).toThrowError('invalid manifest')
  })

  it('rejects width that is not an integer', () => {
    expect(() => parseMinimal({ photos: [{ ...PHOTO_ENTRY, width: 100.5 }] })).toThrowError('invalid manifest')
  })

  it('accepts width at MAX_DIMENSION', () => {
    const result = parseManifest(
      JSON.stringify({ ...JSON.parse(MINIMAL_MANIFEST) as object, photos: [{ ...PHOTO_ENTRY, width: MANIFEST_LIMITS.MAX_DIMENSION }] }),
      ALBUM_ID,
    )
    expect(result.photos[0]?.width).toBe(MANIFEST_LIMITS.MAX_DIMENSION)
  })

  it('rejects width exceeding MAX_DIMENSION', () => {
    expect(() => parseMinimal({ photos: [{ ...PHOTO_ENTRY, width: MANIFEST_LIMITS.MAX_DIMENSION + 1 }] })).toThrowError('invalid manifest')
  })

  it('rejects height of 0', () => {
    expect(() => parseMinimal({ photos: [{ ...PHOTO_ENTRY, height: 0 }] })).toThrowError('invalid manifest')
  })

  it('accepts height at MAX_DIMENSION', () => {
    const result = parseManifest(
      JSON.stringify({ ...JSON.parse(MINIMAL_MANIFEST) as object, photos: [{ ...PHOTO_ENTRY, height: MANIFEST_LIMITS.MAX_DIMENSION }] }),
      ALBUM_ID,
    )
    expect(result.photos[0]?.height).toBe(MANIFEST_LIMITS.MAX_DIMENSION)
  })

  it('rejects height exceeding MAX_DIMENSION', () => {
    expect(() => parseMinimal({ photos: [{ ...PHOTO_ENTRY, height: MANIFEST_LIMITS.MAX_DIMENSION + 1 }] })).toThrowError('invalid manifest')
  })

  it('rejects width as string', () => {
    expect(() => parseMinimal({ photos: [{ ...PHOTO_ENTRY, width: '100' }] })).toThrowError('invalid manifest')
  })

  it('rejects height as string', () => {
    expect(() => parseMinimal({ photos: [{ ...PHOTO_ENTRY, height: '100' }] })).toThrowError('invalid manifest')
  })
})

// ---------------------------------------------------------------------------
// Error message safety
// ---------------------------------------------------------------------------

describe('parseManifest error message safety', () => {
  it('all parse errors throw exactly "invalid manifest"', () => {
    const cases: Array<[string, string]> = [
      ['invalid JSON', '{bad}'],
      ['null root', 'null'],
      ['array root', '[]'],
    ]
    for (const [, json] of cases) {
      expect(() => parseManifest(json, ALBUM_ID)).toThrowError('invalid manifest')
    }
  })

  it('error message does not contain the expected album ID', () => {
    const err = (() => {
      try { parseManifest(MINIMAL_MANIFEST, 'different-album'); return null }
      catch (e) { return e as Error }
    })()
    expect(err?.message).toBe('invalid manifest')
    expect(err?.message).not.toContain('different-album')
    expect(err?.message).not.toContain(ALBUM_ID)
  })

  it('error message does not contain photo ID on path mismatch', () => {
    const photo = { ...PHOTO_ENTRY, thumb: 'thumbs/other.webp' }
    const err = (() => {
      try { parseMinimal({ photos: [photo] }); return null }
      catch (e) { return e as Error }
    })()
    expect(err?.message).toBe('invalid manifest')
    expect(err?.message).not.toContain(PHOTO_ID)
    expect(err?.message).not.toContain('other')
  })

  it('error message does not contain title content on title rejection', () => {
    const title = 'sensitiveTitle_' + 'a'.repeat(MANIFEST_LIMITS.MAX_TITLE_CODE_POINTS + 1)
    const err = (() => {
      try { parseMinimal({ title }); return null }
      catch (e) { return e as Error }
    })()
    expect(err?.message).toBe('invalid manifest')
    expect(err?.message).not.toContain('sensitiveTitle')
  })

  it('error message does not contain albumUid on invalid source', () => {
    const err = (() => {
      try { parseMinimal({ source: { type: 'photoprism', albumUid: '!bad!', secret: 'value' } }); return null }
      catch (e) { return e as Error }
    })()
    expect(err?.message).toBe('invalid manifest')
    expect(err?.message).not.toContain('!bad!')
    expect(err?.message).not.toContain('secret')
  })
})
