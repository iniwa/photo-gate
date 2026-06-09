import { describe, it, expect } from 'vitest'
import app from '../src/index.js'

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

// Fixture album/photo IDs defined in fixtures.ts are used to verify reserved routes
// do not leak them.
const FIXTURE_IDS = [
  'sample-album-001',
  'sample-album-002',
  'fixture-photo-001',
  'fixture-photo-002',
  'fixture-photo-003',
  'fixture-photo-004',
  'fixture-photo-005',
]

describe('GET /', () => {
  it('returns 200 HTML', async () => {
    const res = await app.request('/')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
  })

  it('indicates login is not yet implemented', async () => {
    const res = await app.request('/')
    const text = await res.text()
    expect(text).toContain('not implemented')
  })

  it('has Cache-Control: private, no-cache', async () => {
    const res = await app.request('/')
    expect(res.headers.get('cache-control')).toBe('private, no-cache')
  })

  it('has security headers', async () => {
    const res = await app.request('/')
    hasSecurityHeaders(res)
  })
})

describe('GET /albums', () => {
  it('returns 200 HTML', async () => {
    const res = await app.request('/albums')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
  })

  it('contains fixture album titles', async () => {
    const res = await app.request('/albums')
    const text = await res.text()
    expect(text).toContain('Sample Album 001 (Fixture)')
    expect(text).toContain('Sample Album 002 (Fixture)')
  })

  it('does not contain /img/ links', async () => {
    const res = await app.request('/albums')
    const text = await res.text()
    expect(text).not.toContain('/img/')
  })

  it('does not contain remote image URLs', async () => {
    const res = await app.request('/albums')
    const text = await res.text()
    expect(text).not.toMatch(/https?:\/\//)
  })

  it('has Cache-Control: private, no-cache', async () => {
    const res = await app.request('/albums')
    expect(res.headers.get('cache-control')).toBe('private, no-cache')
  })

  it('has security headers', async () => {
    const res = await app.request('/albums')
    hasSecurityHeaders(res)
  })
})

describe('GET /albums/:albumId - known fixture album', () => {
  it('returns 200 HTML for sample-album-001', async () => {
    const res = await app.request('/albums/sample-album-001')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
  })

  it('renders deterministic fixture photos for sample-album-001', async () => {
    const res = await app.request('/albums/sample-album-001')
    const text = await res.text()
    expect(text).toContain('Fixture Photo 001')
    expect(text).toContain('Fixture Photo 002')
    expect(text).toContain('Fixture Photo 003')
  })

  it('returns 200 HTML for sample-album-002', async () => {
    const res = await app.request('/albums/sample-album-002')
    expect(res.status).toBe(200)
  })

  it('renders deterministic fixture photos for sample-album-002', async () => {
    const res = await app.request('/albums/sample-album-002')
    const text = await res.text()
    expect(text).toContain('Fixture Photo 004')
    expect(text).toContain('Fixture Photo 005')
    expect(text).not.toContain('Fixture Photo 001')
  })

  it('contains no /img/ links', async () => {
    const res = await app.request('/albums/sample-album-001')
    const text = await res.text()
    expect(text).not.toContain('/img/')
  })

  it('contains no remote image URLs', async () => {
    const res = await app.request('/albums/sample-album-001')
    const text = await res.text()
    expect(text).not.toMatch(/https?:\/\//)
  })

  it('has Cache-Control: private, no-cache', async () => {
    const res = await app.request('/albums/sample-album-001')
    expect(res.headers.get('cache-control')).toBe('private, no-cache')
  })

  it('has security headers', async () => {
    const res = await app.request('/albums/sample-album-001')
    hasSecurityHeaders(res)
  })
})

describe('GET /albums/:albumId - unknown or invalid', () => {
  it('returns 404 for an unknown but valid-format album ID', async () => {
    const res = await app.request('/albums/nonexistent-album')
    expect(res.status).toBe(404)
  })

  it('returns 404 for an invalid ID containing special characters', async () => {
    const res = await app.request('/albums/!invalid!')
    expect(res.status).toBe(404)
  })

  it('returns 404 for an empty-looking segment', async () => {
    const res = await app.request('/albums/.')
    expect(res.status).toBe(404)
  })

  it('404 response has security headers', async () => {
    const res = await app.request('/albums/nonexistent-album')
    hasSecurityHeaders(res)
  })

  it('404 response has Cache-Control: no-store', async () => {
    const res = await app.request('/albums/nonexistent-album')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})

describe('Reserved routes - fail closed with 401', () => {
  const cases = [
    '/api',
    '/api/login',
    '/api/albums',
    '/api/albums/sample-album-001',
    '/img',
    '/img/sample-album-001/thumb/fixture-photo-001',
    '/admin',
    '/admin/api/albums',
  ]

  for (const path of cases) {
    it(`${path} returns 401`, async () => {
      const res = await app.request(path)
      expect(res.status).toBe(401)
    })

    it(`${path} does not contain fixture album or photo IDs`, async () => {
      const res = await app.request(path)
      const text = await res.text()
      for (const id of FIXTURE_IDS) {
        expect(text).not.toContain(id)
      }
    })

    it(`${path} has Cache-Control: no-store`, async () => {
      const res = await app.request(path)
      expect(res.headers.get('cache-control')).toBe('no-store')
    })

    it(`${path} has security headers`, async () => {
      const res = await app.request(path)
      hasSecurityHeaders(res)
    })
  }

  it('rejects non-GET requests under reserved prefixes', async () => {
    const res = await app.request('/api/login', { method: 'POST' })
    expect(res.status).toBe(401)
    expect(res.headers.get('cache-control')).toBe('no-store')
    hasSecurityHeaders(res)
  })
})

describe('Unknown routes', () => {
  it('returns 404 for /unknown', async () => {
    const res = await app.request('/unknown')
    expect(res.status).toBe(404)
  })

  it('returns 404 for /login (not implemented in Phase 2)', async () => {
    const res = await app.request('/login')
    expect(res.status).toBe(404)
  })

  it('404 has security headers', async () => {
    const res = await app.request('/unknown')
    hasSecurityHeaders(res)
  })

  it('404 has Cache-Control: no-store', async () => {
    const res = await app.request('/unknown')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})

describe('JSX escaping', () => {
  it('escapes special characters from fixture values', async () => {
    const res = await app.request('/albums/sample-album-001')
    const text = await res.text()
    expect(text).toContain('Fixture Photo 003 &lt;Sample&gt; &amp; Test')
    expect(text).not.toContain('Fixture Photo 003 <Sample> & Test')
  })
})
