import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { createAdminRoutes } from '../src/routes/admin.js'
import { normalizeEmail, parseAdminAllowlist } from '../src/middleware/require-admin.js'
import type { AdminAuthConfig } from '../src/types/admin-auth.js'
import type { AdminUserPage, AdminUserSummary } from '../src/types/admin-user.js'
import type { AdminAlbumPage, AdminAlbumSummary } from '../src/types/admin-album.js'
import type { AdminPermissionPage, AdminPermissionSummary } from '../src/types/admin-permission.js'
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

const SAMPLE_ALBUM: AdminAlbumSummary = {
  id: 'album-sample-001',
  title: 'Summer Trip',
  enabled: 1,
  expires_at: null,
  download_enabled: 0,
  created_at: NOW_TS,
  updated_at: NOW_TS,
}

const SAMPLE_ALBUM_2: AdminAlbumSummary = {
  id: 'album-sample-002',
  title: 'Winter Holidays',
  enabled: 0,
  expires_at: '2026-12-31T23:59:59.000Z',
  download_enabled: 1,
  created_at: NOW_TS,
  updated_at: NOW_TS,
}

const SAMPLE_PERM: AdminPermissionSummary = {
  album_id: 'album-sample-001',
  user_id: 'user-sample-001',
  created_at: NOW_TS,
}

const SAMPLE_PERM_2: AdminPermissionSummary = {
  album_id: 'album-sample-002',
  user_id: 'user-sample-001',
  created_at: NOW_TS,
}

type UserRepo = {
  listUsers(afterUserId?: string): Promise<AdminUserPage>
  setUserEnabled(userId: string, enabled: number, updatedAt: string): Promise<void>
  createUser(userId: string, displayName: string, passwordHash: string, createdAt: string, updatedAt: string): Promise<void>
  resetPassword(userId: string, passwordHash: string, updatedAt: string): Promise<void>
}

type MutationUserRepo = UserRepo & {
  calls: { userId: string; enabled: number; updatedAt: string }[]
  createCalls: { userId: string; displayName: string; passwordHash: string; createdAt: string; updatedAt: string }[]
  resetCalls: { userId: string; passwordHash: string; updatedAt: string }[]
}

function makeEmptyUserRepo(): UserRepo {
  return {
    listUsers: async () => ({ users: [], hasMore: false }),
    setUserEnabled: async () => {},
    createUser: async () => {},
    resetPassword: async () => {},
  }
}

function makeUserRepo(
  users: AdminUserSummary[],
  hasMore = false,
): UserRepo {
  return {
    listUsers: async () => ({ users, hasMore }),
    setUserEnabled: async () => {},
    createUser: async () => {},
    resetPassword: async () => {},
  }
}

function makeThrowingUserRepo(): UserRepo {
  return {
    listUsers: async () => {
      throw new Error('D1 exploded')
    },
    setUserEnabled: async () => {},
    createUser: async () => {},
    resetPassword: async () => {},
  }
}

function makeMutationUserRepo(): MutationUserRepo {
  const calls: { userId: string; enabled: number; updatedAt: string }[] = []
  const createCalls: { userId: string; displayName: string; passwordHash: string; createdAt: string; updatedAt: string }[] = []
  const resetCalls: { userId: string; passwordHash: string; updatedAt: string }[] = []
  return {
    calls,
    createCalls,
    resetCalls,
    listUsers: async () => ({ users: [], hasMore: false }),
    setUserEnabled: async (userId, enabled, updatedAt) => { calls.push({ userId, enabled, updatedAt }) },
    createUser: async (userId, displayName, passwordHash, createdAt, updatedAt) => {
      createCalls.push({ userId, displayName, passwordHash, createdAt, updatedAt })
    },
    resetPassword: async (userId, passwordHash, updatedAt) => {
      resetCalls.push({ userId, passwordHash, updatedAt })
    },
  }
}

function makeThrowingSetEnabledUserRepo(): UserRepo {
  return {
    listUsers: async () => ({ users: [], hasMore: false }),
    setUserEnabled: async () => { throw new Error('D1 exploded') },
    createUser: async () => {},
    resetPassword: async () => {},
  }
}

function makeThrowingCreateUserRepo(): UserRepo {
  return {
    listUsers: async () => ({ users: [], hasMore: false }),
    setUserEnabled: async () => {},
    createUser: async () => { throw new Error('D1 exploded') },
    resetPassword: async () => {},
  }
}

function makeThrowingResetPasswordRepo(): UserRepo {
  return {
    listUsers: async () => ({ users: [], hasMore: false }),
    setUserEnabled: async () => {},
    createUser: async () => {},
    resetPassword: async () => { throw new Error('D1 exploded') },
  }
}

type AlbumRepo = {
  listAlbums(afterAlbumId?: string): Promise<AdminAlbumPage>
  setAlbumEnabled(albumId: string, enabled: number, updatedAt: string): Promise<void>
}

type MutationAlbumRepo = AlbumRepo & {
  calls: { albumId: string; enabled: number; updatedAt: string }[]
}

function makeEmptyAlbumRepo(): AlbumRepo {
  return {
    listAlbums: async () => ({ albums: [], hasMore: false }),
    setAlbumEnabled: async () => {},
  }
}

function makeAlbumRepo(
  albums: AdminAlbumSummary[],
  hasMore = false,
): AlbumRepo {
  return {
    listAlbums: async () => ({ albums, hasMore }),
    setAlbumEnabled: async () => {},
  }
}

function makeThrowingAlbumRepo(): AlbumRepo {
  return {
    listAlbums: async () => {
      throw new Error('D1 exploded')
    },
    setAlbumEnabled: async () => {},
  }
}

function makeMutationAlbumRepo(): MutationAlbumRepo {
  const calls: { albumId: string; enabled: number; updatedAt: string }[] = []
  return {
    calls,
    listAlbums: async () => ({ albums: [], hasMore: false }),
    setAlbumEnabled: async (albumId, enabled, updatedAt) => { calls.push({ albumId, enabled, updatedAt }) },
  }
}

function makeThrowingSetEnabledAlbumRepo(): AlbumRepo {
  return {
    listAlbums: async () => ({ albums: [], hasMore: false }),
    setAlbumEnabled: async () => { throw new Error('D1 exploded') },
  }
}

type PermissionRepo = {
  listPermissions(after?: { albumId: string; userId: string }): Promise<AdminPermissionPage>
  grantPermission(albumId: string, userId: string, createdAt: string): Promise<void>
  revokePermission(albumId: string, userId: string): Promise<void>
}

function makeEmptyPermissionRepo(): PermissionRepo {
  return {
    listPermissions: async () => ({ permissions: [], hasMore: false }),
    grantPermission: async () => {},
    revokePermission: async () => {},
  }
}

function makePermissionRepo(
  permissions: AdminPermissionSummary[],
  hasMore = false,
): PermissionRepo {
  return {
    listPermissions: async () => ({ permissions, hasMore }),
    grantPermission: async () => {},
    revokePermission: async () => {},
  }
}

function makeThrowingPermissionRepo(): PermissionRepo {
  return {
    listPermissions: async () => {
      throw new Error('D1 exploded')
    },
    grantPermission: async () => {},
    revokePermission: async () => {},
  }
}

type MutationPermissionRepo = PermissionRepo & {
  grantCalls: { albumId: string; userId: string; createdAt: string }[]
  revokeCalls: { albumId: string; userId: string }[]
}

function makeMutationPermissionRepo(): MutationPermissionRepo {
  const grantCalls: { albumId: string; userId: string; createdAt: string }[] = []
  const revokeCalls: { albumId: string; userId: string }[] = []
  return {
    grantCalls,
    revokeCalls,
    listPermissions: async () => ({ permissions: [], hasMore: false }),
    grantPermission: async (albumId, userId, createdAt) => {
      grantCalls.push({ albumId, userId, createdAt })
    },
    revokePermission: async (albumId, userId) => {
      revokeCalls.push({ albumId, userId })
    },
  }
}

function makeThrowingMutationPermissionRepo(): PermissionRepo {
  return {
    listPermissions: async () => ({ permissions: [], hasMore: false }),
    grantPermission: async () => { throw new Error('D1 exploded') },
    revokePermission: async () => { throw new Error('D1 exploded') },
  }
}

function makeClockSpy() {
  let callCount = 0
  const clock = () => { callCount++; return new Date(NOW_TS) }
  return { clock, getCallCount: () => callCount }
}

function makeApp(
  resolveAuth: ResolveAuth,
  userRepo?: UserRepo,
  albumRepo?: AlbumRepo,
  permissionRepo?: PermissionRepo,
  clock?: () => Date,
): Hono {
  const app = new Hono()
  app.route(
    '/admin',
    createAdminRoutes(resolveAuth, () => ({
      userRepo: userRepo ?? makeEmptyUserRepo(),
      albumRepo: albumRepo ?? makeEmptyAlbumRepo(),
      permissionRepo: permissionRepo ?? makeEmptyPermissionRepo(),
      clock: clock ?? (() => new Date(NOW_TS)),
    })),
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

  // The admin home intentionally links to the read-only album and permission
  // inventories (an admin surface, not viewer data). Leak guards above still
  // assert no viewer login form or /img/ content is present.
  it('body links to /admin/albums and /admin/permissions inventories', async () => {
    const res = await getAdmin(makeApp(goodAuth()))
    const body = await res.text()
    expect(body).toContain('/admin/albums')
    expect(body).toContain('/admin/permissions')
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

  it('GET /admin body now contains a link to /admin/albums', async () => {
    const res = await getAdmin(makeApp(goodAuth()))
    const body = await res.text()
    expect(body).toContain('/admin/albums')
  })

  it('GET /admin body now contains a link to /admin/permissions', async () => {
    const res = await getAdmin(makeApp(goodAuth()))
    const body = await res.text()
    expect(body).toContain('/admin/permissions')
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
// GET /admin/albums — success
// ---------------------------------------------------------------------------

describe('admin-routes: GET /admin/albums success', () => {
  it('returns 200 with valid admin and fake repo', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepo([SAMPLE_ALBUM]))
    const res = await getAdmin(app, { path: '/admin/albums' })
    expect(res.status).toBe(200)
  })

  it('sets Cache-Control: no-store', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepo([SAMPLE_ALBUM]))
    const res = await getAdmin(app, { path: '/admin/albums' })
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('body contains album id', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepo([SAMPLE_ALBUM]))
    const res = await getAdmin(app, { path: '/admin/albums' })
    const body = await res.text()
    expect(body).toContain(SAMPLE_ALBUM.id)
  })

  it('body contains album title', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepo([SAMPLE_ALBUM]))
    const res = await getAdmin(app, { path: '/admin/albums' })
    const body = await res.text()
    expect(body).toContain(SAMPLE_ALBUM.title)
  })

  it('body shows 有効 for enabled=1', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepo([SAMPLE_ALBUM]))
    const res = await getAdmin(app, { path: '/admin/albums' })
    const body = await res.text()
    expect(body).toContain('有効')
  })

  it('body shows 無効 for enabled=0', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepo([SAMPLE_ALBUM_2]))
    const res = await getAdmin(app, { path: '/admin/albums' })
    const body = await res.text()
    expect(body).toContain('無効')
  })

  it('body shows なし for expires_at=null', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepo([SAMPLE_ALBUM]))
    const res = await getAdmin(app, { path: '/admin/albums' })
    const body = await res.text()
    expect(body).toContain('なし')
  })

  it('body shows expires_at value when non-null', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepo([SAMPLE_ALBUM_2]))
    const res = await getAdmin(app, { path: '/admin/albums' })
    const body = await res.text()
    expect(body).toContain(SAMPLE_ALBUM_2.expires_at!)
  })

  it('body shows 許可 for download_enabled=1', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepo([SAMPLE_ALBUM_2]))
    const res = await getAdmin(app, { path: '/admin/albums' })
    const body = await res.text()
    expect(body).toContain('許可')
  })

  it('body shows 不可 for download_enabled=0', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepo([SAMPLE_ALBUM]))
    const res = await getAdmin(app, { path: '/admin/albums' })
    const body = await res.text()
    expect(body).toContain('不可')
  })

  it('body does NOT contain photoprism_album_uid', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepo([SAMPLE_ALBUM]))
    const res = await getAdmin(app, { path: '/admin/albums' })
    const body = await res.text()
    expect(body).not.toContain('photoprism_album_uid')
  })

  it('body does NOT contain strip_exif', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepo([SAMPLE_ALBUM]))
    const res = await getAdmin(app, { path: '/admin/albums' })
    const body = await res.text()
    expect(body).not.toContain('strip_exif')
  })
})

// ---------------------------------------------------------------------------
// GET /admin/albums — empty list
// ---------------------------------------------------------------------------

describe('admin-routes: GET /admin/albums empty list', () => {
  it('returns 200 with empty state message', async () => {
    const app = makeApp(goodAuth(), undefined, makeEmptyAlbumRepo())
    const res = await getAdmin(app, { path: '/admin/albums' })
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('アルバムがありません')
  })

  it('no table rows in empty state', async () => {
    const app = makeApp(goodAuth(), undefined, makeEmptyAlbumRepo())
    const res = await getAdmin(app, { path: '/admin/albums' })
    const body = await res.text()
    expect(body).not.toContain('<tr>')
  })
})

// ---------------------------------------------------------------------------
// GET /admin/albums — pagination
// ---------------------------------------------------------------------------

describe('admin-routes: GET /admin/albums pagination', () => {
  it('hasMore true → body contains next-page link with last album id', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepo([SAMPLE_ALBUM, SAMPLE_ALBUM_2], true))
    const res = await getAdmin(app, { path: '/admin/albums' })
    const body = await res.text()
    expect(body).toContain(`/admin/albums?after=${SAMPLE_ALBUM_2.id}`)
  })

  it('hasMore false → no next-page link', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepo([SAMPLE_ALBUM], false))
    const res = await getAdmin(app, { path: '/admin/albums' })
    const body = await res.text()
    expect(body).not.toContain('/admin/albums?after=')
  })
})

// ---------------------------------------------------------------------------
// GET /admin/albums — 400 bad cursor
// ---------------------------------------------------------------------------

describe('admin-routes: GET /admin/albums 400 bad cursor', () => {
  it('invalid after param → 400 no-store', async () => {
    const app = makeApp(goodAuth(), undefined, makeEmptyAlbumRepo())
    const res = await getAdmin(app, { path: '/admin/albums?after=!invalid!' })
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('invalid after param — body does not reflect the bad input', async () => {
    const badInput = '!invalid-cursor!'
    const app = makeApp(goodAuth(), undefined, makeEmptyAlbumRepo())
    const res = await getAdmin(app, { path: `/admin/albums?after=${badInput}` })
    const body = await res.text()
    expect(body).not.toContain(badInput)
  })

  it('repeated after param → 400 no-store', async () => {
    const app = makeApp(goodAuth(), undefined, makeEmptyAlbumRepo())
    const res = await getAdmin(app, { path: '/admin/albums?after=album-a-001&after=album-b-002' })
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})

// ---------------------------------------------------------------------------
// GET /admin/albums — 500 repo throws
// ---------------------------------------------------------------------------

describe('admin-routes: GET /admin/albums 500 repo throws', () => {
  it('repo.listAlbums throws → 500 no-store', async () => {
    const app = makeApp(goodAuth(), undefined, makeThrowingAlbumRepo())
    const res = await getAdmin(app, { path: '/admin/albums' })
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('500 body has no error detail', async () => {
    const app = makeApp(goodAuth(), undefined, makeThrowingAlbumRepo())
    const res = await getAdmin(app, { path: '/admin/albums' })
    const body = await res.text()
    expect(body).not.toContain('D1 exploded')
  })
})

// ---------------------------------------------------------------------------
// GET /admin/albums — AUTH PRESERVED
// ---------------------------------------------------------------------------

describe('admin-routes: GET /admin/albums auth preserved', () => {
  it('no Cf-Access-Jwt-Assertion header → 403', async () => {
    const app = makeApp(goodAuth(), undefined, makeEmptyAlbumRepo())
    const res = await getAdmin(app, { path: '/admin/albums', token: null })
    expect(res.status).toBe(403)
  })

  it('non-allowlisted email → 403', async () => {
    const app = makeApp(() => ({
      verifier: async () => ({ email: 'other@example.com' }),
      allowlist: new Set([ADMIN_EMAIL]),
    }), undefined, makeEmptyAlbumRepo())
    const res = await getAdmin(app, { path: '/admin/albums' })
    expect(res.status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// GET /admin/albums — form rendering
// ---------------------------------------------------------------------------

describe('admin-routes: GET /admin/albums form rendering', () => {
  it('enabled album → body contains action="/admin/albums/disable"', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepo([SAMPLE_ALBUM]))
    const res = await getAdmin(app, { path: '/admin/albums' })
    const body = await res.text()
    expect(body).toContain('action="/admin/albums/disable"')
  })

  it('enabled album → body contains hidden albumId input with row id', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepo([SAMPLE_ALBUM]))
    const res = await getAdmin(app, { path: '/admin/albums' })
    const body = await res.text()
    expect(body).toContain(`value="${SAMPLE_ALBUM.id}"`)
  })

  it('enabled album → body does NOT contain action="/admin/albums/enable"', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepo([SAMPLE_ALBUM]))
    const res = await getAdmin(app, { path: '/admin/albums' })
    const body = await res.text()
    expect(body).not.toContain('action="/admin/albums/enable"')
  })

  it('disabled album → body contains action="/admin/albums/enable"', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepo([SAMPLE_ALBUM_2]))
    const res = await getAdmin(app, { path: '/admin/albums' })
    const body = await res.text()
    expect(body).toContain('action="/admin/albums/enable"')
  })

  it('disabled album → body contains hidden albumId input with row id', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepo([SAMPLE_ALBUM_2]))
    const res = await getAdmin(app, { path: '/admin/albums' })
    const body = await res.text()
    expect(body).toContain(`value="${SAMPLE_ALBUM_2.id}"`)
  })

  it('disabled album → body does NOT contain action="/admin/albums/disable"', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepo([SAMPLE_ALBUM_2]))
    const res = await getAdmin(app, { path: '/admin/albums' })
    const body = await res.text()
    expect(body).not.toContain('action="/admin/albums/disable"')
  })

  it('body contains name="albumId" for the operation form', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepo([SAMPLE_ALBUM]))
    const res = await getAdmin(app, { path: '/admin/albums' })
    const body = await res.text()
    expect(body).toContain('name="albumId"')
  })

  it('body does NOT contain name="enabled" (no enabled input in form)', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepo([SAMPLE_ALBUM]))
    const res = await getAdmin(app, { path: '/admin/albums' })
    const body = await res.text()
    expect(body).not.toContain('name="enabled"')
  })

  it('操作 column header present', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepo([SAMPLE_ALBUM]))
    const res = await getAdmin(app, { path: '/admin/albums' })
    const body = await res.text()
    expect(body).toContain('操作')
  })

  it('body does NOT contain photoprism_album_uid', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepo([SAMPLE_ALBUM]))
    const res = await getAdmin(app, { path: '/admin/albums' })
    const body = await res.text()
    expect(body).not.toContain('photoprism_album_uid')
  })

  it('body does NOT contain strip_exif', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepo([SAMPLE_ALBUM]))
    const res = await getAdmin(app, { path: '/admin/albums' })
    const body = await res.text()
    expect(body).not.toContain('strip_exif')
  })
})

// ---------------------------------------------------------------------------
// GET /admin/permissions — success
// ---------------------------------------------------------------------------

describe('admin-routes: GET /admin/permissions success', () => {
  it('returns 200 with valid admin and fake repo', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, makePermissionRepo([SAMPLE_PERM]))
    const res = await getAdmin(app, { path: '/admin/permissions' })
    expect(res.status).toBe(200)
  })

  it('sets Cache-Control: no-store', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, makePermissionRepo([SAMPLE_PERM]))
    const res = await getAdmin(app, { path: '/admin/permissions' })
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('body contains album_id', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, makePermissionRepo([SAMPLE_PERM]))
    const res = await getAdmin(app, { path: '/admin/permissions' })
    const body = await res.text()
    expect(body).toContain(SAMPLE_PERM.album_id)
  })

  it('body contains user_id', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, makePermissionRepo([SAMPLE_PERM]))
    const res = await getAdmin(app, { path: '/admin/permissions' })
    const body = await res.text()
    expect(body).toContain(SAMPLE_PERM.user_id)
  })

  it('body contains created_at', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, makePermissionRepo([SAMPLE_PERM]))
    const res = await getAdmin(app, { path: '/admin/permissions' })
    const body = await res.text()
    expect(body).toContain(SAMPLE_PERM.created_at)
  })

  it('body does NOT contain password_hash', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, makePermissionRepo([SAMPLE_PERM]))
    const res = await getAdmin(app, { path: '/admin/permissions' })
    const body = await res.text()
    expect(body).not.toContain('password_hash')
  })

  it('body does NOT contain display_name text', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, makePermissionRepo([SAMPLE_PERM]))
    const res = await getAdmin(app, { path: '/admin/permissions' })
    const body = await res.text()
    expect(body).not.toContain('display_name')
  })

  it('body does NOT contain title (album title)', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, makePermissionRepo([SAMPLE_PERM]))
    const res = await getAdmin(app, { path: '/admin/permissions' })
    const body = await res.text()
    // "title" must not appear as a data field (column header or data leak)
    // The page heading/tag text is fine but data fields must not appear
    expect(body).not.toContain('Summer Trip')
  })
})

// ---------------------------------------------------------------------------
// GET /admin/permissions — empty list
// ---------------------------------------------------------------------------

describe('admin-routes: GET /admin/permissions empty list', () => {
  it('returns 200 with empty state message', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, makeEmptyPermissionRepo())
    const res = await getAdmin(app, { path: '/admin/permissions' })
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('権限がありません')
  })

  it('no table rows in empty state', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, makeEmptyPermissionRepo())
    const res = await getAdmin(app, { path: '/admin/permissions' })
    const body = await res.text()
    expect(body).not.toContain('<tr>')
  })
})

// ---------------------------------------------------------------------------
// GET /admin/permissions — pagination
// ---------------------------------------------------------------------------

describe('admin-routes: GET /admin/permissions pagination', () => {
  it('hasMore true → body contains next-page link with composite cursor', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, makePermissionRepo([SAMPLE_PERM, SAMPLE_PERM_2], true))
    const res = await getAdmin(app, { path: '/admin/permissions' })
    const body = await res.text()
    // JSX/HTML escapes the `&` joining the two query params to `&amp;` in the
    // rendered href; a browser parses it back to `&`, so the link is correct.
    expect(body).toContain(`/admin/permissions?after_album=${SAMPLE_PERM_2.album_id}&amp;after_user=${SAMPLE_PERM_2.user_id}`)
  })

  it('hasMore false → no next-page link', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, makePermissionRepo([SAMPLE_PERM], false))
    const res = await getAdmin(app, { path: '/admin/permissions' })
    const body = await res.text()
    expect(body).not.toContain('/admin/permissions?after_album=')
  })
})

// ---------------------------------------------------------------------------
// GET /admin/permissions — 400 bad cursor
// ---------------------------------------------------------------------------

describe('admin-routes: GET /admin/permissions 400 bad cursor', () => {
  it('invalid after_album → 400 no-store', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, makeEmptyPermissionRepo())
    const res = await getAdmin(app, { path: '/admin/permissions?after_album=!bad!&after_user=user-abc-001' })
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('invalid after_user → 400 no-store', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, makeEmptyPermissionRepo())
    const res = await getAdmin(app, { path: '/admin/permissions?after_album=album-abc-001&after_user=!bad!' })
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('only after_album provided (missing after_user) → 400 no-store', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, makeEmptyPermissionRepo())
    const res = await getAdmin(app, { path: '/admin/permissions?after_album=album-abc-001' })
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('only after_user provided (missing after_album) → 400 no-store', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, makeEmptyPermissionRepo())
    const res = await getAdmin(app, { path: '/admin/permissions?after_user=user-abc-001' })
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('repeated after_album → 400 no-store', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, makeEmptyPermissionRepo())
    const res = await getAdmin(app, { path: '/admin/permissions?after_album=album-a&after_album=album-b&after_user=user-a' })
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('repeated after_user → 400 no-store', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, makeEmptyPermissionRepo())
    const res = await getAdmin(app, { path: '/admin/permissions?after_album=album-a&after_user=user-a&after_user=user-b' })
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('400 body does not reflect bad cursor input', async () => {
    const badAlbum = '!bad-album!'
    const app = makeApp(goodAuth(), undefined, undefined, makeEmptyPermissionRepo())
    const res = await getAdmin(app, { path: `/admin/permissions?after_album=${badAlbum}&after_user=user-abc-001` })
    const body = await res.text()
    expect(body).not.toContain(badAlbum)
  })
})

// ---------------------------------------------------------------------------
// GET /admin/permissions — 500 repo throws
// ---------------------------------------------------------------------------

describe('admin-routes: GET /admin/permissions 500 repo throws', () => {
  it('repo.listPermissions throws → 500 no-store', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, makeThrowingPermissionRepo())
    const res = await getAdmin(app, { path: '/admin/permissions' })
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('500 body has no error detail', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, makeThrowingPermissionRepo())
    const res = await getAdmin(app, { path: '/admin/permissions' })
    const body = await res.text()
    expect(body).not.toContain('D1 exploded')
  })
})

// ---------------------------------------------------------------------------
// GET /admin/permissions — AUTH PRESERVED
// ---------------------------------------------------------------------------

describe('admin-routes: GET /admin/permissions auth preserved', () => {
  it('no Cf-Access-Jwt-Assertion header → 403', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, makeEmptyPermissionRepo())
    const res = await getAdmin(app, { path: '/admin/permissions', token: null })
    expect(res.status).toBe(403)
  })

  it('non-allowlisted email → 403', async () => {
    const app = makeApp(() => ({
      verifier: async () => ({ email: 'other@example.com' }),
      allowlist: new Set([ADMIN_EMAIL]),
    }), undefined, undefined, makeEmptyPermissionRepo())
    const res = await getAdmin(app, { path: '/admin/permissions' })
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

// ---------------------------------------------------------------------------
// POST helpers
// ---------------------------------------------------------------------------

const VALID_ALBUM_ID = 'album-sample-001'
const VALID_USER_ID = 'user-sample-001'
const VALID_FORM_BODY = `albumId=${VALID_ALBUM_ID}&userId=${VALID_USER_ID}`
const VALID_ALBUM_BODY = `albumId=${VALID_ALBUM_ID}`
const VALID_USER_BODY = `userId=${VALID_USER_ID}`
const VALID_ORIGIN = 'http://localhost'
const VALID_PASSWORD = 'correct-horse-battery'
const VALID_DISPLAY_NAME = 'New User'
const NEW_USER_ID = 'user-new-001'
const VALID_CREATE_BODY = `userId=${NEW_USER_ID}&displayName=${encodeURIComponent(VALID_DISPLAY_NAME)}&password=${encodeURIComponent(VALID_PASSWORD)}`
const VALID_RESET_BODY = `userId=${VALID_USER_ID}&password=${encodeURIComponent(VALID_PASSWORD)}`
const PBKDF2_HASH_RE = /^pbkdf2-sha256\$100000\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/

function makeValidPostOptions() {
  return {
    token: VALID_TOKEN as string | null,
    origin: VALID_ORIGIN as string | undefined,
    contentType: 'application/x-www-form-urlencoded' as string | undefined,
    body: VALID_FORM_BODY as string | undefined,
  }
}

function makeValidAlbumPostOptions() {
  return {
    token: VALID_TOKEN as string | null,
    origin: VALID_ORIGIN as string | undefined,
    contentType: 'application/x-www-form-urlencoded' as string | undefined,
    body: VALID_ALBUM_BODY as string | undefined,
  }
}

function makeValidUserPostOptions() {
  return {
    token: VALID_TOKEN as string | null,
    origin: VALID_ORIGIN as string | undefined,
    contentType: 'application/x-www-form-urlencoded' as string | undefined,
    body: VALID_USER_BODY as string | undefined,
  }
}

function makeValidCreatePostOptions() {
  return {
    token: VALID_TOKEN as string | null,
    origin: VALID_ORIGIN as string | undefined,
    contentType: 'application/x-www-form-urlencoded' as string | undefined,
    body: VALID_CREATE_BODY as string | undefined,
  }
}

function makeValidResetPostOptions() {
  return {
    token: VALID_TOKEN as string | null,
    origin: VALID_ORIGIN as string | undefined,
    contentType: 'application/x-www-form-urlencoded' as string | undefined,
    body: VALID_RESET_BODY as string | undefined,
  }
}

async function postAdmin(
  app: Hono,
  path: string,
  options: {
    token?: string | null
    origin?: string | undefined
    contentType?: string | undefined
    body?: string | undefined
    extraHeaders?: Record<string, string>
  } = {},
): Promise<Response> {
  const { token = VALID_TOKEN, origin, contentType, body, extraHeaders = {} } = options
  const headers: Record<string, string> = { ...extraHeaders }
  if (token !== null) {
    headers['Cf-Access-Jwt-Assertion'] = token
  }
  if (origin !== undefined) {
    headers['Origin'] = origin
  }
  if (contentType !== undefined) {
    headers['Content-Type'] = contentType
  }
  return Promise.resolve(
    app.request(
      path,
      { method: 'POST', headers, body: body ?? null },
      {} as unknown as Parameters<typeof app.request>[2],
    ),
  )
}

// ---------------------------------------------------------------------------
// POST /admin/permissions/grant — guard, same-origin, content-type, body
// ---------------------------------------------------------------------------

describe('admin-routes: POST /admin/permissions/grant guard', () => {
  it('no token → 403 Forbidden no-store, grant not called', async () => {
    const repo = makeMutationPermissionRepo()
    const app = makeApp(goodAuth(), undefined, undefined, repo)
    const res = await postAdmin(app, '/admin/permissions/grant', {
      ...makeValidPostOptions(),
      token: null,
    })
    await assertForbidden(res)
    expect(repo.grantCalls).toHaveLength(0)
  })

  it('non-allowlisted email → 403, grant not called', async () => {
    const repo = makeMutationPermissionRepo()
    const app = makeApp(() => ({
      verifier: async () => ({ email: 'other@example.com' }),
      allowlist: new Set([ADMIN_EMAIL]),
    }), undefined, undefined, repo)
    const res = await postAdmin(app, '/admin/permissions/grant', makeValidPostOptions())
    await assertForbidden(res)
    expect(repo.grantCalls).toHaveLength(0)
  })

  it('Origin absent → 403, grant not called', async () => {
    const repo = makeMutationPermissionRepo()
    const app = makeApp(goodAuth(), undefined, undefined, repo)
    const res = await postAdmin(app, '/admin/permissions/grant', {
      ...makeValidPostOptions(),
      origin: undefined,
    })
    await assertForbidden(res)
    expect(repo.grantCalls).toHaveLength(0)
  })

  it('Origin = literal "null" → 403, grant not called', async () => {
    const repo = makeMutationPermissionRepo()
    const app = makeApp(goodAuth(), undefined, undefined, repo)
    const res = await postAdmin(app, '/admin/permissions/grant', {
      ...makeValidPostOptions(),
      origin: 'null',
    })
    await assertForbidden(res)
    expect(repo.grantCalls).toHaveLength(0)
  })

  it('Origin mismatched → 403, grant not called', async () => {
    const repo = makeMutationPermissionRepo()
    const app = makeApp(goodAuth(), undefined, undefined, repo)
    const res = await postAdmin(app, '/admin/permissions/grant', {
      ...makeValidPostOptions(),
      origin: 'https://evil.example',
    })
    await assertForbidden(res)
    expect(repo.grantCalls).toHaveLength(0)
  })
})

describe('admin-routes: POST /admin/permissions/grant content-type validation', () => {
  it('Content-Type missing → 400 no-store, grant not called', async () => {
    const repo = makeMutationPermissionRepo()
    const app = makeApp(goodAuth(), undefined, undefined, repo)
    const res = await postAdmin(app, '/admin/permissions/grant', {
      ...makeValidPostOptions(),
      contentType: undefined,
    })
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(repo.grantCalls).toHaveLength(0)
  })

  it('Content-Type application/json → 400, grant not called', async () => {
    const repo = makeMutationPermissionRepo()
    const app = makeApp(goodAuth(), undefined, undefined, repo)
    const res = await postAdmin(app, '/admin/permissions/grant', {
      ...makeValidPostOptions(),
      contentType: 'application/json',
    })
    expect(res.status).toBe(400)
    expect(repo.grantCalls).toHaveLength(0)
  })

  it('Content-Type with charset → accepted (not 400)', async () => {
    const repo = makeMutationPermissionRepo()
    const app = makeApp(goodAuth(), undefined, undefined, repo)
    const res = await postAdmin(app, '/admin/permissions/grant', {
      ...makeValidPostOptions(),
      contentType: 'application/x-www-form-urlencoded; charset=utf-8',
    })
    expect(res.status).not.toBe(400)
  })

  it('Content-Type with a non-charset parameter → 400, grant not called', async () => {
    const repo = makeMutationPermissionRepo()
    const app = makeApp(goodAuth(), undefined, undefined, repo)
    const res = await postAdmin(app, '/admin/permissions/grant', {
      ...makeValidPostOptions(),
      contentType: 'application/x-www-form-urlencoded; boundary=unexpected',
    })
    expect(res.status).toBe(400)
    expect(repo.grantCalls).toHaveLength(0)
  })
})

describe('admin-routes: POST /admin/permissions/grant body validation', () => {
  it('Body missing albumId → 400, grant not called', async () => {
    const repo = makeMutationPermissionRepo()
    const app = makeApp(goodAuth(), undefined, undefined, repo)
    const res = await postAdmin(app, '/admin/permissions/grant', {
      ...makeValidPostOptions(),
      body: 'userId=user-sample-001',
    })
    expect(res.status).toBe(400)
    expect(repo.grantCalls).toHaveLength(0)
  })

  it('Body missing userId → 400, grant not called', async () => {
    const repo = makeMutationPermissionRepo()
    const app = makeApp(goodAuth(), undefined, undefined, repo)
    const res = await postAdmin(app, '/admin/permissions/grant', {
      ...makeValidPostOptions(),
      body: 'albumId=album-sample-001',
    })
    expect(res.status).toBe(400)
    expect(repo.grantCalls).toHaveLength(0)
  })

  it('Body with extra field → 400, grant not called', async () => {
    const repo = makeMutationPermissionRepo()
    const app = makeApp(goodAuth(), undefined, undefined, repo)
    const res = await postAdmin(app, '/admin/permissions/grant', {
      ...makeValidPostOptions(),
      body: 'albumId=album-sample-001&userId=user-sample-001&role=admin',
    })
    expect(res.status).toBe(400)
    expect(repo.grantCalls).toHaveLength(0)
  })

  it('Body with repeated albumId → 400, grant not called', async () => {
    const repo = makeMutationPermissionRepo()
    const app = makeApp(goodAuth(), undefined, undefined, repo)
    const res = await postAdmin(app, '/admin/permissions/grant', {
      ...makeValidPostOptions(),
      body: 'albumId=album-a&albumId=album-b&userId=user-sample-001',
    })
    expect(res.status).toBe(400)
    expect(repo.grantCalls).toHaveLength(0)
  })

  it('Body with invalid albumId → 400, grant not called', async () => {
    const repo = makeMutationPermissionRepo()
    const app = makeApp(goodAuth(), undefined, undefined, repo)
    const res = await postAdmin(app, '/admin/permissions/grant', {
      ...makeValidPostOptions(),
      body: 'albumId=!bad!&userId=user-sample-001',
    })
    expect(res.status).toBe(400)
    expect(repo.grantCalls).toHaveLength(0)
  })

  it('Clock not called when body is invalid', async () => {
    const spy = makeClockSpy()
    const repo = makeMutationPermissionRepo()
    const app = makeApp(goodAuth(), undefined, undefined, repo, spy.clock)
    await postAdmin(app, '/admin/permissions/grant', {
      ...makeValidPostOptions(),
      body: 'albumId=!bad!&userId=user-sample-001',
    })
    expect(spy.getCallCount()).toBe(0)
  })
})

describe('admin-routes: POST /admin/permissions/grant success', () => {
  it('valid grant → 303 with Location /admin/permissions and no-store', async () => {
    const repo = makeMutationPermissionRepo()
    const app = makeApp(goodAuth(), undefined, undefined, repo)
    const res = await postAdmin(app, '/admin/permissions/grant', makeValidPostOptions())
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/admin/permissions')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('valid grant → empty body', async () => {
    const repo = makeMutationPermissionRepo()
    const app = makeApp(goodAuth(), undefined, undefined, repo)
    const res = await postAdmin(app, '/admin/permissions/grant', makeValidPostOptions())
    const body = await res.text()
    expect(body).toBe('')
  })

  it('valid grant → grantPermission called once with correct args', async () => {
    const repo = makeMutationPermissionRepo()
    const app = makeApp(goodAuth(), undefined, undefined, repo)
    await postAdmin(app, '/admin/permissions/grant', makeValidPostOptions())
    expect(repo.grantCalls).toHaveLength(1)
    expect(repo.grantCalls[0]).toEqual({
      albumId: VALID_ALBUM_ID,
      userId: VALID_USER_ID,
      createdAt: NOW_TS,
    })
  })

  it('valid grant → revokePermission NOT called', async () => {
    const repo = makeMutationPermissionRepo()
    const app = makeApp(goodAuth(), undefined, undefined, repo)
    await postAdmin(app, '/admin/permissions/grant', makeValidPostOptions())
    expect(repo.revokeCalls).toHaveLength(0)
  })

  it('repo throws → 500 no-store', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, makeThrowingMutationPermissionRepo())
    const res = await postAdmin(app, '/admin/permissions/grant', makeValidPostOptions())
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('clock throws → fixed 500 no-store without calling repo', async () => {
    const repo = makeMutationPermissionRepo()
    const app = makeApp(goodAuth(), undefined, undefined, repo, () => {
      throw new Error('clock detail must not escape')
    })
    const res = await postAdmin(app, '/admin/permissions/grant', makeValidPostOptions())
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.text()).toBe('Internal Server Error')
    expect(repo.grantCalls).toHaveLength(0)
  })

  it('invalid clock date → fixed 500 no-store without calling repo', async () => {
    const repo = makeMutationPermissionRepo()
    const app = makeApp(goodAuth(), undefined, undefined, repo, () => new Date(Number.NaN))
    const res = await postAdmin(app, '/admin/permissions/grant', makeValidPostOptions())
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.text()).toBe('Internal Server Error')
    expect(repo.grantCalls).toHaveLength(0)
  })

  it('repo throws → generic body, no detail', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, makeThrowingMutationPermissionRepo())
    const res = await postAdmin(app, '/admin/permissions/grant', makeValidPostOptions())
    const body = await res.text()
    expect(body).toBe('Internal Server Error')
  })
})

// ---------------------------------------------------------------------------
// POST /admin/permissions/revoke — guard, same-origin, content-type, body
// ---------------------------------------------------------------------------

describe('admin-routes: POST /admin/permissions/revoke guard', () => {
  it('no token → 403 Forbidden no-store, revoke not called', async () => {
    const repo = makeMutationPermissionRepo()
    const app = makeApp(goodAuth(), undefined, undefined, repo)
    const res = await postAdmin(app, '/admin/permissions/revoke', {
      ...makeValidPostOptions(),
      token: null,
    })
    await assertForbidden(res)
    expect(repo.revokeCalls).toHaveLength(0)
  })

  it('non-allowlisted email → 403, revoke not called', async () => {
    const repo = makeMutationPermissionRepo()
    const app = makeApp(() => ({
      verifier: async () => ({ email: 'other@example.com' }),
      allowlist: new Set([ADMIN_EMAIL]),
    }), undefined, undefined, repo)
    const res = await postAdmin(app, '/admin/permissions/revoke', makeValidPostOptions())
    await assertForbidden(res)
    expect(repo.revokeCalls).toHaveLength(0)
  })

  it('Origin absent → 403, revoke not called', async () => {
    const repo = makeMutationPermissionRepo()
    const app = makeApp(goodAuth(), undefined, undefined, repo)
    const res = await postAdmin(app, '/admin/permissions/revoke', {
      ...makeValidPostOptions(),
      origin: undefined,
    })
    await assertForbidden(res)
    expect(repo.revokeCalls).toHaveLength(0)
  })

  it('Origin = literal "null" → 403, revoke not called', async () => {
    const repo = makeMutationPermissionRepo()
    const app = makeApp(goodAuth(), undefined, undefined, repo)
    const res = await postAdmin(app, '/admin/permissions/revoke', {
      ...makeValidPostOptions(),
      origin: 'null',
    })
    await assertForbidden(res)
    expect(repo.revokeCalls).toHaveLength(0)
  })

  it('Origin mismatched → 403, revoke not called', async () => {
    const repo = makeMutationPermissionRepo()
    const app = makeApp(goodAuth(), undefined, undefined, repo)
    const res = await postAdmin(app, '/admin/permissions/revoke', {
      ...makeValidPostOptions(),
      origin: 'https://evil.example',
    })
    await assertForbidden(res)
    expect(repo.revokeCalls).toHaveLength(0)
  })
})

describe('admin-routes: POST /admin/permissions/revoke content-type validation', () => {
  it('Content-Type missing → 400 no-store, revoke not called', async () => {
    const repo = makeMutationPermissionRepo()
    const app = makeApp(goodAuth(), undefined, undefined, repo)
    const res = await postAdmin(app, '/admin/permissions/revoke', {
      ...makeValidPostOptions(),
      contentType: undefined,
    })
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(repo.revokeCalls).toHaveLength(0)
  })

  it('Content-Type application/json → 400, revoke not called', async () => {
    const repo = makeMutationPermissionRepo()
    const app = makeApp(goodAuth(), undefined, undefined, repo)
    const res = await postAdmin(app, '/admin/permissions/revoke', {
      ...makeValidPostOptions(),
      contentType: 'application/json',
    })
    expect(res.status).toBe(400)
    expect(repo.revokeCalls).toHaveLength(0)
  })

  it('Content-Type with charset → accepted (not 400)', async () => {
    const repo = makeMutationPermissionRepo()
    const app = makeApp(goodAuth(), undefined, undefined, repo)
    const res = await postAdmin(app, '/admin/permissions/revoke', {
      ...makeValidPostOptions(),
      contentType: 'application/x-www-form-urlencoded; charset=utf-8',
    })
    expect(res.status).not.toBe(400)
  })
})

describe('admin-routes: POST /admin/permissions/revoke body validation', () => {
  it('Body missing albumId → 400, revoke not called', async () => {
    const repo = makeMutationPermissionRepo()
    const app = makeApp(goodAuth(), undefined, undefined, repo)
    const res = await postAdmin(app, '/admin/permissions/revoke', {
      ...makeValidPostOptions(),
      body: 'userId=user-sample-001',
    })
    expect(res.status).toBe(400)
    expect(repo.revokeCalls).toHaveLength(0)
  })

  it('Body missing userId → 400, revoke not called', async () => {
    const repo = makeMutationPermissionRepo()
    const app = makeApp(goodAuth(), undefined, undefined, repo)
    const res = await postAdmin(app, '/admin/permissions/revoke', {
      ...makeValidPostOptions(),
      body: 'albumId=album-sample-001',
    })
    expect(res.status).toBe(400)
    expect(repo.revokeCalls).toHaveLength(0)
  })

  it('Body with extra field → 400, revoke not called', async () => {
    const repo = makeMutationPermissionRepo()
    const app = makeApp(goodAuth(), undefined, undefined, repo)
    const res = await postAdmin(app, '/admin/permissions/revoke', {
      ...makeValidPostOptions(),
      body: 'albumId=album-sample-001&userId=user-sample-001&role=admin',
    })
    expect(res.status).toBe(400)
    expect(repo.revokeCalls).toHaveLength(0)
  })

  it('Body with repeated albumId → 400, revoke not called', async () => {
    const repo = makeMutationPermissionRepo()
    const app = makeApp(goodAuth(), undefined, undefined, repo)
    const res = await postAdmin(app, '/admin/permissions/revoke', {
      ...makeValidPostOptions(),
      body: 'albumId=album-a&albumId=album-b&userId=user-sample-001',
    })
    expect(res.status).toBe(400)
    expect(repo.revokeCalls).toHaveLength(0)
  })

  it('Body with invalid albumId → 400, revoke not called', async () => {
    const repo = makeMutationPermissionRepo()
    const app = makeApp(goodAuth(), undefined, undefined, repo)
    const res = await postAdmin(app, '/admin/permissions/revoke', {
      ...makeValidPostOptions(),
      body: 'albumId=!bad!&userId=user-sample-001',
    })
    expect(res.status).toBe(400)
    expect(repo.revokeCalls).toHaveLength(0)
  })

  it('Clock not called when body is invalid (revoke)', async () => {
    const spy = makeClockSpy()
    const repo = makeMutationPermissionRepo()
    const app = makeApp(goodAuth(), undefined, undefined, repo, spy.clock)
    await postAdmin(app, '/admin/permissions/revoke', {
      ...makeValidPostOptions(),
      body: 'albumId=!bad!&userId=user-sample-001',
    })
    expect(spy.getCallCount()).toBe(0)
  })
})

describe('admin-routes: POST /admin/permissions/revoke success', () => {
  it('valid revoke → 303 with Location /admin/permissions and no-store', async () => {
    const repo = makeMutationPermissionRepo()
    const app = makeApp(goodAuth(), undefined, undefined, repo)
    const res = await postAdmin(app, '/admin/permissions/revoke', makeValidPostOptions())
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/admin/permissions')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('valid revoke → empty body', async () => {
    const repo = makeMutationPermissionRepo()
    const app = makeApp(goodAuth(), undefined, undefined, repo)
    const res = await postAdmin(app, '/admin/permissions/revoke', makeValidPostOptions())
    const body = await res.text()
    expect(body).toBe('')
  })

  it('valid revoke → revokePermission called once with correct args', async () => {
    const repo = makeMutationPermissionRepo()
    const app = makeApp(goodAuth(), undefined, undefined, repo)
    await postAdmin(app, '/admin/permissions/revoke', makeValidPostOptions())
    expect(repo.revokeCalls).toHaveLength(1)
    expect(repo.revokeCalls[0]).toEqual({ albumId: VALID_ALBUM_ID, userId: VALID_USER_ID })
  })

  it('valid revoke → clock NOT called', async () => {
    const spy = makeClockSpy()
    const repo = makeMutationPermissionRepo()
    const app = makeApp(goodAuth(), undefined, undefined, repo, spy.clock)
    await postAdmin(app, '/admin/permissions/revoke', makeValidPostOptions())
    expect(spy.getCallCount()).toBe(0)
  })

  it('repo throws → 500 no-store', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, makeThrowingMutationPermissionRepo())
    const res = await postAdmin(app, '/admin/permissions/revoke', makeValidPostOptions())
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('repo throws → generic body, no detail', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, makeThrowingMutationPermissionRepo())
    const res = await postAdmin(app, '/admin/permissions/revoke', makeValidPostOptions())
    const body = await res.text()
    expect(body).toBe('Internal Server Error')
  })
})

// ---------------------------------------------------------------------------
// GET /admin/permissions — grant form rendering
// ---------------------------------------------------------------------------

describe('admin-routes: GET /admin/permissions grant form rendering', () => {
  it('body contains action="/admin/permissions/grant"', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, makeEmptyPermissionRepo())
    const res = await getAdmin(app, { path: '/admin/permissions' })
    const body = await res.text()
    expect(body).toContain('action="/admin/permissions/grant"')
  })

  it('body contains input name="albumId" for grant form', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, makeEmptyPermissionRepo())
    const res = await getAdmin(app, { path: '/admin/permissions' })
    const body = await res.text()
    expect(body).toContain('name="albumId"')
  })

  it('body contains input name="userId" for grant form', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, makeEmptyPermissionRepo())
    const res = await getAdmin(app, { path: '/admin/permissions' })
    const body = await res.text()
    expect(body).toContain('name="userId"')
  })

  it('body contains action="/admin/permissions/revoke" when permission row present', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, makePermissionRepo([SAMPLE_PERM]))
    const res = await getAdmin(app, { path: '/admin/permissions' })
    const body = await res.text()
    expect(body).toContain('action="/admin/permissions/revoke"')
  })

  it('revoke form contains row album_id as hidden value', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, makePermissionRepo([SAMPLE_PERM]))
    const res = await getAdmin(app, { path: '/admin/permissions' })
    const body = await res.text()
    expect(body).toContain(`value="${SAMPLE_PERM.album_id}"`)
  })

  it('revoke form contains row user_id as hidden value', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, makePermissionRepo([SAMPLE_PERM]))
    const res = await getAdmin(app, { path: '/admin/permissions' })
    const body = await res.text()
    expect(body).toContain(`value="${SAMPLE_PERM.user_id}"`)
  })

  it('revoke form does NOT contain created_at as an input name', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, makePermissionRepo([SAMPLE_PERM]))
    const res = await getAdmin(app, { path: '/admin/permissions' })
    const body = await res.text()
    expect(body).not.toContain('name="created_at"')
  })

  it('操作 column header present when permissions exist', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, makePermissionRepo([SAMPLE_PERM]))
    const res = await getAdmin(app, { path: '/admin/permissions' })
    const body = await res.text()
    expect(body).toContain('操作')
  })
})

// ---------------------------------------------------------------------------
// POST /admin/albums/enable — guard, same-origin, content-type, body
// ---------------------------------------------------------------------------

describe('admin-routes: POST /admin/albums/enable guard', () => {
  it('no token → 403 Forbidden no-store, setAlbumEnabled NOT called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/enable', {
      ...makeValidAlbumPostOptions(),
      token: null,
    })
    await assertForbidden(res)
    expect(repo.calls).toHaveLength(0)
  })

  it('non-allowlisted email → 403, setAlbumEnabled not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(() => ({
      verifier: async () => ({ email: 'other@example.com' }),
      allowlist: new Set([ADMIN_EMAIL]),
    }), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/enable', makeValidAlbumPostOptions())
    await assertForbidden(res)
    expect(repo.calls).toHaveLength(0)
  })

  it('Origin absent → 403, setAlbumEnabled not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/enable', {
      ...makeValidAlbumPostOptions(),
      origin: undefined,
    })
    await assertForbidden(res)
    expect(repo.calls).toHaveLength(0)
  })

  it('Origin = literal "null" → 403, setAlbumEnabled not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/enable', {
      ...makeValidAlbumPostOptions(),
      origin: 'null',
    })
    await assertForbidden(res)
    expect(repo.calls).toHaveLength(0)
  })

  it('Origin mismatched → 403, setAlbumEnabled not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/enable', {
      ...makeValidAlbumPostOptions(),
      origin: 'https://evil.example',
    })
    await assertForbidden(res)
    expect(repo.calls).toHaveLength(0)
  })
})

describe('admin-routes: POST /admin/albums/enable content-type validation', () => {
  it('Content-Type missing → 400 no-store, setAlbumEnabled not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/enable', {
      ...makeValidAlbumPostOptions(),
      contentType: undefined,
    })
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(repo.calls).toHaveLength(0)
  })

  it('Content-Type application/json → 400, setAlbumEnabled not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/enable', {
      ...makeValidAlbumPostOptions(),
      contentType: 'application/json',
    })
    expect(res.status).toBe(400)
    expect(repo.calls).toHaveLength(0)
  })

  it('Content-Type with charset → accepted (not 400)', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/enable', {
      ...makeValidAlbumPostOptions(),
      contentType: 'application/x-www-form-urlencoded; charset=utf-8',
    })
    expect(res.status).not.toBe(400)
  })

  it('Content-Type with an extra parameter → 400, setAlbumEnabled not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/enable', {
      ...makeValidAlbumPostOptions(),
      contentType: 'application/x-www-form-urlencoded; charset=utf-8; foo=bar',
    })
    expect(res.status).toBe(400)
    expect(repo.calls).toHaveLength(0)
  })
})

describe('admin-routes: POST /admin/albums/enable body validation', () => {
  it('empty body → 400 no-store, setAlbumEnabled not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/enable', {
      ...makeValidAlbumPostOptions(),
      body: '',
    })
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(repo.calls).toHaveLength(0)
  })

  it('extra field → 400, setAlbumEnabled not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/enable', {
      ...makeValidAlbumPostOptions(),
      body: 'albumId=album-sample-001&foo=bar',
    })
    expect(res.status).toBe(400)
    expect(repo.calls).toHaveLength(0)
  })

  it('repeated albumId → 400, setAlbumEnabled not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/enable', {
      ...makeValidAlbumPostOptions(),
      body: 'albumId=album-a&albumId=album-b',
    })
    expect(res.status).toBe(400)
    expect(repo.calls).toHaveLength(0)
  })

  it('invalid albumId → 400, setAlbumEnabled not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/enable', {
      ...makeValidAlbumPostOptions(),
      body: 'albumId=!bad!',
    })
    expect(res.status).toBe(400)
    expect(repo.calls).toHaveLength(0)
  })

  it('empty albumId value → 400, setAlbumEnabled not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/enable', {
      ...makeValidAlbumPostOptions(),
      body: 'albumId=',
    })
    expect(res.status).toBe(400)
    expect(repo.calls).toHaveLength(0)
  })

  it('clock not called when body is invalid', async () => {
    const spy = makeClockSpy()
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo, undefined, spy.clock)
    await postAdmin(app, '/admin/albums/enable', {
      ...makeValidAlbumPostOptions(),
      body: 'albumId=!bad!',
    })
    expect(spy.getCallCount()).toBe(0)
  })
})

describe('admin-routes: POST /admin/albums/enable success', () => {
  it('valid → 303 with Location /admin/albums and no-store', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/enable', makeValidAlbumPostOptions())
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/admin/albums')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('valid → empty body', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/enable', makeValidAlbumPostOptions())
    const body = await res.text()
    expect(body).toBe('')
  })

  it('valid → setAlbumEnabled called once with (album-sample-001, 1, NOW_TS)', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    await postAdmin(app, '/admin/albums/enable', makeValidAlbumPostOptions())
    expect(repo.calls).toHaveLength(1)
    expect(repo.calls[0]).toEqual({ albumId: VALID_ALBUM_ID, enabled: 1, updatedAt: NOW_TS })
  })

  it('clock throws → 500 no-store, setAlbumEnabled NOT called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo, undefined, () => {
      throw new Error('clock detail must not escape')
    })
    const res = await postAdmin(app, '/admin/albums/enable', makeValidAlbumPostOptions())
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.text()).toBe('Internal Server Error')
    expect(repo.calls).toHaveLength(0)
  })

  it('clock returns NaN date → 500 no-store, setAlbumEnabled NOT called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo, undefined, () => new Date(Number.NaN))
    const res = await postAdmin(app, '/admin/albums/enable', makeValidAlbumPostOptions())
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.text()).toBe('Internal Server Error')
    expect(repo.calls).toHaveLength(0)
  })

  it('repo throws → 500 no-store, generic body', async () => {
    const app = makeApp(goodAuth(), undefined, makeThrowingSetEnabledAlbumRepo())
    const res = await postAdmin(app, '/admin/albums/enable', makeValidAlbumPostOptions())
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.text()).toBe('Internal Server Error')
  })
})

// ---------------------------------------------------------------------------
// POST /admin/albums/disable — guard, same-origin, content-type, body
// ---------------------------------------------------------------------------

describe('admin-routes: POST /admin/albums/disable guard', () => {
  it('no token → 403 Forbidden no-store, setAlbumEnabled NOT called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/disable', {
      ...makeValidAlbumPostOptions(),
      token: null,
    })
    await assertForbidden(res)
    expect(repo.calls).toHaveLength(0)
  })

  it('non-allowlisted email → 403, setAlbumEnabled not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(() => ({
      verifier: async () => ({ email: 'other@example.com' }),
      allowlist: new Set([ADMIN_EMAIL]),
    }), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/disable', makeValidAlbumPostOptions())
    await assertForbidden(res)
    expect(repo.calls).toHaveLength(0)
  })

  it('Origin absent → 403, setAlbumEnabled not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/disable', {
      ...makeValidAlbumPostOptions(),
      origin: undefined,
    })
    await assertForbidden(res)
    expect(repo.calls).toHaveLength(0)
  })

  it('Origin = literal "null" → 403, setAlbumEnabled not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/disable', {
      ...makeValidAlbumPostOptions(),
      origin: 'null',
    })
    await assertForbidden(res)
    expect(repo.calls).toHaveLength(0)
  })

  it('Origin mismatched → 403, setAlbumEnabled not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/disable', {
      ...makeValidAlbumPostOptions(),
      origin: 'https://evil.example',
    })
    await assertForbidden(res)
    expect(repo.calls).toHaveLength(0)
  })
})

describe('admin-routes: POST /admin/albums/disable content-type validation', () => {
  it('Content-Type missing → 400 no-store, setAlbumEnabled not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/disable', {
      ...makeValidAlbumPostOptions(),
      contentType: undefined,
    })
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(repo.calls).toHaveLength(0)
  })

  it('Content-Type application/json → 400, setAlbumEnabled not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/disable', {
      ...makeValidAlbumPostOptions(),
      contentType: 'application/json',
    })
    expect(res.status).toBe(400)
    expect(repo.calls).toHaveLength(0)
  })

  it('Content-Type with charset → accepted (not 400)', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/disable', {
      ...makeValidAlbumPostOptions(),
      contentType: 'application/x-www-form-urlencoded; charset=utf-8',
    })
    expect(res.status).not.toBe(400)
  })

  it('Content-Type with a non-charset parameter → 400, setAlbumEnabled not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/disable', {
      ...makeValidAlbumPostOptions(),
      contentType: 'application/x-www-form-urlencoded; boundary=unexpected',
    })
    expect(res.status).toBe(400)
    expect(repo.calls).toHaveLength(0)
  })
})

describe('admin-routes: POST /admin/albums/disable body validation', () => {
  it('empty body → 400 no-store, setAlbumEnabled not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/disable', {
      ...makeValidAlbumPostOptions(),
      body: '',
    })
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(repo.calls).toHaveLength(0)
  })

  it('extra field → 400, setAlbumEnabled not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/disable', {
      ...makeValidAlbumPostOptions(),
      body: 'albumId=album-sample-001&foo=bar',
    })
    expect(res.status).toBe(400)
    expect(repo.calls).toHaveLength(0)
  })

  it('repeated albumId → 400, setAlbumEnabled not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/disable', {
      ...makeValidAlbumPostOptions(),
      body: 'albumId=album-a&albumId=album-b',
    })
    expect(res.status).toBe(400)
    expect(repo.calls).toHaveLength(0)
  })

  it('invalid albumId → 400, setAlbumEnabled not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/disable', {
      ...makeValidAlbumPostOptions(),
      body: 'albumId=!bad!',
    })
    expect(res.status).toBe(400)
    expect(repo.calls).toHaveLength(0)
  })

  it('empty albumId value → 400, setAlbumEnabled not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/disable', {
      ...makeValidAlbumPostOptions(),
      body: 'albumId=',
    })
    expect(res.status).toBe(400)
    expect(repo.calls).toHaveLength(0)
  })

  it('clock not called when body is invalid', async () => {
    const spy = makeClockSpy()
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo, undefined, spy.clock)
    await postAdmin(app, '/admin/albums/disable', {
      ...makeValidAlbumPostOptions(),
      body: 'albumId=!bad!',
    })
    expect(spy.getCallCount()).toBe(0)
  })
})

describe('admin-routes: POST /admin/albums/disable success', () => {
  it('valid → 303 with Location /admin/albums and no-store', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/disable', makeValidAlbumPostOptions())
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/admin/albums')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('valid → empty body', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/disable', makeValidAlbumPostOptions())
    const body = await res.text()
    expect(body).toBe('')
  })

  it('valid → setAlbumEnabled called once with (album-sample-001, 0, NOW_TS)', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    await postAdmin(app, '/admin/albums/disable', makeValidAlbumPostOptions())
    expect(repo.calls).toHaveLength(1)
    expect(repo.calls[0]).toEqual({ albumId: VALID_ALBUM_ID, enabled: 0, updatedAt: NOW_TS })
  })

  it('clock throws → 500 no-store, setAlbumEnabled NOT called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo, undefined, () => {
      throw new Error('clock detail must not escape')
    })
    const res = await postAdmin(app, '/admin/albums/disable', makeValidAlbumPostOptions())
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.text()).toBe('Internal Server Error')
    expect(repo.calls).toHaveLength(0)
  })

  it('clock returns NaN date → 500 no-store, setAlbumEnabled NOT called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo, undefined, () => new Date(Number.NaN))
    const res = await postAdmin(app, '/admin/albums/disable', makeValidAlbumPostOptions())
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.text()).toBe('Internal Server Error')
    expect(repo.calls).toHaveLength(0)
  })

  it('repo throws → 500 no-store, generic body', async () => {
    const app = makeApp(goodAuth(), undefined, makeThrowingSetEnabledAlbumRepo())
    const res = await postAdmin(app, '/admin/albums/disable', makeValidAlbumPostOptions())
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.text()).toBe('Internal Server Error')
  })
})

// ---------------------------------------------------------------------------
// POST /admin/users/enable — guard, same-origin, content-type, body
// ---------------------------------------------------------------------------

describe('admin-routes: POST /admin/users/enable guard', () => {
  it('no token → 403 Forbidden no-store, setUserEnabled NOT called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/enable', {
      ...makeValidUserPostOptions(),
      token: null,
    })
    await assertForbidden(res)
    expect(repo.calls).toHaveLength(0)
  })

  it('non-allowlisted email → 403, setUserEnabled not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(() => ({
      verifier: async () => ({ email: 'other@example.com' }),
      allowlist: new Set([ADMIN_EMAIL]),
    }), repo)
    const res = await postAdmin(app, '/admin/users/enable', makeValidUserPostOptions())
    await assertForbidden(res)
    expect(repo.calls).toHaveLength(0)
  })

  it('Origin absent → 403, setUserEnabled not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/enable', {
      ...makeValidUserPostOptions(),
      origin: undefined,
    })
    await assertForbidden(res)
    expect(repo.calls).toHaveLength(0)
  })

  it('Origin = literal "null" → 403, setUserEnabled not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/enable', {
      ...makeValidUserPostOptions(),
      origin: 'null',
    })
    await assertForbidden(res)
    expect(repo.calls).toHaveLength(0)
  })

  it('Origin mismatched → 403, setUserEnabled not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/enable', {
      ...makeValidUserPostOptions(),
      origin: 'https://evil.example',
    })
    await assertForbidden(res)
    expect(repo.calls).toHaveLength(0)
  })
})

describe('admin-routes: POST /admin/users/enable content-type validation', () => {
  it('Content-Type missing → 400 no-store, setUserEnabled not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/enable', {
      ...makeValidUserPostOptions(),
      contentType: undefined,
    })
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(repo.calls).toHaveLength(0)
  })

  it('Content-Type application/json → 400, setUserEnabled not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/enable', {
      ...makeValidUserPostOptions(),
      contentType: 'application/json',
    })
    expect(res.status).toBe(400)
    expect(repo.calls).toHaveLength(0)
  })

  it('Content-Type with charset → accepted (not 400)', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/enable', {
      ...makeValidUserPostOptions(),
      contentType: 'application/x-www-form-urlencoded; charset=utf-8',
    })
    expect(res.status).not.toBe(400)
  })

  it('Content-Type with an extra parameter → 400, setUserEnabled not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/enable', {
      ...makeValidUserPostOptions(),
      contentType: 'application/x-www-form-urlencoded; charset=utf-8; foo=bar',
    })
    expect(res.status).toBe(400)
    expect(repo.calls).toHaveLength(0)
  })
})

describe('admin-routes: POST /admin/users/enable body validation', () => {
  it('empty body → 400 no-store, setUserEnabled not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/enable', {
      ...makeValidUserPostOptions(),
      body: '',
    })
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(repo.calls).toHaveLength(0)
  })

  it('extra field → 400, setUserEnabled not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/enable', {
      ...makeValidUserPostOptions(),
      body: 'userId=user-sample-001&foo=bar',
    })
    expect(res.status).toBe(400)
    expect(repo.calls).toHaveLength(0)
  })

  it('repeated userId → 400, setUserEnabled not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/enable', {
      ...makeValidUserPostOptions(),
      body: 'userId=user-a&userId=user-b',
    })
    expect(res.status).toBe(400)
    expect(repo.calls).toHaveLength(0)
  })

  it('invalid userId → 400, setUserEnabled not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/enable', {
      ...makeValidUserPostOptions(),
      body: 'userId=!bad!',
    })
    expect(res.status).toBe(400)
    expect(repo.calls).toHaveLength(0)
  })

  it('empty userId value → 400, setUserEnabled not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/enable', {
      ...makeValidUserPostOptions(),
      body: 'userId=',
    })
    expect(res.status).toBe(400)
    expect(repo.calls).toHaveLength(0)
  })

  it('albumId field (wrong name) → 400, setUserEnabled not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/enable', {
      ...makeValidUserPostOptions(),
      body: 'albumId=album-sample-001',
    })
    expect(res.status).toBe(400)
    expect(repo.calls).toHaveLength(0)
  })

  it('clock not called when body is invalid', async () => {
    const spy = makeClockSpy()
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo, undefined, undefined, spy.clock)
    await postAdmin(app, '/admin/users/enable', {
      ...makeValidUserPostOptions(),
      body: 'userId=!bad!',
    })
    expect(spy.getCallCount()).toBe(0)
  })
})

describe('admin-routes: POST /admin/users/enable success', () => {
  it('valid → 303 with Location /admin/users and no-store', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/enable', makeValidUserPostOptions())
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/admin/users')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('valid → empty body', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/enable', makeValidUserPostOptions())
    const body = await res.text()
    expect(body).toBe('')
  })

  it('valid → setUserEnabled called once with (user-sample-001, 1, NOW_TS)', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    await postAdmin(app, '/admin/users/enable', makeValidUserPostOptions())
    expect(repo.calls).toHaveLength(1)
    expect(repo.calls[0]).toEqual({ userId: VALID_USER_ID, enabled: 1, updatedAt: NOW_TS })
  })

  it('clock throws → 500 no-store, setUserEnabled NOT called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo, undefined, undefined, () => {
      throw new Error('clock detail must not escape')
    })
    const res = await postAdmin(app, '/admin/users/enable', makeValidUserPostOptions())
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.text()).toBe('Internal Server Error')
    expect(repo.calls).toHaveLength(0)
  })

  it('clock returns NaN date → 500 no-store, setUserEnabled NOT called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo, undefined, undefined, () => new Date(Number.NaN))
    const res = await postAdmin(app, '/admin/users/enable', makeValidUserPostOptions())
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.text()).toBe('Internal Server Error')
    expect(repo.calls).toHaveLength(0)
  })

  it('repo throws → 500 no-store, generic body', async () => {
    const app = makeApp(goodAuth(), makeThrowingSetEnabledUserRepo())
    const res = await postAdmin(app, '/admin/users/enable', makeValidUserPostOptions())
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.text()).toBe('Internal Server Error')
  })
})

// ---------------------------------------------------------------------------
// POST /admin/users/disable — guard, same-origin, content-type, body
// ---------------------------------------------------------------------------

describe('admin-routes: POST /admin/users/disable guard', () => {
  it('no token → 403 Forbidden no-store, setUserEnabled NOT called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/disable', {
      ...makeValidUserPostOptions(),
      token: null,
    })
    await assertForbidden(res)
    expect(repo.calls).toHaveLength(0)
  })

  it('non-allowlisted email → 403, setUserEnabled not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(() => ({
      verifier: async () => ({ email: 'other@example.com' }),
      allowlist: new Set([ADMIN_EMAIL]),
    }), repo)
    const res = await postAdmin(app, '/admin/users/disable', makeValidUserPostOptions())
    await assertForbidden(res)
    expect(repo.calls).toHaveLength(0)
  })

  it('Origin absent → 403, setUserEnabled not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/disable', {
      ...makeValidUserPostOptions(),
      origin: undefined,
    })
    await assertForbidden(res)
    expect(repo.calls).toHaveLength(0)
  })

  it('Origin = literal "null" → 403, setUserEnabled not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/disable', {
      ...makeValidUserPostOptions(),
      origin: 'null',
    })
    await assertForbidden(res)
    expect(repo.calls).toHaveLength(0)
  })

  it('Origin mismatched → 403, setUserEnabled not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/disable', {
      ...makeValidUserPostOptions(),
      origin: 'https://evil.example',
    })
    await assertForbidden(res)
    expect(repo.calls).toHaveLength(0)
  })
})

describe('admin-routes: POST /admin/users/disable content-type validation', () => {
  it('Content-Type missing → 400 no-store, setUserEnabled not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/disable', {
      ...makeValidUserPostOptions(),
      contentType: undefined,
    })
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(repo.calls).toHaveLength(0)
  })

  it('Content-Type application/json → 400, setUserEnabled not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/disable', {
      ...makeValidUserPostOptions(),
      contentType: 'application/json',
    })
    expect(res.status).toBe(400)
    expect(repo.calls).toHaveLength(0)
  })

  it('Content-Type with charset → accepted (not 400)', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/disable', {
      ...makeValidUserPostOptions(),
      contentType: 'application/x-www-form-urlencoded; charset=utf-8',
    })
    expect(res.status).not.toBe(400)
  })

  it('Content-Type with a non-charset parameter → 400, setUserEnabled not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/disable', {
      ...makeValidUserPostOptions(),
      contentType: 'application/x-www-form-urlencoded; boundary=unexpected',
    })
    expect(res.status).toBe(400)
    expect(repo.calls).toHaveLength(0)
  })
})

describe('admin-routes: POST /admin/users/disable body validation', () => {
  it('empty body → 400 no-store, setUserEnabled not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/disable', {
      ...makeValidUserPostOptions(),
      body: '',
    })
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(repo.calls).toHaveLength(0)
  })

  it('extra field → 400, setUserEnabled not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/disable', {
      ...makeValidUserPostOptions(),
      body: 'userId=user-sample-001&foo=bar',
    })
    expect(res.status).toBe(400)
    expect(repo.calls).toHaveLength(0)
  })

  it('repeated userId → 400, setUserEnabled not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/disable', {
      ...makeValidUserPostOptions(),
      body: 'userId=user-a&userId=user-b',
    })
    expect(res.status).toBe(400)
    expect(repo.calls).toHaveLength(0)
  })

  it('invalid userId → 400, setUserEnabled not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/disable', {
      ...makeValidUserPostOptions(),
      body: 'userId=!bad!',
    })
    expect(res.status).toBe(400)
    expect(repo.calls).toHaveLength(0)
  })

  it('empty userId value → 400, setUserEnabled not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/disable', {
      ...makeValidUserPostOptions(),
      body: 'userId=',
    })
    expect(res.status).toBe(400)
    expect(repo.calls).toHaveLength(0)
  })

  it('clock not called when body is invalid', async () => {
    const spy = makeClockSpy()
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo, undefined, undefined, spy.clock)
    await postAdmin(app, '/admin/users/disable', {
      ...makeValidUserPostOptions(),
      body: 'userId=!bad!',
    })
    expect(spy.getCallCount()).toBe(0)
  })
})

describe('admin-routes: POST /admin/users/disable success', () => {
  it('valid → 303 with Location /admin/users and no-store', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/disable', makeValidUserPostOptions())
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/admin/users')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('valid → empty body', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/disable', makeValidUserPostOptions())
    const body = await res.text()
    expect(body).toBe('')
  })

  it('valid → setUserEnabled called once with (user-sample-001, 0, NOW_TS)', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    await postAdmin(app, '/admin/users/disable', makeValidUserPostOptions())
    expect(repo.calls).toHaveLength(1)
    expect(repo.calls[0]).toEqual({ userId: VALID_USER_ID, enabled: 0, updatedAt: NOW_TS })
  })

  it('clock throws → 500 no-store, setUserEnabled NOT called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo, undefined, undefined, () => {
      throw new Error('clock detail must not escape')
    })
    const res = await postAdmin(app, '/admin/users/disable', makeValidUserPostOptions())
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.text()).toBe('Internal Server Error')
    expect(repo.calls).toHaveLength(0)
  })

  it('clock returns NaN date → 500 no-store, setUserEnabled NOT called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo, undefined, undefined, () => new Date(Number.NaN))
    const res = await postAdmin(app, '/admin/users/disable', makeValidUserPostOptions())
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.text()).toBe('Internal Server Error')
    expect(repo.calls).toHaveLength(0)
  })

  it('repo throws → 500 no-store, generic body', async () => {
    const app = makeApp(goodAuth(), makeThrowingSetEnabledUserRepo())
    const res = await postAdmin(app, '/admin/users/disable', makeValidUserPostOptions())
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.text()).toBe('Internal Server Error')
  })
})

// ---------------------------------------------------------------------------
// GET /admin/users — form rendering (enable/disable)
// ---------------------------------------------------------------------------

describe('admin-routes: GET /admin/users form rendering', () => {
  it('enabled user → body contains action="/admin/users/disable"', async () => {
    const app = makeApp(goodAuth(), makeUserRepo([SAMPLE_USER]))
    const res = await getAdmin(app, { path: '/admin/users' })
    const body = await res.text()
    expect(body).toContain('action="/admin/users/disable"')
  })

  it('enabled user → body contains hidden userId input with row id', async () => {
    const app = makeApp(goodAuth(), makeUserRepo([SAMPLE_USER]))
    const res = await getAdmin(app, { path: '/admin/users' })
    const body = await res.text()
    expect(body).toContain(`value="${SAMPLE_USER.id}"`)
  })

  it('enabled user → body does NOT contain action="/admin/users/enable"', async () => {
    const app = makeApp(goodAuth(), makeUserRepo([SAMPLE_USER]))
    const res = await getAdmin(app, { path: '/admin/users' })
    const body = await res.text()
    expect(body).not.toContain('action="/admin/users/enable"')
  })

  it('disabled user → body contains action="/admin/users/enable"', async () => {
    const app = makeApp(goodAuth(), makeUserRepo([SAMPLE_USER_2]))
    const res = await getAdmin(app, { path: '/admin/users' })
    const body = await res.text()
    expect(body).toContain('action="/admin/users/enable"')
  })

  it('disabled user → body contains hidden userId input with row id', async () => {
    const app = makeApp(goodAuth(), makeUserRepo([SAMPLE_USER_2]))
    const res = await getAdmin(app, { path: '/admin/users' })
    const body = await res.text()
    expect(body).toContain(`value="${SAMPLE_USER_2.id}"`)
  })

  it('disabled user → body does NOT contain action="/admin/users/disable"', async () => {
    const app = makeApp(goodAuth(), makeUserRepo([SAMPLE_USER_2]))
    const res = await getAdmin(app, { path: '/admin/users' })
    const body = await res.text()
    expect(body).not.toContain('action="/admin/users/disable"')
  })

  it('body contains name="userId" for the operation form', async () => {
    const app = makeApp(goodAuth(), makeUserRepo([SAMPLE_USER]))
    const res = await getAdmin(app, { path: '/admin/users' })
    const body = await res.text()
    expect(body).toContain('name="userId"')
  })

  it('body does NOT contain name="enabled" (no enabled input in form)', async () => {
    const app = makeApp(goodAuth(), makeUserRepo([SAMPLE_USER]))
    const res = await getAdmin(app, { path: '/admin/users' })
    const body = await res.text()
    expect(body).not.toContain('name="enabled"')
  })

  it('操作 column header present', async () => {
    const app = makeApp(goodAuth(), makeUserRepo([SAMPLE_USER]))
    const res = await getAdmin(app, { path: '/admin/users' })
    const body = await res.text()
    expect(body).toContain('操作')
  })

  it('body does NOT contain password_hash in any form', async () => {
    const app = makeApp(goodAuth(), makeUserRepo([SAMPLE_USER]))
    const res = await getAdmin(app, { path: '/admin/users' })
    const body = await res.text()
    expect(body).not.toContain('password_hash')
  })

  it('body does NOT contain name="password_hash"', async () => {
    const app = makeApp(goodAuth(), makeUserRepo([SAMPLE_USER]))
    const res = await getAdmin(app, { path: '/admin/users' })
    const body = await res.text()
    expect(body).not.toContain('name="password_hash"')
  })

  it('body does NOT contain name="albumId" (userId-only form)', async () => {
    const app = makeApp(goodAuth(), makeUserRepo([SAMPLE_USER]))
    const res = await getAdmin(app, { path: '/admin/users' })
    const body = await res.text()
    expect(body).not.toContain('name="albumId"')
  })
})

// ---------------------------------------------------------------------------
// POST /admin/users/create — guard
// ---------------------------------------------------------------------------

describe('admin-routes: POST /admin/users/create guard', () => {
  it('no token → 403 Forbidden no-store, createUser NOT called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/create', {
      ...makeValidCreatePostOptions(),
      token: null,
    })
    await assertForbidden(res)
    expect(repo.createCalls).toHaveLength(0)
  })

  it('non-allowlisted email → 403, createUser not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(() => ({
      verifier: async () => ({ email: 'other@example.com' }),
      allowlist: new Set([ADMIN_EMAIL]),
    }), repo)
    const res = await postAdmin(app, '/admin/users/create', makeValidCreatePostOptions())
    await assertForbidden(res)
    expect(repo.createCalls).toHaveLength(0)
  })

  it('Origin absent → 403, createUser not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/create', {
      ...makeValidCreatePostOptions(),
      origin: undefined,
    })
    await assertForbidden(res)
    expect(repo.createCalls).toHaveLength(0)
  })

  it('Origin = literal "null" → 403, createUser not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/create', {
      ...makeValidCreatePostOptions(),
      origin: 'null',
    })
    await assertForbidden(res)
    expect(repo.createCalls).toHaveLength(0)
  })

  it('Origin mismatched → 403, createUser not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/create', {
      ...makeValidCreatePostOptions(),
      origin: 'https://evil.example',
    })
    await assertForbidden(res)
    expect(repo.createCalls).toHaveLength(0)
  })
})

describe('admin-routes: POST /admin/users/create content-type validation', () => {
  it('Content-Type missing → 400 no-store, createUser not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/create', {
      ...makeValidCreatePostOptions(),
      contentType: undefined,
    })
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(repo.createCalls).toHaveLength(0)
  })

  it('Content-Type application/json → 400, createUser not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/create', {
      ...makeValidCreatePostOptions(),
      contentType: 'application/json',
    })
    expect(res.status).toBe(400)
    expect(repo.createCalls).toHaveLength(0)
  })

  it('Content-Type with charset → accepted (not 400)', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/create', {
      ...makeValidCreatePostOptions(),
      contentType: 'application/x-www-form-urlencoded; charset=utf-8',
    })
    expect(res.status).not.toBe(400)
  })
})

describe('admin-routes: POST /admin/users/create body validation', () => {
  it('missing userId → 400, createUser not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/create', {
      ...makeValidCreatePostOptions(),
      body: `displayName=${encodeURIComponent(VALID_DISPLAY_NAME)}&password=${encodeURIComponent(VALID_PASSWORD)}`,
    })
    expect(res.status).toBe(400)
    expect(repo.createCalls).toHaveLength(0)
  })

  it('missing displayName → 400, createUser not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/create', {
      ...makeValidCreatePostOptions(),
      body: `userId=${NEW_USER_ID}&password=${encodeURIComponent(VALID_PASSWORD)}`,
    })
    expect(res.status).toBe(400)
    expect(repo.createCalls).toHaveLength(0)
  })

  it('missing password → 400, createUser not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/create', {
      ...makeValidCreatePostOptions(),
      body: `userId=${NEW_USER_ID}&displayName=${encodeURIComponent(VALID_DISPLAY_NAME)}`,
    })
    expect(res.status).toBe(400)
    expect(repo.createCalls).toHaveLength(0)
  })

  it('extra field → 400, createUser not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/create', {
      ...makeValidCreatePostOptions(),
      body: VALID_CREATE_BODY + '&extra=x',
    })
    expect(res.status).toBe(400)
    expect(repo.createCalls).toHaveLength(0)
  })

  it('repeated userId → 400, createUser not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/create', {
      ...makeValidCreatePostOptions(),
      body: `userId=${NEW_USER_ID}&userId=user-other-002&displayName=${encodeURIComponent(VALID_DISPLAY_NAME)}&password=${encodeURIComponent(VALID_PASSWORD)}`,
    })
    expect(res.status).toBe(400)
    expect(repo.createCalls).toHaveLength(0)
  })

  it('invalid userId → 400, createUser not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/create', {
      ...makeValidCreatePostOptions(),
      body: `userId=!bad!&displayName=${encodeURIComponent(VALID_DISPLAY_NAME)}&password=${encodeURIComponent(VALID_PASSWORD)}`,
    })
    expect(res.status).toBe(400)
    expect(repo.createCalls).toHaveLength(0)
  })

  it('empty displayName → 400, createUser not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/create', {
      ...makeValidCreatePostOptions(),
      body: `userId=${NEW_USER_ID}&displayName=&password=${encodeURIComponent(VALID_PASSWORD)}`,
    })
    expect(res.status).toBe(400)
    expect(repo.createCalls).toHaveLength(0)
  })

  it('displayName with leading whitespace → 400, createUser not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/create', {
      ...makeValidCreatePostOptions(),
      body: `userId=${NEW_USER_ID}&displayName=${encodeURIComponent(' Leading')}&password=${encodeURIComponent(VALID_PASSWORD)}`,
    })
    expect(res.status).toBe(400)
    expect(repo.createCalls).toHaveLength(0)
  })

  it('displayName with control character → 400, createUser not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/create', {
      ...makeValidCreatePostOptions(),
      body: `userId=${NEW_USER_ID}&displayName=${encodeURIComponent('tab\there')}&password=${encodeURIComponent(VALID_PASSWORD)}`,
    })
    expect(res.status).toBe(400)
    expect(repo.createCalls).toHaveLength(0)
  })

  it('empty password → 400, createUser not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/create', {
      ...makeValidCreatePostOptions(),
      body: `userId=${NEW_USER_ID}&displayName=${encodeURIComponent(VALID_DISPLAY_NAME)}&password=`,
    })
    expect(res.status).toBe(400)
    expect(repo.createCalls).toHaveLength(0)
  })

  it('clock not called when body is invalid', async () => {
    const spy = makeClockSpy()
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo, undefined, undefined, spy.clock)
    await postAdmin(app, '/admin/users/create', {
      ...makeValidCreatePostOptions(),
      body: 'userId=!bad!',
    })
    expect(spy.getCallCount()).toBe(0)
  })

  it('400 response body does not reflect invalid input', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/create', {
      ...makeValidCreatePostOptions(),
      body: `userId=!bad-secret!&displayName=${encodeURIComponent(VALID_DISPLAY_NAME)}&password=secret123`,
    })
    const body = await res.text()
    expect(body).not.toContain('bad-secret')
    expect(body).not.toContain('secret123')
  })
})

describe('admin-routes: POST /admin/users/create success', () => {
  it('valid create → 303 with Location /admin/users and no-store', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/create', makeValidCreatePostOptions())
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/admin/users')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('valid create → empty body', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/create', makeValidCreatePostOptions())
    const body = await res.text()
    expect(body).toBe('')
  })

  it('valid create → createUser called once with correct userId and displayName', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    await postAdmin(app, '/admin/users/create', makeValidCreatePostOptions())
    expect(repo.createCalls).toHaveLength(1)
    expect(repo.createCalls[0]!.userId).toBe(NEW_USER_ID)
    expect(repo.createCalls[0]!.displayName).toBe(VALID_DISPLAY_NAME)
  })

  it('valid create → passwordHash has correct PBKDF2 shape', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    await postAdmin(app, '/admin/users/create', makeValidCreatePostOptions())
    expect(PBKDF2_HASH_RE.test(repo.createCalls[0]!.passwordHash)).toBe(true)
  })

  it('valid create → createdAt matches clock', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    await postAdmin(app, '/admin/users/create', makeValidCreatePostOptions())
    expect(repo.createCalls[0]!.createdAt).toBe(NOW_TS)
    expect(repo.createCalls[0]!.updatedAt).toBe(NOW_TS)
  })

  it('valid create → password plaintext NOT in createCalls passwordHash', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    await postAdmin(app, '/admin/users/create', makeValidCreatePostOptions())
    expect(repo.createCalls[0]!.passwordHash).not.toContain(VALID_PASSWORD)
  })

  it('clock throws → 500 no-store, createUser NOT called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo, undefined, undefined, () => {
      throw new Error('clock detail must not escape')
    })
    const res = await postAdmin(app, '/admin/users/create', makeValidCreatePostOptions())
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.text()).toBe('Internal Server Error')
    expect(repo.createCalls).toHaveLength(0)
  })

  it('repo throws → 500 no-store, generic body', async () => {
    const app = makeApp(goodAuth(), makeThrowingCreateUserRepo())
    const res = await postAdmin(app, '/admin/users/create', makeValidCreatePostOptions())
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.text()).toBe('Internal Server Error')
  })
})

// ---------------------------------------------------------------------------
// POST /admin/users/reset-password — guard
// ---------------------------------------------------------------------------

describe('admin-routes: POST /admin/users/reset-password guard', () => {
  it('no token → 403 Forbidden no-store, resetPassword NOT called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/reset-password', {
      ...makeValidResetPostOptions(),
      token: null,
    })
    await assertForbidden(res)
    expect(repo.resetCalls).toHaveLength(0)
  })

  it('non-allowlisted email → 403, resetPassword not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(() => ({
      verifier: async () => ({ email: 'other@example.com' }),
      allowlist: new Set([ADMIN_EMAIL]),
    }), repo)
    const res = await postAdmin(app, '/admin/users/reset-password', makeValidResetPostOptions())
    await assertForbidden(res)
    expect(repo.resetCalls).toHaveLength(0)
  })

  it('Origin absent → 403, resetPassword not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/reset-password', {
      ...makeValidResetPostOptions(),
      origin: undefined,
    })
    await assertForbidden(res)
    expect(repo.resetCalls).toHaveLength(0)
  })

  it('Origin = literal "null" → 403, resetPassword not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/reset-password', {
      ...makeValidResetPostOptions(),
      origin: 'null',
    })
    await assertForbidden(res)
    expect(repo.resetCalls).toHaveLength(0)
  })

  it('Origin mismatched → 403, resetPassword not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/reset-password', {
      ...makeValidResetPostOptions(),
      origin: 'https://evil.example',
    })
    await assertForbidden(res)
    expect(repo.resetCalls).toHaveLength(0)
  })
})

describe('admin-routes: POST /admin/users/reset-password content-type validation', () => {
  it('Content-Type missing → 400 no-store, resetPassword not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/reset-password', {
      ...makeValidResetPostOptions(),
      contentType: undefined,
    })
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(repo.resetCalls).toHaveLength(0)
  })

  it('Content-Type application/json → 400, resetPassword not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/reset-password', {
      ...makeValidResetPostOptions(),
      contentType: 'application/json',
    })
    expect(res.status).toBe(400)
    expect(repo.resetCalls).toHaveLength(0)
  })

  it('Content-Type with charset → accepted (not 400)', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/reset-password', {
      ...makeValidResetPostOptions(),
      contentType: 'application/x-www-form-urlencoded; charset=utf-8',
    })
    expect(res.status).not.toBe(400)
  })
})

describe('admin-routes: POST /admin/users/reset-password body validation', () => {
  it('missing userId → 400, resetPassword not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/reset-password', {
      ...makeValidResetPostOptions(),
      body: `password=${encodeURIComponent(VALID_PASSWORD)}`,
    })
    expect(res.status).toBe(400)
    expect(repo.resetCalls).toHaveLength(0)
  })

  it('missing password → 400, resetPassword not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/reset-password', {
      ...makeValidResetPostOptions(),
      body: `userId=${VALID_USER_ID}`,
    })
    expect(res.status).toBe(400)
    expect(repo.resetCalls).toHaveLength(0)
  })

  it('extra field → 400, resetPassword not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/reset-password', {
      ...makeValidResetPostOptions(),
      body: VALID_RESET_BODY + '&extra=x',
    })
    expect(res.status).toBe(400)
    expect(repo.resetCalls).toHaveLength(0)
  })

  it('repeated userId → 400, resetPassword not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/reset-password', {
      ...makeValidResetPostOptions(),
      body: `userId=${VALID_USER_ID}&userId=user-other-002&password=${encodeURIComponent(VALID_PASSWORD)}`,
    })
    expect(res.status).toBe(400)
    expect(repo.resetCalls).toHaveLength(0)
  })

  it('invalid userId → 400, resetPassword not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/reset-password', {
      ...makeValidResetPostOptions(),
      body: `userId=!bad!&password=${encodeURIComponent(VALID_PASSWORD)}`,
    })
    expect(res.status).toBe(400)
    expect(repo.resetCalls).toHaveLength(0)
  })

  it('empty password → 400, resetPassword not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/reset-password', {
      ...makeValidResetPostOptions(),
      body: `userId=${VALID_USER_ID}&password=`,
    })
    expect(res.status).toBe(400)
    expect(repo.resetCalls).toHaveLength(0)
  })

  it('clock not called when body is invalid', async () => {
    const spy = makeClockSpy()
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo, undefined, undefined, spy.clock)
    await postAdmin(app, '/admin/users/reset-password', {
      ...makeValidResetPostOptions(),
      body: 'userId=!bad!',
    })
    expect(spy.getCallCount()).toBe(0)
  })

  it('400 response body does not reflect invalid input', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/reset-password', {
      ...makeValidResetPostOptions(),
      body: `userId=!bad-secret!&password=secret123`,
    })
    const body = await res.text()
    expect(body).not.toContain('bad-secret')
    expect(body).not.toContain('secret123')
  })
})

describe('admin-routes: POST /admin/users/reset-password success', () => {
  it('valid reset → 303 with Location /admin/users and no-store', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/reset-password', makeValidResetPostOptions())
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/admin/users')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('valid reset → empty body', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/reset-password', makeValidResetPostOptions())
    const body = await res.text()
    expect(body).toBe('')
  })

  it('valid reset → resetPassword called once with correct userId', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    await postAdmin(app, '/admin/users/reset-password', makeValidResetPostOptions())
    expect(repo.resetCalls).toHaveLength(1)
    expect(repo.resetCalls[0]!.userId).toBe(VALID_USER_ID)
  })

  it('valid reset → passwordHash has correct PBKDF2 shape', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    await postAdmin(app, '/admin/users/reset-password', makeValidResetPostOptions())
    expect(PBKDF2_HASH_RE.test(repo.resetCalls[0]!.passwordHash)).toBe(true)
  })

  it('valid reset → updatedAt matches clock', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    await postAdmin(app, '/admin/users/reset-password', makeValidResetPostOptions())
    expect(repo.resetCalls[0]!.updatedAt).toBe(NOW_TS)
  })

  it('valid reset → password plaintext NOT in resetCalls passwordHash', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    await postAdmin(app, '/admin/users/reset-password', makeValidResetPostOptions())
    expect(repo.resetCalls[0]!.passwordHash).not.toContain(VALID_PASSWORD)
  })

  it('clock throws → 500 no-store, resetPassword NOT called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo, undefined, undefined, () => {
      throw new Error('clock detail must not escape')
    })
    const res = await postAdmin(app, '/admin/users/reset-password', makeValidResetPostOptions())
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.text()).toBe('Internal Server Error')
    expect(repo.resetCalls).toHaveLength(0)
  })

  it('repo throws → 500 no-store, generic body', async () => {
    const app = makeApp(goodAuth(), makeThrowingResetPasswordRepo())
    const res = await postAdmin(app, '/admin/users/reset-password', makeValidResetPostOptions())
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.text()).toBe('Internal Server Error')
  })
})

// ---------------------------------------------------------------------------
// GET /admin/users — create form rendering
// ---------------------------------------------------------------------------

describe('admin-routes: GET /admin/users create form rendering', () => {
  it('body contains action="/admin/users/create"', async () => {
    const app = makeApp(goodAuth(), makeEmptyUserRepo())
    const res = await getAdmin(app, { path: '/admin/users' })
    const body = await res.text()
    expect(body).toContain('action="/admin/users/create"')
  })

  it('create form contains name="userId"', async () => {
    const app = makeApp(goodAuth(), makeEmptyUserRepo())
    const res = await getAdmin(app, { path: '/admin/users' })
    const body = await res.text()
    expect(body).toContain('name="userId"')
  })

  it('create form contains name="displayName"', async () => {
    const app = makeApp(goodAuth(), makeEmptyUserRepo())
    const res = await getAdmin(app, { path: '/admin/users' })
    const body = await res.text()
    expect(body).toContain('name="displayName"')
  })

  it('create form contains name="password"', async () => {
    const app = makeApp(goodAuth(), makeEmptyUserRepo())
    const res = await getAdmin(app, { path: '/admin/users' })
    const body = await res.text()
    expect(body).toContain('name="password"')
  })

  it('create form uses type="password" for the password input', async () => {
    const app = makeApp(goodAuth(), makeEmptyUserRepo())
    const res = await getAdmin(app, { path: '/admin/users' })
    const body = await res.text()
    expect(body).toContain('type="password"')
  })

  it('create form is visible even when user list is empty', async () => {
    const app = makeApp(goodAuth(), makeEmptyUserRepo())
    const res = await getAdmin(app, { path: '/admin/users' })
    const body = await res.text()
    expect(body).toContain('action="/admin/users/create"')
    expect(body).toContain('ユーザーがいません')
  })

  it('body does NOT contain name="password_hash" in create form', async () => {
    const app = makeApp(goodAuth(), makeEmptyUserRepo())
    const res = await getAdmin(app, { path: '/admin/users' })
    const body = await res.text()
    expect(body).not.toContain('name="password_hash"')
  })
})

// ---------------------------------------------------------------------------
// GET /admin/users — reset-password form rendering
// ---------------------------------------------------------------------------

describe('admin-routes: GET /admin/users reset-password form rendering', () => {
  it('body contains action="/admin/users/reset-password" when user present', async () => {
    const app = makeApp(goodAuth(), makeUserRepo([SAMPLE_USER]))
    const res = await getAdmin(app, { path: '/admin/users' })
    const body = await res.text()
    expect(body).toContain('action="/admin/users/reset-password"')
  })

  it('reset form contains hidden userId with row id', async () => {
    const app = makeApp(goodAuth(), makeUserRepo([SAMPLE_USER]))
    const res = await getAdmin(app, { path: '/admin/users' })
    const body = await res.text()
    expect(body).toContain(`value="${SAMPLE_USER.id}"`)
  })

  it('reset form contains type="password" input for password', async () => {
    const app = makeApp(goodAuth(), makeUserRepo([SAMPLE_USER]))
    const res = await getAdmin(app, { path: '/admin/users' })
    const body = await res.text()
    expect(body).toContain('type="password"')
    expect(body).toContain('name="password"')
  })

  it('reset form does NOT contain name="password_hash"', async () => {
    const app = makeApp(goodAuth(), makeUserRepo([SAMPLE_USER]))
    const res = await getAdmin(app, { path: '/admin/users' })
    const body = await res.text()
    expect(body).not.toContain('name="password_hash"')
  })

  it('reset form not present when user list is empty', async () => {
    const app = makeApp(goodAuth(), makeEmptyUserRepo())
    const res = await getAdmin(app, { path: '/admin/users' })
    const body = await res.text()
    expect(body).not.toContain('action="/admin/users/reset-password"')
  })
})
