import { describe, it, expect } from 'vitest'
import type { PrivateObjectBody, PrivateObjectReader } from '../src/types/private-object.js'
import {
  loadManifestAuthorizedThumb,
  loadManifestAuthorizedPreview,
} from '../src/services/manifest-authorized-photo-service.js'
import { ObjectServiceError } from '../src/services/private-album-object-service.js'
import {
  albumManifestKey,
  photoThumbKey,
  photoPreviewKey,
} from '../src/services/r2-object-key.js'

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const ALBUM_ID = 'album-1'
const PHOTO_ID = 'photo-1'
const UNLISTED_PHOTO_ID = 'photo-unlisted'

function manifestJsonWithPhotos(photoIds: string[], albumId = ALBUM_ID): string {
  return JSON.stringify({
    schemaVersion: 1,
    albumId,
    title: 'Test Album',
    source: { type: 'photoprism', albumUid: 'uid001' },
    generatedAt: '2026-06-09T10:00:00Z',
    images: {
      thumb: { longEdge: 400, format: 'webp', quality: 85 },
      preview: { longEdge: 1600, format: 'jpg', quality: 90 },
      stripExif: true,
    },
    photos: photoIds.map((id) => ({
      id,
      title: `Photo ${id}`,
      thumb: `thumbs/${id}.webp`,
      preview: `previews/${id}.jpg`,
      takenAt: '2026-05-01T12:00:00+09:00',
      width: 3000,
      height: 2000,
    })),
  })
}

function makeStream(content = 'image-bytes'): ReadableStream {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(content))
      controller.close()
    },
  })
}

function manifestBody(json: string): PrivateObjectBody {
  return { body: null, text: async () => json }
}

function imageBody(stream: ReadableStream = makeStream()): PrivateObjectBody {
  return {
    body: stream,
    text: async () => {
      throw new Error('text() must not be called on an image object')
    },
  }
}

/**
 * Reader backed by a key-to-object map that records every requested key in order.
 * Missing keys return null (absent object).
 */
function mapReader(objects: Map<string, PrivateObjectBody>): {
  reader: PrivateObjectReader
  calls: string[]
} {
  const calls: string[] = []
  return {
    calls,
    reader: {
      get: async (key) => {
        calls.push(key)
        return objects.get(key) ?? null
      },
    },
  }
}

function readerWithManifestAndImages(opts: {
  manifestJson?: string
  imageKeys?: string[]
  imageStream?: ReadableStream
}): { reader: PrivateObjectReader; calls: string[] } {
  const objects = new Map<string, PrivateObjectBody>()
  if (opts.manifestJson !== undefined) {
    objects.set(albumManifestKey(ALBUM_ID), manifestBody(opts.manifestJson))
  }
  for (const key of opts.imageKeys ?? []) {
    objects.set(key, imageBody(opts.imageStream ?? makeStream()))
  }
  return mapReader(objects)
}

const isSanitizedError =
  (code: 'reader_failure' | 'manifest_invalid') =>
  (e: unknown): boolean =>
    e instanceof ObjectServiceError && e.code === code

interface OperationCase {
  name: string
  load: (
    reader: PrivateObjectReader,
    albumId: string,
    photoId: string,
  ) => ReturnType<typeof loadManifestAuthorizedThumb>
  imageKey: (albumId: string, photoId: string) => string
  otherImageKey: (albumId: string, photoId: string) => string
}

const OPERATIONS: OperationCase[] = [
  {
    name: 'loadManifestAuthorizedThumb',
    load: loadManifestAuthorizedThumb,
    imageKey: photoThumbKey,
    otherImageKey: photoPreviewKey,
  },
  {
    name: 'loadManifestAuthorizedPreview',
    load: loadManifestAuthorizedPreview,
    imageKey: photoPreviewKey,
    otherImageKey: photoThumbKey,
  },
]

// ---------------------------------------------------------------------------
// Shared behavior for both operations
// ---------------------------------------------------------------------------

for (const op of OPERATIONS) {
  describe(op.name, () => {
    describe('read order and keys', () => {
      it('reads the manifest before the image, using exact standard keys', async () => {
        const { reader, calls } = readerWithManifestAndImages({
          manifestJson: manifestJsonWithPhotos([PHOTO_ID]),
          imageKeys: [op.imageKey(ALBUM_ID, PHOTO_ID)],
        })
        await op.load(reader, ALBUM_ID, PHOTO_ID)
        expect(calls).toEqual([
          albumManifestKey(ALBUM_ID),
          op.imageKey(ALBUM_ID, PHOTO_ID),
        ])
      })

      it('makes exactly two reader calls for a listed photo', async () => {
        const { reader, calls } = readerWithManifestAndImages({
          manifestJson: manifestJsonWithPhotos([PHOTO_ID]),
          imageKeys: [op.imageKey(ALBUM_ID, PHOTO_ID)],
        })
        await op.load(reader, ALBUM_ID, PHOTO_ID)
        expect(calls).toHaveLength(2)
      })

      it('never requests the other image variant key', async () => {
        const { reader, calls } = readerWithManifestAndImages({
          manifestJson: manifestJsonWithPhotos([PHOTO_ID]),
          imageKeys: [
            op.imageKey(ALBUM_ID, PHOTO_ID),
            op.otherImageKey(ALBUM_ID, PHOTO_ID),
          ],
        })
        await op.load(reader, ALBUM_ID, PHOTO_ID)
        expect(calls).not.toContain(op.otherImageKey(ALBUM_ID, PHOTO_ID))
      })
    })

    describe('found listed photo', () => {
      it('returns found with the exact ReadableStream reference', async () => {
        const stream = makeStream()
        const { reader } = readerWithManifestAndImages({
          manifestJson: manifestJsonWithPhotos([PHOTO_ID]),
          imageKeys: [op.imageKey(ALBUM_ID, PHOTO_ID)],
          imageStream: stream,
        })
        const result = await op.load(reader, ALBUM_ID, PHOTO_ID)
        if (result.status !== 'found') throw new Error('expected found')
        expect(result.value).toBe(stream)
      })

      it('returns a ReadableStream, not a buffered string or byte array', async () => {
        const { reader } = readerWithManifestAndImages({
          manifestJson: manifestJsonWithPhotos([PHOTO_ID]),
          imageKeys: [op.imageKey(ALBUM_ID, PHOTO_ID)],
        })
        const result = await op.load(reader, ALBUM_ID, PHOTO_ID)
        if (result.status !== 'found') throw new Error('expected found')
        expect(result.value).toBeInstanceOf(ReadableStream)
        expect(typeof result.value).not.toBe('string')
        expect(result.value instanceof Uint8Array).toBe(false)
      })

      it('does not consume the returned stream', async () => {
        const { reader } = readerWithManifestAndImages({
          manifestJson: manifestJsonWithPhotos([PHOTO_ID]),
          imageKeys: [op.imageKey(ALBUM_ID, PHOTO_ID)],
        })
        const result = await op.load(reader, ALBUM_ID, PHOTO_ID)
        if (result.status !== 'found') throw new Error('expected found')
        expect(result.value.locked).toBe(false)
      })

      it('finds a photo listed among others in the manifest', async () => {
        const { reader } = readerWithManifestAndImages({
          manifestJson: manifestJsonWithPhotos(['photo-a', PHOTO_ID, 'photo-z']),
          imageKeys: [op.imageKey(ALBUM_ID, PHOTO_ID)],
        })
        const result = await op.load(reader, ALBUM_ID, PHOTO_ID)
        expect(result.status).toBe('found')
      })

      it('does not return manifest contents, photo metadata, paths, or IDs', async () => {
        const { reader } = readerWithManifestAndImages({
          manifestJson: manifestJsonWithPhotos([PHOTO_ID]),
          imageKeys: [op.imageKey(ALBUM_ID, PHOTO_ID)],
        })
        const result = await op.load(reader, ALBUM_ID, PHOTO_ID)
        expect(Object.keys(result).sort()).toEqual(['status', 'value'])
        if (result.status !== 'found') throw new Error('expected found')
        expect(result.value).toBeInstanceOf(ReadableStream)
      })
    })

    describe('missing manifest', () => {
      it('returns not_found with exactly one reader call', async () => {
        const { reader, calls } = readerWithManifestAndImages({
          imageKeys: [op.imageKey(ALBUM_ID, PHOTO_ID)],
        })
        const result = await op.load(reader, ALBUM_ID, PHOTO_ID)
        expect(result).toEqual({ status: 'not_found' })
        expect(calls).toEqual([albumManifestKey(ALBUM_ID)])
      })

      it('does not probe the image key even when the image object exists', async () => {
        const { reader, calls } = readerWithManifestAndImages({
          imageKeys: [op.imageKey(ALBUM_ID, PHOTO_ID)],
        })
        await op.load(reader, ALBUM_ID, PHOTO_ID)
        expect(calls).not.toContain(op.imageKey(ALBUM_ID, PHOTO_ID))
      })
    })

    describe('unlisted photo', () => {
      it('returns not_found with exactly one reader call', async () => {
        const { reader, calls } = readerWithManifestAndImages({
          manifestJson: manifestJsonWithPhotos([PHOTO_ID]),
          imageKeys: [op.imageKey(ALBUM_ID, UNLISTED_PHOTO_ID)],
        })
        const result = await op.load(reader, ALBUM_ID, UNLISTED_PHOTO_ID)
        expect(result).toEqual({ status: 'not_found' })
        expect(calls).toEqual([albumManifestKey(ALBUM_ID)])
      })

      it('never probes the image key even when a stale object physically exists', async () => {
        const { reader, calls } = readerWithManifestAndImages({
          manifestJson: manifestJsonWithPhotos([PHOTO_ID]),
          imageKeys: [op.imageKey(ALBUM_ID, UNLISTED_PHOTO_ID)],
        })
        await op.load(reader, ALBUM_ID, UNLISTED_PHOTO_ID)
        expect(calls).not.toContain(op.imageKey(ALBUM_ID, UNLISTED_PHOTO_ID))
      })

      it('returns not_found for an empty manifest photo list', async () => {
        const { reader, calls } = readerWithManifestAndImages({
          manifestJson: manifestJsonWithPhotos([]),
        })
        const result = await op.load(reader, ALBUM_ID, PHOTO_ID)
        expect(result).toEqual({ status: 'not_found' })
        expect(calls).toHaveLength(1)
      })

      it('result is indistinguishable from a missing image object', async () => {
        const { reader: unlistedReader } = readerWithManifestAndImages({
          manifestJson: manifestJsonWithPhotos([PHOTO_ID]),
          imageKeys: [op.imageKey(ALBUM_ID, UNLISTED_PHOTO_ID)],
        })
        const unlisted = await op.load(unlistedReader, ALBUM_ID, UNLISTED_PHOTO_ID)

        const { reader: missingImageReader } = readerWithManifestAndImages({
          manifestJson: manifestJsonWithPhotos([PHOTO_ID]),
        })
        const missingImage = await op.load(missingImageReader, ALBUM_ID, PHOTO_ID)

        expect(unlisted).toEqual(missingImage)
      })
    })

    describe('exact-match membership only', () => {
      const listedId = 'Photo-AbC_1'
      const nonMatches = [
        { label: 'case-different', candidate: 'photo-abc_1' },
        { label: 'uppercased', candidate: 'PHOTO-ABC_1' },
        { label: 'prefix of the listed ID', candidate: 'Photo-AbC' },
        { label: 'listed ID plus suffix', candidate: 'Photo-AbC_1x' },
        { label: 'substring of the listed ID', candidate: 'hoto-AbC' },
      ]

      for (const { label, candidate } of nonMatches) {
        it(`does not match a ${label} photo ID`, async () => {
          const { reader, calls } = readerWithManifestAndImages({
            manifestJson: manifestJsonWithPhotos([listedId]),
            imageKeys: [op.imageKey(ALBUM_ID, candidate)],
          })
          const result = await op.load(reader, ALBUM_ID, candidate)
          expect(result).toEqual({ status: 'not_found' })
          expect(calls).toEqual([albumManifestKey(ALBUM_ID)])
        })
      }

      it('matches only the exact listed ID', async () => {
        const { reader } = readerWithManifestAndImages({
          manifestJson: manifestJsonWithPhotos([listedId]),
          imageKeys: [op.imageKey(ALBUM_ID, listedId)],
        })
        const result = await op.load(reader, ALBUM_ID, listedId)
        expect(result.status).toBe('found')
      })
    })

    describe('invalid identifiers fail closed', () => {
      const invalidIds = ['', '!bad!', '../traversal', 'a/b', 'a'.repeat(129), '-leading-hyphen']

      for (const invalid of invalidIds) {
        it(`rejects invalid album ID ${JSON.stringify(invalid)} with zero reader calls`, async () => {
          const { reader, calls } = readerWithManifestAndImages({
            manifestJson: manifestJsonWithPhotos([PHOTO_ID]),
          })
          await expect(op.load(reader, invalid, PHOTO_ID)).rejects.toSatisfy(
            isSanitizedError('reader_failure'),
          )
          expect(calls).toHaveLength(0)
        })

        it(`rejects invalid photo ID ${JSON.stringify(invalid)} with zero reader calls`, async () => {
          const { reader, calls } = readerWithManifestAndImages({
            manifestJson: manifestJsonWithPhotos([PHOTO_ID]),
          })
          await expect(op.load(reader, ALBUM_ID, invalid)).rejects.toSatisfy(
            isSanitizedError('reader_failure'),
          )
          expect(calls).toHaveLength(0)
        })
      }
    })

    describe('manifest failures stop before the image read', () => {
      it('manifest reader failure stops with one reader call and no image read', async () => {
        const calls: string[] = []
        const reader: PrivateObjectReader = {
          get: async (key) => {
            calls.push(key)
            throw new Error('storage failure')
          },
        }
        await expect(op.load(reader, ALBUM_ID, PHOTO_ID)).rejects.toSatisfy(
          isSanitizedError('reader_failure'),
        )
        expect(calls).toEqual([albumManifestKey(ALBUM_ID)])
      })

      it('manifest text failure stops with one reader call and no image read', async () => {
        const calls: string[] = []
        const reader: PrivateObjectReader = {
          get: async (key) => {
            calls.push(key)
            return {
              body: null,
              text: async () => {
                throw new Error('body read failure')
              },
            }
          },
        }
        await expect(op.load(reader, ALBUM_ID, PHOTO_ID)).rejects.toSatisfy(
          isSanitizedError('reader_failure'),
        )
        expect(calls).toEqual([albumManifestKey(ALBUM_ID)])
      })

      it('malformed manifest stops with one reader call and no image read', async () => {
        const { reader, calls } = readerWithManifestAndImages({
          manifestJson: '{ not valid json',
          imageKeys: [op.imageKey(ALBUM_ID, PHOTO_ID)],
        })
        await expect(op.load(reader, ALBUM_ID, PHOTO_ID)).rejects.toSatisfy(
          isSanitizedError('manifest_invalid'),
        )
        expect(calls).toEqual([albumManifestKey(ALBUM_ID)])
      })

      it('wrong-album manifest stops with one reader call and no image read', async () => {
        const { reader, calls } = readerWithManifestAndImages({
          manifestJson: manifestJsonWithPhotos([PHOTO_ID], 'other-album'),
          imageKeys: [op.imageKey(ALBUM_ID, PHOTO_ID)],
        })
        await expect(op.load(reader, ALBUM_ID, PHOTO_ID)).rejects.toSatisfy(
          isSanitizedError('manifest_invalid'),
        )
        expect(calls).toEqual([albumManifestKey(ALBUM_ID)])
      })

      it('manifest with unexpected schema fields stops before the image read', async () => {
        const withExtra = JSON.stringify({
          ...JSON.parse(manifestJsonWithPhotos([PHOTO_ID])),
          unexpectedField: 'should-fail',
        })
        const { reader, calls } = readerWithManifestAndImages({
          manifestJson: withExtra,
          imageKeys: [op.imageKey(ALBUM_ID, PHOTO_ID)],
        })
        await expect(op.load(reader, ALBUM_ID, PHOTO_ID)).rejects.toSatisfy(
          isSanitizedError('manifest_invalid'),
        )
        expect(calls).toEqual([albumManifestKey(ALBUM_ID)])
      })
    })

    describe('image-read outcomes for a listed photo', () => {
      it('image absence returns not_found', async () => {
        const { reader, calls } = readerWithManifestAndImages({
          manifestJson: manifestJsonWithPhotos([PHOTO_ID]),
        })
        const result = await op.load(reader, ALBUM_ID, PHOTO_ID)
        expect(result).toEqual({ status: 'not_found' })
        expect(calls).toHaveLength(2)
      })

      it('image reader failure is a sanitized reader_failure error', async () => {
        const manifestKey = albumManifestKey(ALBUM_ID)
        const reader: PrivateObjectReader = {
          get: async (key) => {
            if (key === manifestKey) {
              return manifestBody(manifestJsonWithPhotos([PHOTO_ID]))
            }
            throw new Error('image storage failure')
          },
        }
        await expect(op.load(reader, ALBUM_ID, PHOTO_ID)).rejects.toSatisfy(
          isSanitizedError('reader_failure'),
        )
      })

      it('null image body is a sanitized reader_failure error', async () => {
        const manifestKey = albumManifestKey(ALBUM_ID)
        const reader: PrivateObjectReader = {
          get: async (key) => {
            if (key === manifestKey) {
              return manifestBody(manifestJsonWithPhotos([PHOTO_ID]))
            }
            return { body: null, text: async () => '' }
          },
        }
        await expect(op.load(reader, ALBUM_ID, PHOTO_ID)).rejects.toSatisfy(
          isSanitizedError('reader_failure'),
        )
      })
    })

    describe('error sanitization', () => {
      it('errors never expose album ID, photo ID, keys, or manifest data', async () => {
        const sensitiveAlbum = 'secret-album-id'
        const sensitivePhoto = 'secret-photo-id'
        const sensitiveTitle = 'Secret Family Trip'
        const manifestJson = JSON.stringify({
          ...JSON.parse(manifestJsonWithPhotos([sensitivePhoto], sensitiveAlbum)),
          title: sensitiveTitle,
        })
        const objects = new Map<string, PrivateObjectBody>()
        objects.set(albumManifestKey(sensitiveAlbum), manifestBody(manifestJson))

        // Force an image reader_failure for the listed photo.
        const failingImageReader: PrivateObjectReader = {
          get: async (key) => {
            const obj = objects.get(key)
            if (obj !== undefined) return obj
            throw new Error('underlying-storage-detail')
          },
        }

        await expect(
          op.load(failingImageReader, sensitiveAlbum, sensitivePhoto),
        ).rejects.toSatisfy((e: unknown) => {
          if (!(e instanceof ObjectServiceError)) return false
          const text = `${e.name} ${e.message} ${String(e.stack ?? '')}`
          return (
            !text.includes(sensitiveAlbum) &&
            !text.includes(sensitivePhoto) &&
            !text.includes(sensitiveTitle) &&
            !text.includes('underlying-storage-detail') &&
            !text.includes('albums/')
          )
        })
      })

      it('invalid-ID errors do not contain the rejected value', async () => {
        const sensitive = '!secret value to never leak!'
        const { reader } = readerWithManifestAndImages({})
        await expect(op.load(reader, sensitive, PHOTO_ID)).rejects.toSatisfy(
          (e: unknown) =>
            e instanceof ObjectServiceError && !e.message.includes(sensitive),
        )
      })

      it('manifest_invalid errors do not contain manifest contents', async () => {
        const sensitiveTitle = 'leak-this-title-never'
        const malformed = `{"title": "${sensitiveTitle}"`
        const { reader } = readerWithManifestAndImages({ manifestJson: malformed })
        await expect(op.load(reader, ALBUM_ID, PHOTO_ID)).rejects.toSatisfy(
          (e: unknown) =>
            e instanceof ObjectServiceError && !e.message.includes(sensitiveTitle),
        )
      })
    })

    describe('signature', () => {
      it('accepts only reader, albumId, and photoId — no key or path parameter', () => {
        expect(op.load.length).toBe(3)
      })
    })
  })
}

// ---------------------------------------------------------------------------
// Cross-operation isolation
// ---------------------------------------------------------------------------

describe('thumb and preview operations are independent', () => {
  it('thumb requests the thumb key and preview requests the preview key', async () => {
    const manifestJson = manifestJsonWithPhotos([PHOTO_ID])
    const objects = new Map<string, PrivateObjectBody>()
    objects.set(albumManifestKey(ALBUM_ID), manifestBody(manifestJson))
    objects.set(photoThumbKey(ALBUM_ID, PHOTO_ID), imageBody())
    objects.set(photoPreviewKey(ALBUM_ID, PHOTO_ID), imageBody())

    const thumbCalls = mapReader(objects)
    await loadManifestAuthorizedThumb(thumbCalls.reader, ALBUM_ID, PHOTO_ID)
    expect(thumbCalls.calls[1]).toBe(photoThumbKey(ALBUM_ID, PHOTO_ID))

    const previewCalls = mapReader(objects)
    await loadManifestAuthorizedPreview(previewCalls.reader, ALBUM_ID, PHOTO_ID)
    expect(previewCalls.calls[1]).toBe(photoPreviewKey(ALBUM_ID, PHOTO_ID))
  })
})
