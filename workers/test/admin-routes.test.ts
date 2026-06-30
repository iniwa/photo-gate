import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { createAdminRoutes } from '../src/routes/admin.js'
import { normalizeEmail, parseAdminAllowlist } from '../src/middleware/require-admin.js'
import type { AdminAuthConfig } from '../src/types/admin-auth.js'
import type { AdminUserPage, AdminUserSummary } from '../src/types/admin-user.js'
import type { AdminAlbumPage, AdminAlbumSummary } from '../src/types/admin-album.js'
import type { AlbumForSync } from '../src/services/admin-album-repository.js'
import type { AdminPermissionSummary, AssignmentOptions } from '../src/types/admin-permission.js'
import type { Env } from '../src/types/env.js'
import type { AdminOpsSummary } from '../src/types/admin-ops.js'
import type { AdminSyncStatus } from '../src/types/admin-sync-status.js'
import type { AdminR2CleanupReport } from '../src/types/admin-r2-cleanup.js'

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
  updateDisplayName(userId: string, displayName: string, updatedAt: string): Promise<void>
}

type MutationUserRepo = UserRepo & {
  calls: { userId: string; enabled: number; updatedAt: string }[]
  createCalls: { userId: string; displayName: string; passwordHash: string; createdAt: string; updatedAt: string }[]
  resetCalls: { userId: string; passwordHash: string; updatedAt: string }[]
  updateDisplayNameCalls: { userId: string; displayName: string; updatedAt: string }[]
}

function makeEmptyUserRepo(): UserRepo {
  return {
    listUsers: async () => ({ users: [], hasMore: false }),
    setUserEnabled: async () => {},
    createUser: async () => {},
    resetPassword: async () => {},
    updateDisplayName: async () => {},
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
    updateDisplayName: async () => {},
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
    updateDisplayName: async () => {},
  }
}

function makeMutationUserRepo(): MutationUserRepo {
  const calls: { userId: string; enabled: number; updatedAt: string }[] = []
  const createCalls: { userId: string; displayName: string; passwordHash: string; createdAt: string; updatedAt: string }[] = []
  const resetCalls: { userId: string; passwordHash: string; updatedAt: string }[] = []
  const updateDisplayNameCalls: { userId: string; displayName: string; updatedAt: string }[] = []
  return {
    calls,
    createCalls,
    resetCalls,
    updateDisplayNameCalls,
    listUsers: async () => ({ users: [], hasMore: false }),
    setUserEnabled: async (userId, enabled, updatedAt) => { calls.push({ userId, enabled, updatedAt }) },
    createUser: async (userId, displayName, passwordHash, createdAt, updatedAt) => {
      createCalls.push({ userId, displayName, passwordHash, createdAt, updatedAt })
    },
    resetPassword: async (userId, passwordHash, updatedAt) => {
      resetCalls.push({ userId, passwordHash, updatedAt })
    },
    updateDisplayName: async (userId, displayName, updatedAt) => {
      updateDisplayNameCalls.push({ userId, displayName, updatedAt })
    },
  }
}

function makeThrowingSetEnabledUserRepo(): UserRepo {
  return {
    listUsers: async () => ({ users: [], hasMore: false }),
    setUserEnabled: async () => { throw new Error('D1 exploded') },
    createUser: async () => {},
    resetPassword: async () => {},
    updateDisplayName: async () => {},
  }
}

function makeThrowingCreateUserRepo(): UserRepo {
  return {
    listUsers: async () => ({ users: [], hasMore: false }),
    setUserEnabled: async () => {},
    createUser: async () => { throw new Error('D1 exploded') },
    resetPassword: async () => {},
    updateDisplayName: async () => {},
  }
}

function makeThrowingResetPasswordRepo(): UserRepo {
  return {
    listUsers: async () => ({ users: [], hasMore: false }),
    setUserEnabled: async () => {},
    createUser: async () => {},
    resetPassword: async () => { throw new Error('D1 exploded') },
    updateDisplayName: async () => {},
  }
}

function makeThrowingUpdateDisplayNameRepo(): UserRepo {
  return {
    listUsers: async () => ({ users: [], hasMore: false }),
    setUserEnabled: async () => {},
    createUser: async () => {},
    resetPassword: async () => {},
    updateDisplayName: async () => { throw new Error('D1 exploded') },
  }
}

type AlbumRepo = {
  listAlbums(afterAlbumId?: string): Promise<AdminAlbumPage>
  setAlbumEnabled(albumId: string, enabled: number, updatedAt: string): Promise<void>
  updatePublicMetadata(albumId: string, title: string, expiresAt: string | null, downloadEnabled: number, updatedAt: string): Promise<void>
  createAlbum(albumId: string, title: string, photoprismAlbumUid: string, expiresAt: string | null, downloadEnabled: 0 | 1, createdAt: string, updatedAt: string): Promise<void>
  getAlbumForSync(albumId: string): Promise<AlbumForSync | null>
}

type MutationAlbumRepo = AlbumRepo & {
  calls: { albumId: string; enabled: number; updatedAt: string }[]
  updateCalls: { albumId: string; title: string; expiresAt: string | null; downloadEnabled: number; updatedAt: string }[]
  createAlbumCalls: { albumId: string; title: string; photoprismAlbumUid: string; expiresAt: string | null; downloadEnabled: 0 | 1; createdAt: string; updatedAt: string }[]
}

function makeEmptyAlbumRepo(): AlbumRepo {
  return {
    listAlbums: async () => ({ albums: [], hasMore: false }),
    setAlbumEnabled: async () => {},
    updatePublicMetadata: async () => {},
    createAlbum: async () => {},
    getAlbumForSync: async () => null,
  }
}

function makeAlbumRepo(
  albums: AdminAlbumSummary[],
  hasMore = false,
): AlbumRepo {
  return {
    listAlbums: async () => ({ albums, hasMore }),
    setAlbumEnabled: async () => {},
    updatePublicMetadata: async () => {},
    createAlbum: async () => {},
    getAlbumForSync: async () => null,
  }
}

function makeThrowingAlbumRepo(): AlbumRepo {
  return {
    listAlbums: async () => {
      throw new Error('D1 exploded')
    },
    setAlbumEnabled: async () => {},
    updatePublicMetadata: async () => {},
    createAlbum: async () => {},
    getAlbumForSync: async () => null,
  }
}

function makeMutationAlbumRepo(): MutationAlbumRepo {
  const calls: { albumId: string; enabled: number; updatedAt: string }[] = []
  const updateCalls: { albumId: string; title: string; expiresAt: string | null; downloadEnabled: number; updatedAt: string }[] = []
  const createAlbumCalls: { albumId: string; title: string; photoprismAlbumUid: string; expiresAt: string | null; downloadEnabled: 0 | 1; createdAt: string; updatedAt: string }[] = []
  return {
    calls,
    updateCalls,
    createAlbumCalls,
    listAlbums: async () => ({ albums: [], hasMore: false }),
    setAlbumEnabled: async (albumId, enabled, updatedAt) => { calls.push({ albumId, enabled, updatedAt }) },
    updatePublicMetadata: async (albumId, title, expiresAt, downloadEnabled, updatedAt) => {
      updateCalls.push({ albumId, title, expiresAt, downloadEnabled, updatedAt })
    },
    createAlbum: async (albumId, title, photoprismAlbumUid, expiresAt, downloadEnabled, createdAt, updatedAt) => {
      createAlbumCalls.push({ albumId, title, photoprismAlbumUid, expiresAt, downloadEnabled, createdAt, updatedAt })
    },
    getAlbumForSync: async () => null,
  }
}

function makeThrowingSetEnabledAlbumRepo(): AlbumRepo {
  return {
    listAlbums: async () => ({ albums: [], hasMore: false }),
    setAlbumEnabled: async () => { throw new Error('D1 exploded') },
    updatePublicMetadata: async () => {},
    createAlbum: async () => {},
    getAlbumForSync: async () => null,
  }
}

function makeThrowingUpdatePublicMetadataRepo(): AlbumRepo {
  return {
    listAlbums: async () => ({ albums: [], hasMore: false }),
    setAlbumEnabled: async () => {},
    updatePublicMetadata: async () => { throw new Error('D1 exploded') },
    createAlbum: async () => {},
    getAlbumForSync: async () => null,
  }
}

function makeThrowingCreateAlbumRepo(): AlbumRepo {
  return {
    listAlbums: async () => ({ albums: [], hasMore: false }),
    setAlbumEnabled: async () => {},
    updatePublicMetadata: async () => {},
    createAlbum: async () => { throw new Error('D1 exploded') },
    getAlbumForSync: async () => null,
  }
}

type PermissionRepo = {
  listAssignmentOptions(after?: { albumId: string; userId: string }): Promise<AssignmentOptions>
  grantPermission(albumId: string, userId: string, createdAt: string): Promise<void>
  revokePermission(albumId: string, userId: string): Promise<void>
}

function makeEmptyPermissionRepo(): PermissionRepo {
  return {
    listAssignmentOptions: async () => ({ users: [], albums: [], permissions: [], hasMore: false }),
    grantPermission: async () => {},
    revokePermission: async () => {},
  }
}

function makePermissionRepo(
  permissions: AdminPermissionSummary[],
  hasMore = false,
): PermissionRepo {
  return {
    listAssignmentOptions: async () => ({ users: [], albums: [], permissions, hasMore }),
    grantPermission: async () => {},
    revokePermission: async () => {},
  }
}

function makeThrowingPermissionRepo(): PermissionRepo {
  return {
    listAssignmentOptions: async () => {
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
    listAssignmentOptions: async () => ({ users: [], albums: [], permissions: [], hasMore: false }),
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
    listAssignmentOptions: async () => ({ users: [], albums: [], permissions: [], hasMore: false }),
    grantPermission: async () => { throw new Error('D1 exploded') },
    revokePermission: async () => { throw new Error('D1 exploded') },
  }
}

function makePermissionRepoWithOptions(
  options: Partial<AssignmentOptions>,
  permissions: AdminPermissionSummary[] = [],
  hasMore = false,
): PermissionRepo {
  return {
    listAssignmentOptions: async () => ({
      users: options.users ?? [],
      albums: options.albums ?? [],
      permissions,
      hasMore,
    }),
    grantPermission: async () => {},
    revokePermission: async () => {},
  }
}

type OpsRepo = {
  getSummary(now: string, expiringSoonUntil: string): Promise<AdminOpsSummary>
}

const SAMPLE_SUMMARY: AdminOpsSummary = {
  generatedAt: NOW_TS,
  users: { total: 3, enabled: 2, disabled: 1, locked: 0 },
  albums: { total: 2, enabled: 1, disabled: 1, expired: 0, expiringSoon: 0, downloadable: 1 },
  permissions: { total: 4 },
  sessions: { total: 5, expired: 1 },
}

function makeOpsRepo(summary: AdminOpsSummary = SAMPLE_SUMMARY): OpsRepo {
  return { getSummary: async () => summary }
}

function makeThrowingOpsRepo(): OpsRepo {
  return { getSummary: async () => { throw new Error('D1 exploded') } }
}

type SyncStatusRepo = {
  getStatus(): Promise<{ status: 'missing' } | { status: 'found'; value: AdminSyncStatus }>
}

const SAMPLE_SYNC_STATUS: AdminSyncStatus = {
  schema: 2,
  publishedAt: '2026-06-25T00:00:00.000Z',
  albumId: 'my-album',
  intervalSeconds: 86400,
  startedAt: '2026-06-25T00:00:00.000Z',
  heartbeatAt: '2026-06-25T00:01:00.000Z',
  lastAttemptStartedAt: '2026-06-25T00:00:00.000Z',
  lastAttemptCompletedAt: '2026-06-25T00:02:00.000Z',
  lastResult: 'ok',
  lastError: null,
  consecutiveFailures: 0,
  runsCompleted: 1,
  lastTriggerKind: null,
  lastHandledRequestId: null,
}

function makeSyncStatusRepo(
  result: { status: 'missing' } | { status: 'found'; value: AdminSyncStatus } = {
    status: 'found',
    value: SAMPLE_SYNC_STATUS,
  },
): SyncStatusRepo {
  return { getStatus: async () => result }
}

function makeThrowingSyncStatusRepo(): SyncStatusRepo {
  return { getStatus: async () => { throw new Error('R2 exploded') } }
}

type SyncRequestValue = { schema: 1; requestId: string; requestedAt: string; kind: 'sync-now' }

type SyncRequestRepo = {
  writeRequest(req: SyncRequestValue): Promise<void>
  getPendingRequest(): Promise<{ status: 'missing' } | { status: 'found'; value: SyncRequestValue }>
}

type CapturingSyncRequestRepo = SyncRequestRepo & {
  calls: SyncRequestValue[]
}

function makeCapturingSyncRequestRepo(): CapturingSyncRequestRepo {
  const calls: SyncRequestValue[] = []
  return {
    calls,
    writeRequest: async (req) => { calls.push(req) },
    getPendingRequest: async () => ({ status: 'missing' }),
  }
}

function makeThrowingSyncRequestRepo(): SyncRequestRepo {
  return {
    writeRequest: async () => { throw new Error('R2 exploded') },
    getPendingRequest: async () => ({ status: 'missing' }),
  }
}

function makePendingRequestRepo(): SyncRequestRepo {
  return {
    writeRequest: async () => {},
    getPendingRequest: async () => ({
      status: 'found',
      value: { schema: 1, requestId: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4', requestedAt: '2026-06-25T00:00:00.000Z', kind: 'sync-now' },
    }),
  }
}

function makeThrowingPendingRequestRepo(): SyncRequestRepo {
  return {
    writeRequest: async () => {},
    getPendingRequest: async () => { throw new Error('R2 exploded') },
  }
}

function makeClockSpy() {
  let callCount = 0
  const clock = () => { callCount++; return new Date(NOW_TS) }
  return { clock, getCallCount: () => callCount }
}

type SyncTargetRepo = {
  upsertTarget(albumId: string, catalogId: string, title: string, expiresAt: string | null, downloadEnabled: 0 | 1, publishedAt: string): Promise<void>
  removeTarget(albumId: string, publishedAt: string): Promise<void>
}

type CapturingSyncTargetRepo = SyncTargetRepo & {
  upsertCalls: { albumId: string; catalogId: string; title: string; expiresAt: string | null; downloadEnabled: 0 | 1; publishedAt: string }[]
  removeCalls: { albumId: string; publishedAt: string }[]
}

function makeCapturingSyncTargetRepo(): CapturingSyncTargetRepo {
  const upsertCalls: { albumId: string; catalogId: string; title: string; expiresAt: string | null; downloadEnabled: 0 | 1; publishedAt: string }[] = []
  const removeCalls: { albumId: string; publishedAt: string }[] = []
  return {
    upsertCalls,
    removeCalls,
    upsertTarget: async (albumId, catalogId, title, expiresAt, downloadEnabled, publishedAt) => {
      upsertCalls.push({ albumId, catalogId, title, expiresAt, downloadEnabled, publishedAt })
    },
    removeTarget: async (albumId, publishedAt) => {
      removeCalls.push({ albumId, publishedAt })
    },
  }
}

function makeThrowingSyncTargetRepo(): SyncTargetRepo {
  return {
    upsertTarget: async () => { throw new Error('R2 exploded') },
    removeTarget: async () => { throw new Error('R2 exploded') },
  }
}

type CatalogEntry = {
  catalogId: string
  title: string
  photoCount: number | null
  updatedAt: string | null
}

type CatalogRepo = {
  getCatalog(): Promise<{ status: 'missing' } | { status: 'available'; publishedAt: string; albums: CatalogEntry[] }>
  hasCatalogId(catalogId: string): Promise<boolean>
}

function makePassingCatalogRepo(): CatalogRepo {
  return {
    getCatalog: async () => ({
      status: 'available',
      publishedAt: '2026-06-29T12:00:00Z',
      albums: [{ catalogId: 'a'.repeat(64), title: 'Test Album', photoCount: 10, updatedAt: '2026-06-29T12:00:00Z' }],
    }),
    hasCatalogId: async () => true,
  }
}

function makeMissingCatalogRepo(): CatalogRepo {
  return {
    getCatalog: async () => ({ status: 'missing' }),
    hasCatalogId: async () => { throw new Error('catalog missing') },
  }
}

function makeThrowingCatalogRepo(): CatalogRepo {
  return {
    getCatalog: async () => { throw new Error('R2 exploded') },
    hasCatalogId: async () => { throw new Error('R2 exploded') },
  }
}

function makeAbsentCatalogRepo(): CatalogRepo {
  return {
    getCatalog: async () => ({
      status: 'available',
      publishedAt: '2026-06-29T12:00:00Z',
      albums: [],
    }),
    hasCatalogId: async () => false,
  }
}

type R2CleanupRepo = {
  getReport(): Promise<AdminR2CleanupReport>
}

const SAMPLE_R2_CLEANUP_REPORT: AdminR2CleanupReport = {
  albums: [
    { albumId: 'album-sample-001', category: 'owned-active', objectCount: 3, totalBytes: 1024 },
    { albumId: 'album-sample-002', category: 'owned-disabled', objectCount: 1, totalBytes: 256 },
  ],
  malformedCount: 0,
  malformedBytes: 0,
  excludedOpsCount: 2,
  truncated: false,
}

function makeR2CleanupRepo(report: AdminR2CleanupReport = SAMPLE_R2_CLEANUP_REPORT): R2CleanupRepo {
  return { getReport: async () => report }
}

function makeThrowingR2CleanupRepo(): R2CleanupRepo {
  return { getReport: async () => { throw new Error('R2 exploded') } }
}

function makeApp(
  resolveAuth: ResolveAuth,
  userRepo?: UserRepo,
  albumRepo?: AlbumRepo,
  permissionRepo?: PermissionRepo,
  clock?: () => Date,
  opsRepo?: OpsRepo,
  syncStatusRepo?: SyncStatusRepo,
  syncRequestRepo?: SyncRequestRepo,
  syncTargetRepo?: SyncTargetRepo,
  catalogRepo?: CatalogRepo,
  r2CleanupRepo?: R2CleanupRepo,
): Hono {
  const app = new Hono()
  app.route(
    '/admin',
    createAdminRoutes(resolveAuth, () => ({
      userRepo: userRepo ?? makeEmptyUserRepo(),
      albumRepo: albumRepo ?? makeEmptyAlbumRepo(),
      permissionRepo: permissionRepo ?? makeEmptyPermissionRepo(),
      clock: clock ?? (() => new Date(NOW_TS)),
      opsRepo: opsRepo ?? makeOpsRepo(),
      syncStatusRepo: syncStatusRepo ?? makeSyncStatusRepo(),
      syncRequestRepo: syncRequestRepo ?? makeCapturingSyncRequestRepo(),
      syncTargetRepo: syncTargetRepo ?? makeCapturingSyncTargetRepo(),
      catalogRepo: catalogRepo ?? makePassingCatalogRepo(),
      r2CleanupRepo: r2CleanupRepo ?? makeR2CleanupRepo(),
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
  it('repo.listAssignmentOptions throws → 500 no-store', async () => {
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
const VALID_UPDATE_BODY = `albumId=${VALID_ALBUM_ID}&title=My+Album&expiresAt=&downloadEnabled=0`
const VALID_UPDATE_BODY_WITH_EXPIRY = `albumId=${VALID_ALBUM_ID}&title=My+Album&expiresAt=${encodeURIComponent('2026-12-31T23:59:59.000Z')}&downloadEnabled=1`
const VALID_UPDATE_DISPLAY_NAME_BODY = `userId=${VALID_USER_ID}&displayName=${encodeURIComponent(VALID_DISPLAY_NAME)}`
const NEW_ALBUM_ID = 'album-new-001'
const VALID_ALBUM_UID = 'pxyz1234ABCD'
const VALID_CREATE_ALBUM_BODY = `albumId=${NEW_ALBUM_ID}&title=My+New+Album&photoprismAlbumUid=${VALID_ALBUM_UID}&expiresAt=&downloadEnabled=0`

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

function makeValidUpdatePostOptions() {
  return {
    token: VALID_TOKEN as string | null,
    origin: VALID_ORIGIN as string | undefined,
    contentType: 'application/x-www-form-urlencoded' as string | undefined,
    body: VALID_UPDATE_BODY as string | undefined,
  }
}

function makeValidUpdateDisplayNamePostOptions() {
  return {
    token: VALID_TOKEN as string | null,
    origin: VALID_ORIGIN as string | undefined,
    contentType: 'application/x-www-form-urlencoded' as string | undefined,
    body: VALID_UPDATE_DISPLAY_NAME_BODY as string | undefined,
  }
}

function makeValidCreateAlbumPostOptions() {
  return {
    token: VALID_TOKEN as string | null,
    origin: VALID_ORIGIN as string | undefined,
    contentType: 'application/x-www-form-urlencoded' as string | undefined,
    body: VALID_CREATE_ALBUM_BODY as string | undefined,
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

// ---------------------------------------------------------------------------
// POST /admin/albums/update-public-metadata — guard
// ---------------------------------------------------------------------------

describe('admin-routes: POST /admin/albums/update-public-metadata guard', () => {
  it('no token → 403 Forbidden no-store, updatePublicMetadata not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/update-public-metadata', {
      ...makeValidUpdatePostOptions(),
      token: null,
    })
    await assertForbidden(res)
    expect(repo.updateCalls).toHaveLength(0)
  })

  it('non-allowlisted email → 403, updatePublicMetadata not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(() => ({
      verifier: async () => ({ email: 'other@example.com' }),
      allowlist: new Set([ADMIN_EMAIL]),
    }), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/update-public-metadata', makeValidUpdatePostOptions())
    await assertForbidden(res)
    expect(repo.updateCalls).toHaveLength(0)
  })

  it('Origin absent → 403, updatePublicMetadata not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/update-public-metadata', {
      ...makeValidUpdatePostOptions(),
      origin: undefined,
    })
    await assertForbidden(res)
    expect(repo.updateCalls).toHaveLength(0)
  })

  it('Origin = literal "null" → 403, updatePublicMetadata not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/update-public-metadata', {
      ...makeValidUpdatePostOptions(),
      origin: 'null',
    })
    await assertForbidden(res)
    expect(repo.updateCalls).toHaveLength(0)
  })

  it('Origin mismatched → 403, updatePublicMetadata not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/update-public-metadata', {
      ...makeValidUpdatePostOptions(),
      origin: 'https://evil.example',
    })
    await assertForbidden(res)
    expect(repo.updateCalls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// POST /admin/albums/update-public-metadata — content-type
// ---------------------------------------------------------------------------

describe('admin-routes: POST /admin/albums/update-public-metadata content-type', () => {
  it('Content-Type missing → 400 no-store, updatePublicMetadata not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/update-public-metadata', {
      ...makeValidUpdatePostOptions(),
      contentType: undefined,
    })
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(repo.updateCalls).toHaveLength(0)
  })

  it('Content-Type text/plain → 400, updatePublicMetadata not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/update-public-metadata', {
      ...makeValidUpdatePostOptions(),
      contentType: 'text/plain',
    })
    expect(res.status).toBe(400)
    expect(repo.updateCalls).toHaveLength(0)
  })

  it('Content-Type multipart/form-data → 400, updatePublicMetadata not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/update-public-metadata', {
      ...makeValidUpdatePostOptions(),
      contentType: 'multipart/form-data',
    })
    expect(res.status).toBe(400)
    expect(repo.updateCalls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// POST /admin/albums/update-public-metadata — body validation
// ---------------------------------------------------------------------------

describe('admin-routes: POST /admin/albums/update-public-metadata body validation', () => {
  it('empty body → 400, updatePublicMetadata not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/update-public-metadata', {
      ...makeValidUpdatePostOptions(),
      body: '',
    })
    expect(res.status).toBe(400)
    expect(repo.updateCalls).toHaveLength(0)
  })

  it('albumId only → 400 (field shortage), updatePublicMetadata not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/update-public-metadata', {
      ...makeValidUpdatePostOptions(),
      body: `albumId=${VALID_ALBUM_ID}`,
    })
    expect(res.status).toBe(400)
    expect(repo.updateCalls).toHaveLength(0)
  })

  it('expiresAt empty string → valid (303)', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/update-public-metadata', {
      ...makeValidUpdatePostOptions(),
      body: VALID_UPDATE_BODY,
    })
    expect(res.status).toBe(303)
  })

  it('expiresAt non-canonical ("2026-12-31") → 400, updatePublicMetadata not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/update-public-metadata', {
      ...makeValidUpdatePostOptions(),
      body: `albumId=${VALID_ALBUM_ID}&title=My+Album&expiresAt=2026-12-31&downloadEnabled=0`,
    })
    expect(res.status).toBe(400)
    expect(repo.updateCalls).toHaveLength(0)
  })

  it('downloadEnabled "2" → 400, updatePublicMetadata not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/update-public-metadata', {
      ...makeValidUpdatePostOptions(),
      body: `albumId=${VALID_ALBUM_ID}&title=My+Album&expiresAt=&downloadEnabled=2`,
    })
    expect(res.status).toBe(400)
    expect(repo.updateCalls).toHaveLength(0)
  })

  it('downloadEnabled "true" → 400, updatePublicMetadata not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/update-public-metadata', {
      ...makeValidUpdatePostOptions(),
      body: `albumId=${VALID_ALBUM_ID}&title=My+Album&expiresAt=&downloadEnabled=true`,
    })
    expect(res.status).toBe(400)
    expect(repo.updateCalls).toHaveLength(0)
  })

  it('empty title → 400, updatePublicMetadata not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/update-public-metadata', {
      ...makeValidUpdatePostOptions(),
      body: `albumId=${VALID_ALBUM_ID}&title=&expiresAt=&downloadEnabled=0`,
    })
    expect(res.status).toBe(400)
    expect(repo.updateCalls).toHaveLength(0)
  })

  it('title with leading space → 400, updatePublicMetadata not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/update-public-metadata', {
      ...makeValidUpdatePostOptions(),
      body: `albumId=${VALID_ALBUM_ID}&title=${encodeURIComponent(' album')}&expiresAt=&downloadEnabled=0`,
    })
    expect(res.status).toBe(400)
    expect(repo.updateCalls).toHaveLength(0)
  })

  it('title with control char → 400, updatePublicMetadata not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/update-public-metadata', {
      ...makeValidUpdatePostOptions(),
      body: `albumId=${VALID_ALBUM_ID}&title=${encodeURIComponent('\x01album')}&expiresAt=&downloadEnabled=0`,
    })
    expect(res.status).toBe(400)
    expect(repo.updateCalls).toHaveLength(0)
  })

  it('extra field → 400, updatePublicMetadata not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/update-public-metadata', {
      ...makeValidUpdatePostOptions(),
      body: VALID_UPDATE_BODY + '&extra=x',
    })
    expect(res.status).toBe(400)
    expect(repo.updateCalls).toHaveLength(0)
  })
  it('repeated albumId → 400, updatePublicMetadata not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/update-public-metadata', {
      ...makeValidUpdatePostOptions(),
      body: `albumId=${VALID_ALBUM_ID}&albumId=album-other-001&title=My+Album&expiresAt=&downloadEnabled=0`,
    })
    expect(res.status).toBe(400)
    expect(repo.updateCalls).toHaveLength(0)
  })

  it('repeated title → 400, updatePublicMetadata not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/update-public-metadata', {
      ...makeValidUpdatePostOptions(),
      body: `albumId=${VALID_ALBUM_ID}&title=My+Album&title=Other&expiresAt=&downloadEnabled=0`,
    })
    expect(res.status).toBe(400)
    expect(repo.updateCalls).toHaveLength(0)
  })

  it('clock not called when body is invalid', async () => {
    const spy = makeClockSpy()
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo, undefined, spy.clock)
    await postAdmin(app, '/admin/albums/update-public-metadata', {
      ...makeValidUpdatePostOptions(),
      body: `albumId=${VALID_ALBUM_ID}&title=&expiresAt=&downloadEnabled=0`,
    })
    expect(spy.getCallCount()).toBe(0)
    expect(repo.updateCalls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// POST /admin/albums/update-public-metadata — success
// ---------------------------------------------------------------------------

describe('admin-routes: POST /admin/albums/update-public-metadata success', () => {
  it('valid request → 303 with Location /admin/albums and no-store', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/update-public-metadata', makeValidUpdatePostOptions())
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/admin/albums')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('valid request → empty body', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/update-public-metadata', makeValidUpdatePostOptions())
    const body = await res.text()
    expect(body).toBe('')
  })

  it('repo throws → 500 no-store, generic body', async () => {
    const app = makeApp(goodAuth(), undefined, makeThrowingUpdatePublicMetadataRepo())
    const res = await postAdmin(app, '/admin/albums/update-public-metadata', makeValidUpdatePostOptions())
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.text()).toBe('Internal Server Error')
  })

  it('clock throws → 500 no-store, updatePublicMetadata NOT called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo, undefined, () => {
      throw new Error('clock detail must not escape')
    })
    const res = await postAdmin(app, '/admin/albums/update-public-metadata', makeValidUpdatePostOptions())
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.text()).toBe('Internal Server Error')
    expect(repo.updateCalls).toHaveLength(0)
  })

  it('expiresAt empty string → repo receives null', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    await postAdmin(app, '/admin/albums/update-public-metadata', {
      ...makeValidUpdatePostOptions(),
      body: VALID_UPDATE_BODY,
    })
    expect(repo.updateCalls).toHaveLength(1)
    expect(repo.updateCalls[0]!.expiresAt).toBeNull()
  })

  it('expiresAt canonical string → repo receives the string', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    await postAdmin(app, '/admin/albums/update-public-metadata', {
      ...makeValidUpdatePostOptions(),
      body: VALID_UPDATE_BODY_WITH_EXPIRY,
    })
    expect(repo.updateCalls).toHaveLength(1)
    expect(repo.updateCalls[0]!.expiresAt).toBe('2026-12-31T23:59:59.000Z')
  })

  it('downloadEnabled "0" → repo receives 0 (numeric)', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    await postAdmin(app, '/admin/albums/update-public-metadata', {
      ...makeValidUpdatePostOptions(),
      body: VALID_UPDATE_BODY,
    })
    expect(repo.updateCalls).toHaveLength(1)
    expect(repo.updateCalls[0]!.downloadEnabled).toBe(0)
  })

  it('downloadEnabled "1" → repo receives 1 (numeric)', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    await postAdmin(app, '/admin/albums/update-public-metadata', {
      ...makeValidUpdatePostOptions(),
      body: VALID_UPDATE_BODY_WITH_EXPIRY,
    })
    expect(repo.updateCalls).toHaveLength(1)
    expect(repo.updateCalls[0]!.downloadEnabled).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// GET /admin/albums — update-public-metadata form rendering
// ---------------------------------------------------------------------------

describe('admin-routes: GET /admin/albums update-public-metadata form rendering', () => {
  it('body contains action="/admin/albums/update-public-metadata"', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepo([SAMPLE_ALBUM]))
    const res = await getAdmin(app, { path: '/admin/albums' })
    const body = await res.text()
    expect(body).toContain('action="/admin/albums/update-public-metadata"')
  })

  it('update form contains name="albumId"', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepo([SAMPLE_ALBUM]))
    const res = await getAdmin(app, { path: '/admin/albums' })
    const body = await res.text()
    expect(body).toContain('name="albumId"')
  })

  it('update form contains name="title"', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepo([SAMPLE_ALBUM]))
    const res = await getAdmin(app, { path: '/admin/albums' })
    const body = await res.text()
    expect(body).toContain('name="title"')
  })

  it('update form contains name="expiresAt"', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepo([SAMPLE_ALBUM]))
    const res = await getAdmin(app, { path: '/admin/albums' })
    const body = await res.text()
    expect(body).toContain('name="expiresAt"')
  })

  it('update form contains name="downloadEnabled"', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepo([SAMPLE_ALBUM]))
    const res = await getAdmin(app, { path: '/admin/albums' })
    const body = await res.text()
    expect(body).toContain('name="downloadEnabled"')
  })
})

// ---------------------------------------------------------------------------
// GET /admin/ops
// ---------------------------------------------------------------------------

describe('GET /admin/ops — guard', () => {
  it('returns 403 when no auth token', async () => {
    const app = makeApp(goodAuth())
    const res = await getAdmin(app, { token: null, path: '/admin/ops' })
    expect(res.status).toBe(403)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('returns 403 when auth rejects', async () => {
    const app = makeApp(() => null)
    const res = await getAdmin(app, { path: '/admin/ops' })
    expect(res.status).toBe(403)
  })
})

describe('GET /admin/ops — success', () => {
  it('returns 200 with no-store', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, undefined, undefined, makeOpsRepo())
    const res = await getAdmin(app, { path: '/admin/ops' })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const html = await res.text()
    expect(html).toContain('運用サマリ')
  })

  it('renders aggregate counts from the summary', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, undefined, undefined, makeOpsRepo())
    const res = await getAdmin(app, { path: '/admin/ops' })
    const html = await res.text()
    expect(html).toContain('3') // users.total
    expect(html).toContain('2') // users.enabled
    expect(html).toContain('4') // permissions.total
    expect(html).toContain('5') // sessions.total
  })

  it('does not expose forbidden data', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, undefined, undefined, makeOpsRepo())
    const res = await getAdmin(app, { path: '/admin/ops' })
    const html = await res.text()
    expect(html).not.toContain('password_hash')
    expect(html).not.toContain('token_hash')
    expect(html).not.toContain('photoprism_album_uid')
    expect(html).not.toContain('display_name')
  })

  it('passes nowIso and expiringSoonUntil to opsRepo', async () => {
    const calls: { now: string; expiringSoonUntil: string }[] = []
    const opsRepo: OpsRepo = {
      getSummary: async (now, expiringSoonUntil) => {
        calls.push({ now, expiringSoonUntil })
        return SAMPLE_SUMMARY
      },
    }
    const fixedDate = new Date(NOW_TS)
    const clock = () => fixedDate
    const app = makeApp(goodAuth(), undefined, undefined, undefined, clock, opsRepo)
    await getAdmin(app, { path: '/admin/ops' })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.now).toBe(NOW_TS)
    const sevenDaysLater = new Date(fixedDate.valueOf() + 7 * 24 * 60 * 60 * 1000).toISOString()
    expect(calls[0]!.expiringSoonUntil).toBe(sevenDaysLater)
  })
})

describe('GET /admin/ops — repo failure', () => {
  it('returns 500 when opsRepo throws', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, undefined, undefined, makeThrowingOpsRepo())
    const res = await getAdmin(app, { path: '/admin/ops' })
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('returns 500 when clock throws', async () => {
    const throwingClock = (): Date => { throw new Error('clock failure') }
    const app = makeApp(goodAuth(), undefined, undefined, undefined, throwingClock, makeOpsRepo())
    const res = await getAdmin(app, { path: '/admin/ops' })
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})

describe('GET /admin/ops — admin home links', () => {
  it('GET /admin links to /admin/ops with label 運用サマリ', async () => {
    const app = makeApp(goodAuth())
    const res = await getAdmin(app)
    const html = await res.text()
    expect(html).toContain('href="/admin/ops"')
    expect(html).toContain('運用サマリ')
  })
})

// ---------------------------------------------------------------------------
// GET /admin/sync
// ---------------------------------------------------------------------------

describe('GET /admin/sync — auth guard', () => {
  it('returns 403 with no token', async () => {
    const res = await getAdmin(makeApp(goodAuth()), { token: null, path: '/admin/sync' })
    expect(res.status).toBe(403)
  })

  it('returns 403 with bad auth config', async () => {
    const res = await getAdmin(makeApp(() => null), { path: '/admin/sync' })
    expect(res.status).toBe(403)
  })
})

describe('GET /admin/sync — found status', () => {
  it('returns 200', async () => {
    const res = await getAdmin(makeApp(goodAuth()), { path: '/admin/sync' })
    expect(res.status).toBe(200)
  })

  it('sets Cache-Control: no-store', async () => {
    const res = await getAdmin(makeApp(goodAuth()), { path: '/admin/sync' })
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('renders album ID', async () => {
    const res = await getAdmin(makeApp(goodAuth()), { path: '/admin/sync' })
    const body = await res.text()
    expect(body).toContain('my-album')
  })

  it('renders interval seconds', async () => {
    const res = await getAdmin(makeApp(goodAuth()), { path: '/admin/sync' })
    const body = await res.text()
    expect(body).toContain('86400')
  })

  it('renders last result', async () => {
    const res = await getAdmin(makeApp(goodAuth()), { path: '/admin/sync' })
    const body = await res.text()
    expect(body).toContain('ok')
  })

  it('does NOT render raw JSON blob', async () => {
    const res = await getAdmin(makeApp(goodAuth()), { path: '/admin/sync' })
    const body = await res.text()
    expect(body).not.toContain('"schema"')
  })

  it('does NOT render PhotoPrism references', async () => {
    const res = await getAdmin(makeApp(goodAuth()), { path: '/admin/sync' })
    const body = await res.text()
    expect(body.toLowerCase()).not.toContain('photoprism')
  })
})

describe('GET /admin/sync — missing status', () => {
  it('returns 200', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, undefined, undefined, undefined, makeSyncStatusRepo({ status: 'missing' }))
    const res = await getAdmin(app, { path: '/admin/sync' })
    expect(res.status).toBe(200)
  })

  it('renders 未報告', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, undefined, undefined, undefined, makeSyncStatusRepo({ status: 'missing' }))
    const res = await getAdmin(app, { path: '/admin/sync' })
    const body = await res.text()
    expect(body).toContain('未報告')
  })

  it('sets Cache-Control: no-store', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, undefined, undefined, undefined, makeSyncStatusRepo({ status: 'missing' }))
    const res = await getAdmin(app, { path: '/admin/sync' })
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})

describe('GET /admin/sync — repo failure', () => {
  it('returns 500 when repo throws', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, undefined, undefined, undefined, makeThrowingSyncStatusRepo())
    const res = await getAdmin(app, { path: '/admin/sync' })
    expect(res.status).toBe(500)
  })

  it('sets Cache-Control: no-store on 500', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, undefined, undefined, undefined, makeThrowingSyncStatusRepo())
    const res = await getAdmin(app, { path: '/admin/sync' })
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('500 body does not contain R2 error details', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, undefined, undefined, undefined, makeThrowingSyncStatusRepo())
    const res = await getAdmin(app, { path: '/admin/sync' })
    const body = await res.text()
    expect(body).not.toContain('R2 exploded')
  })
})

describe('GET /admin — home link to /admin/sync', () => {
  it('contains link to /admin/sync', async () => {
    const res = await getAdmin(makeApp(goodAuth()))
    const body = await res.text()
    expect(body).toContain('href="/admin/sync"')
  })

  it('link label is 同期状態', async () => {
    const res = await getAdmin(makeApp(goodAuth()))
    const body = await res.text()
    expect(body).toContain('同期状態')
  })
})

// ---------------------------------------------------------------------------
// POST /admin/sync/request helpers
// ---------------------------------------------------------------------------

function postSyncRequest(
  app: Hono,
  options: {
    token?: string | null
    origin?: string | null
    contentType?: string | null
    body?: string
  } = {},
): Promise<Response> {
  const {
    token = VALID_TOKEN,
    origin = 'https://example.com',
    contentType = 'application/x-www-form-urlencoded',
    body = 'kind=sync-now',
  } = options
  const headers: Record<string, string> = {}
  if (token !== null) headers['Cf-Access-Jwt-Assertion'] = token
  if (origin !== null) headers['Origin'] = origin
  if (contentType !== null) headers['Content-Type'] = contentType
  return Promise.resolve(
    app.request(
      'https://example.com/admin/sync/request',
      { method: 'POST', headers, body },
      {} as unknown as Parameters<typeof app.request>[2],
    ),
  )
}

// ---------------------------------------------------------------------------
// POST /admin/sync/request — auth guard
// ---------------------------------------------------------------------------

describe('POST /admin/sync/request — auth guard', () => {
  it('returns 403 when no token', async () => {
    const app = makeApp(goodAuth())
    const res = await postSyncRequest(app, { token: null })
    expect(res.status).toBe(403)
  })

  it('returns 403 with no-store when no token', async () => {
    const app = makeApp(goodAuth())
    const res = await postSyncRequest(app, { token: null })
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('returns 403 when token invalid', async () => {
    const resolveAuth: ResolveAuth = () => ({
      verifier: async () => { throw new Error('bad token') },
      allowlist: new Set([ADMIN_EMAIL]),
    })
    const app = makeApp(resolveAuth)
    const res = await postSyncRequest(app)
    expect(res.status).toBe(403)
  })

  it('returns 403 when email not in allowlist', async () => {
    const resolveAuth: ResolveAuth = () => ({
      verifier: async () => ({ email: 'other@example.com' }),
      allowlist: new Set([ADMIN_EMAIL]),
    })
    const app = makeApp(resolveAuth)
    const res = await postSyncRequest(app)
    expect(res.status).toBe(403)
  })

  it('repo is not called on auth failure', async () => {
    const repo = makeCapturingSyncRequestRepo()
    const app = makeApp(goodAuth(), undefined, undefined, undefined, undefined, undefined, undefined, repo)
    await postSyncRequest(app, { token: null })
    expect(repo.calls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// POST /admin/sync/request — same-origin guard
// ---------------------------------------------------------------------------

describe('POST /admin/sync/request — same-origin guard', () => {
  it('returns 403 when Origin is absent', async () => {
    const app = makeApp(goodAuth())
    const res = await postSyncRequest(app, { origin: null })
    expect(res.status).toBe(403)
  })

  it('returns no-store when Origin is absent', async () => {
    const app = makeApp(goodAuth())
    const res = await postSyncRequest(app, { origin: null })
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('returns 403 when Origin is "null"', async () => {
    const app = makeApp(goodAuth())
    const res = await postSyncRequest(app, { origin: 'null' })
    expect(res.status).toBe(403)
  })

  it('returns 403 when Origin is cross-origin', async () => {
    const app = makeApp(goodAuth())
    const res = await postSyncRequest(app, { origin: 'https://evil.example.com' })
    expect(res.status).toBe(403)
  })

  it('repo is not called on same-origin failure', async () => {
    const repo = makeCapturingSyncRequestRepo()
    const app = makeApp(goodAuth(), undefined, undefined, undefined, undefined, undefined, undefined, repo)
    await postSyncRequest(app, { origin: null })
    expect(repo.calls).toHaveLength(0)
  })

  it('clock is not called on same-origin failure', async () => {
    const { clock, getCallCount } = makeClockSpy()
    const app = makeApp(goodAuth(), undefined, undefined, undefined, clock)
    await postSyncRequest(app, { origin: null })
    expect(getCallCount()).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// POST /admin/sync/request — Content-Type guard
// ---------------------------------------------------------------------------

describe('POST /admin/sync/request — Content-Type guard', () => {
  it('returns 400 when Content-Type is absent', async () => {
    const app = makeApp(goodAuth())
    const res = await postSyncRequest(app, { contentType: null })
    expect(res.status).toBe(400)
  })

  it('returns no-store when Content-Type is absent', async () => {
    const app = makeApp(goodAuth())
    const res = await postSyncRequest(app, { contentType: null })
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('returns 400 when Content-Type is application/json', async () => {
    const app = makeApp(goodAuth())
    const res = await postSyncRequest(app, { contentType: 'application/json' })
    expect(res.status).toBe(400)
  })

  it('returns 400 when Content-Type is multipart/form-data', async () => {
    const app = makeApp(goodAuth())
    const res = await postSyncRequest(app, { contentType: 'multipart/form-data' })
    expect(res.status).toBe(400)
  })

  it('repo is not called on Content-Type failure', async () => {
    const repo = makeCapturingSyncRequestRepo()
    const app = makeApp(goodAuth(), undefined, undefined, undefined, undefined, undefined, undefined, repo)
    await postSyncRequest(app, { contentType: 'application/json' })
    expect(repo.calls).toHaveLength(0)
  })

  it('clock is not called on Content-Type failure', async () => {
    const { clock, getCallCount } = makeClockSpy()
    const app = makeApp(goodAuth(), undefined, undefined, undefined, clock)
    await postSyncRequest(app, { contentType: 'application/json' })
    expect(getCallCount()).toBe(0)
  })

  it('accepts Content-Type with charset', async () => {
    const app = makeApp(goodAuth())
    const res = await postSyncRequest(app, { contentType: 'application/x-www-form-urlencoded; charset=utf-8' })
    expect(res.status).toBe(303)
  })
})

// ---------------------------------------------------------------------------
// POST /admin/sync/request — form validation
// ---------------------------------------------------------------------------

describe('POST /admin/sync/request — form validation', () => {
  it('returns 400 when body is empty (kind missing)', async () => {
    const app = makeApp(goodAuth())
    const res = await postSyncRequest(app, { body: '' })
    expect(res.status).toBe(400)
  })

  it('returns no-store when kind missing', async () => {
    const app = makeApp(goodAuth())
    const res = await postSyncRequest(app, { body: '' })
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('returns 400 when kind has wrong value', async () => {
    const app = makeApp(goodAuth())
    const res = await postSyncRequest(app, { body: 'kind=sync-later' })
    expect(res.status).toBe(400)
  })

  it('returns 400 when extra field is present', async () => {
    const app = makeApp(goodAuth())
    const res = await postSyncRequest(app, { body: 'kind=sync-now&extra=value' })
    expect(res.status).toBe(400)
  })

  it('returns 400 when kind is repeated', async () => {
    const app = makeApp(goodAuth())
    const res = await postSyncRequest(app, { body: 'kind=sync-now&kind=sync-now' })
    expect(res.status).toBe(400)
  })

  it('repo is not called on form validation failure', async () => {
    const repo = makeCapturingSyncRequestRepo()
    const app = makeApp(goodAuth(), undefined, undefined, undefined, undefined, undefined, undefined, repo)
    await postSyncRequest(app, { body: 'kind=wrong' })
    expect(repo.calls).toHaveLength(0)
  })

  it('clock is not called on form validation failure', async () => {
    const { clock, getCallCount } = makeClockSpy()
    const app = makeApp(goodAuth(), undefined, undefined, undefined, clock)
    await postSyncRequest(app, { body: 'kind=wrong' })
    expect(getCallCount()).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// POST /admin/sync/request — success
// ---------------------------------------------------------------------------

describe('POST /admin/sync/request — success', () => {
  it('returns 303 on success', async () => {
    const app = makeApp(goodAuth())
    const res = await postSyncRequest(app)
    expect(res.status).toBe(303)
  })

  it('sets Location: /admin/sync on success', async () => {
    const app = makeApp(goodAuth())
    const res = await postSyncRequest(app)
    expect(res.headers.get('location')).toBe('/admin/sync')
  })

  it('sets Cache-Control: no-store on success', async () => {
    const app = makeApp(goodAuth())
    const res = await postSyncRequest(app)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('calls repo.writeRequest exactly once on success', async () => {
    const repo = makeCapturingSyncRequestRepo()
    const app = makeApp(goodAuth(), undefined, undefined, undefined, undefined, undefined, undefined, repo)
    await postSyncRequest(app)
    expect(repo.calls).toHaveLength(1)
  })

  it('written request has schema=1', async () => {
    const repo = makeCapturingSyncRequestRepo()
    const app = makeApp(goodAuth(), undefined, undefined, undefined, undefined, undefined, undefined, repo)
    await postSyncRequest(app)
    expect(repo.calls[0]!.schema).toBe(1)
  })

  it('written request has kind=sync-now', async () => {
    const repo = makeCapturingSyncRequestRepo()
    const app = makeApp(goodAuth(), undefined, undefined, undefined, undefined, undefined, undefined, repo)
    await postSyncRequest(app)
    expect(repo.calls[0]!.kind).toBe('sync-now')
  })

  it('written request has requestId matching /^[0-9a-f]{32}$/', async () => {
    const repo = makeCapturingSyncRequestRepo()
    const app = makeApp(goodAuth(), undefined, undefined, undefined, undefined, undefined, undefined, repo)
    await postSyncRequest(app)
    expect(repo.calls[0]!.requestId).toMatch(/^[0-9a-f]{32}$/)
  })

  it('written request has canonical ISO requestedAt', async () => {
    const repo = makeCapturingSyncRequestRepo()
    const app = makeApp(goodAuth(), undefined, undefined, undefined, undefined, undefined, undefined, repo)
    await postSyncRequest(app)
    const ts = repo.calls[0]!.requestedAt
    expect(ts).toBe(new Date(ts).toISOString())
  })

  it('clock is called during successful request', async () => {
    const { clock, getCallCount } = makeClockSpy()
    const repo = makeCapturingSyncRequestRepo()
    const app = makeApp(goodAuth(), undefined, undefined, undefined, clock, undefined, undefined, repo)
    await postSyncRequest(app)
    expect(getCallCount()).toBeGreaterThan(0)
  })

  it('requestedAt matches clock output', async () => {
    const fixedDate = new Date('2026-06-25T10:20:30.456Z')
    const repo = makeCapturingSyncRequestRepo()
    const app = makeApp(goodAuth(), undefined, undefined, undefined, () => fixedDate, undefined, undefined, repo)
    await postSyncRequest(app)
    expect(repo.calls[0]!.requestedAt).toBe(fixedDate.toISOString())
  })

  it('body does not reflect requestId', async () => {
    const repo = makeCapturingSyncRequestRepo()
    const app = makeApp(goodAuth(), undefined, undefined, undefined, undefined, undefined, undefined, repo)
    const res = await postSyncRequest(app)
    const body = await res.text()
    if (repo.calls[0]) {
      expect(body).not.toContain(repo.calls[0]!.requestId)
    }
  })
})

// ---------------------------------------------------------------------------
// POST /admin/sync/request — repo failure
// ---------------------------------------------------------------------------

describe('POST /admin/sync/request — repo failure', () => {
  it('returns 500 when repo throws', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, undefined, undefined, undefined, undefined, makeThrowingSyncRequestRepo())
    const res = await postSyncRequest(app)
    expect(res.status).toBe(500)
  })

  it('sets Cache-Control: no-store on repo failure', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, undefined, undefined, undefined, undefined, makeThrowingSyncRequestRepo())
    const res = await postSyncRequest(app)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('500 body does not contain repo error details', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, undefined, undefined, undefined, undefined, makeThrowingSyncRequestRepo())
    const res = await postSyncRequest(app)
    const body = await res.text()
    expect(body).not.toContain('R2 exploded')
  })

  it('500 body does not contain ops/sync-request.json', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, undefined, undefined, undefined, undefined, makeThrowingSyncRequestRepo())
    const res = await postSyncRequest(app)
    const body = await res.text()
    expect(body).not.toContain('ops/sync-request.json')
  })
})

// ---------------------------------------------------------------------------
// GET /admin/sync — Sync Now form
// ---------------------------------------------------------------------------

describe('GET /admin/sync — Sync Now form', () => {
  it('form targets /admin/sync/request', async () => {
    const app = makeApp(goodAuth())
    const res = await getAdmin(app, { path: '/admin/sync' })
    const body = await res.text()
    expect(body).toContain('action="/admin/sync/request"')
  })

  it('form has hidden input kind=sync-now', async () => {
    const app = makeApp(goodAuth())
    const res = await getAdmin(app, { path: '/admin/sync' })
    const body = await res.text()
    expect(body).toContain('name="kind"')
    expect(body).toContain('value="sync-now"')
  })

  it('form has submit button 今すぐ同期', async () => {
    const app = makeApp(goodAuth())
    const res = await getAdmin(app, { path: '/admin/sync' })
    const body = await res.text()
    expect(body).toContain('今すぐ同期')
  })

  it('form uses method=post', async () => {
    const app = makeApp(goodAuth())
    const res = await getAdmin(app, { path: '/admin/sync' })
    const body = await res.text()
    expect(body).toContain('method="post"')
  })
})

// ---------------------------------------------------------------------------
// GET /admin/sync — pending indicator
// ---------------------------------------------------------------------------

describe('GET /admin/sync — pending indicator', () => {
  it('shows 同期リクエスト処理待ち when request is pending', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, undefined, undefined, undefined, undefined, makePendingRequestRepo())
    const res = await getAdmin(app, { path: '/admin/sync' })
    const body = await res.text()
    expect(body).toContain('同期リクエスト処理待ち')
  })

  it('does not show 同期リクエスト処理待ち when no pending request', async () => {
    const app = makeApp(goodAuth())
    const res = await getAdmin(app, { path: '/admin/sync' })
    const body = await res.text()
    expect(body).not.toContain('同期リクエスト処理待ち')
  })

  it('does not render requestId in response when pending', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, undefined, undefined, undefined, undefined, makePendingRequestRepo())
    const res = await getAdmin(app, { path: '/admin/sync' })
    const body = await res.text()
    expect(body).not.toContain('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4')
  })

  it('returns 500 when getPendingRequest throws', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, undefined, undefined, undefined, undefined, makeThrowingPendingRequestRepo())
    const res = await getAdmin(app, { path: '/admin/sync' })
    expect(res.status).toBe(500)
  })

  it('returns no-store on 500 from getPendingRequest', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, undefined, undefined, undefined, undefined, makeThrowingPendingRequestRepo())
    const res = await getAdmin(app, { path: '/admin/sync' })
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })

  it('does not render error detail on getPendingRequest 500', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, undefined, undefined, undefined, undefined, makeThrowingPendingRequestRepo())
    const res = await getAdmin(app, { path: '/admin/sync' })
    const body = await res.text()
    expect(body).not.toContain('R2 exploded')
    expect(body).not.toContain('ops/sync-request')
  })
})

// ---------------------------------------------------------------------------
// GET /admin/sync — trigger metadata
// ---------------------------------------------------------------------------

describe('GET /admin/sync — trigger metadata', () => {
  it('renders 未報告 when lastTriggerKind is null', async () => {
    const statusRepo = makeSyncStatusRepo({ status: 'found', value: { ...SAMPLE_SYNC_STATUS, lastTriggerKind: null } })
    const app = makeApp(goodAuth(), undefined, undefined, undefined, undefined, undefined, statusRepo)
    const res = await getAdmin(app, { path: '/admin/sync' })
    const body = await res.text()
    expect(body).toContain('未報告')
  })

  it('renders 定期実行 when lastTriggerKind is scheduled', async () => {
    const statusRepo = makeSyncStatusRepo({ status: 'found', value: { ...SAMPLE_SYNC_STATUS, lastTriggerKind: 'scheduled' } })
    const app = makeApp(goodAuth(), undefined, undefined, undefined, undefined, undefined, statusRepo)
    const res = await getAdmin(app, { path: '/admin/sync' })
    const body = await res.text()
    expect(body).toContain('定期実行')
  })

  it('renders 手動実行 when lastTriggerKind is manual', async () => {
    const statusRepo = makeSyncStatusRepo({ status: 'found', value: { ...SAMPLE_SYNC_STATUS, lastTriggerKind: 'manual' } })
    const app = makeApp(goodAuth(), undefined, undefined, undefined, undefined, undefined, statusRepo)
    const res = await getAdmin(app, { path: '/admin/sync' })
    const body = await res.text()
    expect(body).toContain('手動実行')
  })

  it('shows lastHandledRequestId when non-null', async () => {
    const statusRepo = makeSyncStatusRepo({ status: 'found', value: { ...SAMPLE_SYNC_STATUS, lastHandledRequestId: 'deadbeef12345678deadbeef12345678' } })
    const app = makeApp(goodAuth(), undefined, undefined, undefined, undefined, undefined, statusRepo)
    const res = await getAdmin(app, { path: '/admin/sync' })
    const body = await res.text()
    expect(body).toContain('deadbeef12345678deadbeef12345678')
  })

  it('does not show lastHandledRequestId row when null', async () => {
    const statusRepo = makeSyncStatusRepo({ status: 'found', value: { ...SAMPLE_SYNC_STATUS, lastHandledRequestId: null } })
    const app = makeApp(goodAuth(), undefined, undefined, undefined, undefined, undefined, statusRepo)
    const res = await getAdmin(app, { path: '/admin/sync' })
    const body = await res.text()
    expect(body).not.toContain('最終処理リクエストID')
  })
})

// ---------------------------------------------------------------------------
// POST /admin/users/update-display-name — guard
// ---------------------------------------------------------------------------

describe('admin-routes: POST /admin/users/update-display-name guard', () => {
  it('no token → 403 Forbidden no-store, updateDisplayName not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/update-display-name', {
      ...makeValidUpdateDisplayNamePostOptions(),
      token: null,
    })
    await assertForbidden(res)
    expect(repo.updateDisplayNameCalls).toHaveLength(0)
  })

  it('non-allowlisted email → 403, updateDisplayName not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(() => ({
      verifier: async () => ({ email: 'other@example.com' }),
      allowlist: new Set([ADMIN_EMAIL]),
    }), repo)
    const res = await postAdmin(app, '/admin/users/update-display-name', makeValidUpdateDisplayNamePostOptions())
    await assertForbidden(res)
    expect(repo.updateDisplayNameCalls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// POST /admin/users/update-display-name — same-origin
// ---------------------------------------------------------------------------

describe('admin-routes: POST /admin/users/update-display-name same-origin', () => {
  it('Origin header absent → 403, updateDisplayName not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/update-display-name', {
      ...makeValidUpdateDisplayNamePostOptions(),
      origin: undefined,
    })
    await assertForbidden(res)
    expect(repo.updateDisplayNameCalls).toHaveLength(0)
  })

  it('Origin = literal "null" → 403, updateDisplayName not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/update-display-name', {
      ...makeValidUpdateDisplayNamePostOptions(),
      origin: 'null',
    })
    await assertForbidden(res)
    expect(repo.updateDisplayNameCalls).toHaveLength(0)
  })

  it('Origin mismatched → 403, updateDisplayName not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/update-display-name', {
      ...makeValidUpdateDisplayNamePostOptions(),
      origin: 'https://evil.example',
    })
    await assertForbidden(res)
    expect(repo.updateDisplayNameCalls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// POST /admin/users/update-display-name — content-type validation
// ---------------------------------------------------------------------------

describe('admin-routes: POST /admin/users/update-display-name content-type', () => {
  it('Content-Type missing → 400 no-store, updateDisplayName not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/update-display-name', {
      ...makeValidUpdateDisplayNamePostOptions(),
      contentType: undefined,
    })
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(repo.updateDisplayNameCalls).toHaveLength(0)
  })

  it('Content-Type application/json → 400, updateDisplayName not called', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/update-display-name', {
      ...makeValidUpdateDisplayNamePostOptions(),
      contentType: 'application/json',
    })
    expect(res.status).toBe(400)
    expect(repo.updateDisplayNameCalls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// POST /admin/users/update-display-name — body validation
// ---------------------------------------------------------------------------

describe('admin-routes: POST /admin/users/update-display-name body validation', () => {
  it('missing userId → 400', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/update-display-name', {
      ...makeValidUpdateDisplayNamePostOptions(),
      body: `displayName=${encodeURIComponent(VALID_DISPLAY_NAME)}`,
    })
    expect(res.status).toBe(400)
    expect(repo.updateDisplayNameCalls).toHaveLength(0)
  })

  it('missing displayName → 400', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/update-display-name', {
      ...makeValidUpdateDisplayNamePostOptions(),
      body: `userId=${VALID_USER_ID}`,
    })
    expect(res.status).toBe(400)
    expect(repo.updateDisplayNameCalls).toHaveLength(0)
  })

  it('extra field → 400', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/update-display-name', {
      ...makeValidUpdateDisplayNamePostOptions(),
      body: `userId=${VALID_USER_ID}&displayName=${encodeURIComponent(VALID_DISPLAY_NAME)}&extra=x`,
    })
    expect(res.status).toBe(400)
    expect(repo.updateDisplayNameCalls).toHaveLength(0)
  })

  it('repeated userId → 400', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/update-display-name', {
      ...makeValidUpdateDisplayNamePostOptions(),
      body: `userId=${VALID_USER_ID}&userId=user-other-001&displayName=${encodeURIComponent(VALID_DISPLAY_NAME)}`,
    })
    expect(res.status).toBe(400)
    expect(repo.updateDisplayNameCalls).toHaveLength(0)
  })

  it('repeated displayName → 400', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/update-display-name', {
      ...makeValidUpdateDisplayNamePostOptions(),
      body: `userId=${VALID_USER_ID}&displayName=${encodeURIComponent(VALID_DISPLAY_NAME)}&displayName=Other`,
    })
    expect(res.status).toBe(400)
    expect(repo.updateDisplayNameCalls).toHaveLength(0)
  })

  it('invalid userId → 400', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/update-display-name', {
      ...makeValidUpdateDisplayNamePostOptions(),
      body: `userId=!bad!&displayName=${encodeURIComponent(VALID_DISPLAY_NAME)}`,
    })
    expect(res.status).toBe(400)
    expect(repo.updateDisplayNameCalls).toHaveLength(0)
  })

  it('empty displayName → 400', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/update-display-name', {
      ...makeValidUpdateDisplayNamePostOptions(),
      body: `userId=${VALID_USER_ID}&displayName=`,
    })
    expect(res.status).toBe(400)
    expect(repo.updateDisplayNameCalls).toHaveLength(0)
  })

  it('displayName with leading space → 400', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/update-display-name', {
      ...makeValidUpdateDisplayNamePostOptions(),
      body: `userId=${VALID_USER_ID}&displayName=${encodeURIComponent(' Leading')}`,
    })
    expect(res.status).toBe(400)
    expect(repo.updateDisplayNameCalls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// POST /admin/users/update-display-name — success
// ---------------------------------------------------------------------------

describe('admin-routes: POST /admin/users/update-display-name success', () => {
  it('valid request → 303 redirect to /admin/users', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    const res = await postAdmin(app, '/admin/users/update-display-name', makeValidUpdateDisplayNamePostOptions())
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/admin/users')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('updateDisplayName called with correct userId and displayName', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    await postAdmin(app, '/admin/users/update-display-name', makeValidUpdateDisplayNamePostOptions())
    expect(repo.updateDisplayNameCalls).toHaveLength(1)
    expect(repo.updateDisplayNameCalls[0]?.userId).toBe(VALID_USER_ID)
    expect(repo.updateDisplayNameCalls[0]?.displayName).toBe(VALID_DISPLAY_NAME)
  })

  it('updatedAt passed to repo is a canonical ISO timestamp', async () => {
    const repo = makeMutationUserRepo()
    const app = makeApp(goodAuth(), repo)
    await postAdmin(app, '/admin/users/update-display-name', makeValidUpdateDisplayNamePostOptions())
    const updatedAt = repo.updateDisplayNameCalls[0]?.updatedAt ?? ''
    expect(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(updatedAt)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// POST /admin/users/update-display-name — repo / clock errors
// ---------------------------------------------------------------------------

describe('admin-routes: POST /admin/users/update-display-name errors', () => {
  it('repo.updateDisplayName throws → 500 no-store', async () => {
    const app = makeApp(goodAuth(), makeThrowingUpdateDisplayNameRepo())
    const res = await postAdmin(app, '/admin/users/update-display-name', makeValidUpdateDisplayNamePostOptions())
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('clock throws → 500 no-store', async () => {
    const throwingClock = () => { throw new Error('clock exploded') }
    const app = makeApp(goodAuth(), makeMutationUserRepo(), undefined, undefined, throwingClock)
    const res = await postAdmin(app, '/admin/users/update-display-name', makeValidUpdateDisplayNamePostOptions())
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('500 body does not contain repo error detail', async () => {
    const app = makeApp(goodAuth(), makeThrowingUpdateDisplayNameRepo())
    const res = await postAdmin(app, '/admin/users/update-display-name', makeValidUpdateDisplayNamePostOptions())
    const body = await res.text()
    expect(body).not.toContain('D1 exploded')
  })
})

// ---------------------------------------------------------------------------
// GET /admin/permissions — assignment UI (select dropdowns)
// ---------------------------------------------------------------------------

const SAMPLE_ASSIGNMENT_USER_ENABLED = {
  id: 'user-opt-001',
  display_name: 'Alice Viewer',
  enabled: 1 as const,
}

const SAMPLE_ASSIGNMENT_USER_DISABLED = {
  id: 'user-opt-002',
  display_name: 'Bob Disabled',
  enabled: 0 as const,
}

const SAMPLE_ASSIGNMENT_ALBUM_ENABLED = {
  id: 'album-opt-001',
  title: 'Summer Trip',
  enabled: 1 as const,
}

const SAMPLE_ASSIGNMENT_ALBUM_DISABLED = {
  id: 'album-opt-002',
  title: 'Winter',
  enabled: 0 as const,
}

describe('admin-routes: GET /admin/permissions assignment UI', () => {
  it('renders <select name="albumId"> for grant form', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, makePermissionRepoWithOptions({}))
    const res = await getAdmin(app, { path: '/admin/permissions' })
    const body = await res.text()
    expect(body).toContain('name="albumId"')
    expect(body).toMatch(/<select[^>]*name="albumId"/)
  })

  it('renders <select name="userId"> for grant form', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, makePermissionRepoWithOptions({}))
    const res = await getAdmin(app, { path: '/admin/permissions' })
    const body = await res.text()
    expect(body).toContain('name="userId"')
    expect(body).toMatch(/<select[^>]*name="userId"/)
  })

  it('enabled album option renders album title', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, makePermissionRepoWithOptions({
      albums: [SAMPLE_ASSIGNMENT_ALBUM_ENABLED],
    }))
    const res = await getAdmin(app, { path: '/admin/permissions' })
    const body = await res.text()
    expect(body).toContain(SAMPLE_ASSIGNMENT_ALBUM_ENABLED.title)
  })

  it('disabled album option renders (無効) status badge', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, makePermissionRepoWithOptions({
      albums: [SAMPLE_ASSIGNMENT_ALBUM_DISABLED],
    }))
    const res = await getAdmin(app, { path: '/admin/permissions' })
    const body = await res.text()
    expect(body).toContain(SAMPLE_ASSIGNMENT_ALBUM_DISABLED.title)
    expect(body).toContain('無効')
  })

  it('enabled album does NOT show (無効) badge', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, makePermissionRepoWithOptions({
      albums: [SAMPLE_ASSIGNMENT_ALBUM_ENABLED],
      users: [],
    }))
    const res = await getAdmin(app, { path: '/admin/permissions' })
    const body = await res.text()
    expect(body).toContain(SAMPLE_ASSIGNMENT_ALBUM_ENABLED.title)
    expect(body).not.toContain('無効')
  })

  it('enabled user option renders display_name', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, makePermissionRepoWithOptions({
      users: [SAMPLE_ASSIGNMENT_USER_ENABLED],
    }))
    const res = await getAdmin(app, { path: '/admin/permissions' })
    const body = await res.text()
    expect(body).toContain(SAMPLE_ASSIGNMENT_USER_ENABLED.display_name)
  })

  it('disabled user option renders (無効) status badge', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, makePermissionRepoWithOptions({
      users: [SAMPLE_ASSIGNMENT_USER_DISABLED],
    }))
    const res = await getAdmin(app, { path: '/admin/permissions' })
    const body = await res.text()
    expect(body).toContain(SAMPLE_ASSIGNMENT_USER_DISABLED.display_name)
    expect(body).toContain('無効')
  })

  it('enabled user does NOT show (無効) badge', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, makePermissionRepoWithOptions({
      users: [SAMPLE_ASSIGNMENT_USER_ENABLED],
      albums: [],
    }))
    const res = await getAdmin(app, { path: '/admin/permissions' })
    const body = await res.text()
    expect(body).toContain(SAMPLE_ASSIGNMENT_USER_ENABLED.display_name)
    expect(body).not.toContain('無効')
  })

  it('does NOT render password_hash in options page', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, makePermissionRepoWithOptions({
      users: [SAMPLE_ASSIGNMENT_USER_ENABLED],
      albums: [SAMPLE_ASSIGNMENT_ALBUM_ENABLED],
    }))
    const res = await getAdmin(app, { path: '/admin/permissions' })
    const body = await res.text()
    expect(body).not.toContain('password_hash')
  })

  it('does NOT render photoprism_album_uid in options page', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, makePermissionRepoWithOptions({
      users: [SAMPLE_ASSIGNMENT_USER_ENABLED],
      albums: [SAMPLE_ASSIGNMENT_ALBUM_ENABLED],
    }))
    const res = await getAdmin(app, { path: '/admin/permissions' })
    const body = await res.text()
    expect(body).not.toContain('photoprism_album_uid')
  })
})

// ---------------------------------------------------------------------------
// GET /admin/albums — create form
// ---------------------------------------------------------------------------

describe('GET /admin/albums — create form presence', () => {
  it('form action="/admin/albums/create" is present', async () => {
    const app = makeApp(goodAuth(), undefined, makeEmptyAlbumRepo())
    const res = await getAdmin(app, { path: '/admin/albums' })
    const body = await res.text()
    expect(body).toContain('action="/admin/albums/create"')
  })

  it('input name="albumId" is present', async () => {
    const app = makeApp(goodAuth(), undefined, makeEmptyAlbumRepo())
    const res = await getAdmin(app, { path: '/admin/albums' })
    const body = await res.text()
    expect(body).toContain('name="albumId"')
  })

  it('input name="title" is present', async () => {
    const app = makeApp(goodAuth(), undefined, makeEmptyAlbumRepo())
    const res = await getAdmin(app, { path: '/admin/albums' })
    const body = await res.text()
    expect(body).toContain('name="title"')
  })

  it('input name="photoprismAlbumUid" is present', async () => {
    const app = makeApp(goodAuth(), undefined, makeEmptyAlbumRepo())
    const res = await getAdmin(app, { path: '/admin/albums' })
    const body = await res.text()
    expect(body).toContain('name="photoprismAlbumUid"')
  })

  it('input name="expiresAt" is present', async () => {
    const app = makeApp(goodAuth(), undefined, makeEmptyAlbumRepo())
    const res = await getAdmin(app, { path: '/admin/albums' })
    const body = await res.text()
    expect(body).toContain('name="expiresAt"')
  })

  it('select name="downloadEnabled" is present', async () => {
    const app = makeApp(goodAuth(), undefined, makeEmptyAlbumRepo())
    const res = await getAdmin(app, { path: '/admin/albums' })
    const body = await res.text()
    expect(body).toContain('name="downloadEnabled"')
  })

  it('create form is visible when album list is empty', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepo([]))
    const res = await getAdmin(app, { path: '/admin/albums' })
    const body = await res.text()
    expect(body).toContain('action="/admin/albums/create"')
    expect(body).toContain('アルバムがありません')
  })

  it('create form is visible when album list has items', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepo([SAMPLE_ALBUM]))
    const res = await getAdmin(app, { path: '/admin/albums' })
    const body = await res.text()
    expect(body).toContain('action="/admin/albums/create"')
    expect(body).toContain(SAMPLE_ALBUM.title)
  })

  it('create form does NOT render any stored photoprism_album_uid value', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepo([SAMPLE_ALBUM]))
    const res = await getAdmin(app, { path: '/admin/albums' })
    const body = await res.text()
    expect(body).not.toContain('photoprism_album_uid')
  })
})

// ---------------------------------------------------------------------------
// POST /admin/albums/create — guard
// ---------------------------------------------------------------------------

describe('admin-routes: POST /admin/albums/create guard', () => {
  it('no token → 403 no-store, createAlbum not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/create', {
      ...makeValidCreateAlbumPostOptions(),
      token: null,
    })
    expect(res.status).toBe(403)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(repo.createAlbumCalls).toHaveLength(0)
  })

  it('non-allowlisted email → 403, createAlbum not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(
      () => ({ verifier: async () => ({ email: 'other@example.com' }), allowlist: new Set([ADMIN_EMAIL]) }),
      undefined,
      repo,
    )
    const res = await postAdmin(app, '/admin/albums/create', makeValidCreateAlbumPostOptions())
    expect(res.status).toBe(403)
    expect(repo.createAlbumCalls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// POST /admin/albums/create — same-origin
// ---------------------------------------------------------------------------

describe('admin-routes: POST /admin/albums/create same-origin', () => {
  it('absent Origin → 403, createAlbum not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/create', {
      ...makeValidCreateAlbumPostOptions(),
      origin: undefined,
    })
    expect(res.status).toBe(403)
    expect(repo.createAlbumCalls).toHaveLength(0)
  })

  it('Origin = "null" → 403, createAlbum not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/create', {
      ...makeValidCreateAlbumPostOptions(),
      origin: 'null',
    })
    expect(res.status).toBe(403)
    expect(repo.createAlbumCalls).toHaveLength(0)
  })

  it('Origin mismatched → 403, createAlbum not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/create', {
      ...makeValidCreateAlbumPostOptions(),
      origin: 'https://evil.example',
    })
    expect(res.status).toBe(403)
    expect(repo.createAlbumCalls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// POST /admin/albums/create — content-type
// ---------------------------------------------------------------------------

describe('admin-routes: POST /admin/albums/create content-type', () => {
  it('Content-Type missing → 400 no-store, createAlbum not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/create', {
      ...makeValidCreateAlbumPostOptions(),
      contentType: undefined,
    })
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(repo.createAlbumCalls).toHaveLength(0)
  })

  it('Content-Type application/json → 400, createAlbum not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/create', {
      ...makeValidCreateAlbumPostOptions(),
      contentType: 'application/json',
    })
    expect(res.status).toBe(400)
    expect(repo.createAlbumCalls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// POST /admin/albums/create — body validation
// ---------------------------------------------------------------------------

describe('admin-routes: POST /admin/albums/create body validation', () => {
  it('missing albumId → 400, createAlbum not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/create', {
      ...makeValidCreateAlbumPostOptions(),
      body: `title=My+Album&photoprismAlbumUid=${VALID_ALBUM_UID}&expiresAt=&downloadEnabled=0`,
    })
    expect(res.status).toBe(400)
    expect(repo.createAlbumCalls).toHaveLength(0)
  })

  it('missing title → 400, createAlbum not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/create', {
      ...makeValidCreateAlbumPostOptions(),
      body: `albumId=${NEW_ALBUM_ID}&photoprismAlbumUid=${VALID_ALBUM_UID}&expiresAt=&downloadEnabled=0`,
    })
    expect(res.status).toBe(400)
    expect(repo.createAlbumCalls).toHaveLength(0)
  })

  it('missing photoprismAlbumUid → 400, createAlbum not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/create', {
      ...makeValidCreateAlbumPostOptions(),
      body: `albumId=${NEW_ALBUM_ID}&title=My+Album&expiresAt=&downloadEnabled=0`,
    })
    expect(res.status).toBe(400)
    expect(repo.createAlbumCalls).toHaveLength(0)
  })

  it('extra field → 400, createAlbum not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/create', {
      ...makeValidCreateAlbumPostOptions(),
      body: `${VALID_CREATE_ALBUM_BODY}&extra=value`,
    })
    expect(res.status).toBe(400)
    expect(repo.createAlbumCalls).toHaveLength(0)
  })

  it('repeated albumId → 400, createAlbum not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/create', {
      ...makeValidCreateAlbumPostOptions(),
      body: `albumId=${NEW_ALBUM_ID}&albumId=other-id&title=My+Album&photoprismAlbumUid=${VALID_ALBUM_UID}&expiresAt=&downloadEnabled=0`,
    })
    expect(res.status).toBe(400)
    expect(repo.createAlbumCalls).toHaveLength(0)
  })

  it('invalid albumId → 400, createAlbum not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/create', {
      ...makeValidCreateAlbumPostOptions(),
      body: `albumId=!bad!&title=My+Album&photoprismAlbumUid=${VALID_ALBUM_UID}&expiresAt=&downloadEnabled=0`,
    })
    expect(res.status).toBe(400)
    expect(repo.createAlbumCalls).toHaveLength(0)
  })

  it('empty title → 400, createAlbum not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/create', {
      ...makeValidCreateAlbumPostOptions(),
      body: `albumId=${NEW_ALBUM_ID}&title=&photoprismAlbumUid=${VALID_ALBUM_UID}&expiresAt=&downloadEnabled=0`,
    })
    expect(res.status).toBe(400)
    expect(repo.createAlbumCalls).toHaveLength(0)
  })

  it('title with leading space → 400, createAlbum not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/create', {
      ...makeValidCreateAlbumPostOptions(),
      body: `albumId=${NEW_ALBUM_ID}&title=+leading&photoprismAlbumUid=${VALID_ALBUM_UID}&expiresAt=&downloadEnabled=0`,
    })
    expect(res.status).toBe(400)
    expect(repo.createAlbumCalls).toHaveLength(0)
  })

  it('empty photoprismAlbumUid → 400, createAlbum not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/create', {
      ...makeValidCreateAlbumPostOptions(),
      body: `albumId=${NEW_ALBUM_ID}&title=My+Album&photoprismAlbumUid=&expiresAt=&downloadEnabled=0`,
    })
    expect(res.status).toBe(400)
    expect(repo.createAlbumCalls).toHaveLength(0)
  })

  it('photoprismAlbumUid with space → 400, createAlbum not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/create', {
      ...makeValidCreateAlbumPostOptions(),
      body: `albumId=${NEW_ALBUM_ID}&title=My+Album&photoprismAlbumUid=uid+space&expiresAt=&downloadEnabled=0`,
    })
    expect(res.status).toBe(400)
    expect(repo.createAlbumCalls).toHaveLength(0)
  })

  it('invalid expiresAt (non-canonical date) → 400, createAlbum not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/create', {
      ...makeValidCreateAlbumPostOptions(),
      body: `albumId=${NEW_ALBUM_ID}&title=My+Album&photoprismAlbumUid=${VALID_ALBUM_UID}&expiresAt=2027-01-01&downloadEnabled=0`,
    })
    expect(res.status).toBe(400)
    expect(repo.createAlbumCalls).toHaveLength(0)
  })

  it('invalid downloadEnabled ("2") → 400, createAlbum not called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/create', {
      ...makeValidCreateAlbumPostOptions(),
      body: `albumId=${NEW_ALBUM_ID}&title=My+Album&photoprismAlbumUid=${VALID_ALBUM_UID}&expiresAt=&downloadEnabled=2`,
    })
    expect(res.status).toBe(400)
    expect(repo.createAlbumCalls).toHaveLength(0)
  })

  it('clock not called when body is invalid', async () => {
    const spy = makeClockSpy()
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo, undefined, spy.clock)
    await postAdmin(app, '/admin/albums/create', {
      ...makeValidCreateAlbumPostOptions(),
      body: `albumId=!bad!&title=My+Album&photoprismAlbumUid=${VALID_ALBUM_UID}&expiresAt=&downloadEnabled=0`,
    })
    expect(spy.getCallCount()).toBe(0)
    expect(repo.createAlbumCalls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// POST /admin/albums/create — success
// ---------------------------------------------------------------------------

describe('admin-routes: POST /admin/albums/create success', () => {
  it('valid request → 303 Location /admin/albums no-store', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/create', makeValidCreateAlbumPostOptions())
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/admin/albums')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('valid request → empty body', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const res = await postAdmin(app, '/admin/albums/create', makeValidCreateAlbumPostOptions())
    const body = await res.text()
    expect(body).toBe('')
  })

  it('createAlbum called once with correct albumId, title, uid', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    await postAdmin(app, '/admin/albums/create', makeValidCreateAlbumPostOptions())
    expect(repo.createAlbumCalls).toHaveLength(1)
    expect(repo.createAlbumCalls[0]!.albumId).toBe(NEW_ALBUM_ID)
    expect(repo.createAlbumCalls[0]!.title).toBe('My New Album')
    expect(repo.createAlbumCalls[0]!.photoprismAlbumUid).toBe(VALID_ALBUM_UID)
  })

  it('createAlbum called with expiresAt null when empty string', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    await postAdmin(app, '/admin/albums/create', makeValidCreateAlbumPostOptions())
    expect(repo.createAlbumCalls[0]!.expiresAt).toBeNull()
  })

  it('createAlbum called with downloadEnabled 0', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    await postAdmin(app, '/admin/albums/create', makeValidCreateAlbumPostOptions())
    expect(repo.createAlbumCalls[0]!.downloadEnabled).toBe(0)
  })

  it('createAlbum called with downloadEnabled 1 when "1" submitted', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    await postAdmin(app, '/admin/albums/create', {
      ...makeValidCreateAlbumPostOptions(),
      body: `albumId=${NEW_ALBUM_ID}&title=My+New+Album&photoprismAlbumUid=${VALID_ALBUM_UID}&expiresAt=&downloadEnabled=1`,
    })
    expect(repo.createAlbumCalls[0]!.downloadEnabled).toBe(1)
  })

  it('createdAt and updatedAt are canonical ISO timestamps from clock', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    await postAdmin(app, '/admin/albums/create', makeValidCreateAlbumPostOptions())
    expect(repo.createAlbumCalls[0]!.createdAt).toBe(NOW_TS)
    expect(repo.createAlbumCalls[0]!.updatedAt).toBe(NOW_TS)
  })

  it('expiresAt non-empty canonical ISO → passed through to repo', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo)
    const iso = '2027-06-01T00:00:00.000Z'
    await postAdmin(app, '/admin/albums/create', {
      ...makeValidCreateAlbumPostOptions(),
      body: `albumId=${NEW_ALBUM_ID}&title=My+New+Album&photoprismAlbumUid=${VALID_ALBUM_UID}&expiresAt=${encodeURIComponent(iso)}&downloadEnabled=0`,
    })
    expect(repo.createAlbumCalls[0]!.expiresAt).toBe(iso)
  })
})

// ---------------------------------------------------------------------------
// POST /admin/albums/create — errors
// ---------------------------------------------------------------------------

describe('admin-routes: POST /admin/albums/create errors', () => {
  it('repo throws → 500 no-store', async () => {
    const app = makeApp(goodAuth(), undefined, makeThrowingCreateAlbumRepo())
    const res = await postAdmin(app, '/admin/albums/create', makeValidCreateAlbumPostOptions())
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('repo throws → generic body, no submitted values reflected', async () => {
    const app = makeApp(goodAuth(), undefined, makeThrowingCreateAlbumRepo())
    const res = await postAdmin(app, '/admin/albums/create', makeValidCreateAlbumPostOptions())
    const body = await res.text()
    expect(body).toBe('Internal Server Error')
    expect(body).not.toContain(NEW_ALBUM_ID)
    expect(body).not.toContain(VALID_ALBUM_UID)
    expect(body).not.toContain('My New Album')
  })

  it('clock throws → 500 no-store, createAlbum NOT called', async () => {
    const repo = makeMutationAlbumRepo()
    const app = makeApp(goodAuth(), undefined, repo, undefined, () => {
      throw new Error('clock detail must not escape')
    })
    const res = await postAdmin(app, '/admin/albums/create', makeValidCreateAlbumPostOptions())
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.text()).toBe('Internal Server Error')
    expect(repo.createAlbumCalls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// POST /admin/albums/sync-target-upsert
// ---------------------------------------------------------------------------

const VALID_CATALOG_ID = 'a'.repeat(64)
const SYNC_TARGET_ALBUM_ID = 'ise-ryokou-id'
const VALID_UPSERT_BODY = `albumId=${SYNC_TARGET_ALBUM_ID}&catalogId=${VALID_CATALOG_ID}`

function makeValidSyncTargetUpsertOptions() {
  return {
    token: VALID_TOKEN as string | null,
    origin: VALID_ORIGIN as string | undefined,
    contentType: 'application/x-www-form-urlencoded' as string | undefined,
    body: VALID_UPSERT_BODY as string | undefined,
  }
}

function makeAlbumRepoWithSync(album: AlbumForSync | null): AlbumRepo {
  return {
    listAlbums: async () => ({ albums: [], hasMore: false }),
    setAlbumEnabled: async () => {},
    updatePublicMetadata: async () => {},
    createAlbum: async () => {},
    getAlbumForSync: async () => album,
  }
}

function makeThrowingGetAlbumForSyncRepo(): AlbumRepo {
  return {
    listAlbums: async () => ({ albums: [], hasMore: false }),
    setAlbumEnabled: async () => {},
    updatePublicMetadata: async () => {},
    createAlbum: async () => {},
    getAlbumForSync: async () => { throw new Error('D1 exploded') },
  }
}

const SAMPLE_ALBUM_FOR_SYNC: AlbumForSync = {
  id: SYNC_TARGET_ALBUM_ID,
  title: 'Ise ryokou',
  expires_at: null,
  download_enabled: 0,
}

describe('admin-routes: POST /admin/albums/sync-target-upsert guard', () => {
  it('no token → 403 Forbidden no-store', async () => {
    const app = makeApp(goodAuth())
    const res = await postAdmin(app, '/admin/albums/sync-target-upsert', {
      ...makeValidSyncTargetUpsertOptions(),
      token: null,
    })
    await assertForbidden(res)
  })

  it('Origin absent → 403', async () => {
    const app = makeApp(goodAuth())
    const res = await postAdmin(app, '/admin/albums/sync-target-upsert', {
      ...makeValidSyncTargetUpsertOptions(),
      origin: undefined,
    })
    await assertForbidden(res)
  })
})

describe('admin-routes: POST /admin/albums/sync-target-upsert content-type', () => {
  it('Content-Type missing → 400 no-store', async () => {
    const app = makeApp(goodAuth())
    const res = await postAdmin(app, '/admin/albums/sync-target-upsert', {
      ...makeValidSyncTargetUpsertOptions(),
      contentType: undefined,
    })
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})

describe('admin-routes: POST /admin/albums/sync-target-upsert body validation', () => {
  it('missing albumId → 400 no-store', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepoWithSync(SAMPLE_ALBUM_FOR_SYNC))
    const res = await postAdmin(app, '/admin/albums/sync-target-upsert', {
      ...makeValidSyncTargetUpsertOptions(),
      body: `catalogId=${VALID_CATALOG_ID}`,
    })
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('missing catalogId → 400 no-store', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepoWithSync(SAMPLE_ALBUM_FOR_SYNC))
    const res = await postAdmin(app, '/admin/albums/sync-target-upsert', {
      ...makeValidSyncTargetUpsertOptions(),
      body: `albumId=${SYNC_TARGET_ALBUM_ID}`,
    })
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('invalid albumId → 400 no-store', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepoWithSync(SAMPLE_ALBUM_FOR_SYNC))
    const res = await postAdmin(app, '/admin/albums/sync-target-upsert', {
      ...makeValidSyncTargetUpsertOptions(),
      body: `albumId=!bad!&catalogId=${VALID_CATALOG_ID}`,
    })
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('invalid catalogId (not 64 hex) → 400 no-store', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepoWithSync(SAMPLE_ALBUM_FOR_SYNC))
    const res = await postAdmin(app, '/admin/albums/sync-target-upsert', {
      ...makeValidSyncTargetUpsertOptions(),
      body: `albumId=${SYNC_TARGET_ALBUM_ID}&catalogId=tooshort`,
    })
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('catalogId with uppercase → 400 no-store', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepoWithSync(SAMPLE_ALBUM_FOR_SYNC))
    const res = await postAdmin(app, '/admin/albums/sync-target-upsert', {
      ...makeValidSyncTargetUpsertOptions(),
      body: `albumId=${SYNC_TARGET_ALBUM_ID}&catalogId=${'A'.repeat(64)}`,
    })
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('extra field → 400 no-store', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepoWithSync(SAMPLE_ALBUM_FOR_SYNC))
    const res = await postAdmin(app, '/admin/albums/sync-target-upsert', {
      ...makeValidSyncTargetUpsertOptions(),
      body: `${VALID_UPSERT_BODY}&extra=val`,
    })
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})

describe('admin-routes: POST /admin/albums/sync-target-upsert success', () => {
  it('success → 303 to /admin/albums', async () => {
    const targetRepo = makeCapturingSyncTargetRepo()
    const app = makeApp(goodAuth(), undefined, makeAlbumRepoWithSync(SAMPLE_ALBUM_FOR_SYNC), undefined, undefined, undefined, undefined, undefined, targetRepo)
    const res = await postAdmin(app, '/admin/albums/sync-target-upsert', makeValidSyncTargetUpsertOptions())
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/admin/albums')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('success → upsertTarget called with correct albumId and catalogId', async () => {
    const targetRepo = makeCapturingSyncTargetRepo()
    const app = makeApp(goodAuth(), undefined, makeAlbumRepoWithSync(SAMPLE_ALBUM_FOR_SYNC), undefined, undefined, undefined, undefined, undefined, targetRepo)
    await postAdmin(app, '/admin/albums/sync-target-upsert', makeValidSyncTargetUpsertOptions())
    expect(targetRepo.upsertCalls).toHaveLength(1)
    expect(targetRepo.upsertCalls[0]!.albumId).toBe(SYNC_TARGET_ALBUM_ID)
    expect(targetRepo.upsertCalls[0]!.catalogId).toBe(VALID_CATALOG_ID)
  })

  it('success → upsertTarget called with D1 album title', async () => {
    const targetRepo = makeCapturingSyncTargetRepo()
    const app = makeApp(goodAuth(), undefined, makeAlbumRepoWithSync(SAMPLE_ALBUM_FOR_SYNC), undefined, undefined, undefined, undefined, undefined, targetRepo)
    await postAdmin(app, '/admin/albums/sync-target-upsert', makeValidSyncTargetUpsertOptions())
    expect(targetRepo.upsertCalls[0]!.title).toBe('Ise ryokou')
  })

  it('success → photoprism_album_uid never appears in body or upsert args', async () => {
    const targetRepo = makeCapturingSyncTargetRepo()
    const app = makeApp(goodAuth(), undefined, makeAlbumRepoWithSync(SAMPLE_ALBUM_FOR_SYNC), undefined, undefined, undefined, undefined, undefined, targetRepo)
    const res = await postAdmin(app, '/admin/albums/sync-target-upsert', makeValidSyncTargetUpsertOptions())
    const body = await res.text()
    expect(body).not.toContain('photoprism')
    const call = targetRepo.upsertCalls[0]!
    expect(JSON.stringify(call)).not.toContain('uid')
  })
})

describe('admin-routes: POST /admin/albums/sync-target-upsert errors', () => {
  it('unknown album (getAlbumForSync returns null) → 500 no-store', async () => {
    const targetRepo = makeCapturingSyncTargetRepo()
    const app = makeApp(goodAuth(), undefined, makeAlbumRepoWithSync(null), undefined, undefined, undefined, undefined, undefined, targetRepo)
    const res = await postAdmin(app, '/admin/albums/sync-target-upsert', makeValidSyncTargetUpsertOptions())
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(targetRepo.upsertCalls).toHaveLength(0)
  })

  it('D1 throws → 500 no-store, upsertTarget not called', async () => {
    const targetRepo = makeCapturingSyncTargetRepo()
    const app = makeApp(goodAuth(), undefined, makeThrowingGetAlbumForSyncRepo(), undefined, undefined, undefined, undefined, undefined, targetRepo)
    const res = await postAdmin(app, '/admin/albums/sync-target-upsert', makeValidSyncTargetUpsertOptions())
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.text()).toBe('Internal Server Error')
    expect(targetRepo.upsertCalls).toHaveLength(0)
  })

  it('R2 repo throws → 500 no-store', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepoWithSync(SAMPLE_ALBUM_FOR_SYNC), undefined, undefined, undefined, undefined, undefined, makeThrowingSyncTargetRepo())
    const res = await postAdmin(app, '/admin/albums/sync-target-upsert', makeValidSyncTargetUpsertOptions())
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.text()).toBe('Internal Server Error')
  })

  it('clock throws → 500 no-store, upsertTarget not called', async () => {
    const targetRepo = makeCapturingSyncTargetRepo()
    const app = makeApp(goodAuth(), undefined, makeAlbumRepoWithSync(SAMPLE_ALBUM_FOR_SYNC), undefined, () => { throw new Error('clock detail') }, undefined, undefined, undefined, targetRepo)
    const res = await postAdmin(app, '/admin/albums/sync-target-upsert', makeValidSyncTargetUpsertOptions())
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.text()).toBe('Internal Server Error')
    expect(targetRepo.upsertCalls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// POST /admin/albums/sync-target-remove
// ---------------------------------------------------------------------------

const VALID_REMOVE_BODY = `albumId=${SYNC_TARGET_ALBUM_ID}`

function makeValidSyncTargetRemoveOptions() {
  return {
    token: VALID_TOKEN as string | null,
    origin: VALID_ORIGIN as string | undefined,
    contentType: 'application/x-www-form-urlencoded' as string | undefined,
    body: VALID_REMOVE_BODY as string | undefined,
  }
}

describe('admin-routes: POST /admin/albums/sync-target-remove guard', () => {
  it('no token → 403 Forbidden no-store', async () => {
    const app = makeApp(goodAuth())
    const res = await postAdmin(app, '/admin/albums/sync-target-remove', {
      ...makeValidSyncTargetRemoveOptions(),
      token: null,
    })
    await assertForbidden(res)
  })

  it('Origin absent → 403', async () => {
    const app = makeApp(goodAuth())
    const res = await postAdmin(app, '/admin/albums/sync-target-remove', {
      ...makeValidSyncTargetRemoveOptions(),
      origin: undefined,
    })
    await assertForbidden(res)
  })
})

describe('admin-routes: POST /admin/albums/sync-target-remove content-type', () => {
  it('Content-Type missing → 400 no-store', async () => {
    const app = makeApp(goodAuth())
    const res = await postAdmin(app, '/admin/albums/sync-target-remove', {
      ...makeValidSyncTargetRemoveOptions(),
      contentType: undefined,
    })
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})

describe('admin-routes: POST /admin/albums/sync-target-remove body validation', () => {
  it('missing albumId → 400 no-store', async () => {
    const app = makeApp(goodAuth())
    const res = await postAdmin(app, '/admin/albums/sync-target-remove', {
      ...makeValidSyncTargetRemoveOptions(),
      body: 'extra=val',
    })
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('invalid albumId → 400 no-store', async () => {
    const app = makeApp(goodAuth())
    const res = await postAdmin(app, '/admin/albums/sync-target-remove', {
      ...makeValidSyncTargetRemoveOptions(),
      body: 'albumId=!bad!',
    })
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('extra field → 400 no-store', async () => {
    const app = makeApp(goodAuth())
    const res = await postAdmin(app, '/admin/albums/sync-target-remove', {
      ...makeValidSyncTargetRemoveOptions(),
      body: `${VALID_REMOVE_BODY}&extra=val`,
    })
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})

describe('admin-routes: POST /admin/albums/sync-target-remove success', () => {
  it('success → 303 to /admin/albums', async () => {
    const targetRepo = makeCapturingSyncTargetRepo()
    const app = makeApp(goodAuth(), undefined, undefined, undefined, undefined, undefined, undefined, undefined, targetRepo)
    const res = await postAdmin(app, '/admin/albums/sync-target-remove', makeValidSyncTargetRemoveOptions())
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/admin/albums')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('success → removeTarget called with albumId', async () => {
    const targetRepo = makeCapturingSyncTargetRepo()
    const app = makeApp(goodAuth(), undefined, undefined, undefined, undefined, undefined, undefined, undefined, targetRepo)
    await postAdmin(app, '/admin/albums/sync-target-remove', makeValidSyncTargetRemoveOptions())
    expect(targetRepo.removeCalls).toHaveLength(1)
    expect(targetRepo.removeCalls[0]!.albumId).toBe(SYNC_TARGET_ALBUM_ID)
  })
})

describe('admin-routes: POST /admin/albums/sync-target-remove errors', () => {
  it('R2 repo throws → 500 no-store', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, undefined, undefined, undefined, undefined, undefined, makeThrowingSyncTargetRepo())
    const res = await postAdmin(app, '/admin/albums/sync-target-remove', makeValidSyncTargetRemoveOptions())
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.text()).toBe('Internal Server Error')
  })

  it('clock throws → 500 no-store, removeTarget not called', async () => {
    const targetRepo = makeCapturingSyncTargetRepo()
    const app = makeApp(goodAuth(), undefined, undefined, undefined, () => { throw new Error('clock') }, undefined, undefined, undefined, targetRepo)
    const res = await postAdmin(app, '/admin/albums/sync-target-remove', makeValidSyncTargetRemoveOptions())
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(targetRepo.removeCalls).toHaveLength(0)
  })
})

describe('admin-routes: GET /admin/albums sync-target form rendering', () => {
  it('album rows include sync-target-upsert form', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepo([SAMPLE_ALBUM]))
    const res = await getAdmin(app, { path: '/admin/albums' })
    const html = await res.text()
    expect(html).toContain('sync-target-upsert')
  })

  it('album rows include sync-target-remove form', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepo([SAMPLE_ALBUM]))
    const res = await getAdmin(app, { path: '/admin/albums' })
    const html = await res.text()
    expect(html).toContain('sync-target-remove')
  })

  it('catalogId field is rendered per album row', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepo([SAMPLE_ALBUM]))
    const res = await getAdmin(app, { path: '/admin/albums' })
    const html = await res.text()
    expect(html).toContain('catalogId')
  })

  it('sync-target forms do not render photoprism_album_uid', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepo([SAMPLE_ALBUM]))
    const res = await getAdmin(app, { path: '/admin/albums' })
    const html = await res.text()
    // The sync-target forms must not expose raw UIDs; the existing create form
    // legitimately has a photoprismAlbumUid field (non-goal in A2 handoff).
    // We check that the sync-target form section has no uid leak.
    const syncTargetSection = html.slice(html.indexOf('sync-target-upsert'))
    expect(syncTargetSection).not.toContain('photoprism_album_uid')
  })
})

// ---------------------------------------------------------------------------
// GET /admin/albums — catalog picker rendering
// ---------------------------------------------------------------------------

const CATALOG_ENTRY: CatalogEntry = {
  catalogId: VALID_CATALOG_ID,
  title: 'Ise Ryokou',
  photoCount: 42,
  updatedAt: '2026-06-29T12:00:00Z',
}

function makeAvailableCatalogRepo(entries: CatalogEntry[]): CatalogRepo {
  return {
    getCatalog: async () => ({
      status: 'available',
      publishedAt: '2026-06-29T12:00:00Z',
      albums: entries,
    }),
    hasCatalogId: async (id) => entries.some(e => e.catalogId === id),
  }
}

describe('admin-routes: GET /admin/albums catalog picker', () => {
  it('catalog available with entries → renders select name="catalogId"', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepo([SAMPLE_ALBUM]), undefined, undefined, undefined, undefined, undefined, undefined, makeAvailableCatalogRepo([CATALOG_ENTRY]))
    const res = await getAdmin(app, { path: '/admin/albums' })
    const html = await res.text()
    expect(html).toContain('name="catalogId"')
    expect(html).toContain('<select')
  })

  it('catalog available → renders catalog entry title in option', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepo([SAMPLE_ALBUM]), undefined, undefined, undefined, undefined, undefined, undefined, makeAvailableCatalogRepo([CATALOG_ENTRY]))
    const res = await getAdmin(app, { path: '/admin/albums' })
    const html = await res.text()
    expect(html).toContain('Ise Ryokou')
  })

  it('catalog available → renders catalogId as option value', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepo([SAMPLE_ALBUM]), undefined, undefined, undefined, undefined, undefined, undefined, makeAvailableCatalogRepo([CATALOG_ENTRY]))
    const res = await getAdmin(app, { path: '/admin/albums' })
    const html = await res.text()
    expect(html).toContain(VALID_CATALOG_ID)
  })

  it('catalog available → renders photoCount in option label', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepo([SAMPLE_ALBUM]), undefined, undefined, undefined, undefined, undefined, undefined, makeAvailableCatalogRepo([CATALOG_ENTRY]))
    const res = await getAdmin(app, { path: '/admin/albums' })
    const html = await res.text()
    expect(html).toContain('42')
  })

  it('catalog available, photoCount null → renders 不明', async () => {
    const entry: CatalogEntry = { ...CATALOG_ENTRY, photoCount: null }
    const app = makeApp(goodAuth(), undefined, makeAlbumRepo([SAMPLE_ALBUM]), undefined, undefined, undefined, undefined, undefined, undefined, makeAvailableCatalogRepo([entry]))
    const res = await getAdmin(app, { path: '/admin/albums' })
    const html = await res.text()
    expect(html).toContain('不明')
  })

  it('catalog available → does not render photoprism or token strings', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepo([SAMPLE_ALBUM]), undefined, undefined, undefined, undefined, undefined, undefined, makeAvailableCatalogRepo([CATALOG_ENTRY]))
    const res = await getAdmin(app, { path: '/admin/albums' })
    const html = await res.text()
    const syncSection = html.slice(html.indexOf('sync-target-upsert'))
    expect(syncSection).not.toContain('photoprism_album_uid')
    expect(syncSection).not.toContain('token')
    expect(syncSection).not.toContain('secret')
  })

  it('catalog missing → 200 with カタログ未取得 message', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepo([SAMPLE_ALBUM]), undefined, undefined, undefined, undefined, undefined, undefined, makeMissingCatalogRepo())
    const res = await getAdmin(app, { path: '/admin/albums' })
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('カタログ未取得')
  })

  it('catalog missing → no select element in sync-target section', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepo([SAMPLE_ALBUM]), undefined, undefined, undefined, undefined, undefined, undefined, makeMissingCatalogRepo())
    const res = await getAdmin(app, { path: '/admin/albums' })
    const html = await res.text()
    const syncSection = html.slice(html.indexOf('sync-target-upsert'))
    expect(syncSection).not.toContain('<select')
  })

  it('catalog available but empty → renders カタログ未取得', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepo([SAMPLE_ALBUM]), undefined, undefined, undefined, undefined, undefined, undefined, makeAvailableCatalogRepo([]))
    const res = await getAdmin(app, { path: '/admin/albums' })
    const html = await res.text()
    expect(html).toContain('カタログ未取得')
  })

  it('catalog getCatalog throws → 500 no-store', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepo([SAMPLE_ALBUM]), undefined, undefined, undefined, undefined, undefined, undefined, makeThrowingCatalogRepo())
    const res = await getAdmin(app, { path: '/admin/albums' })
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('catalog getCatalog throws → no error detail in body', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepo([SAMPLE_ALBUM]), undefined, undefined, undefined, undefined, undefined, undefined, makeThrowingCatalogRepo())
    const res = await getAdmin(app, { path: '/admin/albums' })
    const body = await res.text()
    expect(body).not.toContain('R2 exploded')
    expect(body).toBe('Internal Server Error')
  })

  it('listAlbums throws → 500 before catalog is read', async () => {
    const app = makeApp(goodAuth(), undefined, makeThrowingAlbumRepo(), undefined, undefined, undefined, undefined, undefined, undefined, makeThrowingCatalogRepo())
    const res = await getAdmin(app, { path: '/admin/albums' })
    expect(res.status).toBe(500)
  })
})

// ---------------------------------------------------------------------------
// POST /admin/albums/sync-target-upsert — catalog check
// ---------------------------------------------------------------------------

function makeAlbumRepoWithSyncSpy(album: AlbumForSync | null): { repo: AlbumRepo; callCount: () => number } {
  let count = 0
  const repo: AlbumRepo = {
    listAlbums: async () => ({ albums: [], hasMore: false }),
    setAlbumEnabled: async () => {},
    updatePublicMetadata: async () => {},
    createAlbum: async () => {},
    getAlbumForSync: async () => { count++; return album },
  }
  return { repo, callCount: () => count }
}

describe('admin-routes: POST /admin/albums/sync-target-upsert catalog check', () => {
  it('catalogId absent from catalog → 400 no-store', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepoWithSync(SAMPLE_ALBUM_FOR_SYNC), undefined, undefined, undefined, undefined, undefined, undefined, makeAbsentCatalogRepo())
    const res = await postAdmin(app, '/admin/albums/sync-target-upsert', makeValidSyncTargetUpsertOptions())
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('catalogId absent → clock not called', async () => {
    const { clock, getCallCount } = makeClockSpy()
    const app = makeApp(goodAuth(), undefined, makeAlbumRepoWithSync(SAMPLE_ALBUM_FOR_SYNC), undefined, clock, undefined, undefined, undefined, undefined, makeAbsentCatalogRepo())
    await postAdmin(app, '/admin/albums/sync-target-upsert', makeValidSyncTargetUpsertOptions())
    expect(getCallCount()).toBe(0)
  })

  it('catalogId absent → getAlbumForSync not called', async () => {
    const spy = makeAlbumRepoWithSyncSpy(SAMPLE_ALBUM_FOR_SYNC)
    const app = makeApp(goodAuth(), undefined, spy.repo, undefined, undefined, undefined, undefined, undefined, undefined, makeAbsentCatalogRepo())
    await postAdmin(app, '/admin/albums/sync-target-upsert', makeValidSyncTargetUpsertOptions())
    expect(spy.callCount()).toBe(0)
  })

  it('catalogId absent → upsertTarget not called', async () => {
    const targetRepo = makeCapturingSyncTargetRepo()
    const app = makeApp(goodAuth(), undefined, makeAlbumRepoWithSync(SAMPLE_ALBUM_FOR_SYNC), undefined, undefined, undefined, undefined, undefined, targetRepo, makeAbsentCatalogRepo())
    await postAdmin(app, '/admin/albums/sync-target-upsert', makeValidSyncTargetUpsertOptions())
    expect(targetRepo.upsertCalls).toHaveLength(0)
  })

  it('catalog missing (hasCatalogId throws) → 500 no-store', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepoWithSync(SAMPLE_ALBUM_FOR_SYNC), undefined, undefined, undefined, undefined, undefined, undefined, makeMissingCatalogRepo())
    const res = await postAdmin(app, '/admin/albums/sync-target-upsert', makeValidSyncTargetUpsertOptions())
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('catalog missing → clock not called', async () => {
    const { clock, getCallCount } = makeClockSpy()
    const app = makeApp(goodAuth(), undefined, makeAlbumRepoWithSync(SAMPLE_ALBUM_FOR_SYNC), undefined, clock, undefined, undefined, undefined, undefined, makeMissingCatalogRepo())
    await postAdmin(app, '/admin/albums/sync-target-upsert', makeValidSyncTargetUpsertOptions())
    expect(getCallCount()).toBe(0)
  })

  it('catalog missing → upsertTarget not called', async () => {
    const targetRepo = makeCapturingSyncTargetRepo()
    const app = makeApp(goodAuth(), undefined, makeAlbumRepoWithSync(SAMPLE_ALBUM_FOR_SYNC), undefined, undefined, undefined, undefined, undefined, targetRepo, makeMissingCatalogRepo())
    await postAdmin(app, '/admin/albums/sync-target-upsert', makeValidSyncTargetUpsertOptions())
    expect(targetRepo.upsertCalls).toHaveLength(0)
  })

  it('catalog throws → 500 no-store, body sanitized', async () => {
    const app = makeApp(goodAuth(), undefined, makeAlbumRepoWithSync(SAMPLE_ALBUM_FOR_SYNC), undefined, undefined, undefined, undefined, undefined, undefined, makeThrowingCatalogRepo())
    const res = await postAdmin(app, '/admin/albums/sync-target-upsert', makeValidSyncTargetUpsertOptions())
    expect(res.status).toBe(500)
    expect(await res.text()).toBe('Internal Server Error')
  })
})

// ---------------------------------------------------------------------------
// GET /admin/r2-cleanup
// ---------------------------------------------------------------------------

describe('admin-routes: GET /admin/r2-cleanup', () => {
  it('returns 200 with Cache-Control: no-store', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, makeR2CleanupRepo())
    const res = await getAdmin(app, { path: '/admin/r2-cleanup' })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('returns 403 when unauthenticated', async () => {
    const app = makeApp(() => null, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, makeR2CleanupRepo())
    const res = await getAdmin(app, { path: '/admin/r2-cleanup', token: null })
    await assertForbidden(res)
  })

  it('returns 500 with no-store when repo throws', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, makeThrowingR2CleanupRepo())
    const res = await getAdmin(app, { path: '/admin/r2-cleanup' })
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('500 body is generic and contains no internal details', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, makeThrowingR2CleanupRepo())
    const res = await getAdmin(app, { path: '/admin/r2-cleanup' })
    const body = await res.text()
    expect(body).toBe('Internal Server Error')
  })

  it('success body contains no mutation form (method=post)', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, makeR2CleanupRepo())
    const res = await getAdmin(app, { path: '/admin/r2-cleanup' })
    const body = await res.text()
    expect(body.toLowerCase()).not.toContain('method="post"')
  })

  it('success body contains no delete form or control', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, makeR2CleanupRepo())
    const res = await getAdmin(app, { path: '/admin/r2-cleanup' })
    const body = await res.text()
    expect(body.toLowerCase()).not.toContain('delete')
  })

  it('success body renders album IDs', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, makeR2CleanupRepo())
    const res = await getAdmin(app, { path: '/admin/r2-cleanup' })
    const body = await res.text()
    expect(body).toContain('album-sample-001')
    expect(body).toContain('album-sample-002')
  })

  it('success body does not contain bucket name, PhotoPrism, or R2 credentials', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, makeR2CleanupRepo())
    const res = await getAdmin(app, { path: '/admin/r2-cleanup' })
    const body = await res.text()
    expect(body).not.toContain('PHOTO_BUCKET')
    expect(body).not.toContain('photoprism')
    expect(body).not.toContain('r2.cloudflarestorage')
  })

  it('shows truncation notice when report is truncated', async () => {
    const truncatedReport: AdminR2CleanupReport = { ...SAMPLE_R2_CLEANUP_REPORT, truncated: true }
    const app = makeApp(goodAuth(), undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, makeR2CleanupRepo(truncatedReport))
    const res = await getAdmin(app, { path: '/admin/r2-cleanup' })
    const body = await res.text()
    expect(body).toContain('切り詰め')
  })

  it('POST /admin/r2-cleanup returns 404 (no mutation route)', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, makeR2CleanupRepo())
    const res = await app.request(
      '/admin/r2-cleanup',
      { method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': VALID_TOKEN } },
      {} as unknown as Parameters<typeof app.request>[2],
    )
    expect(res.status).toBe(404)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('GET /admin home page now contains link to /admin/r2-cleanup', async () => {
    const app = makeApp(goodAuth(), undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, makeR2CleanupRepo())
    const res = await getAdmin(app)
    const body = await res.text()
    expect(body).toContain('/admin/r2-cleanup')
  })
})
