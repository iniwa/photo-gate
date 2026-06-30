import { describe, it, expect } from 'vitest'
import {
  privateImageResponse,
  objectNotFoundResponse,
  objectInternalErrorResponse,
  buildDownloadFilename,
  privateDownloadResponse,
  objectForbiddenResponse,
} from '../src/middleware/private-object-response.js'
import type { ImageKind } from '../src/middleware/private-object-response.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStream(content = 'image-bytes'): ReadableStream {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(content))
      controller.close()
    },
  })
}

const ALL_KINDS: ImageKind[] = ['cover', 'thumb', 'preview']

// ---------------------------------------------------------------------------
// privateImageResponse: cover
// ---------------------------------------------------------------------------

describe('privateImageResponse cover', () => {
  it('returns status 200', () => {
    expect(privateImageResponse(makeStream(), 'cover').status).toBe(200)
  })

  it('sets Content-Type: image/webp', () => {
    expect(privateImageResponse(makeStream(), 'cover').headers.get('Content-Type')).toBe(
      'image/webp',
    )
  })

  it('sets Cache-Control: private, no-store', () => {
    expect(privateImageResponse(makeStream(), 'cover').headers.get('Cache-Control')).toBe(
      'private, no-store',
    )
  })

  it('sets X-Content-Type-Options: nosniff', () => {
    expect(
      privateImageResponse(makeStream(), 'cover').headers.get('X-Content-Type-Options'),
    ).toBe('nosniff')
  })
})

// ---------------------------------------------------------------------------
// privateImageResponse: thumb
// ---------------------------------------------------------------------------

describe('privateImageResponse thumb', () => {
  it('returns status 200', () => {
    expect(privateImageResponse(makeStream(), 'thumb').status).toBe(200)
  })

  it('sets Content-Type: image/webp', () => {
    expect(privateImageResponse(makeStream(), 'thumb').headers.get('Content-Type')).toBe(
      'image/webp',
    )
  })

  it('sets Cache-Control: private, no-store', () => {
    expect(privateImageResponse(makeStream(), 'thumb').headers.get('Cache-Control')).toBe(
      'private, no-store',
    )
  })

  it('sets X-Content-Type-Options: nosniff', () => {
    expect(
      privateImageResponse(makeStream(), 'thumb').headers.get('X-Content-Type-Options'),
    ).toBe('nosniff')
  })
})

// ---------------------------------------------------------------------------
// privateImageResponse: preview
// ---------------------------------------------------------------------------

describe('privateImageResponse preview', () => {
  it('returns status 200', () => {
    expect(privateImageResponse(makeStream(), 'preview').status).toBe(200)
  })

  it('sets Content-Type: image/jpeg', () => {
    expect(privateImageResponse(makeStream(), 'preview').headers.get('Content-Type')).toBe(
      'image/jpeg',
    )
  })

  it('sets Cache-Control: private, no-store', () => {
    expect(privateImageResponse(makeStream(), 'preview').headers.get('Cache-Control')).toBe(
      'private, no-store',
    )
  })

  it('sets X-Content-Type-Options: nosniff', () => {
    expect(
      privateImageResponse(makeStream(), 'preview').headers.get('X-Content-Type-Options'),
    ).toBe('nosniff')
  })
})

// ---------------------------------------------------------------------------
// privateImageResponse: content types are fixed to the allowlist only
// ---------------------------------------------------------------------------

describe('privateImageResponse content type allowlist', () => {
  it('cover and thumb produce image/webp and preview produces image/jpeg', () => {
    const types = ALL_KINDS.map((k) =>
      privateImageResponse(makeStream(), k).headers.get('Content-Type'),
    )
    expect(types).toEqual(['image/webp', 'image/webp', 'image/jpeg'])
  })

  it('does not produce text/html for any kind', () => {
    for (const kind of ALL_KINDS) {
      expect(privateImageResponse(makeStream(), kind).headers.get('Content-Type')).not.toBe(
        'text/html',
      )
    }
  })

  it('does not produce application/octet-stream for any kind', () => {
    for (const kind of ALL_KINDS) {
      expect(
        privateImageResponse(makeStream(), kind).headers.get('Content-Type'),
      ).not.toBe('application/octet-stream')
    }
  })
})

// ---------------------------------------------------------------------------
// privateImageResponse: no forbidden headers
// ---------------------------------------------------------------------------

describe('privateImageResponse no forbidden headers', () => {
  it('does not set ETag', () => {
    for (const kind of ALL_KINDS) {
      expect(privateImageResponse(makeStream(), kind).headers.get('ETag')).toBeNull()
    }
  })

  it('does not set Last-Modified', () => {
    for (const kind of ALL_KINDS) {
      expect(privateImageResponse(makeStream(), kind).headers.get('Last-Modified')).toBeNull()
    }
  })

  it('does not set Content-Disposition', () => {
    for (const kind of ALL_KINDS) {
      expect(
        privateImageResponse(makeStream(), kind).headers.get('Content-Disposition'),
      ).toBeNull()
    }
  })

  it('does not set Content-Length', () => {
    for (const kind of ALL_KINDS) {
      expect(
        privateImageResponse(makeStream(), kind).headers.get('Content-Length'),
      ).toBeNull()
    }
  })

  it('does not set Content-Range', () => {
    for (const kind of ALL_KINDS) {
      expect(
        privateImageResponse(makeStream(), kind).headers.get('Content-Range'),
      ).toBeNull()
    }
  })
})

// ---------------------------------------------------------------------------
// privateImageResponse: body is streamed, not buffered
// ---------------------------------------------------------------------------

describe('privateImageResponse body', () => {
  it('the response body is the exact ReadableStream passed in', () => {
    const stream = makeStream()
    const res = privateImageResponse(stream, 'cover')
    expect(res.body).toBe(stream)
  })

  it('rejects a null body at runtime', () => {
    expect(() => privateImageResponse(null as unknown as ReadableStream, 'thumb')).toThrowError(
      'invalid private image response',
    )
  })

  it('rejects an unknown kind at runtime', () => {
    expect(() => privateImageResponse(makeStream(), 'other' as ImageKind)).toThrowError(
      'invalid private image response',
    )
  })

  it('sanitizes a response-incompatible locked stream failure', () => {
    const stream = makeStream()
    stream.getReader()
    expect(() => privateImageResponse(stream, 'preview')).toThrowError(
      'invalid private image response',
    )
  })

  it('does not convert the stream to a string before building the response', () => {
    const stream = makeStream('photo-bytes')
    const res = privateImageResponse(stream, 'preview')
    // The stream should still be readable (not consumed/locked by the helper)
    expect(res.body).toBe(stream)
    expect(typeof res.body).not.toBe('string')
  })
})

// ---------------------------------------------------------------------------
// privateImageResponse: does not forward fake stored metadata
// ---------------------------------------------------------------------------

describe('privateImageResponse does not forward stored metadata', () => {
  it('ignores any fake ETag passed alongside the stream', () => {
    // The helper accepts only body and kind, with no metadata parameter.
    // Verify the response carries no ETag regardless of what the object had.
    const res = privateImageResponse(makeStream(), 'cover')
    expect(res.headers.get('ETag')).toBeNull()
    expect(res.headers.get('etag')).toBeNull()
  })

  it('does not expose bucket name in any header', () => {
    const res = privateImageResponse(makeStream(), 'cover')
    const headers: Record<string, string> = {}
    res.headers.forEach((value, key) => {
      headers[key] = value
    })
    const headerText = JSON.stringify(headers)
    expect(headerText).not.toContain('bucket')
    expect(headerText).not.toContain('r2')
  })
})

// ---------------------------------------------------------------------------
// objectNotFoundResponse
// ---------------------------------------------------------------------------

describe('objectNotFoundResponse', () => {
  it('returns status 404', () => {
    expect(objectNotFoundResponse().status).toBe(404)
  })

  it('sets Cache-Control: no-store', () => {
    expect(objectNotFoundResponse().headers.get('Cache-Control')).toBe('no-store')
  })

  it('sets X-Content-Type-Options: nosniff', () => {
    expect(objectNotFoundResponse().headers.get('X-Content-Type-Options')).toBe('nosniff')
  })

  it('does not set ETag', () => {
    expect(objectNotFoundResponse().headers.get('ETag')).toBeNull()
  })

  it('body does not contain album ID, photo ID, or bucket details', async () => {
    const body = await objectNotFoundResponse().text()
    expect(body).not.toContain('album')
    expect(body).not.toContain('photo')
    expect(body).not.toContain('bucket')
    expect(body).not.toContain('r2')
    expect(body.length).toBeGreaterThan(0)
  })

  it('body does not reveal storage provider or key information', async () => {
    const body = await objectNotFoundResponse().text()
    const lc = body.toLowerCase()
    expect(lc).not.toContain('r2')
    expect(lc).not.toContain('cloudflare')
    expect(lc).not.toContain('albums/')
    expect(lc).not.toContain('manifest')
  })
})

// ---------------------------------------------------------------------------
// objectInternalErrorResponse
// ---------------------------------------------------------------------------

describe('objectInternalErrorResponse', () => {
  it('returns status 500', () => {
    expect(objectInternalErrorResponse().status).toBe(500)
  })

  it('sets Cache-Control: no-store', () => {
    expect(objectInternalErrorResponse().headers.get('Cache-Control')).toBe('no-store')
  })

  it('sets X-Content-Type-Options: nosniff', () => {
    expect(objectInternalErrorResponse().headers.get('X-Content-Type-Options')).toBe('nosniff')
  })

  it('does not set ETag', () => {
    expect(objectInternalErrorResponse().headers.get('ETag')).toBeNull()
  })

  it('body does not contain album ID, photo ID, or internal error details', async () => {
    const body = await objectInternalErrorResponse().text()
    expect(body).not.toContain('album')
    expect(body).not.toContain('photo')
    expect(body).not.toContain('bucket')
    expect(body).not.toContain('r2')
    expect(body.length).toBeGreaterThan(0)
  })

  it('body does not reveal storage provider or internal stack information', async () => {
    const body = await objectInternalErrorResponse().text()
    const lc = body.toLowerCase()
    expect(lc).not.toContain('r2')
    expect(lc).not.toContain('cloudflare')
    expect(lc).not.toContain('stack')
    expect(lc).not.toContain('exception')
  })
})

// ---------------------------------------------------------------------------
// failure responses use no-store (not private, no-store)
// ---------------------------------------------------------------------------

describe('failure response cache policy is no-store, not private', () => {
  it('404 uses plain no-store, not private, no-store', () => {
    const cc = objectNotFoundResponse().headers.get('Cache-Control')
    expect(cc).toBe('no-store')
    expect(cc).not.toContain('private')
  })

  it('500 uses plain no-store, not private, no-store', () => {
    const cc = objectInternalErrorResponse().headers.get('Cache-Control')
    expect(cc).toBe('no-store')
    expect(cc).not.toContain('private')
  })
})

// ---------------------------------------------------------------------------
// successful image response uses private, no-store (not just no-store)
// ---------------------------------------------------------------------------

describe('successful image response cache policy is private, no-store', () => {
  it('cover uses private, no-store', () => {
    const cc = privateImageResponse(makeStream(), 'cover').headers.get('Cache-Control')
    expect(cc).toBe('private, no-store')
    expect(cc).toContain('private')
    expect(cc).toContain('no-store')
  })

  it('thumb uses private, no-store', () => {
    const cc = privateImageResponse(makeStream(), 'thumb').headers.get('Cache-Control')
    expect(cc).toBe('private, no-store')
  })

  it('preview uses private, no-store', () => {
    const cc = privateImageResponse(makeStream(), 'preview').headers.get('Cache-Control')
    expect(cc).toBe('private, no-store')
  })
})

// ---------------------------------------------------------------------------
// buildDownloadFilename — ASCII title
// ---------------------------------------------------------------------------

describe('buildDownloadFilename — ASCII title', () => {
  it('appends .jpg to an ASCII title', () => {
    expect(buildDownloadFilename('Sunset_Beach', 'photo-1')).toBe('Sunset_Beach.jpg')
  })

  it('replaces spaces with underscores', () => {
    expect(buildDownloadFilename('My Photo', 'photo-1')).toBe('My_Photo.jpg')
  })

  it('strips double quotes', () => {
    expect(buildDownloadFilename('A "test"', 'photo-1')).toBe('A_test.jpg')
  })

  it('strips forward slashes', () => {
    expect(buildDownloadFilename('path/to/photo', 'photo-1')).toBe('pathtophoto.jpg')
  })

  it('strips backslashes', () => {
    expect(buildDownloadFilename('win\\path', 'photo-1')).toBe('winpath.jpg')
  })

  it('strips control characters (CR, LF)', () => {
    expect(buildDownloadFilename('line\r\nbreak', 'photo-1')).toBe('linebreak.jpg')
  })

  it('strips non-printable characters below 0x20', () => {
    expect(buildDownloadFilename('tab\there', 'photo-1')).toBe('tabhere.jpg')
  })

  it('caps at 100 characters (base before extension)', () => {
    const long = 'a'.repeat(200)
    const result = buildDownloadFilename(long, 'photo-1')
    expect(result).toBe('a'.repeat(100) + '.jpg')
  })
})

// ---------------------------------------------------------------------------
// buildDownloadFilename — non-ASCII fallback
// ---------------------------------------------------------------------------

describe('buildDownloadFilename — non-ASCII fallback', () => {
  it('strips Japanese characters and falls back to photoId when result is empty', () => {
    expect(buildDownloadFilename('写真', 'photo-abc')).toBe('photo-abc.jpg')
  })

  it('strips emoji and falls back to photoId', () => {
    expect(buildDownloadFilename('🌅', 'photo-1')).toBe('photo-1.jpg')
  })

  it('falls back to photoId when title is empty string', () => {
    expect(buildDownloadFilename('', 'photo-1')).toBe('photo-1.jpg')
  })

  it('falls back to photoId when title is all non-ASCII', () => {
    expect(buildDownloadFilename('αβγ', 'photo-2')).toBe('photo-2.jpg')
  })

  it('uses ASCII part of mixed title', () => {
    expect(buildDownloadFilename('Ocean海_photo', 'photo-1')).toBe('Ocean_photo.jpg')
  })
})

// ---------------------------------------------------------------------------
// privateDownloadResponse
// ---------------------------------------------------------------------------

describe('privateDownloadResponse', () => {
  it('returns status 200', () => {
    expect(privateDownloadResponse(makeStream(), 'photo.jpg').status).toBe(200)
  })

  it('sets Content-Type: image/jpeg', () => {
    expect(
      privateDownloadResponse(makeStream(), 'photo.jpg').headers.get('Content-Type'),
    ).toBe('image/jpeg')
  })

  it('sets Content-Disposition attachment with supplied filename', () => {
    const cd = privateDownloadResponse(makeStream(), 'sunset.jpg').headers.get(
      'Content-Disposition',
    )
    expect(cd).toBe('attachment; filename="sunset.jpg"')
  })

  it('sets Cache-Control: private, no-store', () => {
    expect(
      privateDownloadResponse(makeStream(), 'photo.jpg').headers.get('Cache-Control'),
    ).toBe('private, no-store')
  })

  it('sets X-Content-Type-Options: nosniff', () => {
    expect(
      privateDownloadResponse(makeStream(), 'photo.jpg').headers.get('X-Content-Type-Options'),
    ).toBe('nosniff')
  })

  it('does not set ETag', () => {
    expect(privateDownloadResponse(makeStream(), 'photo.jpg').headers.get('ETag')).toBeNull()
  })

  it('does not set Last-Modified', () => {
    expect(
      privateDownloadResponse(makeStream(), 'photo.jpg').headers.get('Last-Modified'),
    ).toBeNull()
  })

  it('does not set Content-Length', () => {
    expect(
      privateDownloadResponse(makeStream(), 'photo.jpg').headers.get('Content-Length'),
    ).toBeNull()
  })

  it('does not set Content-Range', () => {
    expect(
      privateDownloadResponse(makeStream(), 'photo.jpg').headers.get('Content-Range'),
    ).toBeNull()
  })

  it('streams the body without buffering', () => {
    const stream = makeStream()
    const res = privateDownloadResponse(stream, 'photo.jpg')
    expect(res.body).toBe(stream)
  })

  it('rejects a null body', () => {
    expect(() =>
      privateDownloadResponse(null as unknown as ReadableStream, 'photo.jpg'),
    ).toThrowError('invalid private download response')
  })

  it('does not expose bucket or R2 details in headers', () => {
    const res = privateDownloadResponse(makeStream(), 'photo.jpg')
    const headers: Record<string, string> = {}
    res.headers.forEach((value, key) => {
      headers[key] = value
    })
    const headerText = JSON.stringify(headers)
    expect(headerText).not.toContain('r2')
    expect(headerText).not.toContain('bucket')
  })
})

// ---------------------------------------------------------------------------
// objectForbiddenResponse
// ---------------------------------------------------------------------------

describe('objectForbiddenResponse', () => {
  it('returns status 403', () => {
    expect(objectForbiddenResponse().status).toBe(403)
  })

  it('sets Cache-Control: no-store', () => {
    expect(objectForbiddenResponse().headers.get('Cache-Control')).toBe('no-store')
  })

  it('sets X-Content-Type-Options: nosniff', () => {
    expect(objectForbiddenResponse().headers.get('X-Content-Type-Options')).toBe('nosniff')
  })

  it('does not set ETag', () => {
    expect(objectForbiddenResponse().headers.get('ETag')).toBeNull()
  })

  it('body does not reveal album IDs, photo IDs, or R2 details', async () => {
    const body = await objectForbiddenResponse().text()
    expect(body.toLowerCase()).not.toContain('album')
    expect(body.toLowerCase()).not.toContain('r2')
    expect(body.toLowerCase()).not.toContain('bucket')
    expect(body.length).toBeGreaterThan(0)
  })
})
