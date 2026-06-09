import { describe, it, expect } from 'vitest'
import {
  albumManifestKey,
  albumCoverKey,
  photoThumbKey,
  photoPreviewKey,
} from '../src/services/r2-object-key.js'

const ALBUM_ID = 'family-trip-2026'
const PHOTO_ID = 'pp-abc001'

describe('albumManifestKey', () => {
  it('returns the standard manifest path', () => {
    expect(albumManifestKey(ALBUM_ID)).toBe(`albums/${ALBUM_ID}/manifest.json`)
  })

  it('produces path with no leading slash', () => {
    expect(albumManifestKey(ALBUM_ID)).not.toMatch(/^\//)
  })

  it('produces path with no backslash', () => {
    expect(albumManifestKey(ALBUM_ID)).not.toContain('\\')
  })

  it('throws for an empty album ID', () => {
    expect(() => albumManifestKey('')).toThrow()
  })

  it('throws for an invalid album ID with special characters', () => {
    expect(() => albumManifestKey('!bad!')).toThrow()
  })

  it('throws for an album ID starting with underscore', () => {
    expect(() => albumManifestKey('_abc')).toThrow()
  })

  it('throws for an album ID with slash', () => {
    expect(() => albumManifestKey('a/b')).toThrow()
  })

  it('error message does not echo the rejected album ID', () => {
    const invalidId = 'do-not-echo-me!!'
    expect(() => albumManifestKey(invalidId)).toThrowError(/^invalid album ID$/)
  })
})

describe('albumCoverKey', () => {
  it('returns the standard cover path', () => {
    expect(albumCoverKey(ALBUM_ID)).toBe(`albums/${ALBUM_ID}/cover.webp`)
  })

  it('produces path with no leading slash', () => {
    expect(albumCoverKey(ALBUM_ID)).not.toMatch(/^\//)
  })

  it('throws for an empty album ID', () => {
    expect(() => albumCoverKey('')).toThrow()
  })

  it('throws for an invalid album ID', () => {
    expect(() => albumCoverKey('!bad!')).toThrow()
  })

  it('error message does not echo the rejected album ID', () => {
    const invalidId = 'do-not-echo-me!!'
    expect(() => albumCoverKey(invalidId)).toThrowError(/^invalid album ID$/)
  })
})

describe('photoThumbKey', () => {
  it('returns the standard thumb path', () => {
    expect(photoThumbKey(ALBUM_ID, PHOTO_ID)).toBe(
      `albums/${ALBUM_ID}/thumbs/${PHOTO_ID}.webp`,
    )
  })

  it('produces path with no leading slash', () => {
    expect(photoThumbKey(ALBUM_ID, PHOTO_ID)).not.toMatch(/^\//)
  })

  it('produces path with no backslash', () => {
    expect(photoThumbKey(ALBUM_ID, PHOTO_ID)).not.toContain('\\')
  })

  it('throws for an empty album ID', () => {
    expect(() => photoThumbKey('', PHOTO_ID)).toThrow()
  })

  it('throws for an invalid album ID', () => {
    expect(() => photoThumbKey('!bad!', PHOTO_ID)).toThrow()
  })

  it('throws for an empty photo ID', () => {
    expect(() => photoThumbKey(ALBUM_ID, '')).toThrow()
  })

  it('throws for an invalid photo ID', () => {
    expect(() => photoThumbKey(ALBUM_ID, '!bad!')).toThrow()
  })

  it('throws for a photo ID with path traversal', () => {
    expect(() => photoThumbKey(ALBUM_ID, '../escape')).toThrow()
  })

  it('throws for a photo ID with slash', () => {
    expect(() => photoThumbKey(ALBUM_ID, 'a/b')).toThrow()
  })

  it('album ID error message does not echo the rejected value', () => {
    const invalidId = 'do-not-echo-me!!'
    expect(() => photoThumbKey(invalidId, PHOTO_ID)).toThrowError(/^invalid album ID$/)
  })

  it('photo ID error message does not echo the rejected value', () => {
    const invalidId = 'do-not-echo-me!!'
    expect(() => photoThumbKey(ALBUM_ID, invalidId)).toThrowError(/^invalid photo ID$/)
  })
})

describe('photoPreviewKey', () => {
  it('returns the standard preview path', () => {
    expect(photoPreviewKey(ALBUM_ID, PHOTO_ID)).toBe(
      `albums/${ALBUM_ID}/previews/${PHOTO_ID}.jpg`,
    )
  })

  it('produces path with no leading slash', () => {
    expect(photoPreviewKey(ALBUM_ID, PHOTO_ID)).not.toMatch(/^\//)
  })

  it('produces path with no backslash', () => {
    expect(photoPreviewKey(ALBUM_ID, PHOTO_ID)).not.toContain('\\')
  })

  it('throws for an empty album ID', () => {
    expect(() => photoPreviewKey('', PHOTO_ID)).toThrow()
  })

  it('throws for an invalid album ID', () => {
    expect(() => photoPreviewKey('!bad!', PHOTO_ID)).toThrow()
  })

  it('throws for an empty photo ID', () => {
    expect(() => photoPreviewKey(ALBUM_ID, '')).toThrow()
  })

  it('throws for an invalid photo ID', () => {
    expect(() => photoPreviewKey(ALBUM_ID, '!bad!')).toThrow()
  })

  it('album ID error message does not echo the rejected value', () => {
    const invalidId = 'do-not-echo-me!!'
    expect(() => photoPreviewKey(invalidId, PHOTO_ID)).toThrowError(/^invalid album ID$/)
  })

  it('photo ID error message does not echo the rejected value', () => {
    const invalidId = 'do-not-echo-me!!'
    expect(() => photoPreviewKey(ALBUM_ID, invalidId)).toThrowError(/^invalid photo ID$/)
  })
})
