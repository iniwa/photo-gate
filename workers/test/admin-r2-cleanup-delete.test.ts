import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { createAdminRoutes } from '../src/routes/admin.js'
import type { AdminAuthConfig } from '../src/types/admin-auth.js'
import type { Env } from '../src/types/env.js'
import type { AdminR2CleanupReport } from '../src/types/admin-r2-cleanup.js'

function strToBase64url(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}
import {
  signCleanupToken,
  computeOrphanFingerprint,
  R2_CLEANUP_TOKEN_TTL_MS,
  type CleanupTokenPayload,
} from '../src/services/admin-r2-cleanup-delete-token.js'
import {
  R2_CLEANUP_CONFIRM_MAX_ORPHAN_PREFIXES,
  R2_CLEANUP_CONFIRM_MAX_OBJECTS,
} from '../src/routes/admin-r2-cleanup-delete.js'

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = 'admin@example.com'
const VALID_TOKEN = 'valid-test-token'
const VALID_HMAC_KEY = 'test-hmac-key-0000000000000000000' // 35 chars, > 32
const SHORT_HMAC_KEY = 'short' // < 32 chars

const NOW_TS = '2026-06-30T12:00:00.000Z'
const NOW_MS = new Date(NOW_TS).valueOf()

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORPHAN_ENTRY_1: AdminR2CleanupReport['albums'][0] = {
  albumId: 'album-orphan-001',
  category: 'orphan',
  objectCount: 3,
  totalBytes: 1024,
}

const ORPHAN_ENTRY_2: AdminR2CleanupReport['albums'][0] = {
  albumId: 'album-orphan-002',
  category: 'orphan',
  objectCount: 2,
  totalBytes: 512,
}

const ACTIVE_ENTRY: AdminR2CleanupReport['albums'][0] = {
  albumId: 'album-active-001',
  category: 'owned-active',
  objectCount: 5,
  totalBytes: 2048,
}

const REPORT_WITH_ORPHANS: AdminR2CleanupReport = {
  albums: [ORPHAN_ENTRY_1, ORPHAN_ENTRY_2, ACTIVE_ENTRY],
  malformedCount: 0,
  malformedBytes: 0,
  excludedOpsCount: 1,
  truncated: false,
}

const REPORT_NO_ORPHANS: AdminR2CleanupReport = {
  albums: [ACTIVE_ENTRY],
  malformedCount: 0,
  malformedBytes: 0,
  excludedOpsCount: 0,
  truncated: false,
}

const REPORT_TRUNCATED: AdminR2CleanupReport = {
  ...REPORT_WITH_ORPHANS,
  truncated: true,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ResolveAuth = (env: Env) => AdminAuthConfig | null

function goodAuth(): ResolveAuth {
  return () => ({
    verifier: async () => ({ email: ADMIN_EMAIL }),
    allowlist: new Set([ADMIN_EMAIL]),
  })
}

type R2CleanupRepo = { getReport(): Promise<AdminR2CleanupReport> }

function makeR2CleanupRepo(report: AdminR2CleanupReport = REPORT_WITH_ORPHANS): R2CleanupRepo {
  return { getReport: async () => report }
}

function makeThrowingR2CleanupRepo(): R2CleanupRepo {
  return {
    getReport: async () => {
      throw new Error('R2 exploded')
    },
  }
}

function makeApp(resolveAuth: ResolveAuth, r2CleanupRepo?: R2CleanupRepo): Hono {
  const app = new Hono()
  app.route(
    '/admin',
    createAdminRoutes(resolveAuth, () => ({
      userRepo: { listUsers: async () => ({ users: [], hasMore: false }), setUserEnabled: async () => {}, createUser: async () => {}, resetPassword: async () => {}, updateDisplayName: async () => {} },
      albumRepo: { listAlbums: async () => ({ albums: [], hasMore: false }), setAlbumEnabled: async () => {}, updatePublicMetadata: async () => {}, createAlbum: async () => {}, getAlbumForSync: async () => null },
      permissionRepo: { listAssignmentOptions: async () => ({ users: [], albums: [], permissions: [], hasMore: false }), grantPermission: async () => {}, revokePermission: async () => {} },
      clock: () => new Date(NOW_TS),
      opsRepo: { getSummary: async () => ({ generatedAt: NOW_TS, users: { total: 0, enabled: 0, disabled: 0, locked: 0 }, albums: { total: 0, enabled: 0, disabled: 0, expired: 0, expiringSoon: 0, downloadable: 0 }, permissions: { total: 0 }, sessions: { total: 0, expired: 0 } }) },
      syncStatusRepo: { getStatus: async () => ({ status: 'missing' as const }) },
      syncRequestRepo: { writeRequest: async () => {}, getPendingRequest: async () => ({ status: 'missing' as const }) },
      syncTargetRepo: { upsertTarget: async () => {}, removeTarget: async () => {} },
      catalogRepo: { getCatalog: async () => ({ status: 'missing' as const }), hasCatalogId: async () => false },
      r2CleanupRepo: r2CleanupRepo ?? makeR2CleanupRepo(),
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

type TestEnv = { R2_CLEANUP_HMAC_KEY?: string }

function postR2CleanupConfirm(
  app: Hono,
  options: PostOptions = {},
  env: TestEnv = { R2_CLEANUP_HMAC_KEY: VALID_HMAC_KEY },
): Promise<Response> {
  return postR2CleanupRoute(app, '/admin/r2-cleanup/confirm', options, env)
}

function postR2CleanupDelete(
  app: Hono,
  options: PostOptions = {},
  env: TestEnv = { R2_CLEANUP_HMAC_KEY: VALID_HMAC_KEY },
): Promise<Response> {
  return postR2CleanupRoute(app, '/admin/r2-cleanup/delete', options, env)
}

function postR2CleanupRoute(
  app: Hono,
  path: string,
  options: PostOptions,
  env: TestEnv,
): Promise<Response> {
  const { token = VALID_TOKEN, origin, contentType, body } = options
  const headers: Record<string, string> = {}
  if (token !== null) headers['Cf-Access-Jwt-Assertion'] = token
  if (origin !== undefined) headers['Origin'] = origin
  if (contentType !== undefined) headers['Content-Type'] = contentType
  return Promise.resolve(
    app.request(
      path,
      { method: 'POST', headers, body: body ?? null },
      env as unknown as Parameters<typeof app.request>[2],
    ),
  )
}

async function assertForbidden(res: Response): Promise<void> {
  expect(res.status).toBe(403)
  expect(res.headers.get('cache-control')).toBe('no-store')
  const body = await res.text()
  expect(body).toBe('Forbidden')
}

const VALID_CONFIRM_OPTIONS: PostOptions = {
  origin: 'http://localhost',
  contentType: 'application/x-www-form-urlencoded',
  body: '',
}

/** Build a signed delete token from a given report using the test HMAC key. */
async function buildValidToken(
  report: AdminR2CleanupReport = REPORT_WITH_ORPHANS,
  opts: { expired?: boolean } = {},
): Promise<string> {
  const orphanEntries = report.albums
    .filter((e) => e.category === 'orphan')
    .map((e) => ({ albumId: e.albumId, objectCount: e.objectCount, totalBytes: e.totalBytes }))
  const fingerprint = await computeOrphanFingerprint(orphanEntries)
  const issuedAt = opts.expired ? NOW_MS - R2_CLEANUP_TOKEN_TTL_MS - 1 : NOW_MS
  const expiresAt = issuedAt + R2_CLEANUP_TOKEN_TTL_MS
  const payload: CleanupTokenPayload = {
    schema: 1,
    issuedAt,
    expiresAt,
    category: 'orphan',
    fingerprint,
    orphanPrefixCount: orphanEntries.length,
    orphanObjectCount: orphanEntries.reduce((s, e) => s + e.objectCount, 0),
  }
  return signCleanupToken(VALID_HMAC_KEY, payload)
}

function buildDeleteBody(token: string, phrase = 'DELETE ORPHANS'): string {
  return new URLSearchParams({ token, phrase }).toString()
}

// ---------------------------------------------------------------------------
// POST /admin/r2-cleanup/confirm — guard
// ---------------------------------------------------------------------------

describe('admin-routes: POST /admin/r2-cleanup/confirm guard', () => {
  it('no auth token → 403', async () => {
    const app = makeApp(goodAuth())
    const res = await postR2CleanupConfirm(app, { ...VALID_CONFIRM_OPTIONS, token: null })
    await assertForbidden(res)
  })

  it('non-allowlisted email → 403', async () => {
    const app = makeApp(() => ({
      verifier: async () => ({ email: 'other@example.com' }),
      allowlist: new Set([ADMIN_EMAIL]),
    }))
    const res = await postR2CleanupConfirm(app, VALID_CONFIRM_OPTIONS)
    await assertForbidden(res)
  })

  it('Origin absent → 403', async () => {
    const app = makeApp(goodAuth())
    const res = await postR2CleanupConfirm(app, { ...VALID_CONFIRM_OPTIONS, origin: undefined })
    await assertForbidden(res)
  })

  it('Origin = "null" → 403', async () => {
    const app = makeApp(goodAuth())
    const res = await postR2CleanupConfirm(app, { ...VALID_CONFIRM_OPTIONS, origin: 'null' })
    await assertForbidden(res)
  })

  it('Origin mismatched → 403', async () => {
    const app = makeApp(goodAuth())
    const res = await postR2CleanupConfirm(app, {
      ...VALID_CONFIRM_OPTIONS,
      origin: 'https://evil.example',
    })
    await assertForbidden(res)
  })
})

// ---------------------------------------------------------------------------
// POST /admin/r2-cleanup/confirm — content-type and body validation
// ---------------------------------------------------------------------------

describe('admin-routes: POST /admin/r2-cleanup/confirm body validation', () => {
  it('no Content-Type → 400 no-store', async () => {
    const app = makeApp(goodAuth())
    const res = await postR2CleanupConfirm(app, {
      ...VALID_CONFIRM_OPTIONS,
      contentType: undefined,
    })
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('wrong Content-Type → 400 no-store', async () => {
    const app = makeApp(goodAuth())
    const res = await postR2CleanupConfirm(app, {
      ...VALID_CONFIRM_OPTIONS,
      contentType: 'application/json',
    })
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('body with extra field → 400 no-store', async () => {
    const app = makeApp(goodAuth())
    const res = await postR2CleanupConfirm(app, {
      ...VALID_CONFIRM_OPTIONS,
      body: 'extra=field',
    })
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})

// ---------------------------------------------------------------------------
// POST /admin/r2-cleanup/confirm — HMAC key validation
// ---------------------------------------------------------------------------

describe('admin-routes: POST /admin/r2-cleanup/confirm HMAC key', () => {
  it('missing HMAC key (env undefined) → 500 no-store', async () => {
    const app = makeApp(goodAuth())
    const res = await postR2CleanupConfirm(app, VALID_CONFIRM_OPTIONS, {})
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.text()).toBe('Internal Server Error')
  })

  it('too-short HMAC key → 500 no-store', async () => {
    const app = makeApp(goodAuth())
    const res = await postR2CleanupConfirm(app, VALID_CONFIRM_OPTIONS, {
      R2_CLEANUP_HMAC_KEY: SHORT_HMAC_KEY,
    })
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.text()).toBe('Internal Server Error')
  })
})

// ---------------------------------------------------------------------------
// POST /admin/r2-cleanup/confirm — report handling
// ---------------------------------------------------------------------------

describe('admin-routes: POST /admin/r2-cleanup/confirm report handling', () => {
  it('repo throws → 500 no-store', async () => {
    const app = makeApp(goodAuth(), makeThrowingR2CleanupRepo())
    const res = await postR2CleanupConfirm(app, VALID_CONFIRM_OPTIONS)
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.text()).toBe('Internal Server Error')
  })

  it('report truncated → 400 no-store', async () => {
    const app = makeApp(goodAuth(), makeR2CleanupRepo(REPORT_TRUNCATED))
    const res = await postR2CleanupConfirm(app, VALID_CONFIRM_OPTIONS)
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('too many orphan prefixes → 400 no-store', async () => {
    const manyOrphans: AdminR2CleanupReport['albums'] = Array.from(
      { length: R2_CLEANUP_CONFIRM_MAX_ORPHAN_PREFIXES + 1 },
      (_, i) => ({
        albumId: `album-orphan-${String(i).padStart(3, '0')}`,
        category: 'orphan' as const,
        objectCount: 1,
        totalBytes: 100,
      }),
    )
    const app = makeApp(
      goodAuth(),
      makeR2CleanupRepo({ ...REPORT_WITH_ORPHANS, albums: manyOrphans }),
    )
    const res = await postR2CleanupConfirm(app, VALID_CONFIRM_OPTIONS)
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('too many total objects → 400 no-store', async () => {
    const hugeOrphan: AdminR2CleanupReport['albums'][0] = {
      albumId: 'album-huge-001',
      category: 'orphan',
      objectCount: R2_CLEANUP_CONFIRM_MAX_OBJECTS + 1,
      totalBytes: 1,
    }
    const app = makeApp(
      goodAuth(),
      makeR2CleanupRepo({ ...REPORT_WITH_ORPHANS, albums: [hugeOrphan] }),
    )
    const res = await postR2CleanupConfirm(app, VALID_CONFIRM_OPTIONS)
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})

// ---------------------------------------------------------------------------
// POST /admin/r2-cleanup/confirm — success
// ---------------------------------------------------------------------------

describe('admin-routes: POST /admin/r2-cleanup/confirm success', () => {
  it('returns 200 no-store HTML page', async () => {
    const app = makeApp(goodAuth())
    const res = await postR2CleanupConfirm(app, VALID_CONFIRM_OPTIONS)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('content-type')).toContain('text/html')
  })

  it('page contains orphan prefix count', async () => {
    const app = makeApp(goodAuth())
    const res = await postR2CleanupConfirm(app, VALID_CONFIRM_OPTIONS)
    const body = await res.text()
    expect(body).toContain('2') // 2 orphan prefixes in REPORT_WITH_ORPHANS
  })

  it('page contains token hidden field (opaque)', async () => {
    const app = makeApp(goodAuth())
    const res = await postR2CleanupConfirm(app, VALID_CONFIRM_OPTIONS)
    const body = await res.text()
    expect(body).toContain('name="token"')
    expect(body).toContain('type="hidden"')
  })

  it('page contains delete form submitting to /admin/r2-cleanup/delete', async () => {
    const app = makeApp(goodAuth())
    const res = await postR2CleanupConfirm(app, VALID_CONFIRM_OPTIONS)
    const body = await res.text()
    expect(body).toContain('action="/admin/r2-cleanup/delete"')
  })

  it('page contains phrase input and confirmation instruction', async () => {
    const app = makeApp(goodAuth())
    const res = await postR2CleanupConfirm(app, VALID_CONFIRM_OPTIONS)
    const body = await res.text()
    expect(body).toContain('name="phrase"')
    expect(body).toContain('DELETE ORPHANS')
  })

  it('uses the admin danger surface while keeping R2 deletion preview-only', async () => {
    const app = makeApp(goodAuth())
    const body = await (await postR2CleanupConfirm(app, VALID_CONFIRM_OPTIONS)).text()
    expect(body).toContain('class="admin-area-chip"')
    expect(body).toContain('class="admin-main"')
    expect(body).toContain('admin-danger-panel')
    expect(body).toContain('class="admin-table-scroll"')
    expect(body).toContain('R2 オブジェクトは削除されません')
    expect(body).not.toContain('src="/app.js"')
  })

  it('page does not contain R2 bucket name, full object keys, or PhotoPrism data', async () => {
    const app = makeApp(goodAuth())
    const res = await postR2CleanupConfirm(app, VALID_CONFIRM_OPTIONS)
    const body = await res.text()
    expect(body).not.toContain('PHOTO_BUCKET')
    expect(body).not.toContain('photoprism')
    expect(body).not.toContain('r2.cloudflarestorage')
    // album IDs are not rendered on the confirm page (only counts)
    expect(body).not.toContain('album-orphan-001')
    expect(body).not.toContain('album-orphan-002')
  })

  it('works when report has zero orphans (empty candidate set)', async () => {
    const app = makeApp(goodAuth(), makeR2CleanupRepo(REPORT_NO_ORPHANS))
    const res = await postR2CleanupConfirm(app, VALID_CONFIRM_OPTIONS)
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('name="token"')
  })
})

// ---------------------------------------------------------------------------
// POST /admin/r2-cleanup/delete — guard
// ---------------------------------------------------------------------------

describe('admin-routes: POST /admin/r2-cleanup/delete guard', () => {
  it('no auth token → 403', async () => {
    const app = makeApp(goodAuth())
    const res = await postR2CleanupDelete(app, { ...VALID_CONFIRM_OPTIONS, token: null })
    await assertForbidden(res)
  })

  it('Origin absent → 403', async () => {
    const app = makeApp(goodAuth())
    const res = await postR2CleanupDelete(app, {
      ...VALID_CONFIRM_OPTIONS,
      origin: undefined,
      body: buildDeleteBody('some-token'),
    })
    await assertForbidden(res)
  })

  it('Origin mismatched → 403', async () => {
    const app = makeApp(goodAuth())
    const res = await postR2CleanupDelete(app, {
      ...VALID_CONFIRM_OPTIONS,
      origin: 'https://evil.example',
      body: buildDeleteBody('some-token'),
    })
    await assertForbidden(res)
  })
})

// ---------------------------------------------------------------------------
// POST /admin/r2-cleanup/delete — content-type and body validation
// ---------------------------------------------------------------------------

describe('admin-routes: POST /admin/r2-cleanup/delete body validation', () => {
  it('no Content-Type → 400 no-store', async () => {
    const app = makeApp(goodAuth())
    const res = await postR2CleanupDelete(app, {
      ...VALID_CONFIRM_OPTIONS,
      contentType: undefined,
      body: buildDeleteBody('some-token'),
    })
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('wrong Content-Type → 400 no-store', async () => {
    const app = makeApp(goodAuth())
    const res = await postR2CleanupDelete(app, {
      ...VALID_CONFIRM_OPTIONS,
      contentType: 'application/json',
      body: JSON.stringify({ token: 'x', phrase: 'DELETE ORPHANS' }),
    })
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('body missing token field → 400', async () => {
    const app = makeApp(goodAuth())
    const res = await postR2CleanupDelete(app, {
      ...VALID_CONFIRM_OPTIONS,
      body: new URLSearchParams({ phrase: 'DELETE ORPHANS' }).toString(),
    })
    expect(res.status).toBe(400)
  })

  it('body missing phrase field → 400', async () => {
    const app = makeApp(goodAuth())
    const res = await postR2CleanupDelete(app, {
      ...VALID_CONFIRM_OPTIONS,
      body: new URLSearchParams({ token: 'some-token' }).toString(),
    })
    expect(res.status).toBe(400)
  })

  it('body has extra field → 400', async () => {
    const app = makeApp(goodAuth())
    const res = await postR2CleanupDelete(app, {
      ...VALID_CONFIRM_OPTIONS,
      body: new URLSearchParams({ token: 'x', phrase: 'DELETE ORPHANS', extra: 'bad' }).toString(),
    })
    expect(res.status).toBe(400)
  })

  it('empty body → 400', async () => {
    const app = makeApp(goodAuth())
    const res = await postR2CleanupDelete(app, { ...VALID_CONFIRM_OPTIONS, body: '' })
    expect(res.status).toBe(400)
  })

  it('wrong phrase → 400', async () => {
    const app = makeApp(goodAuth())
    const res = await postR2CleanupDelete(app, {
      ...VALID_CONFIRM_OPTIONS,
      body: buildDeleteBody('any-token', 'WRONG PHRASE'),
    })
    expect(res.status).toBe(400)
  })

  it('phrase with wrong case → 400', async () => {
    const app = makeApp(goodAuth())
    const res = await postR2CleanupDelete(app, {
      ...VALID_CONFIRM_OPTIONS,
      body: buildDeleteBody('any-token', 'delete orphans'),
    })
    expect(res.status).toBe(400)
  })

  it('token field is empty string → 400', async () => {
    const app = makeApp(goodAuth())
    const res = await postR2CleanupDelete(app, {
      ...VALID_CONFIRM_OPTIONS,
      body: buildDeleteBody('', 'DELETE ORPHANS'),
    })
    expect(res.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// POST /admin/r2-cleanup/delete — HMAC key validation
// ---------------------------------------------------------------------------

describe('admin-routes: POST /admin/r2-cleanup/delete HMAC key', () => {
  it('missing HMAC key (env undefined) → 500', async () => {
    const app = makeApp(goodAuth())
    const res = await postR2CleanupDelete(
      app,
      { ...VALID_CONFIRM_OPTIONS, body: buildDeleteBody('any-token') },
      {},
    )
    expect(res.status).toBe(500)
    expect(await res.text()).toBe('Internal Server Error')
  })

  it('too-short HMAC key → 500', async () => {
    const app = makeApp(goodAuth())
    const res = await postR2CleanupDelete(
      app,
      { ...VALID_CONFIRM_OPTIONS, body: buildDeleteBody('any-token') },
      { R2_CLEANUP_HMAC_KEY: SHORT_HMAC_KEY },
    )
    expect(res.status).toBe(500)
  })
})

// ---------------------------------------------------------------------------
// POST /admin/r2-cleanup/delete — token validation
// ---------------------------------------------------------------------------

describe('admin-routes: POST /admin/r2-cleanup/delete token validation', () => {
  it('malformed token (no dot) → 400', async () => {
    const app = makeApp(goodAuth())
    const res = await postR2CleanupDelete(app, {
      ...VALID_CONFIRM_OPTIONS,
      body: buildDeleteBody('nodothere'),
    })
    expect(res.status).toBe(400)
  })

  it('expired token → 400', async () => {
    const token = await buildValidToken(REPORT_WITH_ORPHANS, { expired: true })
    const app = makeApp(goodAuth())
    const res = await postR2CleanupDelete(app, {
      ...VALID_CONFIRM_OPTIONS,
      body: buildDeleteBody(token),
    })
    expect(res.status).toBe(400)
  })

  it('tampered token (payload changed) → 400', async () => {
    const token = await buildValidToken()
    const [, sigPart] = token.split('.')
    const tamperedPayloadB64 = strToBase64url(
      JSON.stringify({
        schema: 1,
        issuedAt: NOW_MS,
        expiresAt: NOW_MS + R2_CLEANUP_TOKEN_TTL_MS,
        category: 'orphan',
        fingerprint: 'aaaa',
        orphanPrefixCount: 99,
        orphanObjectCount: 999,
      }),
    )
    const tamperedToken = `${tamperedPayloadB64}.${sigPart}`
    const app = makeApp(goodAuth())
    const res = await postR2CleanupDelete(app, {
      ...VALID_CONFIRM_OPTIONS,
      body: buildDeleteBody(tamperedToken),
    })
    expect(res.status).toBe(400)
  })

  it('token signed with wrong key → 400', async () => {
    const payload: CleanupTokenPayload = {
      schema: 1,
      issuedAt: NOW_MS,
      expiresAt: NOW_MS + R2_CLEANUP_TOKEN_TTL_MS,
      category: 'orphan',
      fingerprint: 'aabbcc',
      orphanPrefixCount: 2,
      orphanObjectCount: 5,
    }
    const token = await signCleanupToken('different-key-0000000000000000000', payload)
    const app = makeApp(goodAuth())
    const res = await postR2CleanupDelete(app, {
      ...VALID_CONFIRM_OPTIONS,
      body: buildDeleteBody(token),
    })
    expect(res.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// POST /admin/r2-cleanup/delete — re-scan failures
// ---------------------------------------------------------------------------

describe('admin-routes: POST /admin/r2-cleanup/delete re-scan', () => {
  it('repo throws on re-scan → 500', async () => {
    const token = await buildValidToken()
    // confirm with good repo, then delete with throwing repo
    const app = makeApp(goodAuth(), makeThrowingR2CleanupRepo())
    const res = await postR2CleanupDelete(app, {
      ...VALID_CONFIRM_OPTIONS,
      body: buildDeleteBody(token),
    })
    expect(res.status).toBe(500)
    expect(await res.text()).toBe('Internal Server Error')
  })

  it('report truncated on re-scan → 400', async () => {
    const token = await buildValidToken(REPORT_WITH_ORPHANS)
    const app = makeApp(goodAuth(), makeR2CleanupRepo(REPORT_TRUNCATED))
    const res = await postR2CleanupDelete(app, {
      ...VALID_CONFIRM_OPTIONS,
      body: buildDeleteBody(token),
    })
    expect(res.status).toBe(400)
  })

  it('fingerprint mismatch (candidate set changed) → 400', async () => {
    // Token was created for REPORT_WITH_ORPHANS, but now the repo returns a different set
    const token = await buildValidToken(REPORT_WITH_ORPHANS)
    const changedReport: AdminR2CleanupReport = {
      ...REPORT_WITH_ORPHANS,
      albums: [
        { albumId: 'album-new-orphan', category: 'orphan', objectCount: 1, totalBytes: 100 },
      ],
    }
    const app = makeApp(goodAuth(), makeR2CleanupRepo(changedReport))
    const res = await postR2CleanupDelete(app, {
      ...VALID_CONFIRM_OPTIONS,
      body: buildDeleteBody(token),
    })
    expect(res.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// POST /admin/r2-cleanup/delete — success (Phase 2: not yet enabled)
// ---------------------------------------------------------------------------

describe('admin-routes: POST /admin/r2-cleanup/delete success (Phase 2)', () => {
  it('returns 200 no-store HTML page when all validation passes', async () => {
    const token = await buildValidToken()
    const app = makeApp(goodAuth())
    const res = await postR2CleanupDelete(app, {
      ...VALID_CONFIRM_OPTIONS,
      body: buildDeleteBody(token),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('content-type')).toContain('text/html')
  })

  it('success page says deletion is not enabled', async () => {
    const token = await buildValidToken()
    const app = makeApp(goodAuth())
    const res = await postR2CleanupDelete(app, {
      ...VALID_CONFIRM_OPTIONS,
      body: buildDeleteBody(token),
    })
    const body = await res.text()
    expect(body).toContain('有効ではありません')
  })

  it('success response does not contain R2 keys, bucket name, or credentials', async () => {
    const token = await buildValidToken()
    const app = makeApp(goodAuth())
    const res = await postR2CleanupDelete(app, {
      ...VALID_CONFIRM_OPTIONS,
      body: buildDeleteBody(token),
    })
    const body = await res.text()
    expect(body).not.toContain('PHOTO_BUCKET')
    expect(body).not.toContain('photoprism')
    expect(body).not.toContain('album-orphan-001')
    expect(body).not.toContain('album-orphan-002')
  })

  it('works with zero orphans (empty candidate set with matching fingerprint)', async () => {
    const token = await buildValidToken(REPORT_NO_ORPHANS)
    const app = makeApp(goodAuth(), makeR2CleanupRepo(REPORT_NO_ORPHANS))
    const res = await postR2CleanupDelete(app, {
      ...VALID_CONFIRM_OPTIONS,
      body: buildDeleteBody(token),
    })
    expect(res.status).toBe(200)
  })
})
