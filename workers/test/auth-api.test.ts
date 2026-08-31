import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { app as realApp } from '../src/index.js'
import { createAuthApi } from '../src/routes/auth-api.js'
import type { AuthApiDeps } from '../src/routes/auth-api.js'
import type { Env } from '../src/types/env.js'
import type { AuthVariables } from '../src/types/auth-context.js'
import type { UserAuthRow } from '../src/types/user.js'
import type { SessionWithUser } from '../src/types/session.js'
import { hashPassword, digestSessionToken, base64urlDecode } from '../src/services/auth-crypto.js'
import { PBKDF2_PRODUCTION_ITERATIONS } from '../src/services/login-policy.js'
import { COOKIE_NAME } from '../src/services/session-cookie.js'

const NOW = '2026-06-11T00:00:00.000Z'
const NOW_PLUS_7D = '2026-06-18T00:00:00.000Z' // NOW + 604800s
const NOW_PLUS_15M = '2026-06-11T00:15:00.000Z' // NOW + 900s
const APP_ORIGIN = 'https://app.example'
const PASSWORD = 'correct horse battery staple'

interface RecordedFailure {
  userId: string
  now: string
  threshold: number
  lockedUntil: string
}
interface RecordedReset {
  userId: string
  now: string
}
interface RecordedInsert {
  digest: string
  userId: string
  createdAt: string
  expiresAt: string
}

interface FakeState {
  fetchCalls: string[]
  failures: RecordedFailure[]
  resets: RecordedReset[]
  inserts: RecordedInsert[]
  deletes: string[]
  validSessionCalls: Array<{ digest: string; now: string }>
  rateLimitCalls: Array<{ accountKey: string; networkKey: string }>
}

interface FakeOptions {
  row?: UserAuthRow | null
  fetchThrows?: boolean
  recordFailureThrows?: boolean
  resetThrows?: boolean
  insertThrows?: boolean
  deleteThrows?: boolean
  validSession?: SessionWithUser | null
  fetchValidSessionThrows?: boolean
  rateAllowed?: boolean
  rateLimitThrows?: boolean
  clock?: () => Date
}

function makeDeps(opts: FakeOptions = {}): { deps: AuthApiDeps; state: FakeState } {
  const state: FakeState = {
    fetchCalls: [],
    failures: [],
    resets: [],
    inserts: [],
    deletes: [],
    validSessionCalls: [],
    rateLimitCalls: [],
  }
  const deps: AuthApiDeps = {
    authRepo: {
      async fetchUserForAuth(userId) {
        state.fetchCalls.push(userId)
        if (opts.fetchThrows) throw new Error('D1 down')
        return opts.row ?? null
      },
      async recordLoginFailure(userId, now, threshold, lockedUntil) {
        if (opts.recordFailureThrows) throw new Error('D1 down')
        state.failures.push({ userId, now, threshold, lockedUntil })
      },
      async resetLoginFailure(userId, now) {
        if (opts.resetThrows) throw new Error('D1 down')
        state.resets.push({ userId, now })
      },
    },
    sessionRepo: {
      async insertSession(digest, userId, createdAt, expiresAt) {
        if (opts.insertThrows) throw new Error('D1 down')
        state.inserts.push({ digest, userId, createdAt, expiresAt })
      },
      async deleteSession(digest) {
        if (opts.deleteThrows) throw new Error('D1 down')
        state.deletes.push(digest)
      },
      async fetchValidSession(digest, now) {
        state.validSessionCalls.push({ digest, now })
        if (opts.fetchValidSessionThrows) throw new Error('D1 down')
        return opts.validSession ?? null
      },
    },
    loginRateLimit: {
      async allowAttempt(accountKey, networkKey) {
        state.rateLimitCalls.push({ accountKey, networkKey })
        if (opts.rateLimitThrows) throw new Error('rate limit unavailable')
        return opts.rateAllowed ?? true
      },
    },
    clock: opts.clock ?? (() => new Date(NOW)),
  }
  return { deps, state }
}

function makeApp(deps: AuthApiDeps) {
  const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>()
  app.route('/api/auth', createAuthApi(() => deps))
  return app
}

async function makeRow(overrides: Partial<UserAuthRow> = {}): Promise<UserAuthRow> {
  return {
    id: 'viewer-1',
    password_hash: await hashPassword(PASSWORD, PBKDF2_PRODUCTION_ITERATIONS),
    enabled: 1,
    fail_count: 0,
    locked_until: null,
    ...overrides,
  }
}

function formBody(fields: Record<string, string>): { body: string; headers: Record<string, string> } {
  const params = new URLSearchParams(fields)
  return {
    body: params.toString(),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: APP_ORIGIN,
    },
  }
}

function loginRequest(app: Hono<{ Bindings: Env; Variables: AuthVariables }>, fields: Record<string, string>, extraHeaders: Record<string, string> = {}) {
  const { body, headers } = formBody(fields)
  return app.request(`${APP_ORIGIN}/api/auth/login`, {
    method: 'POST',
    headers: { ...headers, ...extraHeaders },
    body,
  })
}

function cookieFromResponse(res: Response): string | null {
  return res.headers.get('set-cookie')
}

function tokenFromSetCookie(setCookie: string): string {
  const first = setCookie.split(';', 1)[0] ?? ''
  const eq = first.indexOf('=')
  return first.slice(eq + 1)
}

describe('POST /api/auth/login success', () => {
  it('issues a session and redirects to /albums', async () => {
    const row = await makeRow()
    const { deps, state } = makeDeps({ row })
    const app = makeApp(deps)
    const res = await loginRequest(app, { userId: 'viewer-1', password: PASSWORD })

    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/albums')
    expect(res.headers.get('cache-control')).toBe('no-store')

    const setCookie = cookieFromResponse(res)
    expect(setCookie).toBeTruthy()
    const sc = setCookie as string
    expect(sc).toContain(`${COOKIE_NAME}=`)
    expect(sc).toContain('HttpOnly')
    expect(sc).toContain('Secure')
    expect(sc).toContain('SameSite=Strict')
    expect(sc).toContain('Path=/')
    expect(sc).toContain('Max-Age=604800')

    // cookie token is valid base64url of exactly 32 bytes
    const token = tokenFromSetCookie(sc)
    const decoded = base64urlDecode(token)
    expect(decoded).not.toBeNull()
    expect((decoded as Uint8Array).length).toBe(32)

    // insertSession called once with the digest (not the raw token), userId, now, now+7d
    expect(state.inserts).toHaveLength(1)
    const insert = state.inserts[0]!
    expect(insert.digest).toMatch(/^[0-9a-f]{64}$/)
    expect(insert.digest).not.toBe(token)
    expect(insert.digest).toBe(await digestSessionToken(token))
    expect(insert.userId).toBe('viewer-1')
    expect(insert.createdAt).toBe(NOW)
    expect(insert.expiresAt).toBe(NOW_PLUS_7D)

    // resetLoginFailure called, recordLoginFailure NOT called
    expect(state.resets).toEqual([{ userId: 'viewer-1', now: NOW }])
    expect(state.failures).toHaveLength(0)
  })

  it('produces a different token on two successive logins', async () => {
    const row = await makeRow()
    const { deps, state } = makeDeps({ row })
    const app = makeApp(deps)
    const res1 = await loginRequest(app, { userId: 'viewer-1', password: PASSWORD })
    const res2 = await loginRequest(app, { userId: 'viewer-1', password: PASSWORD })
    const t1 = tokenFromSetCookie(cookieFromResponse(res1) as string)
    const t2 = tokenFromSetCookie(cookieFromResponse(res2) as string)
    expect(t1).not.toBe(t2)
    expect(state.inserts[0]!.digest).not.toBe(state.inserts[1]!.digest)
  })
})

describe('POST /api/auth/login failures', () => {
  it('wrong password returns the uniform 303 to /?error=1 and records a failure', async () => {
    const row = await makeRow()
    const { deps, state } = makeDeps({ row })
    const app = makeApp(deps)
    const res = await loginRequest(app, { userId: 'viewer-1', password: 'wrong' })

    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/?error=1')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(cookieFromResponse(res)).toBeNull()

    expect(state.failures).toEqual([
      { userId: 'viewer-1', now: NOW, threshold: 5, lockedUntil: NOW_PLUS_15M },
    ])
    expect(state.inserts).toHaveLength(0)
    expect(state.resets).toHaveLength(0)
  })

  it('unknown user runs verify, records a failure with the supplied ID, returns the identical 303', async () => {
    const { deps, state } = makeDeps({ row: null })
    const app = makeApp(deps)
    const res = await loginRequest(app, { userId: 'ghost-user', password: PASSWORD })

    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/?error=1')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(cookieFromResponse(res)).toBeNull()

    // fetch attempted (ID format valid) and returned null
    expect(state.fetchCalls).toEqual(['ghost-user'])
    // recordLoginFailure called with the unknown ID; no short-circuit, no throw
    expect(state.failures).toEqual([
      { userId: 'ghost-user', now: NOW, threshold: 5, lockedUntil: NOW_PLUS_15M },
    ])
    expect(state.inserts).toHaveLength(0)
  })

  it('invalid-format userId: no fetch, no recordLoginFailure, identical 303', async () => {
    const { deps, state } = makeDeps({ row: null })
    const app = makeApp(deps)
    const res = await loginRequest(app, { userId: '!bad id!', password: PASSWORD })

    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/?error=1')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(state.fetchCalls).toHaveLength(0)
    expect(state.failures).toHaveLength(0)
    expect(state.inserts).toHaveLength(0)
    expect(state.rateLimitCalls).toEqual([
      { accountKey: 'account:invalid', networkKey: 'network:unknown' },
    ])
  })

  it('locked account with correct password: 303 to /?error=1, records failure, no session', async () => {
    const row = await makeRow({ locked_until: '2030-01-01T00:00:00.000Z' })
    const { deps, state } = makeDeps({ row })
    const app = makeApp(deps)
    const res = await loginRequest(app, { userId: 'viewer-1', password: PASSWORD })

    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/?error=1')
    expect(state.failures).toHaveLength(1)
    expect(state.inserts).toHaveLength(0)
    expect(state.resets).toHaveLength(0)
  })

  it('expired lock with correct password: success', async () => {
    const row = await makeRow({ locked_until: '2020-01-01T00:00:00.000Z' })
    const { deps, state } = makeDeps({ row })
    const app = makeApp(deps)
    const res = await loginRequest(app, { userId: 'viewer-1', password: PASSWORD })

    expect(res.status).toBe(303)
    expect(state.inserts).toHaveLength(1)
    expect(state.failures).toHaveLength(0)
  })

  it('malformed locked_until is treated as locked: 303 to /?error=1', async () => {
    const row = await makeRow({ locked_until: 'not-a-timestamp' })
    const { deps, state } = makeDeps({ row })
    const app = makeApp(deps)
    const res = await loginRequest(app, { userId: 'viewer-1', password: PASSWORD })

    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/?error=1')
    expect(state.inserts).toHaveLength(0)
    expect(state.failures).toHaveLength(1)
  })
})

describe('POST /api/auth/login body and content-type validation', () => {
  async function expectNoRepoCalls(extraHeaders: Record<string, string>, body: string) {
    const { deps, state } = makeDeps({ row: null })
    const app = makeApp(deps)
    const res = await app.request(`${APP_ORIGIN}/api/auth/login`, {
      method: 'POST',
      headers: { Origin: APP_ORIGIN, ...extraHeaders },
      body,
    })
    expect(res.status).toBe(401)
    expect(await res.text()).toBe('Unauthorized')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(state.fetchCalls).toHaveLength(0)
    expect(state.failures).toHaveLength(0)
    expect(state.inserts).toHaveLength(0)
    expect(state.rateLimitCalls).toHaveLength(0)
  }

  it('JSON content-type: 401 with zero repo calls', async () => {
    await expectNoRepoCalls(
      { 'Content-Type': 'application/json' },
      JSON.stringify({ userId: 'viewer-1', password: PASSWORD }),
    )
  })

  it('missing password: 401 with zero repo calls', async () => {
    await expectNoRepoCalls(
      { 'Content-Type': 'application/x-www-form-urlencoded' },
      new URLSearchParams({ userId: 'viewer-1' }).toString(),
    )
  })

  it('empty password: 401 with zero repo calls', async () => {
    await expectNoRepoCalls(
      { 'Content-Type': 'application/x-www-form-urlencoded' },
      new URLSearchParams({ userId: 'viewer-1', password: '' }).toString(),
    )
  })

  it('password length 1025: 401 with zero repo calls', async () => {
    await expectNoRepoCalls(
      { 'Content-Type': 'application/x-www-form-urlencoded' },
      new URLSearchParams({ userId: 'viewer-1', password: 'a'.repeat(1025) }).toString(),
    )
  })

  it('accepts content-type with appended charset', async () => {
    const row = await makeRow()
    const { deps } = makeDeps({ row })
    const app = makeApp(deps)
    const res = await app.request(`${APP_ORIGIN}/api/auth/login`, {
      method: 'POST',
      headers: {
        Origin: APP_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      },
      body: new URLSearchParams({ userId: 'viewer-1', password: PASSWORD }).toString(),
    })
    expect(res.status).toBe(303)
  })

  it('declared oversized form: 401 without rate limit, D1, or password work', async () => {
    const { deps, state } = makeDeps({ row: null })
    const app = makeApp(deps)
    const res = await app.request(`${APP_ORIGIN}/api/auth/login`, {
      method: 'POST',
      headers: {
        Origin: APP_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': '4097',
      },
      body: 'userId=viewer-1&password=irrelevant',
    })
    expect(res.status).toBe(401)
    expect(state.rateLimitCalls).toHaveLength(0)
    expect(state.fetchCalls).toHaveLength(0)
    expect(state.failures).toHaveLength(0)
    expect(state.inserts).toHaveLength(0)
  })
})

describe('POST /api/auth/login rate limiting', () => {
  it('returns generic 429 before D1 and password verification when the limit denies the attempt', async () => {
    const row = await makeRow()
    const { deps, state } = makeDeps({ row, rateAllowed: false })
    const app = makeApp(deps)
    const res = await loginRequest(
      app,
      { userId: 'viewer-1', password: PASSWORD },
      { 'CF-Connecting-IP': '2001:db8::42' },
    )
    expect(res.status).toBe(429)
    expect(await res.text()).toBe('Too Many Requests')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('retry-after')).toBe('60')
    expect(state.rateLimitCalls).toEqual([
      { accountKey: 'account:viewer-1', networkKey: 'network:2001:db8::42' },
    ])
    expect(state.fetchCalls).toHaveLength(0)
    expect(state.failures).toHaveLength(0)
    expect(state.inserts).toHaveLength(0)
  })

  it('uses bounded fallback keys for malformed account and network identifiers', async () => {
    const { deps, state } = makeDeps({ rateAllowed: false })
    const app = makeApp(deps)
    const res = await loginRequest(
      app,
      { userId: '!not-an-id!', password: PASSWORD },
      { 'CF-Connecting-IP': 'forged, forwarded, value' },
    )
    expect(res.status).toBe(429)
    expect(state.rateLimitCalls).toEqual([
      { accountKey: 'account:invalid', networkKey: 'network:unknown' },
    ])
  })

  it('fails closed with 503 when the rate-limit binding is unavailable', async () => {
    const { deps, state } = makeDeps({ rateLimitThrows: true })
    const app = makeApp(deps)
    const res = await loginRequest(app, { userId: 'viewer-1', password: PASSWORD })
    expect(res.status).toBe(503)
    expect(await res.text()).toBe('Service Unavailable')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(state.rateLimitCalls).toHaveLength(1)
    expect(state.fetchCalls).toHaveLength(0)
    expect(state.failures).toHaveLength(0)
    expect(state.inserts).toHaveLength(0)
  })
})

describe('Origin enforcement', () => {
  it('login: mismatched Origin returns 403 and never parses the body', async () => {
    const { deps, state } = makeDeps({ row: null })
    const app = makeApp(deps)
    const res = await app.request(`${APP_ORIGIN}/api/auth/login`, {
      method: 'POST',
      headers: {
        Origin: 'https://evil.example',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ userId: 'viewer-1', password: PASSWORD }).toString(),
    })
    expect(res.status).toBe(403)
    expect(await res.text()).toBe('Forbidden')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(state.fetchCalls).toHaveLength(0)
    expect(state.failures).toHaveLength(0)
    expect(state.inserts).toHaveLength(0)
  })

  it('logout: mismatched Origin returns 403 and never touches the session repo', async () => {
    const { deps, state } = makeDeps({})
    const app = makeApp(deps)
    const res = await app.request(`${APP_ORIGIN}/api/auth/logout`, {
      method: 'POST',
      headers: { Origin: 'https://evil.example', Cookie: `${COOKIE_NAME}=${'A'.repeat(43)}` },
    })
    expect(res.status).toBe(403)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(state.deletes).toHaveLength(0)
  })

  it('login: same-value Origin proceeds', async () => {
    const row = await makeRow()
    const { deps } = makeDeps({ row })
    const app = makeApp(deps)
    const res = await loginRequest(app, { userId: 'viewer-1', password: PASSWORD })
    expect(res.status).toBe(303)
  })

  it('login: absent Origin proceeds', async () => {
    const row = await makeRow()
    const { deps } = makeDeps({ row })
    const app = makeApp(deps)
    const res = await app.request(`${APP_ORIGIN}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ userId: 'viewer-1', password: PASSWORD }).toString(),
    })
    expect(res.status).toBe(303)
  })
})

describe('POST /api/auth/login 503 paths', () => {
  function bodyHasNoSensitive(body: string) {
    expect(body).not.toContain('viewer-1')
    expect(body).not.toContain('SQL')
    expect(body).not.toContain('D1 down')
  }

  it('fetchUserForAuth throws -> 503 generic', async () => {
    const { deps } = makeDeps({ fetchThrows: true })
    const app = makeApp(deps)
    const res = await loginRequest(app, { userId: 'viewer-1', password: PASSWORD })
    expect(res.status).toBe(503)
    expect(cookieFromResponse(res)).toBeNull()
    bodyHasNoSensitive(await res.text())
  })

  it('recordLoginFailure throws -> 503 generic', async () => {
    const row = await makeRow()
    const { deps } = makeDeps({ row, recordFailureThrows: true })
    const app = makeApp(deps)
    const res = await loginRequest(app, { userId: 'viewer-1', password: 'wrong' })
    expect(res.status).toBe(503)
    expect(cookieFromResponse(res)).toBeNull()
    bodyHasNoSensitive(await res.text())
  })

  it('resetLoginFailure throws -> 503 generic, no cookie', async () => {
    const row = await makeRow()
    const { deps } = makeDeps({ row, resetThrows: true })
    const app = makeApp(deps)
    const res = await loginRequest(app, { userId: 'viewer-1', password: PASSWORD })
    expect(res.status).toBe(503)
    expect(cookieFromResponse(res)).toBeNull()
    bodyHasNoSensitive(await res.text())
  })

  it('insertSession throws -> 503 generic, no cookie', async () => {
    const row = await makeRow()
    const { deps } = makeDeps({ row, insertThrows: true })
    const app = makeApp(deps)
    const res = await loginRequest(app, { userId: 'viewer-1', password: PASSWORD })
    expect(res.status).toBe(503)
    expect(cookieFromResponse(res)).toBeNull()
    bodyHasNoSensitive(await res.text())
  })
})

describe('POST /api/auth/logout', () => {
  const VALID_TOKEN = 'A'.repeat(43) // 32 zero bytes

  it('valid cookie: 303 to /, clears cookie, deletes session by digest', async () => {
    const { deps, state } = makeDeps({})
    const app = makeApp(deps)
    const res = await app.request(`${APP_ORIGIN}/api/auth/logout`, {
      method: 'POST',
      headers: { Origin: APP_ORIGIN, Cookie: `${COOKIE_NAME}=${VALID_TOKEN}` },
    })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/')
    expect(res.headers.get('cache-control')).toBe('no-store')
    const sc = cookieFromResponse(res) as string
    expect(sc).toContain('Max-Age=0')

    expect(state.deletes).toHaveLength(1)
    expect(state.deletes[0]).toBe(await digestSessionToken(VALID_TOKEN))
    expect(state.deletes[0]).not.toBe(VALID_TOKEN)
  })

  it('no cookie: 303 to / with clear cookie, deleteSession not called', async () => {
    const { deps, state } = makeDeps({})
    const app = makeApp(deps)
    const res = await app.request(`${APP_ORIGIN}/api/auth/logout`, {
      method: 'POST',
      headers: { Origin: APP_ORIGIN },
    })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/')
    expect((cookieFromResponse(res) as string)).toContain('Max-Age=0')
    expect(state.deletes).toHaveLength(0)
  })

  it('malformed cookie: same as no cookie', async () => {
    const { deps, state } = makeDeps({})
    const app = makeApp(deps)
    const res = await app.request(`${APP_ORIGIN}/api/auth/logout`, {
      method: 'POST',
      headers: { Origin: APP_ORIGIN, Cookie: `${COOKIE_NAME}=!!!bad!!!` },
    })
    expect(res.status).toBe(303)
    expect((cookieFromResponse(res) as string)).toContain('Max-Age=0')
    expect(state.deletes).toHaveLength(0)
  })

  it('deleteSession throws: 503 and NO Set-Cookie', async () => {
    const { deps } = makeDeps({ deleteThrows: true })
    const app = makeApp(deps)
    const res = await app.request(`${APP_ORIGIN}/api/auth/logout`, {
      method: 'POST',
      headers: { Origin: APP_ORIGIN, Cookie: `${COOKIE_NAME}=${VALID_TOKEN}` },
    })
    expect(res.status).toBe(503)
    expect(cookieFromResponse(res)).toBeNull()
  })
})

describe('GET /api/auth/me', () => {
  const VALID_TOKEN = 'A'.repeat(43)

  function makeSession(userId: string): SessionWithUser {
    return {
      token_hash: 'a'.repeat(64),
      user_id: userId,
      expires_at: '2030-01-01T00:00:00.000Z',
      last_seen_at: NOW,
      user_enabled: 1,
    }
  }

  it('valid session: 200 JSON with userId and no-store', async () => {
    const { deps } = makeDeps({ validSession: makeSession('viewer-1') })
    const app = makeApp(deps)
    const res = await app.request(`${APP_ORIGIN}/api/auth/me`, {
      headers: { Cookie: `${COOKIE_NAME}=${VALID_TOKEN}` },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ userId: 'viewer-1' })
  })

  it('no cookie: 401', async () => {
    const { deps } = makeDeps({ validSession: null })
    const app = makeApp(deps)
    const res = await app.request(`${APP_ORIGIN}/api/auth/me`)
    expect(res.status).toBe(401)
  })

  it('expired/null session: 401', async () => {
    const { deps } = makeDeps({ validSession: null })
    const app = makeApp(deps)
    const res = await app.request(`${APP_ORIGIN}/api/auth/me`, {
      headers: { Cookie: `${COOKIE_NAME}=${VALID_TOKEN}` },
    })
    expect(res.status).toBe(401)
  })
})

describe('routing precedence against real src/index.tsx', () => {
  // Minimal fake env: repository calls reject because DB is undefined, so the
  // auth router fails closed (503) rather than the reserved 401 handler taking over.
  const fakeEnv = {} as unknown as Env

  it('/api/auth/login reaches the auth router (303 on a successful fixture login is not possible without DB; assert it is NOT the reserved 401)', async () => {
    // Empty form with matching origin: the auth router validates the body and
    // returns its own generic 401. The reserved handler would also be 401, so
    // distinguish by attempting a well-formed login: without a DB the router
    // returns 503, which the reserved 401 handler could never produce.
    const res = await realApp.request(`${APP_ORIGIN}/api/auth/login`, {
      method: 'POST',
      headers: { Origin: APP_ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ userId: 'viewer-1', password: PASSWORD }).toString(),
    }, fakeEnv)
    expect(res.status).toBe(503)
  })

  it('/api/auth/login with mismatched Origin returns 403 (auth router), not reserved 401', async () => {
    const res = await realApp.request(`${APP_ORIGIN}/api/auth/login`, {
      method: 'POST',
      headers: { Origin: 'https://evil.example', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: '',
    }, fakeEnv)
    expect(res.status).toBe(403)
  })

  it('/api still returns 401', async () => {
    const res = await realApp.request(`${APP_ORIGIN}/api`, {}, fakeEnv)
    expect(res.status).toBe(401)
  })

  it('/api/login still returns 401', async () => {
    const res = await realApp.request(`${APP_ORIGIN}/api/login`, {}, fakeEnv)
    expect(res.status).toBe(401)
  })

  it('/api/other still returns 401', async () => {
    const res = await realApp.request(`${APP_ORIGIN}/api/other`, {}, fakeEnv)
    expect(res.status).toBe(401)
  })

  it('/img/x still returns 401', async () => {
    const res = await realApp.request(`${APP_ORIGIN}/img/x`, {}, fakeEnv)
    expect(res.status).toBe(401)
  })

  it('/admin now fails closed with 403 (Access boundary, no config)', async () => {
    const res = await realApp.request(`${APP_ORIGIN}/admin`, {}, fakeEnv)
    // /admin left the reserved-401 set; with no Access config the guard returns 403.
    expect(res.status).toBe(403)
  })

  it('/ fixture page unchanged 200', async () => {
    const res = await realApp.request(`${APP_ORIGIN}/`, {}, fakeEnv)
    expect(res.status).toBe(200)
  })

  it('/albums without a session redirects to the login page', async () => {
    const res = await realApp.request(`${APP_ORIGIN}/albums`, {}, fakeEnv)
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/')
  })
})

describe('dummy hash sanity (timing decoy is well-formed and never verifies)', () => {
  it('verifyPassword against unknown user still returns the uniform 303 (decoy path, no crash)', async () => {
    // unknown user -> dummy hash verify; even if verify somehow returned true,
    // row === null forces failure. This asserts the well-formed decoy hash does
    // not crash (no 503) for a normal password and still redirects to /?error=1.
    const { deps } = makeDeps({ row: null })
    const app = makeApp(deps)
    const res = await loginRequest(app, { userId: 'viewer-1', password: PASSWORD })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/?error=1')
  })
})
