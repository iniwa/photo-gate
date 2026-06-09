import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { requireAlbumPermission } from '../src/middleware/require-album-permission.js'
import type { PermissionChecker } from '../src/middleware/require-album-permission.js'
import type { AuthVariables } from '../src/types/auth-context.js'

const USER_ID = 'user-test-123'
const ALBUM_ID = 'album-test-456'
const NOW = '2026-06-09T00:00:00.000Z'
const FIXED_CLOCK = (): Date => new Date(NOW)

function makeAppWithUser(
  checker: PermissionChecker,
  albumIdResolver: () => string | undefined = () => ALBUM_ID,
  clock = FIXED_CLOCK,
) {
  const app = new Hono<{ Variables: AuthVariables }>()
  app.use('*', async (c, next) => { c.set('userId', USER_ID); await next() })
  app.use('*', requireAlbumPermission(checker, albumIdResolver, clock))
  app.get('/protected', (c) => c.json({ ok: true }))
  return app
}

function makeAppWithoutUser(checker: PermissionChecker, clock = FIXED_CLOCK) {
  const app = new Hono<{ Variables: AuthVariables }>()
  app.use('*', requireAlbumPermission(checker, () => ALBUM_ID, clock))
  app.get('/protected', (c) => c.json({ ok: true }))
  return app
}

describe('requireAlbumPermission successful authorization', () => {
  it('calls downstream handler when permission is granted', async () => {
    const checker: PermissionChecker = { checkPermission: async () => true }
    const res = await makeAppWithUser(checker).request('/protected')
    expect(res.status).toBe(200)
  })

  it('passes authenticated userId from context to permission check', async () => {
    let capturedUserId: string | undefined
    const checker: PermissionChecker = {
      checkPermission: async (userId) => { capturedUserId = userId; return true },
    }
    await makeAppWithUser(checker).request('/protected')
    expect(capturedUserId).toBe(USER_ID)
  })

  it('passes resolver-provided albumId to permission check', async () => {
    let capturedAlbumId: string | undefined
    const checker: PermissionChecker = {
      checkPermission: async (_uid, albumId) => { capturedAlbumId = albumId; return true },
    }
    await makeAppWithUser(checker).request('/protected')
    expect(capturedAlbumId).toBe(ALBUM_ID)
  })

  it('passes canonical UTC timestamp to permission check', async () => {
    let capturedNow: string | undefined
    const checker: PermissionChecker = {
      checkPermission: async (_uid, _aid, now) => { capturedNow = now; return true },
    }
    await makeAppWithUser(checker).request('/protected')
    expect(capturedNow).toBe(NOW)
  })

  it('reads clock exactly once per request', async () => {
    let calls = 0
    const clock = (): Date => { calls++; return new Date(NOW) }
    const checker: PermissionChecker = { checkPermission: async () => true }
    await makeAppWithUser(checker, () => ALBUM_ID, clock).request('/protected')
    expect(calls).toBe(1)
  })
})

describe('requireAlbumPermission missing authenticated context returns 401', () => {
  it('returns 401 when userId is not in context', async () => {
    const checker: PermissionChecker = { checkPermission: async () => true }
    const res = await makeAppWithoutUser(checker).request('/protected')
    expect(res.status).toBe(401)
  })

  it('401 for missing context has Cache-Control: no-store', async () => {
    const checker: PermissionChecker = { checkPermission: async () => true }
    const res = await makeAppWithoutUser(checker).request('/protected')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('does not call downstream when context is missing', async () => {
    let called = false
    const checker: PermissionChecker = { checkPermission: async () => true }
    const app = new Hono<{ Variables: AuthVariables }>()
    app.use('*', requireAlbumPermission(checker, () => ALBUM_ID, FIXED_CLOCK))
    app.get('/protected', (c) => { called = true; return c.json({}) })
    await app.request('/protected')
    expect(called).toBe(false)
  })

  it('returns 401 for an invalid context user ID without checking permission', async () => {
    let checked = false
    const checker: PermissionChecker = {
      checkPermission: async () => { checked = true; return true },
    }
    const app = new Hono<{ Variables: AuthVariables }>()
    app.use('*', async (c, next) => { c.set('userId', '!invalid!'); await next() })
    app.use('*', requireAlbumPermission(checker, () => ALBUM_ID, FIXED_CLOCK))
    app.get('/protected', (c) => c.json({ ok: true }))
    const res = await app.request('/protected')
    expect(res.status).toBe(401)
    expect(checked).toBe(false)
  })
})

describe('requireAlbumPermission invalid album ID returns 403', () => {
  const allowChecker: PermissionChecker = { checkPermission: async () => true }

  it('returns 403 for album ID with special characters', async () => {
    const app = makeAppWithUser(allowChecker, () => '!invalid!')
    const res = await app.request('/protected')
    expect(res.status).toBe(403)
  })

  it('returns 403 when resolver returns undefined', async () => {
    const app = makeAppWithUser(allowChecker, () => undefined)
    const res = await app.request('/protected')
    expect(res.status).toBe(403)
  })

  it('returns 403 for empty string album ID', async () => {
    const app = makeAppWithUser(allowChecker, () => '')
    const res = await app.request('/protected')
    expect(res.status).toBe(403)
  })

  it('403 for invalid album ID has Cache-Control: no-store', async () => {
    const app = makeAppWithUser(allowChecker, () => '!bad!')
    const res = await app.request('/protected')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('does not call downstream when album ID is invalid', async () => {
    let called = false
    const app = new Hono<{ Variables: AuthVariables }>()
    app.use('*', async (c, next) => { c.set('userId', USER_ID); await next() })
    app.use('*', requireAlbumPermission(allowChecker, () => '!bad!', FIXED_CLOCK))
    app.get('/protected', (c) => { called = true; return c.json({}) })
    await app.request('/protected')
    expect(called).toBe(false)
  })
})

describe('requireAlbumPermission permission denied returns 403', () => {
  it('returns 403 when checkPermission returns false', async () => {
    const checker: PermissionChecker = { checkPermission: async () => false }
    const res = await makeAppWithUser(checker).request('/protected')
    expect(res.status).toBe(403)
  })

  it('403 for denied permission has Cache-Control: no-store', async () => {
    const checker: PermissionChecker = { checkPermission: async () => false }
    const res = await makeAppWithUser(checker).request('/protected')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('does not call downstream handler when permission is denied', async () => {
    let called = false
    const checker: PermissionChecker = { checkPermission: async () => false }
    const app = new Hono<{ Variables: AuthVariables }>()
    app.use('*', async (c, next) => { c.set('userId', USER_ID); await next() })
    app.use('*', requireAlbumPermission(checker, () => ALBUM_ID, FIXED_CLOCK))
    app.get('/protected', (c) => { called = true; return c.json({}) })
    await app.request('/protected')
    expect(called).toBe(false)
  })

  it('403 body does not contain user ID, album ID, or permission details', async () => {
    const checker: PermissionChecker = { checkPermission: async () => false }
    const res = await makeAppWithUser(checker).request('/protected')
    const body = await res.text()
    expect(body).not.toContain(USER_ID)
    expect(body).not.toContain(ALBUM_ID)
  })
})

describe('requireAlbumPermission internal failure returns 503', () => {
  it('returns 503 when checkPermission throws', async () => {
    const checker: PermissionChecker = {
      checkPermission: async () => { throw new Error('D1 error') },
    }
    const res = await makeAppWithUser(checker).request('/protected')
    expect(res.status).toBe(503)
  })

  it('503 has Cache-Control: no-store', async () => {
    const checker: PermissionChecker = {
      checkPermission: async () => { throw new Error('D1 error') },
    }
    const res = await makeAppWithUser(checker).request('/protected')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('503 body does not expose exception details', async () => {
    const checker: PermissionChecker = {
      checkPermission: async () => { throw new Error('sensitive_table_info') },
    }
    const res = await makeAppWithUser(checker).request('/protected')
    const body = await res.text()
    expect(body).not.toContain('sensitive_table_info')
  })

  it('fails closed: does not call downstream on repository failure', async () => {
    let called = false
    const checker: PermissionChecker = {
      checkPermission: async () => { throw new Error('boom') },
    }
    const app = new Hono<{ Variables: AuthVariables }>()
    app.use('*', async (c, next) => { c.set('userId', USER_ID); await next() })
    app.use('*', requireAlbumPermission(checker, () => ALBUM_ID, FIXED_CLOCK))
    app.get('/protected', (c) => { called = true; return c.json({}) })
    await app.request('/protected')
    expect(called).toBe(false)
  })

  it('returns 503 with no-store when clock throws', async () => {
    const checker: PermissionChecker = { checkPermission: async () => true }
    const clock = (): Date => { throw new Error('clock failure') }
    const res = await makeAppWithUser(checker, () => ALBUM_ID, clock).request('/protected')
    expect(res.status).toBe(503)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('returns 503 when clock returns an invalid Date', async () => {
    const checker: PermissionChecker = { checkPermission: async () => true }
    const res = await makeAppWithUser(
      checker,
      () => ALBUM_ID,
      () => new Date(Number.NaN),
    ).request('/protected')
    expect(res.status).toBe(503)
  })
})
