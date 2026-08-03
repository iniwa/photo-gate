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

function manifestJson(
  photos: Array<{
    id: string
    title: string
    takenAt?: string
    width?: number
    height?: number
  }>,
  albumId = ALBUM_ID,
): string {
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
      takenAt: p.takenAt ?? '2026-05-01T12:00:00+09:00',
      width: p.width ?? 3000,
      height: p.height ?? 2000,
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
  it('renders ordered timeline sections, repeated dates, ratio classes, and dimensions', async () => {
    const objects = new Map<string, PrivateObjectBody>()
    objects.set(albumManifestKey(ALBUM_ID), manifestBody(manifestJson([
      { id: 'photo-a', title: 'A', takenAt: '2026-05-01T12:00:00+09:00', width: 1000, height: 1000 },
      { id: 'photo-b', title: 'B', takenAt: '2026-05-02T12:00:00+09:00', width: 2000, height: 1000 },
      { id: 'photo-c', title: 'C', takenAt: '2026-05-01T13:00:00+09:00', width: 1000, height: 2000 },
    ])))
    const { deps } = makeDeps({ reader: mapReader(objects) })
    const text = await (await get(makeApp(deps), `/albums/${ALBUM_ID}`, await validCookie())).text()
    expect(text.indexOf('5月1日')).toBeLessThan(text.indexOf('5月2日'))
    expect(text.lastIndexOf('5月1日')).toBeGreaterThan(text.indexOf('5月2日'))
    expect(text).toContain('class="timeline-cell ar-100"')
    expect(text).toContain('class="timeline-cell ar-200"')
    expect(text).toContain('class="timeline-cell ar-050"')
    expect(text).toContain('width="2000" height="1000"')
    expect(text).not.toContain('class="contact-sheet"')
    expect(text).not.toContain('style=')
  })

  it('renders an empty album state without a grid', async () => {
    const objects = new Map<string, PrivateObjectBody>()
    objects.set(albumManifestKey(ALBUM_ID), manifestBody(manifestJson([])))
    const { deps } = makeDeps({ reader: mapReader(objects) })
    const text = await (await get(makeApp(deps), `/albums/${ALBUM_ID}`, await validCookie())).text()
    expect(text).toContain('写真がまだありません')
    expect(text).toContain('href="/albums"')
    expect(text).not.toContain('justified-grid')
    expect(text).not.toContain('contact-sheet')
  })
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
    // Manifest dimensions are emitted as responsive image attributes.
    expect(text).toContain('width="3000"')
    expect(text).toContain('height="2000"')
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

  it('download_enabled=1 grid renders no per-photo download links (selection replaces them)', async () => {
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
    expect(text).not.toContain(`href="/download/${ALBUM_ID}/preview/photo-1"`)
    expect(text).not.toContain(`href="/download/${ALBUM_ID}/preview/photo-2"`)
    expect(text).not.toContain(`href="/download/${ALBUM_ID}/thumb/photo-1"`)
    expect(text).not.toContain(`href="/download/${ALBUM_ID}/thumb/photo-2"`)
    expect(text).not.toContain('低画質ダウンロード')
    expect(text).not.toContain('高画質ダウンロード')
  })

  it('download_enabled=1 grid renders a checkbox per photo, wrapped in the selection form', async () => {
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
    const text = await res.text()
    expect(text).toContain(`action="/download/${ALBUM_ID}/selection"`)
    expect(text).toContain('aria-label="「First」を選択"')
    expect(text).toContain('aria-label="「Second」を選択"')
  })

  it('download_enabled=1 album detail: no RAW download link', async () => {
    const objects = new Map<string, PrivateObjectBody>()
    objects.set(albumManifestKey(ALBUM_ID), manifestBody(manifestJson([{ id: 'photo-1', title: 'P' }])))
    const { deps } = makeDeps({
      summary: { id: ALBUM_ID, title: 'D1 Album Title', download_enabled: 1 },
      reader: mapReader(objects),
    })
    const app = makeApp(deps)
    const res = await get(app, `/albums/${ALBUM_ID}`, await validCookie())
    const text = await res.text()
    expect(text).not.toContain('/download/' + ALBUM_ID + '/raw/')
    expect(text.toLowerCase()).not.toContain('original')
    expect(text.toLowerCase()).not.toContain('raw')
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

  it('download_enabled=1 renders multi-select form with correct action', async () => {
    const objects = new Map<string, PrivateObjectBody>()
    objects.set(
      albumManifestKey(ALBUM_ID),
      manifestBody(manifestJson([{ id: 'photo-1', title: 'First' }])),
    )
    const { deps } = makeDeps({
      summary: { id: ALBUM_ID, title: 'D1 Album Title', download_enabled: 1 },
      reader: mapReader(objects),
    })
    const app = makeApp(deps)
    const res = await get(app, `/albums/${ALBUM_ID}`, await validCookie())
    const text = await res.text()
    expect(text).toContain(`action="/download/${ALBUM_ID}/selection"`)
    expect(text).toContain('method="post"')
  })

  it('download_enabled=1 multi-select form has photoId checkboxes for each photo', async () => {
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
    const text = await res.text()
    expect(text).toContain('name="photoId"')
    expect(text).toContain('value="photo-1"')
    expect(text).toContain('value="photo-2"')
    expect(text).toContain('type="checkbox"')
  })

  it('download_enabled=1 multi-select form has variant select with thumb and preview options', async () => {
    const objects = new Map<string, PrivateObjectBody>()
    objects.set(albumManifestKey(ALBUM_ID), manifestBody(manifestJson([{ id: 'photo-1', title: 'P' }])))
    const { deps } = makeDeps({
      summary: { id: ALBUM_ID, title: 'D1 Album Title', download_enabled: 1 },
      reader: mapReader(objects),
    })
    const app = makeApp(deps)
    const res = await get(app, `/albums/${ALBUM_ID}`, await validCookie())
    const text = await res.text()
    expect(text).toContain('name="variant"')
    expect(text).toContain('value="thumb"')
    expect(text).toContain('value="preview"')
  })

  it('download_enabled=0 renders no multi-select form', async () => {
    const objects = new Map<string, PrivateObjectBody>()
    objects.set(albumManifestKey(ALBUM_ID), manifestBody(manifestJson([{ id: 'photo-1', title: 'P' }])))
    const { deps } = makeDeps({
      summary: { id: ALBUM_ID, title: 'D1 Album Title', download_enabled: 0 },
      reader: mapReader(objects),
    })
    const app = makeApp(deps)
    const res = await get(app, `/albums/${ALBUM_ID}`, await validCookie())
    const text = await res.text()
    expect(text).not.toContain('selection')
    expect(text).not.toContain('name="photoId"')
    expect(text).not.toContain('name="variant"')
  })

  it('download_enabled=1 multi-select form: no RAW option in variant select', async () => {
    const objects = new Map<string, PrivateObjectBody>()
    objects.set(albumManifestKey(ALBUM_ID), manifestBody(manifestJson([{ id: 'photo-1', title: 'P' }])))
    const { deps } = makeDeps({
      summary: { id: ALBUM_ID, title: 'D1 Album Title', download_enabled: 1 },
      reader: mapReader(objects),
    })
    const app = makeApp(deps)
    const res = await get(app, `/albums/${ALBUM_ID}`, await validCookie())
    const text = await res.text()
    expect(text.toLowerCase()).not.toContain('value="raw"')
    expect(text.toLowerCase()).not.toContain('original')
  })

  it('shows photo count derived from manifest length', async () => {
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
    const { deps } = makeDeps({ reader: mapReader(objects) })
    const app = makeApp(deps)
    const res = await get(app, `/albums/${ALBUM_ID}`, await validCookie())
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('2枚')
  })

  it('renders photo titles as grid thumbnail alt text, JSX-escaped (captions removed from the grid)', async () => {
    const objects = new Map<string, PrivateObjectBody>()
    objects.set(
      albumManifestKey(ALBUM_ID),
      manifestBody(manifestJson([{ id: 'photo-1', title: 'Caption <b>bold</b>' }])),
    )
    const { deps } = makeDeps({ reader: mapReader(objects) })
    const app = makeApp(deps)
    const res = await get(app, `/albums/${ALBUM_ID}`, await validCookie())
    const text = await res.text()
    expect(text).toContain('alt="Caption &lt;b&gt;bold&lt;/b&gt;"')
    expect(text).not.toContain('Caption <b>bold</b>')
    expect(text).not.toContain('class="photo-caption"')
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

  it('first photo: no prev link, next link present, disabled prev placeholder', async () => {
    const { deps } = makeDeps({ reader: threePhotoManifest() })
    const app = makeApp(deps)
    const res = await get(app, `/albums/${ALBUM_ID}/photos/${PHOTO_1}`, await validCookie())
    const text = await res.text()
    expect(text).not.toContain('data-nav="prev"')
    expect(text).toContain(`href="/albums/${ALBUM_ID}/photos/${PHOTO_2}"`)
    expect(text).toContain('data-nav="next"')
    expect(text).toContain('preview-nav-disabled')
  })

  it('last photo: prev link present, no next link, disabled next placeholder', async () => {
    const { deps } = makeDeps({ reader: threePhotoManifest() })
    const app = makeApp(deps)
    const res = await get(app, `/albums/${ALBUM_ID}/photos/${PHOTO_3}`, await validCookie())
    const text = await res.text()
    expect(text).toContain(`href="/albums/${ALBUM_ID}/photos/${PHOTO_2}"`)
    expect(text).toContain('data-nav="prev"')
    expect(text).not.toContain('data-nav="next"')
    expect(text).toContain('preview-nav-disabled')
  })

  it('middle photo: both prev and next links present', async () => {
    const { deps } = makeDeps({ reader: threePhotoManifest() })
    const app = makeApp(deps)
    const res = await get(app, `/albums/${ALBUM_ID}/photos/${PHOTO_2}`, await validCookie())
    const text = await res.text()
    expect(text).toContain(`href="/albums/${ALBUM_ID}/photos/${PHOTO_1}"`)
    expect(text).toContain('data-nav="prev"')
    expect(text).toContain(`href="/albums/${ALBUM_ID}/photos/${PHOTO_3}"`)
    expect(text).toContain('data-nav="next"')
    expect(text).not.toContain('preview-nav-disabled')
  })

  it('single photo: no prev or next link, both placeholders disabled', async () => {
    const objects = new Map<string, PrivateObjectBody>()
    objects.set(
      albumManifestKey(ALBUM_ID),
      manifestBody(manifestJson([{ id: PHOTO_1, title: 'Only Photo' }])),
    )
    const { deps } = makeDeps({ reader: mapReader(objects) })
    const app = makeApp(deps)
    const res = await get(app, `/albums/${ALBUM_ID}/photos/${PHOTO_1}`, await validCookie())
    const text = await res.text()
    expect(text).not.toContain('data-nav="prev"')
    expect(text).not.toContain('data-nav="next"')
    expect(text).not.toContain('rel="prefetch"')
  })

  it('next photo exists -> prefetch link for its preview image', async () => {
    const { deps } = makeDeps({ reader: threePhotoManifest() })
    const app = makeApp(deps)
    const res = await get(app, `/albums/${ALBUM_ID}/photos/${PHOTO_1}`, await validCookie())
    const text = await res.text()
    expect(text).toContain(`<link rel="prefetch" href="/img/${ALBUM_ID}/preview/${PHOTO_2}"/>`)
  })

  it('last photo (no next) -> no prefetch link', async () => {
    const { deps } = makeDeps({ reader: threePhotoManifest() })
    const app = makeApp(deps)
    const res = await get(app, `/albums/${ALBUM_ID}/photos/${PHOTO_3}`, await validCookie())
    const text = await res.text()
    expect(text).not.toContain('rel="prefetch"')
  })

  it('no <header> chrome on the immersive preview page', async () => {
    const { deps } = makeDeps({ reader: threePhotoManifest() })
    const app = makeApp(deps)
    const res = await get(app, `/albums/${ALBUM_ID}/photos/${PHOTO_1}`, await validCookie())
    const text = await res.text()
    expect(text).not.toContain('<header>')
    expect(text).toContain('class="immersive"')
  })

  it('back link shows the album title', async () => {
    const { deps } = makeDeps({
      summary: { id: ALBUM_ID, title: 'My Album', download_enabled: 0 },
      reader: threePhotoManifest(),
    })
    const app = makeApp(deps)
    const res = await get(app, `/albums/${ALBUM_ID}/photos/${PHOTO_1}`, await validCookie())
    const text = await res.text()
    expect(text).toContain('My Album')
    expect(text).toContain(`href="/albums/${ALBUM_ID}"`)
  })

  it('download_enabled=1 renders the 保存 download menu', async () => {
    const { deps } = makeDeps({
      summary: { id: ALBUM_ID, title: 'D1 Album Title', download_enabled: 1 },
      reader: threePhotoManifest(),
    })
    const app = makeApp(deps)
    const res = await get(app, `/albums/${ALBUM_ID}/photos/${PHOTO_1}`, await validCookie())
    const text = await res.text()
    expect(text).toContain(`href="/download/${ALBUM_ID}/preview/${PHOTO_1}"`)
    expect(text).toContain('保存')
    expect(text).toContain('<details')
  })

  it('download_enabled=1 renders thumb download link on photo preview page', async () => {
    const { deps } = makeDeps({
      summary: { id: ALBUM_ID, title: 'D1 Album Title', download_enabled: 1 },
      reader: threePhotoManifest(),
    })
    const app = makeApp(deps)
    const res = await get(app, `/albums/${ALBUM_ID}/photos/${PHOTO_1}`, await validCookie())
    const text = await res.text()
    expect(text).toContain(`href="/download/${ALBUM_ID}/thumb/${PHOTO_1}"`)
  })

  it('download_enabled=1 photo preview: no RAW download link', async () => {
    const { deps } = makeDeps({
      summary: { id: ALBUM_ID, title: 'D1 Album Title', download_enabled: 1 },
      reader: threePhotoManifest(),
    })
    const app = makeApp(deps)
    const res = await get(app, `/albums/${ALBUM_ID}/photos/${PHOTO_1}`, await validCookie())
    const text = await res.text()
    expect(text).not.toContain('/download/' + ALBUM_ID + '/raw/')
    expect(text.toLowerCase()).not.toContain('original')
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
    expect(text).not.toContain('保存')
    expect(text).not.toContain('<details')
  })

  it('renders photo title as visible page content, JSX-escaped', async () => {
    const objects = new Map<string, PrivateObjectBody>()
    objects.set(
      albumManifestKey(ALBUM_ID),
      manifestBody(manifestJson([{ id: PHOTO_1, title: 'Sunset <script>alert(1)</script>' }])),
    )
    const { deps } = makeDeps({ reader: mapReader(objects) })
    const app = makeApp(deps)
    const res = await get(app, `/albums/${ALBUM_ID}/photos/${PHOTO_1}`, await validCookie())
    const text = await res.text()
    expect(text).toContain('Sunset &lt;script&gt;alert(1)&lt;/script&gt;')
    expect(text).not.toContain('<script>')
  })

  it('renders position indicator (first photo: 1 / 3)', async () => {
    const { deps } = makeDeps({ reader: threePhotoManifest() })
    const app = makeApp(deps)
    const res = await get(app, `/albums/${ALBUM_ID}/photos/${PHOTO_1}`, await validCookie())
    const text = await res.text()
    expect(text).toContain('1 / 3')
  })

  it('renders position indicator (middle photo: 2 / 3)', async () => {
    const { deps } = makeDeps({ reader: threePhotoManifest() })
    const app = makeApp(deps)
    const res = await get(app, `/albums/${ALBUM_ID}/photos/${PHOTO_2}`, await validCookie())
    const text = await res.text()
    expect(text).toContain('2 / 3')
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
