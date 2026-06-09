import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import { requireSession } from '../src/middleware/require-session.js'
import type { SessionFetcher } from '../src/middleware/require-session.js'
import type { AuthVariables } from '../src/types/auth-context.js'
import type { SessionWithUser } from '../src/types/session.js'

// 'A'.repeat(43) is a valid 43-char base64url string that decodes to 32 zero bytes.
const VALID_TOKEN = 'A'.repeat(43)
const NOW = '2026-06-09T00:00:00.000Z'
const FIXED_CLOCK = (): Date => new Date(NOW)
const SESSION_COOKIE = `photo_gate_session=${VALID_TOKEN}`

function makeSession(userId: string): SessionWithUser {
  return {
    token_hash: 'a'.repeat(64),
    user_id: userId,
    expires_at: '2030-01-01T00:00:00.000Z',
    last_seen_at: NOW,
    user_enabled: 1,
  }
}

function makeApp(fetcher: SessionFetcher, clock = FIXED_CLOCK) {
  const app = new Hono<{ Variables: AuthVariables }>()
  app.use('*', requireSession(fetcher, clock))
  app.get('/protected', (c) => c.json({ userId: c.get('userId') }))
  return app
}

describe('requireSession successful authentication', () => {
  it('calls downstream handler and exposes only userId', async () => {
    const fetcher: SessionFetcher = { fetchValidSession: async () => makeSession('user-abc') }
    const app = makeApp(fetcher)
    const res = await app.request('/protected', { headers: { Cookie: SESSION_COOKIE } })
    expect(res.status).toBe(200)
    const body = await res.json() as { userId: string }
    expect(body.userId).toBe('user-abc')
  })

  it('reads clock exactly once per request', async () => {
    let calls = 0
    const clock = (): Date => { calls++; return new Date(NOW) }
    const fetcher: SessionFetcher = { fetchValidSession: async () => makeSession('user-abc') }
    const app = makeApp(fetcher, clock)
    await app.request('/protected', { headers: { Cookie: SESSION_COOKIE } })
    expect(calls).toBe(1)
  })

  it('passes canonical UTC timestamp to session lookup', async () => {
    let capturedNow: string | undefined
    const fetcher: SessionFetcher = {
      fetchValidSession: async (_digest, now) => { capturedNow = now; return makeSession('u') },
    }
    const app = makeApp(fetcher)
    await app.request('/protected', { headers: { Cookie: SESSION_COOKIE } })
    expect(capturedNow).toBe(NOW)
  })

  it('passes SHA-256 hex digest to session lookup, not the raw token', async () => {
    let capturedDigest: string | undefined
    const fetcher: SessionFetcher = {
      fetchValidSession: async (digest) => { capturedDigest = digest; return makeSession('u') },
    }
    const app = makeApp(fetcher)
    await app.request('/protected', { headers: { Cookie: SESSION_COOKIE } })
    expect(capturedDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(capturedDigest).not.toBe(VALID_TOKEN)
  })
})

describe('requireSession missing or malformed cookie returns 401', () => {
  const nullFetcher: SessionFetcher = { fetchValidSession: async () => null }

  it('returns 401 when Cookie header is absent', async () => {
    const res = await makeApp(nullFetcher).request('/protected')
    expect(res.status).toBe(401)
  })

  it('does not read the clock when Cookie header is absent', async () => {
    let calls = 0
    const clock = (): Date => { calls++; return new Date(NOW) }
    await makeApp(nullFetcher, clock).request('/protected')
    expect(calls).toBe(0)
  })

  it('returns 401 when photo_gate_session cookie is not present', async () => {
    const res = await makeApp(nullFetcher).request('/protected', {
      headers: { Cookie: 'other=value' },
    })
    expect(res.status).toBe(401)
  })

  it('returns 401 when photo_gate_session cookie is duplicated', async () => {
    const res = await makeApp(nullFetcher).request('/protected', {
      headers: { Cookie: `photo_gate_session=${VALID_TOKEN}; photo_gate_session=${VALID_TOKEN}` },
    })
    expect(res.status).toBe(401)
  })

  it('returns 401 for malformed base64url token', async () => {
    const res = await makeApp(nullFetcher).request('/protected', {
      headers: { Cookie: 'photo_gate_session=!!!bad!!!' },
    })
    expect(res.status).toBe(401)
  })

  it('returns 401 for token decoding to fewer than 32 bytes', async () => {
    // 'A'.repeat(40) decodes to 30 bytes
    const res = await makeApp(nullFetcher).request('/protected', {
      headers: { Cookie: `photo_gate_session=${'A'.repeat(40)}` },
    })
    expect(res.status).toBe(401)
  })

  it('returns 401 for token decoding to more than 32 bytes', async () => {
    // 'A'.repeat(44) decodes to 33 bytes
    const res = await makeApp(nullFetcher).request('/protected', {
      headers: { Cookie: `photo_gate_session=${'A'.repeat(44)}` },
    })
    expect(res.status).toBe(401)
  })
})

describe('requireSession unknown or expired session returns 401', () => {
  it('returns 401 when fetcher returns null (unknown session)', async () => {
    const fetcher: SessionFetcher = { fetchValidSession: async () => null }
    const res = await makeApp(fetcher).request('/protected', { headers: { Cookie: SESSION_COOKIE } })
    expect(res.status).toBe(401)
  })

  it('returns 401 when fetcher returns a disabled-user session', async () => {
    const session = makeSession('user-abc')
    session.user_enabled = 0
    const fetcher: SessionFetcher = { fetchValidSession: async () => session }
    const res = await makeApp(fetcher).request('/protected', { headers: { Cookie: SESSION_COOKIE } })
    expect(res.status).toBe(401)
  })

  it('returns 401 when fetcher returns a session with an invalid user ID', async () => {
    const fetcher: SessionFetcher = { fetchValidSession: async () => makeSession('!invalid!') }
    const res = await makeApp(fetcher).request('/protected', { headers: { Cookie: SESSION_COOKIE } })
    expect(res.status).toBe(401)
  })
})

describe('requireSession internal failure returns 503', () => {
  it('returns 503 when session repository throws', async () => {
    const fetcher: SessionFetcher = {
      fetchValidSession: async () => { throw new Error('D1 connection lost') },
    }
    const res = await makeApp(fetcher).request('/protected', { headers: { Cookie: SESSION_COOKIE } })
    expect(res.status).toBe(503)
  })

  it('returns 503 with no-store when clock throws', async () => {
    const fetcher: SessionFetcher = { fetchValidSession: async () => makeSession('user-abc') }
    const clock = (): Date => { throw new Error('clock failure') }
    const res = await makeApp(fetcher, clock).request('/protected', {
      headers: { Cookie: SESSION_COOKIE },
    })
    expect(res.status).toBe(503)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('returns 503 when clock returns an invalid Date', async () => {
    const fetcher: SessionFetcher = { fetchValidSession: async () => makeSession('user-abc') }
    const res = await makeApp(fetcher, () => new Date(Number.NaN)).request('/protected', {
      headers: { Cookie: SESSION_COOKIE },
    })
    expect(res.status).toBe(503)
  })

  it('returns 503 when token digesting fails', async () => {
    const digestSpy = vi.spyOn(crypto.subtle, 'digest').mockRejectedValueOnce(new Error('crypto failure'))
    const fetcher: SessionFetcher = { fetchValidSession: async () => makeSession('user-abc') }
    const res = await makeApp(fetcher).request('/protected', { headers: { Cookie: SESSION_COOKIE } })
    expect(res.status).toBe(503)
    expect(res.headers.get('cache-control')).toBe('no-store')
    digestSpy.mockRestore()
  })
})

describe('requireSession Cache-Control on all failures', () => {
  const nullFetcher: SessionFetcher = { fetchValidSession: async () => null }

  it('401 for missing cookie has Cache-Control: no-store', async () => {
    const res = await makeApp(nullFetcher).request('/protected')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('401 for malformed cookie has Cache-Control: no-store', async () => {
    const res = await makeApp(nullFetcher).request('/protected', {
      headers: { Cookie: 'photo_gate_session=bad' },
    })
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('401 for unknown session has Cache-Control: no-store', async () => {
    const res = await makeApp(nullFetcher).request('/protected', {
      headers: { Cookie: SESSION_COOKIE },
    })
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('503 for repository failure has Cache-Control: no-store', async () => {
    const fetcher: SessionFetcher = {
      fetchValidSession: async () => { throw new Error('boom') },
    }
    const res = await makeApp(fetcher).request('/protected', { headers: { Cookie: SESSION_COOKIE } })
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})

describe('requireSession error responses contain no sensitive data', () => {
  it('503 body does not contain exception text or token', async () => {
    const fetcher: SessionFetcher = {
      fetchValidSession: async () => { throw new Error('internal_secret_db_host') },
    }
    const res = await makeApp(fetcher).request('/protected', { headers: { Cookie: SESSION_COOKIE } })
    const body = await res.text()
    expect(body).not.toContain('internal_secret_db_host')
    expect(body).not.toContain(VALID_TOKEN)
  })

  it('401 for unknown session body does not contain token or digest', async () => {
    const fetcher: SessionFetcher = { fetchValidSession: async () => null }
    const res = await makeApp(fetcher).request('/protected', { headers: { Cookie: SESSION_COOKIE } })
    const body = await res.text()
    expect(body).not.toContain(VALID_TOKEN)
    expect(body).not.toMatch(/[0-9a-f]{64}/)
  })
})

describe('requireSession downstream handler isolation', () => {
  it('does not call downstream handler when session is not found', async () => {
    let called = false
    const fetcher: SessionFetcher = { fetchValidSession: async () => null }
    const app = new Hono<{ Variables: AuthVariables }>()
    app.use('*', requireSession(fetcher, FIXED_CLOCK))
    app.get('/protected', (c) => { called = true; return c.json({}) })
    await app.request('/protected', { headers: { Cookie: SESSION_COOKIE } })
    expect(called).toBe(false)
  })

  it('does not call downstream handler when cookie is missing', async () => {
    let called = false
    const fetcher: SessionFetcher = { fetchValidSession: async () => null }
    const app = new Hono<{ Variables: AuthVariables }>()
    app.use('*', requireSession(fetcher, FIXED_CLOCK))
    app.get('/protected', (c) => { called = true; return c.json({}) })
    await app.request('/protected')
    expect(called).toBe(false)
  })

  it('does not call downstream handler when repository throws', async () => {
    let called = false
    const fetcher: SessionFetcher = {
      fetchValidSession: async () => { throw new Error('boom') },
    }
    const app = new Hono<{ Variables: AuthVariables }>()
    app.use('*', requireSession(fetcher, FIXED_CLOCK))
    app.get('/protected', (c) => { called = true; return c.json({}) })
    await app.request('/protected', { headers: { Cookie: SESSION_COOKIE } })
    expect(called).toBe(false)
  })
})
