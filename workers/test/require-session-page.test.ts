import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import type { AuthVariables } from '../src/types/auth-context.js'
import type { SessionWithUser } from '../src/types/session.js'
import { requireSessionPage } from '../src/middleware/require-session-page.js'
import { generateSessionToken, digestSessionToken } from '../src/services/auth-crypto.js'
import { COOKIE_NAME } from '../src/services/session-cookie.js'

const NOW = '2026-06-11T00:00:00.000Z'
const CLOCK = (): Date => new Date(NOW)
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

interface FakeOptions {
  validSession?: SessionWithUser | null
  throws?: boolean
}

function makeFetcher(opts: FakeOptions): {
  fetchValidSession(digest: string, now: string): Promise<SessionWithUser | null>
} {
  return {
    async fetchValidSession() {
      if (opts.throws) throw new Error('D1 down')
      return opts.validSession === undefined ? validSession() : opts.validSession
    },
  }
}

function makeApp(opts: FakeOptions) {
  const app = new Hono<{ Variables: AuthVariables }>()
  app.use('/page', requireSessionPage(makeFetcher(opts), CLOCK))
  app.get('/page', (c) => c.text(`ok:${c.get('userId')}`))
  return app
}

async function validCookie(): Promise<string> {
  const token = generateSessionToken()
  await digestSessionToken(token)
  return `${COOKIE_NAME}=${token}`
}

describe('requireSessionPage', () => {
  it('valid session: next() runs and userId is set', async () => {
    const app = makeApp({ validSession: validSession() })
    const res = await app.request('/page', { headers: { Cookie: await validCookie() } })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(`ok:${USER_ID}`)
  })

  it('missing cookie: 303 to / with no-store and empty body', async () => {
    const app = makeApp({ validSession: null })
    const res = await app.request('/page')
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.text()).toBe('')
  })

  it('invalid session (repo returns null): 303 to / no-store', async () => {
    const app = makeApp({ validSession: null })
    const res = await app.request('/page', { headers: { Cookie: await validCookie() } })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('disabled user: 303 to /', async () => {
    const app = makeApp({ validSession: { ...validSession(), user_enabled: 0 } })
    const res = await app.request('/page', { headers: { Cookie: await validCookie() } })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/')
  })

  it('fetcher throws: 503 passthrough (not rewritten to 303)', async () => {
    const app = makeApp({ throws: true })
    const res = await app.request('/page', { headers: { Cookie: await validCookie() } })
    expect(res.status).toBe(503)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('location')).toBeNull()
  })
})
