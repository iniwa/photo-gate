import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { createPages } from '../src/routes/pages.js'
import type { PageDeps } from '../src/routes/pages.js'
import type { Env } from '../src/types/env.js'
import type { AuthVariables } from '../src/types/auth-context.js'
import type { SessionWithUser } from '../src/types/session.js'
import type { AuthorizedAlbumSummary } from '../src/types/authorized-album.js'
import type { PrivateObjectBody, PrivateObjectReader } from '../src/types/private-object.js'
import { albumManifestKey } from '../src/services/r2-object-key.js'
import { generateSessionToken, digestSessionToken } from '../src/services/auth-crypto.js'
import { COOKIE_NAME } from '../src/services/session-cookie.js'

const NOW = '2026-06-11T00:00:00.000Z'
const CLOCK = (): Date => new Date(NOW)
const USER_ID = 'viewer-1'
const ALBUM_ID = 'album-1'

function validSession(): SessionWithUser {
  return {
    token_hash: 'f'.repeat(64),
    user_id: USER_ID,
    expires_at: '2026-06-18T00:00:00.000Z',
    last_seen_at: NOW,
    user_enabled: 1,
  }
}

function manifestJson(photos: { id: string; title: string }[], albumId = ALBUM_ID): string {
  return JSON.stringify({
    schemaVersion: 1,
    albumId,
    title: 'Manifest Title (should not be shown)',
    source: { type: 'photoprism', albumUid: 'uid001' },
    generatedAt: '2026-06-09T10:00:00Z',
    images: {
      thumb: { longEdge: 400, format: 'webp', quality: 85 },
      preview: { longEdge: 1600, format: 'jpg', quality: 90 },
      stripExif: true,
    },
    photos: photos.map((p) => ({
      id: p.id,
      title: p.title,
      thumb: `thumbs/${p.id}.webp`,
      preview: `previews/${p.id}.jpg`,
      takenAt: '2026-05-01T12:00:00+09:00',
      width: 3000,
      height: 2000,
    })),
  })
}

function manifestBody(json: string): PrivateObjectBody {
  return { body: null, text: async () => json }
}

function mapReader(objects: Map<string, PrivateObjectBody>): PrivateObjectReader {
  return { get: async (key) => objects.get(key) ?? null }
}

interface ListCall {
  userId: string
  now: string
  limit: number
  after: string | undefined
}

interface FakeOptions {
  validSession?: SessionWithUser | null
  permission?: boolean
  albums?: AuthorizedAlbumSummary[]
  listThrows?: boolean
  summary?: AuthorizedAlbumSummary | null
  getThrows?: boolean
  reader?: PrivateObjectReader
}

interface FakeState {
  listCalls: ListCall[]
  getCalls: Array<{ userId: string; albumId: string; now: string }>
}

function makeDeps(opts: FakeOptions = {}): { deps: PageDeps; state: FakeState } {
  const state: FakeState = { listCalls: [], getCalls: [] }
  const deps: PageDeps = {
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
      async listAuthorizedAlbums(userId, now, limit, after) {
        state.listCalls.push({ userId, now, limit, after })
        if (opts.listThrows) throw new Error('D1 down')
        return opts.albums ?? []
      },
      async getAuthorizedAlbum(userId, albumId, now) {
        state.getCalls.push({ userId, albumId, now })
        if (opts.getThrows) throw new Error('D1 down')
        return opts.summary === undefined
          ? { id: albumId, title: 'D1 Album Title', download_enabled: 0 }
          : opts.summary
      },
    },
    reader: opts.reader ?? mapReader(new Map()),
    clock: CLOCK,
  }
  return { deps, state }
}

function makeApp(deps: PageDeps): Hono<{ Bindings: Env; Variables: AuthVariables }> {
  const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>()
  app.route('/', createPages(() => deps))
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

// Strings that must never appear in any response body.
function assertNoSensitive(text: string): void {
  expect(text).not.toContain('albums/')
  expect(text).not.toContain(USER_ID)
}

describe('GET /', () => {
  it('valid session -> 303 to /albums, no-store', async () => {
    const { deps } = makeDeps({ validSession: validSession() })
    const app = makeApp(deps)
    const res = await get(app, '/', await validCookie())
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/albums')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('no session -> 200 login form', async () => {
    const { deps } = makeDeps({ validSession: null })
    const app = makeApp(deps)
    const res = await get(app, '/')
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('action="/api/auth/login"')
  })

  it('error=1 shows the generic message', async () => {
    const { deps } = makeDeps({ validSession: null })
    const app = makeApp(deps)
    const res = await get(app, '/?error=1')
    expect(await res.text()).toContain('ユーザーIDまたはパスワードが正しくありません')
  })
})

describe('GET /albums', () => {
  it('no session -> 303 to /', async () => {
    const { deps } = makeDeps({ validSession: null })
    const app = makeApp(deps)
    const res = await get(app, '/albums', await validCookie())
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/')
  })

  it('valid session -> 200 with the user albums, escaped titles, cover URLs, links', async () => {
    const albums: AuthorizedAlbumSummary[] = [
      { id: 'album-a', title: '<b>x</b>', download_enabled: 0 },
      { id: 'album-b', title: 'Second', download_enabled: 0 },
    ]
    const { deps } = makeDeps({ albums })
    const app = makeApp(deps)
    const res = await get(app, '/albums', await validCookie())
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('private, no-cache')
    const text = await res.text()
    // Title is auto-escaped, never raw.
    expect(text).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(text).not.toContain('<b>x</b>')
    // Cover img and detail link per album.
    expect(text).toContain('src="/img/album-a/cover"')
    expect(text).toContain('href="/albums/album-a"')
    expect(text).toContain('src="/img/album-b/cover"')
    // No next link below the page size.
    expect(text).not.toContain('次へ')
  })

  it('empty list -> friendly message', async () => {
    const { deps } = makeDeps({ albums: [] })
    const app = makeApp(deps)
    const res = await get(app, '/albums', await validCookie())
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('閲覧できるアルバムがありません')
  })

  it('exactly 50 results -> next link with the last ID', async () => {
    const albums: AuthorizedAlbumSummary[] = Array.from({ length: 50 }, (_, i) => ({
      id: `album-${String(i).padStart(3, '0')}`,
      title: `Album ${i}`,
      download_enabled: 0 as const,
    }))
    const { deps } = makeDeps({ albums })
    const app = makeApp(deps)
    const res = await get(app, '/albums', await validCookie())
    const text = await res.text()
    expect(text).toContain('次へ')
    expect(text).toContain('href="/albums?after=album-049"')
  })

  it('valid after cursor is forwarded to the repository', async () => {
    const { deps, state } = makeDeps({ albums: [] })
    const app = makeApp(deps)
    await get(app, '/albums?after=album-042', await validCookie())
    expect(state.listCalls).toHaveLength(1)
    expect(state.listCalls[0]).toEqual({ userId: USER_ID, now: NOW, limit: 50, after: 'album-042' })
  })

  it('invalid after cursor -> repo called WITHOUT cursor (first page)', async () => {
    const { deps, state } = makeDeps({ albums: [] })
    const app = makeApp(deps)
    await get(app, '/albums?after=' + encodeURIComponent('!bad!'), await validCookie())
    expect(state.listCalls).toHaveLength(1)
    expect(state.listCalls[0]!.after).toBeUndefined()
  })

  it('repo throws -> 500 generic, no userId, no-store', async () => {
    const { deps } = makeDeps({ listThrows: true })
    const app = makeApp(deps)
    const res = await get(app, '/albums', await validCookie())
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const text = await res.text()
    assertNoSensitive(text)
    expect(text).not.toContain('D1 down')
  })

  it('logout button present on the authenticated albums page', async () => {
    const { deps } = makeDeps({ albums: [{ id: 'a', title: 'A', download_enabled: 0 }] })
    const app = makeApp(deps)
    const res = await get(app, '/albums', await validCookie())
    const text = await res.text()
    expect(text).toContain('action="/api/auth/logout"')
  })
})

describe('GET /albums/:albumId', () => {
  it('no session -> 303 to /', async () => {
    const { deps } = makeDeps({ validSession: null })
    const app = makeApp(deps)
    const res = await get(app, `/albums/${ALBUM_ID}`, await validCookie())
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/')
  })

  it('no permission -> 403 generic', async () => {
    const { deps } = makeDeps({ permission: false })
    const app = makeApp(deps)
    const res = await get(app, `/albums/${ALBUM_ID}`, await validCookie())
    expect(res.status).toBe(403)
  })

  it('permission ok, manifest found -> 200 thumb/preview URLs in order, D1 title heading', async () => {
    const objects = new Map<string, PrivateObjectBody>()
    objects.set(
      albumManifestKey(ALBUM_ID),
      manifestBody(
        manifestJson([
          { id: 'photo-1', title: 'First <i>photo</i>' },
          { id: 'photo-2', title: 'Second' },
        ]),
      ),
    )
    const { deps } = makeDeps({ reader: mapReader(objects) })
    const app = makeApp(deps)
    const res = await get(app, `/albums/${ALBUM_ID}`, await validCookie())
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('private, no-cache')
    const text = await res.text()
    // D1 title is the heading; manifest title is not shown.
    expect(text).toContain('D1 Album Title')
    expect(text).not.toContain('Manifest Title (should not be shown)')
    // thumb img src + photo preview page link per photo, in manifest order.
    const firstThumb = text.indexOf('/img/album-1/thumb/photo-1')
    const secondThumb = text.indexOf('/img/album-1/thumb/photo-2')
    expect(firstThumb).toBeGreaterThan(-1)
    expect(secondThumb).toBeGreaterThan(firstThumb)
    expect(text).toContain('href="/albums/album-1/photos/photo-1"')
    expect(text).toContain('href="/albums/album-1/photos/photo-2"')
    // Photo title used as alt text, escaped.
    expect(text).toContain('First &lt;i&gt;photo&lt;/i&gt;')
    expect(text).not.toContain('First <i>photo</i>')
    // No EXIF / dimension metadata.
    expect(text).not.toContain('3000')
    expect(text).not.toContain('2026-05-01')
    // Logout + back link.
    expect(text).toContain('action="/api/auth/logout"')
    expect(text).toContain('href="/albums"')
  })

  it('manifest not_found -> 200 準備中 page with the album title', async () => {
    const { deps } = makeDeps({ reader: mapReader(new Map()) })
    const app = makeApp(deps)
    const res = await get(app, `/albums/${ALBUM_ID}`, await validCookie())
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('このアルバムは準備中です')
    expect(text).toContain('D1 Album Title')
  })

  it('manifest invalid -> 500 generic', async () => {
    const objects = new Map<string, PrivateObjectBody>()
    objects.set(albumManifestKey(ALBUM_ID), manifestBody('{ not valid json'))
    const { deps } = makeDeps({ reader: mapReader(objects) })
    const app = makeApp(deps)
    const res = await get(app, `/albums/${ALBUM_ID}`, await validCookie())
    expect(res.status).toBe(500)
    assertNoSensitive(await res.text())
  })

  it('getAuthorizedAlbum null -> 403 (raced away, fail closed)', async () => {
    const { deps } = makeDeps({ summary: null })
    const app = makeApp(deps)
    const res = await get(app, `/albums/${ALBUM_ID}`, await validCookie())
    expect(res.status).toBe(403)
  })

  it('getAuthorizedAlbum throws -> 500 generic', async () => {
    const { deps } = makeDeps({ getThrows: true })
    const app = makeApp(deps)
    const res = await get(app, `/albums/${ALBUM_ID}`, await validCookie())
    expect(res.status).toBe(500)
    const text = await res.text()
    assertNoSensitive(text)
    expect(text).not.toContain('D1 down')
  })

  it('download_enabled=1 renders /download/ links per photo', async () => {
    const objects = new Map<string, PrivateObjectBody>()
    objects.set(
      albumManifestKey(ALBUM_ID),
      manifestBody(
        manifestJson([
          { id: 'photo-1', title: 'First' },
          { id: 'photo-2', title: 'Second' },
        ]),
      ),
    )
    const { deps } = makeDeps({
      summary: { id: ALBUM_ID, title: 'D1 Album Title', download_enabled: 1 },
      reader: mapReader(objects),
    })
    const app = makeApp(deps)
    const res = await get(app, `/albums/${ALBUM_ID}`, await validCookie())
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain(`href="/download/${ALBUM_ID}/preview/photo-1"`)
    expect(text).toContain(`href="/download/${ALBUM_ID}/preview/photo-2"`)
    expect(text).toContain('ダウンロード')
  })

  it('download_enabled=0 renders no /download/ links', async () => {
    const objects = new Map<string, PrivateObjectBody>()
    objects.set(
      albumManifestKey(ALBUM_ID),
      manifestBody(
        manifestJson([{ id: 'photo-1', title: 'First' }]),
      ),
    )
    const { deps } = makeDeps({
      summary: { id: ALBUM_ID, title: 'D1 Album Title', download_enabled: 0 },
      reader: mapReader(objects),
    })
    const app = makeApp(deps)
    const res = await get(app, `/albums/${ALBUM_ID}`, await validCookie())
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).not.toContain('/download/')
    expect(text).not.toContain('ダウンロード')
  })
})

describe('GET /albums/:albumId/photos/:photoId', () => {
  const PHOTO_1 = 'photo-1'
  const PHOTO_2 = 'photo-2'
  const PHOTO_3 = 'photo-3'

  function threePhotoManifest(): PrivateObjectReader {
    const objects = new Map<string, PrivateObjectBody>()
    objects.set(
      albumManifestKey(ALBUM_ID),
      manifestBody(
        manifestJson([
          { id: PHOTO_1, title: 'First Photo' },
          { id: PHOTO_2, title: 'Second Photo' },
          { id: PHOTO_3, title: 'Third Photo' },
        ]),
      ),
    )
    return mapReader(objects)
  }

  it('no session -> 303 to /', async () => {
    const { deps } = makeDeps({ validSession: null })
    const app = makeApp(deps)
    const res = await get(app, `/albums/${ALBUM_ID}/photos/${PHOTO_1}`, await validCookie())
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/')
  })

  it('no permission -> 403 generic', async () => {
    const { deps } = makeDeps({ permission: false })
    const app = makeApp(deps)
    const res = await get(app, `/albums/${ALBUM_ID}/photos/${PHOTO_1}`, await validCookie())
    expect(res.status).toBe(403)
  })

  it('invalid photoId -> 404, no R2 read', async () => {
    let readerCalled = false
    const { deps } = makeDeps({
      reader: { get: async () => { readerCalled = true; return null } },
    })
    const app = makeApp(deps)
    const res = await get(app, `/albums/${ALBUM_ID}/photos/!bad!`, await validCookie())
    expect(res.status).toBe(404)
    expect(readerCalled).toBe(false)
  })

  it('getAuthorizedAlbum null -> 403 (raced away)', async () => {
    const { deps } = makeDeps({ summary: null, reader: threePhotoManifest() })
    const app = makeApp(deps)
    const res = await get(app, `/albums/${ALBUM_ID}/photos/${PHOTO_1}`, await validCookie())
    expect(res.status).toBe(403)
  })

  it('getAuthorizedAlbum throws -> 500 generic, no sensitive data', async () => {
    const { deps } = makeDeps({ getThrows: true })
    const app = makeApp(deps)
    const res = await get(app, `/albums/${ALBUM_ID}/photos/${PHOTO_1}`, await validCookie())
    expect(res.status).toBe(500)
    const text = await res.text()
    assertNoSensitive(text)
    expect(text).not.toContain('D1 down')
  })

  it('manifest not_found -> 404, no sensitive data', async () => {
    const { deps } = makeDeps({ reader: mapReader(new Map()) })
    const app = makeApp(deps)
    const res = await get(app, `/albums/${ALBUM_ID}/photos/${PHOTO_1}`, await validCookie())
    expect(res.status).toBe(404)
    assertNoSensitive(await res.text())
  })

  it('manifest invalid -> 500 generic, no sensitive data', async () => {
    const objects = new Map<string, PrivateObjectBody>()
    objects.set(albumManifestKey(ALBUM_ID), manifestBody('{ not valid'))
    const { deps } = makeDeps({ reader: mapReader(objects) })
    const app = makeApp(deps)
    const res = await get(app, `/albums/${ALBUM_ID}/photos/${PHOTO_1}`, await validCookie())
    expect(res.status).toBe(500)
    assertNoSensitive(await res.text())
  })

  it('photo not in manifest -> 404', async () => {
    const objects = new Map<string, PrivateObjectBody>()
    objects.set(
      albumManifestKey(ALBUM_ID),
      manifestBody(manifestJson([{ id: 'photo-other', title: 'Other' }])),
    )
    const { deps } = makeDeps({ reader: mapReader(objects) })
    const app = makeApp(deps)
    const res = await get(app, `/albums/${ALBUM_ID}/photos/${PHOTO_1}`, await validCookie())
    expect(res.status).toBe(404)
  })

  it('success: 200, private no-cache, img src is /img route, back link, no EXIF', async () => {
    const { deps } = makeDeps({ reader: threePhotoManifest() })
    const app = makeApp(deps)
    const res = await get(app, `/albums/${ALBUM_ID}/photos/${PHOTO_1}`, await validCookie())
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('private, no-cache')
    const text = await res.text()
    expect(text).toContain(`src="/img/${ALBUM_ID}/preview/${PHOTO_1}"`)
    expect(text).toContain(`href="/albums/${ALBUM_ID}"`)
    expect(text).not.toContain('3000')
    expect(text).not.toContain('2026-05-01')
  })

  it('photo title used as escaped alt text', async () => {
    const objects = new Map<string, PrivateObjectBody>()
    objects.set(
      albumManifestKey(ALBUM_ID),
      manifestBody(manifestJson([{ id: PHOTO_1, title: 'Beach <b>sunset</b>' }])),
    )
    const { deps } = makeDeps({ reader: mapReader(objects) })
    const app = makeApp(deps)
    const res = await get(app, `/albums/${ALBUM_ID}/photos/${PHOTO_1}`, await validCookie())
    const text = await res.text()
    expect(text).toContain('alt="Beach &lt;b&gt;sunset&lt;/b&gt;"')
    expect(text).not.toContain('<b>sunset</b>')
  })

  it('first photo: no prev link, next link present', async () => {
    const { deps } = makeDeps({ reader: threePhotoManifest() })
    const app = makeApp(deps)
    const res = await get(app, `/albums/${ALBUM_ID}/photos/${PHOTO_1}`, await validCookie())
    const text = await res.text()
    expect(text).not.toContain('前の写真')
    expect(text).toContain(`href="/albums/${ALBUM_ID}/photos/${PHOTO_2}"`)
    expect(text).toContain('次の写真')
  })

  it('last photo: prev link present, no next link', async () => {
    const { deps } = makeDeps({ reader: threePhotoManifest() })
    const app = makeApp(deps)
    const res = await get(app, `/albums/${ALBUM_ID}/photos/${PHOTO_3}`, await validCookie())
    const text = await res.text()
    expect(text).toContain(`href="/albums/${ALBUM_ID}/photos/${PHOTO_2}"`)
    expect(text).toContain('前の写真')
    expect(text).not.toContain('次の写真')
  })

  it('middle photo: both prev and next links present', async () => {
    const { deps } = makeDeps({ reader: threePhotoManifest() })
    const app = makeApp(deps)
    const res = await get(app, `/albums/${ALBUM_ID}/photos/${PHOTO_2}`, await validCookie())
    const text = await res.text()
    expect(text).toContain(`href="/albums/${ALBUM_ID}/photos/${PHOTO_1}"`)
    expect(text).toContain('前の写真')
    expect(text).toContain(`href="/albums/${ALBUM_ID}/photos/${PHOTO_3}"`)
    expect(text).toContain('次の写真')
  })

  it('single photo: no prev or next link', async () => {
    const objects = new Map<string, PrivateObjectBody>()
    objects.set(
      albumManifestKey(ALBUM_ID),
      manifestBody(manifestJson([{ id: PHOTO_1, title: 'Only Photo' }])),
    )
    const { deps } = makeDeps({ reader: mapReader(objects) })
    const app = makeApp(deps)
    const res = await get(app, `/albums/${ALBUM_ID}/photos/${PHOTO_1}`, await validCookie())
    const text = await res.text()
    expect(text).not.toContain('前の写真')
    expect(text).not.toContain('次の写真')
  })

  it('download_enabled=1 renders download link', async () => {
    const { deps } = makeDeps({
      summary: { id: ALBUM_ID, title: 'D1 Album Title', download_enabled: 1 },
      reader: threePhotoManifest(),
    })
    const app = makeApp(deps)
    const res = await get(app, `/albums/${ALBUM_ID}/photos/${PHOTO_1}`, await validCookie())
    const text = await res.text()
    expect(text).toContain(`href="/download/${ALBUM_ID}/preview/${PHOTO_1}"`)
    expect(text).toContain('ダウンロード')
  })

  it('download_enabled=0 renders no download link', async () => {
    const { deps } = makeDeps({
      summary: { id: ALBUM_ID, title: 'D1 Album Title', download_enabled: 0 },
      reader: threePhotoManifest(),
    })
    const app = makeApp(deps)
    const res = await get(app, `/albums/${ALBUM_ID}/photos/${PHOTO_1}`, await validCookie())
    const text = await res.text()
    expect(text).not.toContain('/download/')
    expect(text).not.toContain('ダウンロード')
  })

  it('page does not read the preview object directly', async () => {
    const previewKey = `albums/${ALBUM_ID}/previews/${PHOTO_1}.jpg`
    let previewReads = 0
    const objects = new Map<string, PrivateObjectBody>()
    objects.set(
      albumManifestKey(ALBUM_ID),
      manifestBody(manifestJson([{ id: PHOTO_1, title: 'Photo' }])),
    )
    const reader: PrivateObjectReader = {
      get: async (key) => {
        if (key === previewKey) previewReads++
        return objects.get(key) ?? null
      },
    }
    const { deps } = makeDeps({ reader })
    const app = makeApp(deps)
    await get(app, `/albums/${ALBUM_ID}/photos/${PHOTO_1}`, await validCookie())
    expect(previewReads).toBe(0)
  })
})
