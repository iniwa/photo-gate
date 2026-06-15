import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { createAdminRoutes } from '../src/routes/admin.js'
import { normalizeEmail, parseAdminAllowlist } from '../src/middleware/require-admin.js'
import type { AdminAuthConfig } from '../src/types/admin-auth.js'
import type { AdminUserPage, AdminUserSummary } from '../src/types/admin-user.js'
import type { Env } from '../src/types/env.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ResolveAuth = (env: Env) => AdminAuthConfig | null

const NOW_TS = '2026-06-15T00:00:00.000Z'

const SAMPLE_USER: AdminUserSummary = {
  id: 'user-sample-001',
  display_name: 'Sample User',
  enabled: 1,
  fail_count: 0,
  locked_until: null,
  created_at: NOW_TS,
  updated_at: NOW_TS,
}

const SAMPLE_USER_2: AdminUserSummary = {
  id: 'user-sample-002',
  display_name: 'Second User',
  enabled: 0,
  fail_count: 3,
  locked_until: '2026-06-15T01:00:00.000Z',
  created_at: NOW_TS,
  updated_at: NOW_TS,
}

function makeEmptyUserRepo(): { listUsers(): Promise<AdminUserPage> } {
  return { listUsers: async () => ({ users: [], hasMore: false }) }
}

function makeUserRepo(
  users: AdminUserSummary[],
  hasMore = false,
): { listUsers(): Promise<AdminUserPage> } {
  return { listUsers: async () => ({ users, hasMore }) }
}

function makeThrowingUserRepo(): { listUsers(): Promise<AdminUserPage> } {
  return {
    listUsers: async () => {
      throw new Error('D1 exploded')
    },
  }
}

function makeApp(
  resolveAuth: ResolveAuth,
  userRepo?: { listUsers(afterUserId?: string): Promise<AdminUserPage> },
): Hono {
  const app = new Hono()
  app.route(
    '/admin',
    createAdminRoutes(resolveAuth, () => ({ userRepo: userRepo ?? makeEmptyUserRepo() })),
  )
  return app
}

const ADMIN_EMAIL = 'admin@example.com'
const VALID_TOKEN = 'valid-test-token'

/** A resolveAuth that returns a working AdminAuthConfig. */
function goodAuth(email = ADMIN_EMAIL): ResolveAuth {
  return () => ({
    verifier: async () => ({ email }),
    allowlist: new Set([ADMIN_EMAIL]),
  })
}

/** Request helper: GET /admin with optional extra options. */
function getAdmin(
  app: Hono,
  options: { token?: string | null; extraHeaders?: Record<string, string>; path?: string } = {},
): Promise<Response> {
  const { token = VALID_TOKEN, extraHeaders = {}, path = '/admin' } = options
  const headers: Record<string, string> = { ...extraHeaders }
  if (token !== null) {
    headers['Cf-Access-Jwt-Assertion'] = token
  }
  return Promise.resolve(
    app.request(path, { headers }, {} as unknown as Parameters<typeof app.request>[2]),
  )
}

// ---------------------------------------------------------------------------
// SUCCESS CASES (existing)
// ---------------------------------------------------------------------------

describe('admin-routes: success — valid config, token, allowlisted email', () => {
  it('returns 200', async () => {
    const res = await getAdmin(makeApp(goodAuth()))
    expect(res.status).toBe(200)
  })

  it('sets Cache-Control: no-store', async () => {
    const res = await getAdmin(makeApp(goodAuth()))
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('body contains 管理コンソール', async () => {
    const res = await getAdmin(makeApp(goodAuth()))
    const body = await res.text()
    expect(body).toContain('管理コンソール')
  })

  it('body does NOT contain login form action', async () => {
    const res = await getAdmin(makeApp(goodAuth()))
    const body = await res.text()
    expect(body).not.toContain('action="/api/auth/login"')
  })

  it('body does NOT contain /img/', async () => {
    const res = await getAdmin(makeApp(goodAuth()))
    const body = await res.text()
    expect(body).not.toContain('/img/')
  })

  it('body does NOT contain アルバム', async () => {
    const res = await getAdmin(makeApp(goodAuth()))
    const body = await res.text()
    expect(body).not.toContain('アルバム')
  })

  it('case-insensitive allowlist: verifier returns mixed-case email → 200', async () => {
    const app = makeApp(() => ({
      verifier: async () => ({ email: 'Admin@Example.COM' }),
      allowlist: new Set(['admin@example.com']),
    }))
    const res = await getAdmin(app)
    expect(res.status).toBe(200)
  })

  it('GET /admin body now contains a link to /admin/users', async () => {
    const res = await getAdmin(makeApp(goodAuth()))
    const body = await res.text()
    expect(body).toContain('/admin/users')
  })
})

// ---------------------------------------------------------------------------
// FAIL CLOSED — must all produce exactly 403 "Forbidden" with no-store
// ---------------------------------------------------------------------------

async function assertForbidden(res: Response): Promise<void> {
  expect(res.status).toBe(403)
  expect(res.headers.get('cache-control')).toBe('no-store')
  const body = await res.text()
  expect(body).toBe('Forbidden')
}

describe('admin-routes: fail closed — 403 Forbidden', () => {
  it('resolveAuth returns null (misconfiguration)', async () => {
    const app = makeApp(() => null)
    const res = await getAdmin(app)
    await assertForbidden(res)
  })

  it('resolveAuth throws', async () => {
    const app = makeApp(() => { throw new Error('config error') })
    const res = await getAdmin(app)
    await assertForbidden(res)
  })

  it('Cf-Access-Jwt-Assertion header missing entirely', async () => {
    const app = makeApp(goodAuth())
    const res = await getAdmin(app, { token: null })
    await assertForbidden(res)
  })

  it('Cf-Access-Jwt-Assertion header is empty string', async () => {
    const app = makeApp(goodAuth())
    const res = await app.request(
      '/admin',
      { headers: { 'Cf-Access-Jwt-Assertion': '' } },
      {} as unknown as Parameters<typeof app.request>[2],
    )
    await assertForbidden(res)
  })

  it('NO fallback: only Cookie CF_Authorization present, no Cf-Access-Jwt-Assertion', async () => {
    const app = makeApp(goodAuth())
    const res = await getAdmin(app, {
      token: null,
      extraHeaders: { Cookie: `CF_Authorization=${VALID_TOKEN}` },
    })
    await assertForbidden(res)
  })

  it('NO fallback: Cf-Authorization header (wrong name), no Cf-Access-Jwt-Assertion', async () => {
    const app = makeApp(goodAuth())
    const res = await getAdmin(app, {
      token: null,
      extraHeaders: { 'Cf-Authorization': VALID_TOKEN },
    })
    await assertForbidden(res)
  })

  it('verifier throws (bad signature / expired / wrong audience)', async () => {
    const app = makeApp(() => ({
      verifier: async () => { throw new Error('invalid jwt') },
      allowlist: new Set([ADMIN_EMAIL]),
    }))
    const res = await getAdmin(app)
    await assertForbidden(res)
  })

  it('verifier returns email NOT in allowlist', async () => {
    const app = makeApp(() => ({
      verifier: async () => ({ email: 'other@example.com' }),
      allowlist: new Set([ADMIN_EMAIL]),
    }))
    const res = await getAdmin(app)
    await assertForbidden(res)
  })

  it('verifier returns email with surrounding whitespace → 403', async () => {
    const app = makeApp(() => ({
      verifier: async () => ({ email: ` ${ADMIN_EMAIL} ` }),
      allowlist: new Set([ADMIN_EMAIL]),
    }))
    const res = await getAdmin(app)
    await assertForbidden(res)
  })

  it('verifier returns email containing a control character → 403', async () => {
    const app = makeApp(() => ({
      // embed a null byte inside the email
      verifier: async () => ({ email: 'admin\x00@example.com' }),
      allowlist: new Set([ADMIN_EMAIL]),
    }))
    const res = await getAdmin(app)
    await assertForbidden(res)
  })
})

// ---------------------------------------------------------------------------
// ROUTE SHAPE (existing)
// ---------------------------------------------------------------------------

describe('admin-routes: route shape', () => {
  it('GET /admin/whatever with valid admin → 404 "Not Found" no-store', async () => {
    const app = makeApp(goodAuth())
    const res = await getAdmin(app, { path: '/admin/whatever' })
    expect(res.status).toBe(404)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = await res.text()
    expect(body).toBe('Not Found')
  })

  it('GET /admin/whatever with NO token → 403 (guard fires before route)', async () => {
    const app = makeApp(goodAuth())
    const res = await getAdmin(app, { path: '/admin/whatever', token: null })
    expect(res.status).toBe(403)
  })

  it('POST /admin with valid admin → 404 (only GET / is defined)', async () => {
    const app = makeApp(goodAuth())
    const res = await app.request(
      '/admin',
      { method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': VALID_TOKEN } },
      {} as unknown as Parameters<typeof app.request>[2],
    )
    expect(res.status).toBe(404)
  })

  it('POST /admin with no token → 403', async () => {
    const app = makeApp(goodAuth())
    const res = await app.request(
      '/admin',
      { method: 'POST' },
      {} as unknown as Parameters<typeof app.request>[2],
    )
    expect(res.status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// LEAK CHECKS (existing)
// ---------------------------------------------------------------------------

describe('admin-routes: leak checks', () => {
  it('403 body does NOT contain the rejected email', async () => {
    const rejectedEmail = 'other@example.com'
    const app = makeApp(() => ({
      verifier: async () => ({ email: rejectedEmail }),
      allowlist: new Set([ADMIN_EMAIL]),
    }))
    const res = await getAdmin(app)
    expect(res.status).toBe(403)
    const body = await res.text()
    expect(body).not.toContain(rejectedEmail)
  })

  it('403 body does NOT contain the token value', async () => {
    const secretToken = 'super-secret-jwt-value'
    const app = makeApp(() => ({
      verifier: async () => ({ email: 'other@example.com' }),
      allowlist: new Set([ADMIN_EMAIL]),
    }))
    const res = await app.request(
      '/admin',
      { headers: { 'Cf-Access-Jwt-Assertion': secretToken } },
      {} as unknown as Parameters<typeof app.request>[2],
    )
    const body = await res.text()
    expect(body).not.toContain(secretToken)
  })
})

// ---------------------------------------------------------------------------
// GET /admin/users — success
// ---------------------------------------------------------------------------

describe('admin-routes: GET /admin/users success', () => {
  it('returns 200 with valid admin and fake repo', async () => {
    const app = makeApp(goodAuth(), makeUserRepo([SAMPLE_USER]))
    const res = await getAdmin(app, { path: '/admin/users' })
    expect(res.status).toBe(200)
  })

  it('sets Cache-Control: no-store', async () => {
    const app = makeApp(goodAuth(), makeUserRepo([SAMPLE_USER]))
    const res = await getAdmin(app, { path: '/admin/users' })
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('body contains user id', async () => {
    const app = makeApp(goodAuth(), makeUserRepo([SAMPLE_USER]))
    const res = await getAdmin(app, { path: '/admin/users' })
    const body = await res.text()
    expect(body).toContain(SAMPLE_USER.id)
  })

  it('body contains display_name', async () => {
    const app = makeApp(goodAuth(), makeUserRepo([SAMPLE_USER]))
    const res = await getAdmin(app, { path: '/admin/users' })
    const body = await res.text()
    expect(body).toContain(SAMPLE_USER.display_name)
  })

  it('body shows 有効 for enabled=1', async () => {
    const app = makeApp(goodAuth(), makeUserRepo([SAMPLE_USER]))
    const res = await getAdmin(app, { path: '/admin/users' })
    const body = await res.text()
    expect(body).toContain('有効')
  })

  it('body shows 無効 for enabled=0', async () => {
    const app = makeApp(goodAuth(), makeUserRepo([SAMPLE_USER_2]))
    const res = await getAdmin(app, { path: '/admin/users' })
    const body = await res.text()
    expect(body).toContain('無効')
  })

  it('body shows なし for locked_until=null', async () => {
    const app = makeApp(goodAuth(), makeUserRepo([SAMPLE_USER]))
    const res = await getAdmin(app, { path: '/admin/users' })
    const body = await res.text()
    expect(body).toContain('なし')
  })

  it('body shows ロック中 for non-null locked_until', async () => {
    const app = makeApp(goodAuth(), makeUserRepo([SAMPLE_USER_2]))
    const res = await getAdmin(app, { path: '/admin/users' })
    const body = await res.text()
    expect(body).toContain('ロック中')
    expect(body).toContain(SAMPLE_USER_2.locked_until!)
  })

  it('body does NOT contain password_hash', async () => {
    const app = makeApp(goodAuth(), makeUserRepo([SAMPLE_USER]))
    const res = await getAdmin(app, { path: '/admin/users' })
    const body = await res.text()
    expect(body).not.toContain('password_hash')
  })

  it('body does NOT contain admin email', async () => {
    const app = makeApp(goodAuth(), makeUserRepo([SAMPLE_USER]))
    const res = await getAdmin(app, { path: '/admin/users' })
    const body = await res.text()
    expect(body).not.toContain(ADMIN_EMAIL)
  })
})

// ---------------------------------------------------------------------------
// GET /admin/users — empty list
// ---------------------------------------------------------------------------

describe('admin-routes: GET /admin/users empty list', () => {
  it('returns 200 with empty state message', async () => {
    const app = makeApp(goodAuth(), makeEmptyUserRepo())
    const res = await getAdmin(app, { path: '/admin/users' })
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('ユーザーがいません')
  })

  it('no table rows in empty state', async () => {
    const app = makeApp(goodAuth(), makeEmptyUserRepo())
    const res = await getAdmin(app, { path: '/admin/users' })
    const body = await res.text()
    expect(body).not.toContain('<tr>')
  })
})

// ---------------------------------------------------------------------------
// GET /admin/users — pagination
// ---------------------------------------------------------------------------

describe('admin-routes: GET /admin/users pagination', () => {
  it('hasMore true → body contains next-page link with last user id', async () => {
    const app = makeApp(goodAuth(), makeUserRepo([SAMPLE_USER, SAMPLE_USER_2], true))
    const res = await getAdmin(app, { path: '/admin/users' })
    const body = await res.text()
    expect(body).toContain(`/admin/users?after=${SAMPLE_USER_2.id}`)
  })

  it('hasMore false → no next-page link', async () => {
    const app = makeApp(goodAuth(), makeUserRepo([SAMPLE_USER], false))
    const res = await getAdmin(app, { path: '/admin/users' })
    const body = await res.text()
    expect(body).not.toContain('/admin/users?after=')
  })
})

// ---------------------------------------------------------------------------
// GET /admin/users — 400 bad cursor
// ---------------------------------------------------------------------------

describe('admin-routes: GET /admin/users 400 bad cursor', () => {
  it('invalid after param → 400 no-store', async () => {
    const app = makeApp(goodAuth(), makeEmptyUserRepo())
    const res = await getAdmin(app, { path: '/admin/users?after=!invalid!' })
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('invalid after param — body does not reflect the bad input', async () => {
    const badInput = '!invalid-cursor!'
    const app = makeApp(goodAuth(), makeEmptyUserRepo())
    const res = await getAdmin(app, { path: `/admin/users?after=${badInput}` })
    const body = await res.text()
    expect(body).not.toContain(badInput)
  })

  it('repeated after param → 400 no-store', async () => {
    const app = makeApp(goodAuth(), makeEmptyUserRepo())
    const res = await getAdmin(app, { path: '/admin/users?after=user-a-001&after=user-b-002' })
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})

// ---------------------------------------------------------------------------
// GET /admin/users — 500 repo throws
// ---------------------------------------------------------------------------

describe('admin-routes: GET /admin/users 500 repo throws', () => {
  it('repo.listUsers throws → 500 no-store', async () => {
    const app = makeApp(goodAuth(), makeThrowingUserRepo())
    const res = await getAdmin(app, { path: '/admin/users' })
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('500 body has no error detail', async () => {
    const app = makeApp(goodAuth(), makeThrowingUserRepo())
    const res = await getAdmin(app, { path: '/admin/users' })
    const body = await res.text()
    expect(body).not.toContain('D1 exploded')
  })
})

// ---------------------------------------------------------------------------
// GET /admin/users — AUTH PRESERVED
// ---------------------------------------------------------------------------

describe('admin-routes: GET /admin/users auth preserved', () => {
  it('no Cf-Access-Jwt-Assertion header → 403', async () => {
    const app = makeApp(goodAuth(), makeEmptyUserRepo())
    const res = await getAdmin(app, { path: '/admin/users', token: null })
    expect(res.status).toBe(403)
  })

  it('non-allowlisted email → 403', async () => {
    const app = makeApp(() => ({
      verifier: async () => ({ email: 'other@example.com' }),
      allowlist: new Set([ADMIN_EMAIL]),
    }), makeEmptyUserRepo())
    const res = await getAdmin(app, { path: '/admin/users' })
    expect(res.status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// UNIT TESTS: normalizeEmail
// ---------------------------------------------------------------------------

describe('normalizeEmail', () => {
  it('lowercases a valid email', () => {
    expect(normalizeEmail('A@B.com')).toBe('a@b.com')
  })

  it('returns null for email with surrounding whitespace', () => {
    expect(normalizeEmail(' a@b.com ')).toBeNull()
  })

  it('returns null for email with internal whitespace', () => {
    expect(normalizeEmail('a b@c.com')).toBeNull()
  })

  it('returns null for email with a control character', () => {
    expect(normalizeEmail('a@b.com\x00')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(normalizeEmail('')).toBeNull()
  })

  it('returns null for a non-string value (number)', () => {
    expect(normalizeEmail(42 as unknown as string)).toBeNull()
  })

  it('returns null for string with no @ (noat)', () => {
    expect(normalizeEmail('noat')).toBeNull()
  })

  it('returns null for string with multiple @ signs', () => {
    expect(normalizeEmail('a@b@c.com')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// UNIT TESTS: parseAdminAllowlist
// ---------------------------------------------------------------------------

describe('parseAdminAllowlist', () => {
  it('single valid email → Set of size 1', () => {
    const result = parseAdminAllowlist('a@b.com')
    expect(result).not.toBeNull()
    expect(result!.size).toBe(1)
    expect(result!.has('a@b.com')).toBe(true)
  })

  it('two comma-separated emails → size 2, both lowercased', () => {
    const result = parseAdminAllowlist('a@b.com, C@D.com')
    expect(result).not.toBeNull()
    expect(result!.size).toBe(2)
    expect(result!.has('a@b.com')).toBe(true)
    expect(result!.has('c@d.com')).toBe(true)
  })

  it('trailing comma → null (empty entry)', () => {
    expect(parseAdminAllowlist('a@b.com,')).toBeNull()
  })

  it('empty string → null', () => {
    expect(parseAdminAllowlist('')).toBeNull()
  })

  it('whitespace-only string → null', () => {
    expect(parseAdminAllowlist('   ')).toBeNull()
  })

  it('undefined → null', () => {
    expect(parseAdminAllowlist(undefined)).toBeNull()
  })

  it('contains a non-email entry → null', () => {
    expect(parseAdminAllowlist('a@b.com,notanemail')).toBeNull()
  })
})
