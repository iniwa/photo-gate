import { describe, it, expect } from 'vitest'
import type { PrivateObjectBody, PrivateObjectReader } from '../src/types/private-object.js'
import {
  loadAlbumManifest,
  loadAlbumCover,
  loadPhotoThumb,
  loadPhotoPreview,
  ObjectServiceError,
} from '../src/services/private-album-object-service.js'
import {
  albumManifestKey,
  albumCoverKey,
  photoThumbKey,
  photoPreviewKey,
} from '../src/services/r2-object-key.js'

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const ALBUM_ID = 'album-1'
const PHOTO_ID = 'photo-1'

const VALID_MANIFEST_JSON = JSON.stringify({
  schemaVersion: 1,
  albumId: ALBUM_ID,
  title: 'Test Album',
  source: { type: 'photoprism', albumUid: 'uid001' },
  generatedAt: '2026-06-09T10:00:00Z',
  images: {
    thumb: { longEdge: 400, format: 'webp', quality: 85 },
    preview: { longEdge: 1600, format: 'jpg', quality: 90 },
    stripExif: true,
  },
  photos: [],
})

const VALID_MANIFEST_WITH_PHOTO_JSON = JSON.stringify({
  schemaVersion: 1,
  albumId: ALBUM_ID,
  title: 'Test Album',
  source: { type: 'photoprism', albumUid: 'uid001' },
  generatedAt: '2026-06-09T10:00:00Z',
  images: {
    thumb: { longEdge: 400, format: 'webp', quality: 85 },
    preview: { longEdge: 1600, format: 'jpg', quality: 90 },
    stripExif: true,
  },
  photos: [
    {
      id: PHOTO_ID,
      title: 'Test Photo',
      thumb: `thumbs/${PHOTO_ID}.webp`,
      preview: `previews/${PHOTO_ID}.jpg`,
      takenAt: '2026-05-01T12:00:00+09:00',
      width: 3000,
      height: 2000,
    },
  ],
})

function makeStream(content = 'image-bytes'): ReadableStream {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(content))
      controller.close()
    },
  })
}

function makeBody(text = '', stream: ReadableStream | null = null): PrivateObjectBody {
  return {
    body: stream ?? makeStream(),
    text: async () => text,
  }
}

function makeManifestBody(json = VALID_MANIFEST_JSON): PrivateObjectBody {
  return { body: null, text: async () => json }
}

function readerFor(obj: PrivateObjectBody | null): PrivateObjectReader {
  return { get: async () => obj }
}

function failingReader(error = new Error('storage error')): PrivateObjectReader {
  return {
    get: async () => {
      throw error
    },
  }
}

// ---------------------------------------------------------------------------
// loadAlbumManifest
// ---------------------------------------------------------------------------

describe('loadAlbumManifest', () => {
  describe('key construction', () => {
    it('calls reader with the exact key from albumManifestKey', async () => {
      const expectedKey = albumManifestKey(ALBUM_ID)
      let calledWithKey: string | undefined
      const reader: PrivateObjectReader = {
        get: async (k) => {
          calledWithKey = k
          return null
        },
      }
      await loadAlbumManifest(reader, ALBUM_ID)
      expect(calledWithKey).toBe(expectedKey)
    })

    it('throws ObjectServiceError(reader_failure) for an invalid album ID', async () => {
      const reader = readerFor(null)
      await expect(loadAlbumManifest(reader, '!bad!')).rejects.toBeInstanceOf(ObjectServiceError)
      await expect(loadAlbumManifest(reader, '!bad!')).rejects.toSatisfy(
        (e: unknown) => e instanceof ObjectServiceError && e.code === 'reader_failure',
      )
    })

    it('throws ObjectServiceError(reader_failure) for an empty album ID', async () => {
      const reader = readerFor(null)
      await expect(loadAlbumManifest(reader, '')).rejects.toSatisfy(
        (e: unknown) => e instanceof ObjectServiceError && e.code === 'reader_failure',
      )
    })
  })

  describe('reader behavior', () => {
    it('calls reader exactly once', async () => {
      let callCount = 0
      const reader: PrivateObjectReader = {
        get: async () => {
          callCount++
          return null
        },
      }
      await loadAlbumManifest(reader, ALBUM_ID)
      expect(callCount).toBe(1)
    })

    it('returns not_found without throwing when reader returns null', async () => {
      const result = await loadAlbumManifest(readerFor(null), ALBUM_ID)
      expect(result.status).toBe('not_found')
    })

    it('does not call text() when reader returns null', async () => {
      let textCalled = false
      const body: PrivateObjectBody = {
        body: null,
        text: async () => {
          textCalled = true
          return VALID_MANIFEST_JSON
        },
      }
      // Reader returns null, not body
      const reader: PrivateObjectReader = { get: async () => null }
      const result = await loadAlbumManifest(reader, ALBUM_ID)
      expect(result.status).toBe('not_found')
      expect(textCalled).toBe(false)
      void body // silence unused warning
    })

    it('calls text() exactly once when object is found', async () => {
      let textCallCount = 0
      const body: PrivateObjectBody = {
        body: null,
        text: async () => {
          textCallCount++
          return VALID_MANIFEST_JSON
        },
      }
      await loadAlbumManifest(readerFor(body), ALBUM_ID)
      expect(textCallCount).toBe(1)
    })

    it('throws ObjectServiceError(reader_failure) when reader rejects', async () => {
      await expect(loadAlbumManifest(failingReader(), ALBUM_ID)).rejects.toSatisfy(
        (e: unknown) => e instanceof ObjectServiceError && e.code === 'reader_failure',
      )
    })

    it('throws ObjectServiceError(reader_failure) when text() rejects', async () => {
      const body: PrivateObjectBody = {
        body: null,
        text: async () => {
          throw new Error('network error')
        },
      }
      await expect(loadAlbumManifest(readerFor(body), ALBUM_ID)).rejects.toSatisfy(
        (e: unknown) => e instanceof ObjectServiceError && e.code === 'reader_failure',
      )
    })
  })

  describe('manifest parsing', () => {
    it('returns the validated manifest for a valid Docker-compatible JSON', async () => {
      const result = await loadAlbumManifest(readerFor(makeManifestBody()), ALBUM_ID)
      expect(result.status).toBe('found')
      if (result.status !== 'found') throw new Error('expected found')
      expect(result.value.albumId).toBe(ALBUM_ID)
      expect(result.value.schemaVersion).toBe(1)
    })

    it('returns a manifest with the correct photo when JSON includes a photo', async () => {
      const result = await loadAlbumManifest(
        readerFor(makeManifestBody(VALID_MANIFEST_WITH_PHOTO_JSON)),
        ALBUM_ID,
      )
      if (result.status !== 'found') throw new Error('expected found')
      expect(result.value.photos).toHaveLength(1)
      expect(result.value.photos[0]?.id).toBe(PHOTO_ID)
    })

    it('throws ObjectServiceError(manifest_invalid) for malformed JSON', async () => {
      const body = makeManifestBody('{ not valid json')
      await expect(loadAlbumManifest(readerFor(body), ALBUM_ID)).rejects.toSatisfy(
        (e: unknown) => e instanceof ObjectServiceError && e.code === 'manifest_invalid',
      )
    })

    it('throws ObjectServiceError(manifest_invalid) for a wrong-album manifest', async () => {
      const wrongAlbumJson = JSON.stringify({
        schemaVersion: 1,
        albumId: 'other-album',
        title: 'Other Album',
        source: { type: 'photoprism', albumUid: 'uid999' },
        generatedAt: '2026-06-09T10:00:00Z',
        images: {
          thumb: { longEdge: 400, format: 'webp', quality: 85 },
          preview: { longEdge: 1600, format: 'jpg', quality: 90 },
          stripExif: true,
        },
        photos: [],
      })
      const body = makeManifestBody(wrongAlbumJson)
      await expect(loadAlbumManifest(readerFor(body), ALBUM_ID)).rejects.toSatisfy(
        (e: unknown) => e instanceof ObjectServiceError && e.code === 'manifest_invalid',
      )
    })

    it('throws ObjectServiceError(manifest_invalid) for unsupported schemaVersion', async () => {
      const badVersionJson = JSON.stringify({
        schemaVersion: 2,
        albumId: ALBUM_ID,
        title: 'Test',
        source: { type: 'photoprism', albumUid: 'uid001' },
        generatedAt: '2026-06-09T10:00:00Z',
        images: {
          thumb: { longEdge: 400, format: 'webp', quality: 85 },
          preview: { longEdge: 1600, format: 'jpg', quality: 90 },
          stripExif: true,
        },
        photos: [],
      })
      const body = makeManifestBody(badVersionJson)
      await expect(loadAlbumManifest(readerFor(body), ALBUM_ID)).rejects.toSatisfy(
        (e: unknown) => e instanceof ObjectServiceError && e.code === 'manifest_invalid',
      )
    })

    it('throws ObjectServiceError(manifest_invalid) for a manifest with unexpected fields', async () => {
      const extraFieldJson = JSON.stringify({
        schemaVersion: 1,
        albumId: ALBUM_ID,
        title: 'Test',
        source: { type: 'photoprism', albumUid: 'uid001' },
        generatedAt: '2026-06-09T10:00:00Z',
        images: {
          thumb: { longEdge: 400, format: 'webp', quality: 85 },
          preview: { longEdge: 1600, format: 'jpg', quality: 90 },
          stripExif: true,
        },
        photos: [],
        unexpectedField: 'should-fail',
      })
      const body = makeManifestBody(extraFieldJson)
      await expect(loadAlbumManifest(readerFor(body), ALBUM_ID)).rejects.toSatisfy(
        (e: unknown) => e instanceof ObjectServiceError && e.code === 'manifest_invalid',
      )
    })
  })

  describe('error safety', () => {
    it('error message does not contain the album ID', async () => {
      const sensitiveId = 'private-album-do-not-leak'
      const body = makeManifestBody('not json')
      await expect(loadAlbumManifest(readerFor(body), sensitiveId)).rejects.toSatisfy(
        (e: unknown) =>
          e instanceof ObjectServiceError && !e.message.includes(sensitiveId),
      )
    })

    it('reader_failure message does not contain underlying error text', async () => {
      const underlyingMsg = 'bucket-credentials-expired-secret-info'
      const reader: PrivateObjectReader = {
        get: async () => {
          throw new Error(underlyingMsg)
        },
      }
      await expect(loadAlbumManifest(reader, ALBUM_ID)).rejects.toSatisfy(
        (e: unknown) =>
          e instanceof ObjectServiceError && !e.message.includes(underlyingMsg),
      )
    })

    it('reader_failure message does not contain the R2 key', async () => {
      const expectedKey = albumManifestKey(ALBUM_ID)
      await expect(loadAlbumManifest(failingReader(), ALBUM_ID)).rejects.toSatisfy(
        (e: unknown) =>
          e instanceof ObjectServiceError && !e.message.includes(expectedKey),
      )
    })

    it('ObjectServiceError is an instance of Error', async () => {
      await expect(loadAlbumManifest(failingReader(), ALBUM_ID)).rejects.toBeInstanceOf(Error)
    })
  })
})

// ---------------------------------------------------------------------------
// loadAlbumCover
// ---------------------------------------------------------------------------

describe('loadAlbumCover', () => {
  it('calls reader with the exact key from albumCoverKey', async () => {
    const expectedKey = albumCoverKey(ALBUM_ID)
    let calledWithKey: string | undefined
    const reader: PrivateObjectReader = {
      get: async (k) => {
        calledWithKey = k
        return null
      },
    }
    await loadAlbumCover(reader, ALBUM_ID)
    expect(calledWithKey).toBe(expectedKey)
  })

  it('calls reader exactly once', async () => {
    let callCount = 0
    const reader: PrivateObjectReader = {
      get: async () => {
        callCount++
        return null
      },
    }
    await loadAlbumCover(reader, ALBUM_ID)
    expect(callCount).toBe(1)
  })

  it('returns not_found without throwing when reader returns null', async () => {
    const result = await loadAlbumCover(readerFor(null), ALBUM_ID)
    expect(result.status).toBe('not_found')
  })

  it('returns found with the exact ReadableStream reference from body', async () => {
    const stream = makeStream()
    const fakeBody: PrivateObjectBody = { body: stream, text: async () => '' }
    const result = await loadAlbumCover(readerFor(fakeBody), ALBUM_ID)
    if (result.status !== 'found') throw new Error('expected found')
    expect(result.value).toBe(stream)
  })

  it('does not call text() on the image object', async () => {
    let textCalled = false
    const fakeBody: PrivateObjectBody = {
      body: makeStream(),
      text: async () => {
        textCalled = true
        return ''
      },
    }
    await loadAlbumCover(readerFor(fakeBody), ALBUM_ID)
    expect(textCalled).toBe(false)
  })

  it('discards stored metadata and returns only the body', async () => {
    const stream = makeStream()
    const fakeWithMeta = Object.assign(
      { body: stream, text: async () => '' } satisfies PrivateObjectBody,
      {
        etag: 'etag-should-be-discarded',
        contentType: 'application/octet-stream',
        httpMetadata: { contentType: 'image/webp' },
        customMetadata: { albumId: 'private' },
        size: 99999,
        key: albumCoverKey(ALBUM_ID),
      },
    )
    const result = await loadAlbumCover(readerFor(fakeWithMeta), ALBUM_ID)
    if (result.status !== 'found') throw new Error('expected found')
    expect(result.value).toBe(stream)
    expect('etag' in result).toBe(false)
    expect('key' in result).toBe(false)
    expect('size' in result).toBe(false)
  })

  it('rejects a null image body as a sanitized reader failure', async () => {
    const fakeBody: PrivateObjectBody = { body: null, text: async () => '' }
    await expect(loadAlbumCover(readerFor(fakeBody), ALBUM_ID)).rejects.toSatisfy(
      (e: unknown) => e instanceof ObjectServiceError && e.code === 'reader_failure',
    )
  })

  it('rejects a malformed image body as a sanitized reader failure', async () => {
    const malformed = { body: 'not-a-stream', text: async () => '' } as unknown as PrivateObjectBody
    await expect(loadAlbumCover(readerFor(malformed), ALBUM_ID)).rejects.toSatisfy(
      (e: unknown) => e instanceof ObjectServiceError && e.code === 'reader_failure',
    )
  })

  it('throws ObjectServiceError(reader_failure) when reader rejects', async () => {
    await expect(loadAlbumCover(failingReader(), ALBUM_ID)).rejects.toSatisfy(
      (e: unknown) => e instanceof ObjectServiceError && e.code === 'reader_failure',
    )
  })

  it('rejects a null thumbnail body', async () => {
    const fakeBody: PrivateObjectBody = { body: null, text: async () => '' }
    await expect(loadPhotoThumb(readerFor(fakeBody), ALBUM_ID, PHOTO_ID)).rejects.toSatisfy(
      (e: unknown) => e instanceof ObjectServiceError && e.code === 'reader_failure',
    )
  })

  it('throws ObjectServiceError(reader_failure) for an invalid album ID', async () => {
    await expect(loadAlbumCover(readerFor(null), '!bad!')).rejects.toSatisfy(
      (e: unknown) => e instanceof ObjectServiceError && e.code === 'reader_failure',
    )
  })

  it('error message does not contain the album ID', async () => {
    const sensitiveId = 'private-album-do-not-leak'
    await expect(loadAlbumCover(failingReader(), sensitiveId)).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof ObjectServiceError && !e.message.includes(sensitiveId),
    )
  })

  it('error message does not contain underlying error text', async () => {
    const underlyingMsg = 'bucket-credentials-secret'
    const reader: PrivateObjectReader = {
      get: async () => {
        throw new Error(underlyingMsg)
      },
    }
    await expect(loadAlbumCover(reader, ALBUM_ID)).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof ObjectServiceError && !e.message.includes(underlyingMsg),
    )
  })
})

// ---------------------------------------------------------------------------
// loadPhotoThumb
// ---------------------------------------------------------------------------

describe('loadPhotoThumb', () => {
  it('calls reader with the exact key from photoThumbKey', async () => {
    const expectedKey = photoThumbKey(ALBUM_ID, PHOTO_ID)
    let calledWithKey: string | undefined
    const reader: PrivateObjectReader = {
      get: async (k) => {
        calledWithKey = k
        return null
      },
    }
    await loadPhotoThumb(reader, ALBUM_ID, PHOTO_ID)
    expect(calledWithKey).toBe(expectedKey)
  })

  it('calls reader exactly once', async () => {
    let callCount = 0
    const reader: PrivateObjectReader = {
      get: async () => {
        callCount++
        return null
      },
    }
    await loadPhotoThumb(reader, ALBUM_ID, PHOTO_ID)
    expect(callCount).toBe(1)
  })

  it('returns not_found without throwing when reader returns null', async () => {
    const result = await loadPhotoThumb(readerFor(null), ALBUM_ID, PHOTO_ID)
    expect(result.status).toBe('not_found')
  })

  it('returns the exact ReadableStream reference', async () => {
    const stream = makeStream()
    const fakeBody: PrivateObjectBody = { body: stream, text: async () => '' }
    const result = await loadPhotoThumb(readerFor(fakeBody), ALBUM_ID, PHOTO_ID)
    if (result.status !== 'found') throw new Error('expected found')
    expect(result.value).toBe(stream)
  })

  it('does not call text() on the image object', async () => {
    let textCalled = false
    const fakeBody: PrivateObjectBody = {
      body: makeStream(),
      text: async () => {
        textCalled = true
        return ''
      },
    }
    await loadPhotoThumb(readerFor(fakeBody), ALBUM_ID, PHOTO_ID)
    expect(textCalled).toBe(false)
  })

  it('discards stored metadata and returns only the body', async () => {
    const stream = makeStream()
    const fakeWithMeta = Object.assign(
      { body: stream, text: async () => '' } satisfies PrivateObjectBody,
      { etag: 'etag-discard', contentType: 'image/webp', size: 1234 },
    )
    const result = await loadPhotoThumb(readerFor(fakeWithMeta), ALBUM_ID, PHOTO_ID)
    if (result.status !== 'found') throw new Error('expected found')
    expect(result.value).toBe(stream)
    expect('etag' in result).toBe(false)
    expect('contentType' in result).toBe(false)
  })

  it('throws ObjectServiceError(reader_failure) when reader rejects', async () => {
    await expect(loadPhotoThumb(failingReader(), ALBUM_ID, PHOTO_ID)).rejects.toSatisfy(
      (e: unknown) => e instanceof ObjectServiceError && e.code === 'reader_failure',
    )
  })

  it('rejects a null preview body', async () => {
    const fakeBody: PrivateObjectBody = { body: null, text: async () => '' }
    await expect(loadPhotoPreview(readerFor(fakeBody), ALBUM_ID, PHOTO_ID)).rejects.toSatisfy(
      (e: unknown) => e instanceof ObjectServiceError && e.code === 'reader_failure',
    )
  })

  it('throws ObjectServiceError(reader_failure) for an invalid album ID', async () => {
    await expect(loadPhotoThumb(readerFor(null), '!bad!', PHOTO_ID)).rejects.toSatisfy(
      (e: unknown) => e instanceof ObjectServiceError && e.code === 'reader_failure',
    )
  })

  it('throws ObjectServiceError(reader_failure) for an invalid photo ID', async () => {
    await expect(loadPhotoThumb(readerFor(null), ALBUM_ID, '!bad!')).rejects.toSatisfy(
      (e: unknown) => e instanceof ObjectServiceError && e.code === 'reader_failure',
    )
  })

  it('error message does not contain album or photo IDs', async () => {
    const sensitiveAlbum = 'private-album-secret'
    const sensitivePhoto = 'private-photo-secret'
    await expect(
      loadPhotoThumb(failingReader(), sensitiveAlbum, sensitivePhoto),
    ).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof ObjectServiceError &&
        !e.message.includes(sensitiveAlbum) &&
        !e.message.includes(sensitivePhoto),
    )
  })

  it('error message does not contain the R2 key', async () => {
    const expectedKey = photoThumbKey(ALBUM_ID, PHOTO_ID)
    await expect(loadPhotoThumb(failingReader(), ALBUM_ID, PHOTO_ID)).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof ObjectServiceError && !e.message.includes(expectedKey),
    )
  })
})

// ---------------------------------------------------------------------------
// loadPhotoPreview
// ---------------------------------------------------------------------------

describe('loadPhotoPreview', () => {
  it('calls reader with the exact key from photoPreviewKey', async () => {
    const expectedKey = photoPreviewKey(ALBUM_ID, PHOTO_ID)
    let calledWithKey: string | undefined
    const reader: PrivateObjectReader = {
      get: async (k) => {
        calledWithKey = k
        return null
      },
    }
    await loadPhotoPreview(reader, ALBUM_ID, PHOTO_ID)
    expect(calledWithKey).toBe(expectedKey)
  })

  it('calls reader exactly once', async () => {
    let callCount = 0
    const reader: PrivateObjectReader = {
      get: async () => {
        callCount++
        return null
      },
    }
    await loadPhotoPreview(reader, ALBUM_ID, PHOTO_ID)
    expect(callCount).toBe(1)
  })

  it('returns not_found without throwing when reader returns null', async () => {
    const result = await loadPhotoPreview(readerFor(null), ALBUM_ID, PHOTO_ID)
    expect(result.status).toBe('not_found')
  })

  it('returns the exact ReadableStream reference', async () => {
    const stream = makeStream()
    const fakeBody: PrivateObjectBody = { body: stream, text: async () => '' }
    const result = await loadPhotoPreview(readerFor(fakeBody), ALBUM_ID, PHOTO_ID)
    if (result.status !== 'found') throw new Error('expected found')
    expect(result.value).toBe(stream)
  })

  it('does not call text() on the preview object', async () => {
    let textCalled = false
    const fakeBody: PrivateObjectBody = {
      body: makeStream(),
      text: async () => {
        textCalled = true
        return ''
      },
    }
    await loadPhotoPreview(readerFor(fakeBody), ALBUM_ID, PHOTO_ID)
    expect(textCalled).toBe(false)
  })

  it('discards stored metadata and returns only the body', async () => {
    const stream = makeStream()
    const fakeWithMeta = Object.assign(
      { body: stream, text: async () => '' } satisfies PrivateObjectBody,
      { etag: 'etag-discard', contentType: 'image/jpeg', size: 55555 },
    )
    const result = await loadPhotoPreview(readerFor(fakeWithMeta), ALBUM_ID, PHOTO_ID)
    if (result.status !== 'found') throw new Error('expected found')
    expect(result.value).toBe(stream)
    expect('etag' in result).toBe(false)
  })

  it('throws ObjectServiceError(reader_failure) when reader rejects', async () => {
    await expect(loadPhotoPreview(failingReader(), ALBUM_ID, PHOTO_ID)).rejects.toSatisfy(
      (e: unknown) => e instanceof ObjectServiceError && e.code === 'reader_failure',
    )
  })

  it('throws ObjectServiceError(reader_failure) for an invalid photo ID', async () => {
    await expect(loadPhotoPreview(readerFor(null), ALBUM_ID, '!bad!')).rejects.toSatisfy(
      (e: unknown) => e instanceof ObjectServiceError && e.code === 'reader_failure',
    )
  })

  it('error message does not contain album or photo IDs', async () => {
    const sensitiveAlbum = 'secret-album-name'
    const sensitivePhoto = 'secret-photo-name'
    await expect(
      loadPhotoPreview(failingReader(), sensitiveAlbum, sensitivePhoto),
    ).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof ObjectServiceError &&
        !e.message.includes(sensitiveAlbum) &&
        !e.message.includes(sensitivePhoto),
    )
  })

  it('error message does not contain underlying error text', async () => {
    const underlyingMsg = 'internal-storage-secret'
    const reader: PrivateObjectReader = {
      get: async () => {
        throw new Error(underlyingMsg)
      },
    }
    await expect(loadPhotoPreview(reader, ALBUM_ID, PHOTO_ID)).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof ObjectServiceError && !e.message.includes(underlyingMsg),
    )
  })
})

// ---------------------------------------------------------------------------
// ObjectServiceError class
// ---------------------------------------------------------------------------

describe('ObjectServiceError', () => {
  it('has code reader_failure', () => {
    const err = new ObjectServiceError('reader_failure')
    expect(err.code).toBe('reader_failure')
  })

  it('has code manifest_invalid', () => {
    const err = new ObjectServiceError('manifest_invalid')
    expect(err.code).toBe('manifest_invalid')
  })

  it('is an instance of Error', () => {
    expect(new ObjectServiceError('reader_failure')).toBeInstanceOf(Error)
  })

  it('is an instance of ObjectServiceError', () => {
    expect(new ObjectServiceError('reader_failure')).toBeInstanceOf(ObjectServiceError)
  })

  it('name is ObjectServiceError', () => {
    expect(new ObjectServiceError('reader_failure').name).toBe('ObjectServiceError')
  })

  it('reader_failure message is generic', () => {
    const err = new ObjectServiceError('reader_failure')
    expect(err.message).toBe('object read failed')
  })

  it('manifest_invalid message is generic', () => {
    const err = new ObjectServiceError('manifest_invalid')
    expect(err.message).toBe('manifest invalid')
  })
})

// ---------------------------------------------------------------------------
// Loaders do not accept caller-supplied keys or paths
// ---------------------------------------------------------------------------

describe('loaders do not accept arbitrary keys', () => {
  it('loadAlbumManifest has no key parameter', () => {
    // Verified at compile time: signature is (reader, albumId) only.
    // Runtime check: only valid albumId strings produce a defined key.
    expect(typeof loadAlbumManifest).toBe('function')
    expect(loadAlbumManifest.length).toBe(2)
  })

  it('loadAlbumCover has no key parameter', () => {
    expect(loadAlbumCover.length).toBe(2)
  })

  it('loadPhotoThumb has no key parameter beyond albumId and photoId', () => {
    expect(loadPhotoThumb.length).toBe(3)
  })

  it('loadPhotoPreview has no key parameter beyond albumId and photoId', () => {
    expect(loadPhotoPreview.length).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// Image bodies are not buffered or converted
// ---------------------------------------------------------------------------

describe('image bodies are not buffered', () => {
  it('loadAlbumCover returns a ReadableStream, not a string or byte array', async () => {
    const stream = makeStream()
    const result = await loadAlbumCover(readerFor(makeBody('', stream)), ALBUM_ID)
    if (result.status !== 'found') throw new Error('expected found')
    expect(result.value).toBeInstanceOf(ReadableStream)
    expect(typeof result.value).not.toBe('string')
    expect(result.value instanceof Uint8Array).toBe(false)
  })

  it('loadPhotoThumb returns a ReadableStream, not a string or byte array', async () => {
    const stream = makeStream()
    const result = await loadPhotoThumb(readerFor(makeBody('', stream)), ALBUM_ID, PHOTO_ID)
    if (result.status !== 'found') throw new Error('expected found')
    expect(result.value).toBeInstanceOf(ReadableStream)
  })

  it('loadPhotoPreview returns a ReadableStream, not a string or byte array', async () => {
    const stream = makeStream()
    const result = await loadPhotoPreview(readerFor(makeBody('', stream)), ALBUM_ID, PHOTO_ID)
    if (result.status !== 'found') throw new Error('expected found')
    expect(result.value).toBeInstanceOf(ReadableStream)
  })
})
