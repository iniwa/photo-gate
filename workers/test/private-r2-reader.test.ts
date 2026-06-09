import { describe, expect, it } from 'vitest'
import { PrivateR2Reader, PrivateR2ReaderError } from '../src/services/private-r2-reader.js'
import {
  albumCoverKey,
  albumManifestKey,
  isStandardPrivateObjectKey,
  photoPreviewKey,
  photoThumbKey,
} from '../src/services/r2-object-key.js'
import { loadAlbumCover } from '../src/services/private-album-object-service.js'

const ALBUM_ID = 'album-1'
const PHOTO_ID = 'photo-1'
const ALLOWED_KEYS = [
  albumManifestKey(ALBUM_ID),
  albumCoverKey(ALBUM_ID),
  photoThumbKey(ALBUM_ID, PHOTO_ID),
  photoPreviewKey(ALBUM_ID, PHOTO_ID),
]

function makeStream(content = 'image'): ReadableStream {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(content))
      controller.close()
    },
  })
}

function makeBucket(result: unknown, error?: Error): { bucket: R2Bucket; keys: string[] } {
  const keys: string[] = []
  const bucket = {
    get: async (key: string) => {
      keys.push(key)
      if (error !== undefined) throw error
      return result
    },
  } as unknown as R2Bucket
  return { bucket, keys }
}

function makeObject(text = 'manifest text'): R2ObjectBody {
  return {
    body: makeStream(),
    text: async () => text,
    key: 'secret-key',
    etag: 'secret-etag',
    httpMetadata: { contentType: 'secret/type' },
    customMetadata: { secret: 'value' },
  } as unknown as R2ObjectBody
}

describe('isStandardPrivateObjectKey', () => {
  it.each(ALLOWED_KEYS)('accepts builder output %s', (key) => {
    expect(isStandardPrivateObjectKey(key)).toBe(true)
  })

  it.each([
    '',
    '/albums/album-1/cover.webp',
    'albums\\album-1\\cover.webp',
    'albums/../cover.webp',
    'albums//cover.webp',
    'albums/album-1//cover.webp',
    'other/album-1/cover.webp',
    'albums/album-1/cover.jpg',
    'albums/album-1/thumbs/photo-1.jpg',
    'albums/album-1/previews/photo-1.webp',
    'albums/album-1/thumbs/photo-1.webp/extra',
    'albums/album-1/manifest.json?download=1',
    'albums/album-1/cover.webp#fragment',
    'albums/album%2F1/cover.webp',
    'albums/album-1/thumbs/%2e%2e.webp',
    'albums/album-1/private.bin',
    'albums/album-1/cover.webp\u0000',
  ])('rejects non-standard key %j', (key) => {
    expect(isStandardPrivateObjectKey(key)).toBe(false)
  })

  it.each([null, undefined, 1, {}, []])('rejects non-string key %j', (key) => {
    expect(isStandardPrivateObjectKey(key)).toBe(false)
  })
})

describe('PrivateR2Reader', () => {
  it('calls bucket.get exactly once with an allowed key', async () => {
    const { bucket, keys } = makeBucket(null)
    await new PrivateR2Reader(bucket).get(ALLOWED_KEYS[0]!)
    expect(keys).toEqual([ALLOWED_KEYS[0]])
  })

  it('rejects invalid keys before bucket access', async () => {
    const { bucket, keys } = makeBucket(null)
    await expect(new PrivateR2Reader(bucket).get('private/secret')).rejects.toEqual(
      new PrivateR2ReaderError(),
    )
    expect(keys).toEqual([])
  })

  it('sanitizes non-string keys before bucket access', async () => {
    const { bucket, keys } = makeBucket(null)
    await expect(
      new PrivateR2Reader(bucket).get(null as unknown as string),
    ).rejects.toBeInstanceOf(PrivateR2ReaderError)
    expect(keys).toEqual([])
  })

  it('returns null for an absent object', async () => {
    const { bucket } = makeBucket(null)
    await expect(new PrivateR2Reader(bucket).get(ALLOWED_KEYS[0]!)).resolves.toBeNull()
  })

  it('returns only body and text without R2 metadata', async () => {
    const original = makeObject()
    const { bucket } = makeBucket(original)
    const result = await new PrivateR2Reader(bucket).get(ALLOWED_KEYS[0]!)
    expect(result).not.toBe(original)
    expect(Object.keys(result ?? {}).sort()).toEqual(['body', 'text'])
    expect(result?.body).toBe(original.body)
    expect('etag' in (result ?? {})).toBe(false)
    expect('httpMetadata' in (result ?? {})).toBe(false)
  })

  it('delegates text only when called', async () => {
    let calls = 0
    const object = makeObject()
    object.text = async () => {
      calls++
      return 'value'
    }
    const { bucket } = makeBucket(object)
    const result = await new PrivateR2Reader(bucket).get(ALLOWED_KEYS[0]!)
    expect(calls).toBe(0)
    await expect(result?.text()).resolves.toBe('value')
    expect(calls).toBe(1)
  })

  it('sanitizes bucket errors', async () => {
    const { bucket } = makeBucket(null, new Error('bucket secret and key'))
    const error = await new PrivateR2Reader(bucket).get(ALLOWED_KEYS[0]!).catch((value) => value)
    expect(error).toBeInstanceOf(PrivateR2ReaderError)
    expect((error as Error).message).toBe('private object read failed')
  })

  it.each([
    {},
    { body: null, text: async () => 'text' },
    { body: makeStream(), text: 'not a function' },
  ])('rejects malformed objects', async (object) => {
    const { bucket } = makeBucket(object)
    await expect(new PrivateR2Reader(bucket).get(ALLOWED_KEYS[0]!)).rejects.toBeInstanceOf(
      PrivateR2ReaderError,
    )
  })

  it('sanitizes delegated text errors', async () => {
    const object = makeObject()
    object.text = async () => {
      throw new Error('manifest contents')
    }
    const { bucket } = makeBucket(object)
    const result = await new PrivateR2Reader(bucket).get(ALLOWED_KEYS[0]!)
    await expect(result?.text()).rejects.toEqual(new PrivateR2ReaderError())
  })

  it('works with an existing explicit object loader', async () => {
    const object = makeObject()
    const { bucket, keys } = makeBucket(object)
    const result = await loadAlbumCover(new PrivateR2Reader(bucket), ALBUM_ID)
    expect(result.status).toBe('found')
    expect(keys).toEqual([albumCoverKey(ALBUM_ID)])
  })

  it('does not expose storage operations other than get', () => {
    const { bucket } = makeBucket(null)
    const reader = new PrivateR2Reader(bucket) as unknown as Record<string, unknown>
    expect(Object.keys(reader)).toEqual([])
    expect(reader['bucket']).toBeUndefined()
    expect(reader['put']).toBeUndefined()
    expect(reader['delete']).toBeUndefined()
    expect(reader['list']).toBeUndefined()
    expect(reader['head']).toBeUndefined()
  })
})
