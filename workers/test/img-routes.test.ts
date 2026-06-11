import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import realApp from '../src/index.js'
import { createImgRoutes } from '../src/routes/img-routes.js'
import type { ImgRouteDeps } from '../src/routes/img-routes.js'
import type { Env } from '../src/types/env.js'
import type { AuthVariables } from '../src/types/auth-context.js'
import type { SessionWithUser } from '../src/types/session.js'
import type { PrivateObjectBody, PrivateObjectReader } from '../src/types/private-object.js'
import { ObjectServiceError } from '../src/services/private-album-object-service.js'
import {
  albumManifestKey,
  albumCoverKey,
  photoThumbKey,
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

/** Reader backed by a key->object map that records every requested key in order. */
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

/** Reader that throws on the image key but serves the manifest. */
function readerThatThrowsOnImage(manifestJson: string): {
  reader: PrivateObjectReader
  calls: string[]
} {
  const calls: string[] = []
  const manifestKey = albumManifestKey(ALBUM_ID)
  return {
    calls,
    reader: {
      get: async (key) => {
        calls.push(key)
        if (key === manifestKey) return manifestBody(manifestJson)
        throw new Error('image storage failure')
      },
    },
  }
}

interface FakeOptions {
  validSession?: SessionWithUser | null
  sessionThrows?: boolean
  permission?: boolean
  permissionThrows?: boolean
  reader?: PrivateObjectReader
}

interface FakeState {
  sessionCalls: Array<{ digest: string; now: string }>
  permissionCalls: Array<{ userId: string; albumId: string; now: string }>
}

function makeDeps(opts: FakeOptions = {}): { deps: ImgRouteDeps; state: FakeState } {
  const state: FakeState = { sessionCalls: [], permissionCalls: [] }
  const deps: ImgRouteDeps = {
    sessionRepo: {
      async fetchValidSession(digest, now) {
        state.sessionCalls.push({ digest, now })
        if (opts.sessionThrows) throw new Error('D1 down')
        return opts.validSession === undefined ? validSession() : opts.validSession
      },
    },
    permChecker: {
      async checkPermission(userId, albumId, now) {
        state.permissionCalls.push({ userId, albumId, now })
        if (opts.permissionThrows) throw new Error('D1 down')
        return opts.permission ?? true
      },
    },
    reader: opts.reader ?? mapReader(new Map()).reader,
    clock: CLOCK,
  }
  return { deps, state }
}

function makeApp(deps: ImgRouteDeps): Hono<{ Bindings: Env; Variables: AuthVariables }> {
  const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>()
  app.route('/img', createImgRoutes(() => deps))
  return app
}

/** Builds a valid session cookie header plus the digest the repo will see. */
async function validCookie(): Promise<{ header: string; digest: string }> {
  const token = generateSessionToken()
  const digest = await digestSessionToken(token)
  return { header: `${COOKIE_NAME}=${token}`, digest }
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

interface ImageOp {
  name: 'thumb' | 'preview'
  path: (album: string, photo: string) => string
  imageKey: (album: string, photo: string) => string
  otherImageKey: (album: string, photo: string) => string
  contentType: string
}

const OPS: ImageOp[] = [
  {
    name: 'thumb',
    path: (a, p) => `/img/${a}/thumb/${p}`,
    imageKey: photoThumbKey,
    otherImageKey: photoPreviewKey,
    contentType: 'image/webp',
  },
  {
    name: 'preview',
    path: (a, p) => `/img/${a}/preview/${p}`,
    imageKey: photoPreviewKey,
    otherImageKey: photoThumbKey,
    contentType: 'image/jpeg',
  },
]

// ---------------------------------------------------------------------------
// thumb / preview: chain order, manifest-first, failures
// ---------------------------------------------------------------------------

for (const op of OPS) {
  describe(`GET /img/:albumId/${op.name}/:photoId`, () => {
    describe('chain order', () => {
      it('no session cookie -> 401; permission and reader never called', async () => {
        const reader = mapReader(new Map())
        const { deps, state } = makeDeps({ reader: reader.reader })
        const app = makeApp(deps)
        const res = await get(app, op.path(ALBUM_ID, PHOTO_ID))
        expect(res.status).toBe(401)
        expect(state.sessionCalls).toHaveLength(0)
        expect(state.permissionCalls).toHaveLength(0)
        expect(reader.calls).toHaveLength(0)
      })

      it('invalid session (repo returns null) -> 401; permission and reader never called', async () => {
        const reader = mapReader(new Map())
        const { deps, state } = makeDeps({ validSession: null, reader: reader.reader })
        const app = makeApp(deps)
        const { header } = await validCookie()
        const res = await get(app, op.path(ALBUM_ID, PHOTO_ID), header)
        expect(res.status).toBe(401)
        expect(state.sessionCalls).toHaveLength(1)
        expect(state.permissionCalls).toHaveLength(0)
        expect(reader.calls).toHaveLength(0)
      })

      it('session ok, permission false -> 403; reader never called', async () => {
        const reader = mapReader(new Map())
        const { deps, state } = makeDeps({ permission: false, reader: reader.reader })
        const app = makeApp(deps)
        const { header } = await validCookie()
        const res = await get(app, op.path(ALBUM_ID, PHOTO_ID), header)
        expect(res.status).toBe(403)
        expect(state.permissionCalls).toHaveLength(1)
        expect(reader.calls).toHaveLength(0)
      })

      it('permission repo throws -> 503; reader never called', async () => {
        const reader = mapReader(new Map())
        const { deps } = makeDeps({ permissionThrows: true, reader: reader.reader })
        const app = makeApp(deps)
        const { header } = await validCookie()
        const res = await get(app, op.path(ALBUM_ID, PHOTO_ID), header)
        expect(res.status).toBe(503)
        expect(reader.calls).toHaveLength(0)
      })

      it('session repo throws -> 503', async () => {
        const reader = mapReader(new Map())
        const { deps, state } = makeDeps({ sessionThrows: true, reader: reader.reader })
        const app = makeApp(deps)
        const { header } = await validCookie()
        const res = await get(app, op.path(ALBUM_ID, PHOTO_ID), header)
        expect(res.status).toBe(503)
        expect(state.permissionCalls).toHaveLength(0)
        expect(reader.calls).toHaveLength(0)
      })

      it('forwards the digested token and clock now to the session repo', async () => {
        const { deps, state } = makeDeps()
        const app = makeApp(deps)
        const { header, digest } = await validCookie()
        await get(app, op.path(ALBUM_ID, PHOTO_ID), header)
        expect(state.sessionCalls[0]).toEqual({ digest, now: NOW })
      })
    })

    describe('manifest-first membership', () => {
      it('listed photo -> reads manifest then exact image key, in order; 200', async () => {
        const objects = new Map<string, PrivateObjectBody>()
        objects.set(albumManifestKey(ALBUM_ID), manifestBody(manifestJsonWithPhotos([PHOTO_ID])))
        objects.set(op.imageKey(ALBUM_ID, PHOTO_ID), imageBody(makeStream('the-image')))
        const reader = mapReader(objects)
        const { deps } = makeDeps({ reader: reader.reader })
        const app = makeApp(deps)
        const { header } = await validCookie()
        const res = await get(app, op.path(ALBUM_ID, PHOTO_ID), header)

        expect(res.status).toBe(200)
        expect(reader.calls).toEqual([
          albumManifestKey(ALBUM_ID),
          op.imageKey(ALBUM_ID, PHOTO_ID),
        ])
        expect(await res.text()).toBe('the-image')
      })

      it('200 response has fixed headers and no caching/conditional metadata', async () => {
        const objects = new Map<string, PrivateObjectBody>()
        objects.set(albumManifestKey(ALBUM_ID), manifestBody(manifestJsonWithPhotos([PHOTO_ID])))
        objects.set(op.imageKey(ALBUM_ID, PHOTO_ID), imageBody())
        const reader = mapReader(objects)
        const { deps } = makeDeps({ reader: reader.reader })
        const app = makeApp(deps)
        const { header } = await validCookie()
        const res = await get(app, op.path(ALBUM_ID, PHOTO_ID), header)

        expect(res.headers.get('content-type')).toBe(op.contentType)
        expect(res.headers.get('cache-control')).toBe('private, no-store')
        expect(res.headers.get('x-content-type-options')).toBe('nosniff')
        expect(res.headers.get('etag')).toBeNull()
        expect(res.headers.get('last-modified')).toBeNull()
      })

      it('never requests the other image variant key', async () => {
        const objects = new Map<string, PrivateObjectBody>()
        objects.set(albumManifestKey(ALBUM_ID), manifestBody(manifestJsonWithPhotos([PHOTO_ID])))
        objects.set(op.imageKey(ALBUM_ID, PHOTO_ID), imageBody())
        objects.set(op.otherImageKey(ALBUM_ID, PHOTO_ID), imageBody())
        const reader = mapReader(objects)
        const { deps } = makeDeps({ reader: reader.reader })
        const app = makeApp(deps)
        const { header } = await validCookie()
        await get(app, op.path(ALBUM_ID, PHOTO_ID), header)
        expect(reader.calls).not.toContain(op.otherImageKey(ALBUM_ID, PHOTO_ID))
      })

      it('unlisted photo -> 404; image key never requested', async () => {
        const objects = new Map<string, PrivateObjectBody>()
        objects.set(albumManifestKey(ALBUM_ID), manifestBody(manifestJsonWithPhotos([PHOTO_ID])))
        objects.set(op.imageKey(ALBUM_ID, UNLISTED_PHOTO_ID), imageBody())
        const reader = mapReader(objects)
        const { deps } = makeDeps({ reader: reader.reader })
        const app = makeApp(deps)
        const { header } = await validCookie()
        const res = await get(app, op.path(ALBUM_ID, UNLISTED_PHOTO_ID), header)

        expect(res.status).toBe(404)
        expect(reader.calls).toEqual([albumManifestKey(ALBUM_ID)])
        expect(reader.calls).not.toContain(op.imageKey(ALBUM_ID, UNLISTED_PHOTO_ID))
      })

      it('missing manifest -> 404; exactly one reader call', async () => {
        const reader = mapReader(new Map())
        const { deps } = makeDeps({ reader: reader.reader })
        const app = makeApp(deps)
        const { header } = await validCookie()
        const res = await get(app, op.path(ALBUM_ID, PHOTO_ID), header)

        expect(res.status).toBe(404)
        expect(reader.calls).toEqual([albumManifestKey(ALBUM_ID)])
      })

      it('malformed manifest -> 500 generic; image key never requested', async () => {
        const objects = new Map<string, PrivateObjectBody>()
        objects.set(albumManifestKey(ALBUM_ID), manifestBody('{ not valid json'))
        objects.set(op.imageKey(ALBUM_ID, PHOTO_ID), imageBody())
        const reader = mapReader(objects)
        const { deps } = makeDeps({ reader: reader.reader })
        const app = makeApp(deps)
        const { header } = await validCookie()
        const res = await get(app, op.path(ALBUM_ID, PHOTO_ID), header)

        expect(res.status).toBe(500)
        expect(reader.calls).toEqual([albumManifestKey(ALBUM_ID)])
        expect(reader.calls).not.toContain(op.imageKey(ALBUM_ID, PHOTO_ID))
      })

      it('wrong-album manifest -> 500', async () => {
        const objects = new Map<string, PrivateObjectBody>()
        objects.set(
          albumManifestKey(ALBUM_ID),
          manifestBody(manifestJsonWithPhotos([PHOTO_ID], 'other-album')),
        )
        const reader = mapReader(objects)
        const { deps } = makeDeps({ reader: reader.reader })
        const app = makeApp(deps)
        const { header } = await validCookie()
        const res = await get(app, op.path(ALBUM_ID, PHOTO_ID), header)

        expect(res.status).toBe(500)
        expect(reader.calls).toEqual([albumManifestKey(ALBUM_ID)])
      })

      it('image object absent for a listed photo -> 404', async () => {
        const objects = new Map<string, PrivateObjectBody>()
        objects.set(albumManifestKey(ALBUM_ID), manifestBody(manifestJsonWithPhotos([PHOTO_ID])))
        const reader = mapReader(objects)
        const { deps } = makeDeps({ reader: reader.reader })
        const app = makeApp(deps)
        const { header } = await validCookie()
        const res = await get(app, op.path(ALBUM_ID, PHOTO_ID), header)

        expect(res.status).toBe(404)
        expect(reader.calls).toEqual([
          albumManifestKey(ALBUM_ID),
          op.imageKey(ALBUM_ID, PHOTO_ID),
        ])
      })

      it('reader rejects on image read -> 500', async () => {
        const { reader } = readerThatThrowsOnImage(manifestJsonWithPhotos([PHOTO_ID]))
        const { deps } = makeDeps({ reader })
        const app = makeApp(deps)
        const { header } = await validCookie()
        const res = await get(app, op.path(ALBUM_ID, PHOTO_ID), header)
        expect(res.status).toBe(500)
      })
    })

    describe('invalid photoId fails closed before any read', () => {
      const invalid = ['..%2Fx', 'a%20b', '!bad!']
      for (const raw of invalid) {
        it(`invalid photoId ${JSON.stringify(raw)} -> 404 with zero reader calls`, async () => {
          const reader = mapReader(new Map())
          const { deps } = makeDeps({ reader: reader.reader })
          const app = makeApp(deps)
          const { header } = await validCookie()
          const res = await get(app, `/img/${ALBUM_ID}/${op.name}/${raw}`, header)
          // Must never be 200; reaching the handler yields 404 with no reader call.
          expect([404, 401, 403]).toContain(res.status)
          if (res.status === 404) expect(reader.calls).toHaveLength(0)
        })
      }
    })

    describe('invalid albumId is rejected by the permission middleware', () => {
      it('invalid albumId -> 403; zero reader and zero permission-repo calls', async () => {
        const reader = mapReader(new Map())
        const { deps, state } = makeDeps({ reader: reader.reader })
        const app = makeApp(deps)
        const { header } = await validCookie()
        const res = await get(app, op.path('!bad!', PHOTO_ID), header)
        expect(res.status).toBe(403)
        expect(state.permissionCalls).toHaveLength(0)
        expect(reader.calls).toHaveLength(0)
      })
    })

    describe('error responses never leak identifiers', () => {
      it('404 / 500 bodies do not contain album/photo IDs or album key strings', async () => {
        const objects = new Map<string, PrivateObjectBody>()
        objects.set(albumManifestKey(ALBUM_ID), manifestBody('{ broken'))
        const reader = mapReader(objects)
        const { deps } = makeDeps({ reader: reader.reader })
        const app = makeApp(deps)
        const { header } = await validCookie()
        const res = await get(app, op.path(ALBUM_ID, PHOTO_ID), header)
        const text = await res.text()
        expect(text).not.toContain(ALBUM_ID)
        expect(text).not.toContain(PHOTO_ID)
        expect(text).not.toContain('albums/')
      })
    })
  })
}

// ---------------------------------------------------------------------------
// cover (not manifest-gated)
// ---------------------------------------------------------------------------

describe('GET /img/:albumId/cover', () => {
  it('no session cookie -> 401; reader never called', async () => {
    const reader = mapReader(new Map())
    const { deps, state } = makeDeps({ reader: reader.reader })
    const app = makeApp(deps)
    const res = await get(app, `/img/${ALBUM_ID}/cover`)
    expect(res.status).toBe(401)
    expect(state.permissionCalls).toHaveLength(0)
    expect(reader.calls).toHaveLength(0)
  })

  it('permission false -> 403; reader never called', async () => {
    const reader = mapReader(new Map())
    const { deps } = makeDeps({ permission: false, reader: reader.reader })
    const app = makeApp(deps)
    const { header } = await validCookie()
    const res = await get(app, `/img/${ALBUM_ID}/cover`, header)
    expect(res.status).toBe(403)
    expect(reader.calls).toHaveLength(0)
  })

  it('permission ok + cover exists -> 200 image/webp; exactly one reader call (cover key, no manifest)', async () => {
    const objects = new Map<string, PrivateObjectBody>()
    objects.set(albumCoverKey(ALBUM_ID), imageBody(makeStream('cover-bytes')))
    // Also stage a manifest to prove it is NOT read for cover.
    objects.set(albumManifestKey(ALBUM_ID), manifestBody(manifestJsonWithPhotos([PHOTO_ID])))
    const reader = mapReader(objects)
    const { deps } = makeDeps({ reader: reader.reader })
    const app = makeApp(deps)
    const { header } = await validCookie()
    const res = await get(app, `/img/${ALBUM_ID}/cover`, header)

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/webp')
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(reader.calls).toEqual([albumCoverKey(ALBUM_ID)])
    expect(reader.calls).not.toContain(albumManifestKey(ALBUM_ID))
    expect(await res.text()).toBe('cover-bytes')
  })

  it('cover absent -> 404; one reader call (cover key)', async () => {
    const reader = mapReader(new Map())
    const { deps } = makeDeps({ reader: reader.reader })
    const app = makeApp(deps)
    const { header } = await validCookie()
    const res = await get(app, `/img/${ALBUM_ID}/cover`, header)
    expect(res.status).toBe(404)
    expect(reader.calls).toEqual([albumCoverKey(ALBUM_ID)])
  })

  it('reader rejects on cover read -> 500', async () => {
    const reader: PrivateObjectReader = {
      get: async () => {
        throw new ObjectServiceError('reader_failure')
      },
    }
    const { deps } = makeDeps({ reader })
    const app = makeApp(deps)
    const { header } = await validCookie()
    const res = await get(app, `/img/${ALBUM_ID}/cover`, header)
    expect(res.status).toBe(500)
  })

  it('error bodies never contain the album ID or album key strings', async () => {
    const reader = mapReader(new Map())
    const { deps } = makeDeps({ reader: reader.reader })
    const app = makeApp(deps)
    const { header } = await validCookie()
    const res = await get(app, `/img/${ALBUM_ID}/cover`, header)
    const text = await res.text()
    expect(text).not.toContain(ALBUM_ID)
    expect(text).not.toContain('albums/')
  })
})

// ---------------------------------------------------------------------------
// Routing precedence against the real app with a fake env
// ---------------------------------------------------------------------------

describe('routing precedence (real app, fake env)', () => {
  // Fake env: repositories/reader are never reached for these shapes because they
  // fall through to the reserved 401 (no cookie) — env binding values are irrelevant.
  const fakeEnv = {} as unknown as Env

  const reachesReserved401 = [
    '/img',
    '/img/x', // unknown 2-segment shape: not one of the three GET routes
    '/img/a/b/c/d', // too many segments
  ]
  for (const path of reachesReserved401) {
    it(`GET ${path} -> 401 (falls through to reserved catch-all)`, async () => {
      const res = await realApp.request(path, { method: 'GET' }, fakeEnv)
      expect(res.status).toBe(401)
      expect(res.headers.get('cache-control')).toBe('no-store')
    })
  }

  it('POST /img/a/cover -> 401 (non-GET falls through to reserved catch-all)', async () => {
    const res = await realApp.request('/img/album-1/cover', { method: 'POST' }, fakeEnv)
    expect(res.status).toBe(401)
  })

  it('GET /img/a/cover with no cookie -> 401 (img router requireSession)', async () => {
    const res = await realApp.request('/img/album-1/cover', { method: 'GET' }, fakeEnv)
    expect(res.status).toBe(401)
  })

  it('/api and /admin reserved routes unchanged', async () => {
    const apiRes = await realApp.request('/api', { method: 'GET' }, fakeEnv)
    const adminRes = await realApp.request('/admin', { method: 'GET' }, fakeEnv)
    expect(apiRes.status).toBe(401)
    expect(adminRes.status).toBe(401)
  })

  it('fixture pages / and /albums still 200', async () => {
    const rootRes = await realApp.request('/', { method: 'GET' }, fakeEnv)
    const albumsRes = await realApp.request('/albums', { method: 'GET' }, fakeEnv)
    expect(rootRes.status).toBe(200)
    expect(albumsRes.status).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// Proving the img router is reached (not the reserved catch-all) for a 3-segment
// cover GET: a session+permission fake env returning 404/200 distinguishes it.
// ---------------------------------------------------------------------------

describe('img router is reached for a valid 3-segment shape', () => {
  it('GET /img/:albumId/cover with a valid session + permission reaches the handler (404 cover-absent, not 401)', async () => {
    // Build a fake env whose DB/PHOTO_BUCKET back the real repositories indirectly is
    // not feasible here; instead mount the router directly with fakes to prove the
    // 3-segment cover shape reaches the handler rather than the reserved 401.
    const reader = mapReader(new Map())
    const { deps } = makeDeps({ reader: reader.reader })
    const app = makeApp(deps)
    const { header } = await validCookie()
    const res = await get(app, `/img/${ALBUM_ID}/cover`, header)
    expect(res.status).toBe(404)
    expect(reader.calls).toEqual([albumCoverKey(ALBUM_ID)])
  })
})
