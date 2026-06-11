import { describe, it, expect } from 'vitest'
import { app } from '../src/index.js'
import { generateSessionToken, digestSessionToken } from '../src/services/auth-crypto.js'
import { COOKIE_NAME } from '../src/services/session-cookie.js'

const SECURITY_HEADERS = [
  'content-security-policy',
  'x-content-type-options',
  'x-frame-options',
  'referrer-policy',
  'permissions-policy',
]

function hasSecurityHeaders(res: Response): void {
  for (const header of SECURITY_HEADERS) {
    expect(res.headers.get(header), `missing ${header}`).toBeTruthy()
  }
}

// Minimal fake env: bindings are undefined, so repository/reader calls reject.
// The public `/` probe falls back to the login form (fail-safe), authenticated
// pages fail closed, and reserved routes stay 401.
const fakeEnv = {} as unknown as Parameters<typeof app.request>[2]

async function validCookieHeader(): Promise<string> {
  const token = generateSessionToken()
  await digestSessionToken(token)
  return `${COOKIE_NAME}=${token}`
}

describe('GET / (login form, fail-safe probe)', () => {
  it('unauthenticated -> 200 HTML login form posting to /api/auth/login', async () => {
    const res = await app.request('/', {}, fakeEnv)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    const text = await res.text()
    expect(text).toContain('action="/api/auth/login"')
    expect(text).toContain('name="userId"')
    expect(text).toContain('name="password"')
  })

  it('has Cache-Control: private, no-cache', async () => {
    const res = await app.request('/', {}, fakeEnv)
    expect(res.headers.get('cache-control')).toBe('private, no-cache')
  })

  it('has security headers', async () => {
    const res = await app.request('/', {}, fakeEnv)
    hasSecurityHeaders(res)
  })

  it('error=1 shows the generic credential error message', async () => {
    const res = await app.request('/?error=1', {}, fakeEnv)
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('ユーザーIDまたはパスワードが正しくありません')
  })

  it('other query values do NOT show the error and are never echoed', async () => {
    const probe = '<script>alert(1)</script>'
    const res = await app.request(`/?error=${encodeURIComponent(probe)}`, {}, fakeEnv)
    const text = await res.text()
    expect(text).not.toContain('ユーザーIDまたはパスワードが正しくありません')
    expect(text).not.toContain(probe)
    expect(text).not.toContain('alert(1)')
  })

  it('error=0 does not show the error message', async () => {
    const res = await app.request('/?error=0', {}, fakeEnv)
    const text = await res.text()
    expect(text).not.toContain('ユーザーIDまたはパスワードが正しくありません')
  })

  it('session probe failure (binding throws) falls back to the login form', async () => {
    // fakeEnv has no DB, so the session repo rejects when the probe queries it.
    // The probe must swallow that and render the login form, not 500/503.
    const res = await app.request('/', { headers: { Cookie: await validCookieHeader() } }, fakeEnv)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('action="/api/auth/login"')
  })
})

describe('GET /albums (requires session)', () => {
  it('no cookie -> 303 redirect to /', async () => {
    const res = await app.request('/albums', {}, fakeEnv)
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('303 redirect has security headers', async () => {
    const res = await app.request('/albums', {}, fakeEnv)
    hasSecurityHeaders(res)
  })
})

describe('GET /albums/:albumId (requires session)', () => {
  it('no cookie -> 303 redirect to /', async () => {
    const res = await app.request('/albums/some-album', {}, fakeEnv)
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/')
  })
})

describe('Reserved routes - fail closed with 401', () => {
  const cases = [
    '/api',
    '/api/login',
    '/api/albums',
    '/img',
    '/img/some-album/thumb/some-photo',
    '/admin',
    '/admin/api/albums',
  ]

  for (const path of cases) {
    it(`${path} returns 401`, async () => {
      const res = await app.request(path, {}, fakeEnv)
      expect(res.status).toBe(401)
    })

    it(`${path} has Cache-Control: no-store`, async () => {
      const res = await app.request(path, {}, fakeEnv)
      expect(res.headers.get('cache-control')).toBe('no-store')
    })

    it(`${path} has security headers`, async () => {
      const res = await app.request(path, {}, fakeEnv)
      hasSecurityHeaders(res)
    })
  }

  it('rejects non-GET requests under reserved prefixes', async () => {
    const res = await app.request('/api/login', { method: 'POST' }, fakeEnv)
    expect(res.status).toBe(401)
    expect(res.headers.get('cache-control')).toBe('no-store')
    hasSecurityHeaders(res)
  })
})

describe('Unknown routes', () => {
  it('returns 404 for /unknown', async () => {
    const res = await app.request('/unknown', {}, fakeEnv)
    expect(res.status).toBe(404)
  })

  it('returns 404 for /login (not a real route)', async () => {
    const res = await app.request('/login', {}, fakeEnv)
    expect(res.status).toBe(404)
  })

  it('404 has security headers', async () => {
    const res = await app.request('/unknown', {}, fakeEnv)
    hasSecurityHeaders(res)
  })

  it('404 has Cache-Control: no-store', async () => {
    const res = await app.request('/unknown', {}, fakeEnv)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})
