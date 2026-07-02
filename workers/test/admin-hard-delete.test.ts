import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { createAdminRoutes } from '../src/routes/admin.js'
import type { AdminAuthConfig } from '../src/types/admin-auth.js'
import type { Env } from '../src/types/env.js'
import { signHardDeleteToken, HARD_DELETE_TOKEN_TTL_MS } from '../src/services/admin-hard-delete-token.js'

const ADMIN_EMAIL = 'admin@example.com'
const VALID_TOKEN = 'valid-test-token'
const VALID_HMAC_KEY = 'hard-delete-hmac-key-0000000000000'
const SHORT_HMAC_KEY = 'short'
const NOW_TS = '2026-07-02T00:00:00.000Z'
const NOW_MS = new Date(NOW_TS).valueOf()

const USER = { id: 'user-sample-001', display_name: 'Alice', enabled: 1 as const }
const ALBUM = { id: 'album-sample-001', title: 'Summer Trip', enabled: 0 as const }

type ResolveAuth = (env: Env) => AdminAuthConfig | null
type UserRepo = {
  getUserForHardDelete(userId: string): Promise<typeof USER | null>
  deleteUser(userId: string): Promise<void>
  deleteCalls: string[]
}
type AlbumRepo = {
  getAlbumForHardDelete(albumId: string): Promise<typeof ALBUM | null>
  deleteCalls: string[]
}

function goodAuth(): ResolveAuth {
  return () => ({
    verifier: async () => ({ email: ADMIN_EMAIL }),
    allowlist: new Set([ADMIN_EMAIL]),
  })
}

function makeUserRepo(user: typeof USER | null = USER): UserRepo {
  const deleteCalls: string[] = []
  return {
    getUserForHardDelete: async () => user,
    deleteUser: async (userId) => { deleteCalls.push(userId) },
    deleteCalls,
  }
}

function makeAlbumRepo(album: typeof ALBUM | null = ALBUM): AlbumRepo {
  return { getAlbumForHardDelete: async () => album, deleteCalls: [] }
}

function makeThrowingUserRepo(): UserRepo {
  return {
    getUserForHardDelete: async () => { throw new Error('password_hash must not escape') },
    deleteUser: async () => { throw new Error('delete must not run') },
    deleteCalls: [],
  }
}

function makeThrowingAlbumRepo(): AlbumRepo {
  return {
    getAlbumForHardDelete: async () => { throw new Error('photoprism_album_uid must not escape') },
    deleteCalls: [],
  }
}

function makeThrowingDeleteUserRepo(): UserRepo {
  const deleteCalls: string[] = []
  return {
    getUserForHardDelete: async () => USER,
    deleteUser: async (userId) => {
      deleteCalls.push(userId)
      throw new Error('D1 delete failed with password_hash detail')
    },
    deleteCalls,
  }
}

function makeApp(
  resolveAuth: ResolveAuth,
  userRepo: UserRepo = makeUserRepo(),
  albumRepo: AlbumRepo = makeAlbumRepo(),
): Hono {
  const app = new Hono()
  app.route(
    '/admin',
    createAdminRoutes(resolveAuth, () => ({
      userRepo: {
        listUsers: async () => ({ users: [], hasMore: false }),
        setUserEnabled: async () => {},
        createUser: async () => {},
        resetPassword: async () => {},
        updateDisplayName: async () => {},
        getUserForHardDelete: userRepo.getUserForHardDelete,
        deleteUser: userRepo.deleteUser,
      },
      albumRepo: {
        listAlbums: async () => ({ albums: [], hasMore: false }),
        setAlbumEnabled: async () => {},
        updatePublicMetadata: async () => {},
        createAlbum: async () => {},
        getAlbumForSync: async () => null,
        getAlbumForHardDelete: albumRepo.getAlbumForHardDelete,
      },
      permissionRepo: {
        listAssignmentOptions: async () => ({ users: [], albums: [], permissions: [], hasMore: false }),
        grantPermission: async () => {},
        revokePermission: async () => {},
      },
      clock: () => new Date(NOW_TS),
      opsRepo: { getSummary: async () => ({ generatedAt: NOW_TS, users: { total: 0, enabled: 0, disabled: 0, locked: 0 }, albums: { total: 0, enabled: 0, disabled: 0, expired: 0, expiringSoon: 0, downloadable: 0 }, permissions: { total: 0 }, sessions: { total: 0, expired: 0 } }) },
      syncStatusRepo: { getStatus: async () => ({ status: 'missing' as const }) },
      syncRequestRepo: { writeRequest: async () => {}, getPendingRequest: async () => ({ status: 'missing' as const }) },
      syncTargetRepo: { upsertTarget: async () => {}, removeTarget: async () => {} },
      catalogRepo: { getCatalog: async () => ({ status: 'missing' as const }), hasCatalogId: async () => false },
      r2CleanupRepo: { getReport: async () => ({ albums: [], malformedCount: 0, malformedBytes: 0, excludedOpsCount: 0, truncated: false }) },
    })),
  )
  return app
}

type PostOptions = {
  token?: string | null
  origin?: string | undefined
  contentType?: string | undefined
  body?: string | undefined
}

function postAdmin(
  app: Hono,
  path: string,
  options: PostOptions,
  env: { HARD_DELETE_HMAC_KEY?: string } = { HARD_DELETE_HMAC_KEY: VALID_HMAC_KEY },
): Promise<Response> {
  const headers: Record<string, string> = {}
  if (options.token !== null) headers['Cf-Access-Jwt-Assertion'] = options.token ?? VALID_TOKEN
  if (options.origin !== undefined) headers['Origin'] = options.origin
  if (options.contentType !== undefined) headers['Content-Type'] = options.contentType
  return Promise.resolve(
    app.request(path, { method: 'POST', headers, body: options.body ?? null }, env as Env),
  )
}

function validConfirmBody(kind: 'user' | 'album'): string {
  return kind === 'user' ? `userId=${USER.id}` : `albumId=${ALBUM.id}`
}

function validPostOptions(kind: 'user' | 'album'): PostOptions {
  return {
    origin: 'http://localhost',
    contentType: 'application/x-www-form-urlencoded',
    body: validConfirmBody(kind),
  }
}

async function buildToken(kind: 'user' | 'album', opts: { expired?: boolean; wrongCategory?: boolean } = {}): Promise<string> {
  const issuedAt = opts.expired ? NOW_MS - HARD_DELETE_TOKEN_TTL_MS - 1 : NOW_MS
  const category = opts.wrongCategory
    ? (kind === 'user' ? 'album-delete' : 'user-delete')
    : (kind === 'user' ? 'user-delete' : 'album-delete')
  return signHardDeleteToken(VALID_HMAC_KEY, {
    schema: 1,
    issuedAt,
    expiresAt: issuedAt + HARD_DELETE_TOKEN_TTL_MS,
    category,
    targetId: kind === 'user' ? USER.id : ALBUM.id,
  })
}

async function assertForbidden(res: Response): Promise<void> {
  expect(res.status).toBe(403)
  expect(res.headers.get('cache-control')).toBe('no-store')
  expect(await res.text()).toBe('Forbidden')
}

describe('admin hard delete confirm routes', () => {
  it('requires admin auth', async () => {
    const res = await postAdmin(makeApp(goodAuth()), '/admin/users/confirm-delete', {
      ...validPostOptions('user'),
      token: null,
    })
    await assertForbidden(res)
  })

  it('requires same-origin Origin', async () => {
    const res = await postAdmin(makeApp(goodAuth()), '/admin/users/confirm-delete', {
      ...validPostOptions('user'),
      origin: 'http://evil.example',
    })
    await assertForbidden(res)
  })

  it('rejects wrong content-type and invalid fields', async () => {
    const userRepo = makeUserRepo()
    const app = makeApp(goodAuth(), userRepo)
    const wrongType = await postAdmin(app, '/admin/users/confirm-delete', {
      ...validPostOptions('user'),
      contentType: 'application/json',
    })
    expect(wrongType.status).toBe(400)
    expect(wrongType.headers.get('cache-control')).toBe('no-store')

    const extra = await postAdmin(app, '/admin/users/confirm-delete', {
      ...validPostOptions('user'),
      body: `${validConfirmBody('user')}&extra=1`,
    })
    expect(extra.status).toBe(400)
    expect(extra.headers.get('cache-control')).toBe('no-store')
  })

  it('fails closed when HARD_DELETE_HMAC_KEY is missing or short', async () => {
    const userRepo = makeUserRepo()
    const app = makeApp(goodAuth(), userRepo)
    const missing = await postAdmin(app, '/admin/users/confirm-delete', validPostOptions('user'), {})
    expect(missing.status).toBe(500)
    expect(await missing.text()).toBe('Internal Server Error')

    const short = await postAdmin(app, '/admin/users/confirm-delete', validPostOptions('user'), {
      HARD_DELETE_HMAC_KEY: SHORT_HMAC_KEY,
    })
    expect(short.status).toBe(500)
    expect(await short.text()).toBe('Internal Server Error')
  })

  it('renders user confirmation page with allowed summary only', async () => {
    const res = await postAdmin(makeApp(goodAuth()), '/admin/users/confirm-delete', validPostOptions('user'))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = await res.text()
    expect(body).toContain(USER.id)
    expect(body).toContain(USER.display_name)
    expect(body).toContain('DELETE USER')
    expect(body).toContain('action="/admin/users/delete"')
    expect(body).not.toContain('password_hash')
    expect(body).not.toContain('photoprism_album_uid')
  })

  it('renders album confirmation page with allowed summary only', async () => {
    const res = await postAdmin(makeApp(goodAuth()), '/admin/albums/confirm-delete', validPostOptions('album'))
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain(ALBUM.id)
    expect(body).toContain(ALBUM.title)
    expect(body).toContain('DELETE ALBUM')
    expect(body).toContain('action="/admin/albums/delete"')
    expect(body).not.toContain('photoprism_album_uid')
    expect(body).not.toContain('ops/sync-targets.json')
  })

  it('missing targets render sanitized page without delete form', async () => {
    const res = await postAdmin(
      makeApp(goodAuth(), makeUserRepo(null)),
      '/admin/users/confirm-delete',
      validPostOptions('user'),
    )
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('対象は見つかりませんでした')
    expect(body).not.toContain('action="/admin/users/delete"')
  })

  it('repository errors return sanitized 500', async () => {
    const res = await postAdmin(
      makeApp(goodAuth(), makeThrowingUserRepo()),
      '/admin/users/confirm-delete',
      validPostOptions('user'),
    )
    expect(res.status).toBe(500)
    expect(await res.text()).toBe('Internal Server Error')
  })
})

describe('admin hard delete preview routes', () => {
  it('requires the exact phrase and does not delete', async () => {
    const userRepo = makeUserRepo()
    const token = await buildToken('user')
    const res = await postAdmin(makeApp(goodAuth(), userRepo), '/admin/users/delete', {
      origin: 'http://localhost',
      contentType: 'application/x-www-form-urlencoded',
      body: new URLSearchParams({ token, phrase: 'delete user' }).toString(),
    })
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(userRepo.deleteCalls).toHaveLength(0)
  })

  it('rejects malformed, expired, and wrong-category tokens', async () => {
    const userRepo = makeUserRepo()
    const app = makeApp(goodAuth(), userRepo)
    for (const token of ['bad-token', await buildToken('user', { expired: true }), await buildToken('user', { wrongCategory: true })]) {
      const res = await postAdmin(app, '/admin/users/delete', {
        origin: 'http://localhost',
        contentType: 'application/x-www-form-urlencoded',
        body: new URLSearchParams({ token, phrase: 'DELETE USER' }).toString(),
      })
      expect(res.status).toBe(400)
      expect(res.headers.get('cache-control')).toBe('no-store')
    }
    expect(userRepo.deleteCalls).toHaveLength(0)
  })

  it('re-reads target, deletes the user once, and returns the completed page', async () => {
    const userRepo = makeUserRepo()
    const albumRepo = makeAlbumRepo()
    const token = await buildToken('user')
    const res = await postAdmin(makeApp(goodAuth(), userRepo, albumRepo), '/admin/users/delete', {
      origin: 'http://localhost',
      contentType: 'application/x-www-form-urlencoded',
      body: new URLSearchParams({ token, phrase: 'DELETE USER' }).toString(),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = await res.text()
    expect(body).toContain('User hard delete completed')
    expect(body).toContain(USER.id)
    expect(body).toContain(USER.display_name)
    expect(body).toContain('enabled')
    expect(body).toContain('Sessions and album permissions are removed by the existing D1 foreign-key cascade')
    expect(userRepo.deleteCalls).toEqual([USER.id])
    expect(albumRepo.deleteCalls).toHaveLength(0)
    expect(body).not.toContain('password_hash')
    expect(body).not.toContain('token_hash')
    expect(body).not.toContain('photoprism_album_uid')
    expect(body).not.toContain('albums/')
    expect(body).not.toContain('DELETE FROM')
  })

  it('does not delete when the user target is missing at delete time', async () => {
    const userRepo = makeUserRepo(null)
    const token = await buildToken('user')
    const res = await postAdmin(makeApp(goodAuth(), userRepo), '/admin/users/delete', {
      origin: 'http://localhost',
      contentType: 'application/x-www-form-urlencoded',
      body: new URLSearchParams({ token, phrase: 'DELETE USER' }).toString(),
    })
    expect(res.status).toBe(200)
    expect(userRepo.deleteCalls).toHaveLength(0)
    const body = await res.text()
    expect(body).toContain('対象は見つかりませんでした')
    expect(body).not.toContain('DELETE FROM')
  })

  it('returns sanitized 500 when user delete fails', async () => {
    const userRepo = makeThrowingDeleteUserRepo()
    const token = await buildToken('user')
    const res = await postAdmin(makeApp(goodAuth(), userRepo), '/admin/users/delete', {
      origin: 'http://localhost',
      contentType: 'application/x-www-form-urlencoded',
      body: new URLSearchParams({ token, phrase: 'DELETE USER' }).toString(),
    })
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.text()).toBe('Internal Server Error')
    expect(userRepo.deleteCalls).toEqual([USER.id])
  })

  it('missing or short HMAC key does not delete', async () => {
    const userRepo = makeUserRepo()
    const token = await buildToken('user')
    const body = new URLSearchParams({ token, phrase: 'DELETE USER' }).toString()

    const missing = await postAdmin(makeApp(goodAuth(), userRepo), '/admin/users/delete', {
      origin: 'http://localhost',
      contentType: 'application/x-www-form-urlencoded',
      body,
    }, {})
    expect(missing.status).toBe(500)

    const short = await postAdmin(makeApp(goodAuth(), userRepo), '/admin/users/delete', {
      origin: 'http://localhost',
      contentType: 'application/x-www-form-urlencoded',
      body,
    }, { HARD_DELETE_HMAC_KEY: SHORT_HMAC_KEY })
    expect(short.status).toBe(500)
    expect(userRepo.deleteCalls).toHaveLength(0)
  })

  it('album delete remains preview-only and does not call user delete', async () => {
    const userRepo = makeUserRepo()
    const albumRepo = makeAlbumRepo()
    const token = await buildToken('album')
    const res = await postAdmin(makeApp(goodAuth(), userRepo, albumRepo), '/admin/albums/delete', {
      origin: 'http://localhost',
      contentType: 'application/x-www-form-urlencoded',
      body: new URLSearchParams({ token, phrase: 'DELETE ALBUM' }).toString(),
    })
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('実際の hard delete はこの Phase 2 では有効化されていません')
    expect(body).toContain(ALBUM.id)
    expect(userRepo.deleteCalls).toHaveLength(0)
    expect(albumRepo.deleteCalls).toHaveLength(0)
    expect(body).not.toContain('photoprism_album_uid')
  })

  it('returns sanitized missing-target page after valid token and phrase', async () => {
    const token = await buildToken('album')
    const res = await postAdmin(
      makeApp(goodAuth(), makeUserRepo(), makeAlbumRepo(null)),
      '/admin/albums/delete',
      {
        origin: 'http://localhost',
        contentType: 'application/x-www-form-urlencoded',
        body: new URLSearchParams({ token, phrase: 'DELETE ALBUM' }).toString(),
      },
    )
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('対象は見つかりませんでした')
    expect(body).not.toContain('DELETE FROM')
  })

  it('repository errors return sanitized 500', async () => {
    const token = await buildToken('album')
    const res = await postAdmin(
      makeApp(goodAuth(), makeUserRepo(), makeThrowingAlbumRepo()),
      '/admin/albums/delete',
      {
        origin: 'http://localhost',
        contentType: 'application/x-www-form-urlencoded',
        body: new URLSearchParams({ token, phrase: 'DELETE ALBUM' }).toString(),
      },
    )
    expect(res.status).toBe(500)
    expect(await res.text()).toBe('Internal Server Error')
  })
})
