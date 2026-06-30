import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { createDownloadRoutes } from '../src/routes/download-routes.js'
import type { DownloadRouteDeps } from '../src/routes/download-routes.js'
import type { Env } from '../src/types/env.js'
import type { AuthVariables } from '../src/types/auth-context.js'
import type { SessionWithUser } from '../src/types/session.js'
import type { AuthorizedAlbumSummary } from '../src/types/authorized-album.js'
import type { PrivateObjectBody, PrivateObjectReader } from '../src/types/private-object.js'
import {
  albumManifestKey,
  photoPreviewKey,
} from '../src/services/r2-object-key.js'
import { generateSessionToken, digestSessionToken } from '../src/services/auth-crypto.js'
import { COOKIE_NAME } from '../src/services/session-cookie.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = '2026-06-11T00:00:00.000Z'
const CLOCK = (): Date => new Date(NOW)
const ALBUM_ID = 'album-1'
const PHOTO_ID = 'photo-1'
const UNLISTED_PHOTO_ID = 'photo-unlisted'
const USER_ID = 'viewer-1'

function validSession(): SessionWithUser {
  return {
    token_hash: 'f'.repeat(64),
    user_id: USER_ID,
    expires_at: '2026-06-18T00:00:00.000Z',
    last_seen_at: NOW,
    user_enabled: 1,
  }
}

function albumSummary(downloadEnabled: number): AuthorizedAlbumSummary {
  return { id: ALBUM_ID, title: 'Test Album', download_enabled: downloadEnabled }
}

function manifestJson(photoIds: string[]): string {
  return JSON.stringify({
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

function makeStream(content = 'jpeg-bytes'): ReadableStream {
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
      throw new Error('text() must not be called on image body')
    },
  }
}

function mapReader(objects: Map<string, PrivateObjectBody>): PrivateObjectReader {
  return { get: async (key) => objects.get(key) ?? null }
}

function throwingReader(): PrivateObjectReader {
  return {
    get: async () => {
      throw new Error('R2 unavailable')
    },
  }
}

interface FakeOptions {
  validSession?: SessionWithUser | null
  permission?: boolean
  summary?: AuthorizedAlbumSummary | null | 'throw'
  reader?: PrivateObjectReader
}

function makeDeps(opts: FakeOptions = {}): DownloadRouteDeps {
  return {
    sessionRepo: {
      async fetchValidSession() {
        return opts.validSession === undefined ? validSession() : opts.validSession
      },
    },
    permChecker: {
      async checkPermission() {
        return opts.permission ?? true
      },
    },
    albumRepo: {
      async getAuthorizedAlbum() {
        if (opts.summary === 'throw') throw new Error('D1 down')
        return opts.summary === undefined ? albumSummary(1) : opts.summary
      },
    },
    reader: opts.reader ?? mapReader(new Map()),
    clock: CLOCK,
  }
}

function makeApp(deps: DownloadRouteDeps): Hono<{ Bindings: Env; Variables: AuthVariables }> {
  const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>()
  app.route('/download', createDownloadRoutes(() => deps))
  return app
}

async function validCookie(): Promise<string> {
  const token = generateSessionToken()
  await digestSessionToken(token)
  return `${COOKIE_NAME}=${token}`
}

async function get(
  app: Hono<{ Bindings: Env; Variables: AuthVariables }>,
  path: string,
  cookie?: string,
): Promise<Response> {
  const headers: Record<string, string> = {}
  if (cookie !== undefined) headers['Cookie'] = cookie
  return app.request(path, { method: 'GET', headers })
}

function fullObjects(photoIds: string[] = [PHOTO_ID]): Map<string, PrivateObjectBody> {
  const map = new Map<string, PrivateObjectBody>()
  map.set(albumManifestKey(ALBUM_ID), manifestBody(manifestJson(photoIds)))
  for (const id of photoIds) {
    map.set(photoPreviewKey(ALBUM_ID, id), imageBody())
  }
  return map
}

// ---------------------------------------------------------------------------
// Authentication guard
// ---------------------------------------------------------------------------

describe('GET /download/:albumId/preview/:photoId — authentication', () => {
  it('no cookie -> 401', async () => {
    const app = makeApp(makeDeps())
    const res = await get(app, `/download/${ALBUM_ID}/preview/${PHOTO_ID}`)
    expect(res.status).toBe(401)
  })

  it('invalid session -> 401', async () => {
    const app = makeApp(makeDeps({ validSession: null }))
    const res = await get(app, `/download/${ALBUM_ID}/preview/${PHOTO_ID}`, await validCookie())
    expect(res.status).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// Album permission guard
// ---------------------------------------------------------------------------

describe('GET /download/:albumId/preview/:photoId — album permission', () => {
  it('no album permission -> 403', async () => {
    const app = makeApp(makeDeps({ permission: false }))
    const res = await get(app, `/download/${ALBUM_ID}/preview/${PHOTO_ID}`, await validCookie())
    expect(res.status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// photoId validation
// ---------------------------------------------------------------------------

describe('GET /download/:albumId/preview/:photoId — photoId validation', () => {
  it('empty photoId path -> 404', async () => {
    const app = makeApp(makeDeps())
    const res = await get(app, `/download/${ALBUM_ID}/preview/`, await validCookie())
    expect(res.status).toBe(404)
  })

  it('photoId starting with ! -> 404', async () => {
    const app = makeApp(makeDeps())
    const res = await get(app, `/download/${ALBUM_ID}/preview/!bad!`, await validCookie())
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// download_enabled gate
// ---------------------------------------------------------------------------

describe('GET /download/:albumId/preview/:photoId — download_enabled gate', () => {
  it('download_enabled = 0 -> 403 before any R2 read', async () => {
    let readerCalled = false
    const deps = makeDeps({
      summary: albumSummary(0),
      reader: {
        get: async () => {
          readerCalled = true
          return null
        },
      },
    })
    const app = makeApp(deps)
    const res = await get(app, `/download/${ALBUM_ID}/preview/${PHOTO_ID}`, await validCookie())
    expect(res.status).toBe(403)
    expect(readerCalled).toBe(false)
  })

  it('album summary null (race) -> 403', async () => {
    const app = makeApp(makeDeps({ summary: null }))
    const res = await get(app, `/download/${ALBUM_ID}/preview/${PHOTO_ID}`, await validCookie())
    expect(res.status).toBe(403)
  })

  it('album repo throws -> 500', async () => {
    const app = makeApp(makeDeps({ summary: 'throw' }))
    const res = await get(app, `/download/${ALBUM_ID}/preview/${PHOTO_ID}`, await validCookie())
    expect(res.status).toBe(500)
  })
})

// ---------------------------------------------------------------------------
// Manifest and photo membership
// ---------------------------------------------------------------------------

describe('GET /download/:albumId/preview/:photoId — manifest', () => {
  it('manifest absent -> 404', async () => {
    const app = makeApp(makeDeps({ reader: mapReader(new Map()) }))
    const res = await get(app, `/download/${ALBUM_ID}/preview/${PHOTO_ID}`, await validCookie())
    expect(res.status).toBe(404)
  })

  it('photo not in manifest -> 404', async () => {
    const objects = new Map<string, PrivateObjectBody>()
    objects.set(albumManifestKey(ALBUM_ID), manifestBody(manifestJson([UNLISTED_PHOTO_ID])))
    const app = makeApp(makeDeps({ reader: mapReader(objects) }))
    const res = await get(app, `/download/${ALBUM_ID}/preview/${PHOTO_ID}`, await validCookie())
    expect(res.status).toBe(404)
  })

  it('manifest reader throws -> 500', async () => {
    const app = makeApp(makeDeps({ reader: throwingReader() }))
    const res = await get(app, `/download/${ALBUM_ID}/preview/${PHOTO_ID}`, await validCookie())
    expect(res.status).toBe(500)
  })

  it('manifest invalid JSON -> 500', async () => {
    const objects = new Map<string, PrivateObjectBody>()
    objects.set(albumManifestKey(ALBUM_ID), manifestBody('{ bad json'))
    const app = makeApp(makeDeps({ reader: mapReader(objects) }))
    const res = await get(app, `/download/${ALBUM_ID}/preview/${PHOTO_ID}`, await validCookie())
    expect(res.status).toBe(500)
  })
})

// ---------------------------------------------------------------------------
// Preview object
// ---------------------------------------------------------------------------

describe('GET /download/:albumId/preview/:photoId — preview object', () => {
  it('preview object absent -> 404', async () => {
    const objects = new Map<string, PrivateObjectBody>()
    objects.set(albumManifestKey(ALBUM_ID), manifestBody(manifestJson([PHOTO_ID])))
    const app = makeApp(makeDeps({ reader: mapReader(objects) }))
    const res = await get(app, `/download/${ALBUM_ID}/preview/${PHOTO_ID}`, await validCookie())
    expect(res.status).toBe(404)
  })

  it('preview reader throws after manifest loaded -> 500', async () => {
    let callCount = 0
    const objects = new Map<string, PrivateObjectBody>()
    objects.set(albumManifestKey(ALBUM_ID), manifestBody(manifestJson([PHOTO_ID])))
    const partialReader: PrivateObjectReader = {
      get: async (key) => {
        callCount++
        if (callCount === 1) return objects.get(key) ?? null
        throw new Error('R2 error on preview')
      },
    }
    const app = makeApp(makeDeps({ reader: partialReader }))
    const res = await get(app, `/download/${ALBUM_ID}/preview/${PHOTO_ID}`, await validCookie())
    expect(res.status).toBe(500)
  })
})

// ---------------------------------------------------------------------------
// Successful download
// ---------------------------------------------------------------------------

describe('GET /download/:albumId/preview/:photoId — success', () => {
  it('returns 200 with correct headers', async () => {
    const app = makeApp(makeDeps({ reader: mapReader(fullObjects()) }))
    const res = await get(app, `/download/${ALBUM_ID}/preview/${PHOTO_ID}`, await validCookie())
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/jpeg')
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })

  it('Content-Disposition is attachment with .jpg filename', async () => {
    const app = makeApp(makeDeps({ reader: mapReader(fullObjects()) }))
    const res = await get(app, `/download/${ALBUM_ID}/preview/${PHOTO_ID}`, await validCookie())
    const cd = res.headers.get('Content-Disposition') ?? ''
    expect(cd).toContain('attachment')
    expect(cd).toContain('.jpg')
  })

  it('Content-Disposition filename does not contain album ID or R2 key', async () => {
    const app = makeApp(makeDeps({ reader: mapReader(fullObjects()) }))
    const res = await get(app, `/download/${ALBUM_ID}/preview/${PHOTO_ID}`, await validCookie())
    const cd = res.headers.get('Content-Disposition') ?? ''
    expect(cd).not.toContain(ALBUM_ID)
    expect(cd).not.toContain('albums/')
    expect(cd).not.toContain('previews/')
  })

  it('does not set ETag', async () => {
    const app = makeApp(makeDeps({ reader: mapReader(fullObjects()) }))
    const res = await get(app, `/download/${ALBUM_ID}/preview/${PHOTO_ID}`, await validCookie())
    expect(res.headers.get('ETag')).toBeNull()
  })

  it('does not set Last-Modified', async () => {
    const app = makeApp(makeDeps({ reader: mapReader(fullObjects()) }))
    const res = await get(app, `/download/${ALBUM_ID}/preview/${PHOTO_ID}`, await validCookie())
    expect(res.headers.get('Last-Modified')).toBeNull()
  })

  it('does not set Content-Length', async () => {
    const app = makeApp(makeDeps({ reader: mapReader(fullObjects()) }))
    const res = await get(app, `/download/${ALBUM_ID}/preview/${PHOTO_ID}`, await validCookie())
    expect(res.headers.get('Content-Length')).toBeNull()
  })

  it('returns a readable body (the preview stream)', async () => {
    const app = makeApp(makeDeps({ reader: mapReader(fullObjects()) }))
    const res = await get(app, `/download/${ALBUM_ID}/preview/${PHOTO_ID}`, await validCookie())
    const body = await res.text()
    expect(body).toBe('jpeg-bytes')
  })

  it('manifest read happens before preview read (exactly 2 reader calls for success)', async () => {
    const calls: string[] = []
    const objects = fullObjects()
    const trackingReader: PrivateObjectReader = {
      get: async (key) => {
        calls.push(key)
        return objects.get(key) ?? null
      },
    }
    const app = makeApp(makeDeps({ reader: trackingReader }))
    await get(app, `/download/${ALBUM_ID}/preview/${PHOTO_ID}`, await validCookie())
    expect(calls).toHaveLength(2)
    expect(calls[0]).toContain('manifest')
    expect(calls[1]).toContain('preview')
  })
})

// ---------------------------------------------------------------------------
// Privacy: no sensitive data in error responses
// ---------------------------------------------------------------------------

describe('GET /download/:albumId/preview/:photoId — no sensitive data in errors', () => {
  it('404 body does not reveal album ID, photo ID, or R2 details', async () => {
    const app = makeApp(makeDeps({ reader: mapReader(new Map()) }))
    const res = await get(app, `/download/${ALBUM_ID}/preview/${PHOTO_ID}`, await validCookie())
    const text = await res.text()
    expect(text).not.toContain(ALBUM_ID)
    expect(text).not.toContain(PHOTO_ID)
    expect(text.toLowerCase()).not.toContain('r2')
    expect(text.toLowerCase()).not.toContain('bucket')
    expect(text.toLowerCase()).not.toContain('manifest')
  })

  it('500 body does not reveal internal error details', async () => {
    const app = makeApp(makeDeps({ reader: throwingReader() }))
    const res = await get(app, `/download/${ALBUM_ID}/preview/${PHOTO_ID}`, await validCookie())
    const text = await res.text()
    expect(text.toLowerCase()).not.toContain('r2')
    expect(text.toLowerCase()).not.toContain('unavailable')
    expect(text.toLowerCase()).not.toContain('stack')
  })

  it('403 body does not reveal download policy or album details', async () => {
    const app = makeApp(makeDeps({ summary: albumSummary(0) }))
    const res = await get(app, `/download/${ALBUM_ID}/preview/${PHOTO_ID}`, await validCookie())
    const text = await res.text()
    expect(text.toLowerCase()).not.toContain(ALBUM_ID)
    expect(text.toLowerCase()).not.toContain('download')
  })
})
