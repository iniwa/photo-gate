/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { beforeAll, describe, expect, it } from 'vitest'
import { applyD1Migrations } from 'cloudflare:test'
import { env, exports as workerExports } from 'cloudflare:workers'
import type { Env } from '../src/types/env.js'
import { hashPassword } from '../src/services/auth-crypto.js'
import { PBKDF2_PRODUCTION_ITERATIONS } from '../src/services/login-policy.js'

type IntegrationEnv = Env & {
  TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1]
}

const integrationEnv = env as unknown as IntegrationEnv
const worker = workerExports as unknown as { default: Fetcher }
const ORIGIN = 'https://photo-gate.integration.test'
const USER_ID = 'viewer-1'
const ALBUM_ID = 'album-1'
const PHOTO_ID = 'photo-1'
const PASSWORD = 'correct horse battery staple'
const NOW = '2026-08-13T00:00:00.000Z'

function cookieFrom(response: Response): string {
  const setCookie = response.headers.get('Set-Cookie')
  if (setCookie === null) throw new Error('expected session cookie')
  return setCookie.split(';', 1)[0] ?? ''
}

async function fetchWorker(path: string, init?: RequestInit): Promise<Response> {
  return worker.default.fetch(new Request(`${ORIGIN}${path}`, { redirect: 'manual', ...init }))
}

async function bytesAsText(response: Response): Promise<string> {
  return new TextDecoder().decode(await response.arrayBuffer())
}

async function seedAuthorizedAlbum(): Promise<void> {
  const passwordHash = await hashPassword(PASSWORD, PBKDF2_PRODUCTION_ITERATIONS)
  await integrationEnv.DB.prepare(
    `INSERT INTO users (id, display_name, password_hash, enabled, fail_count, locked_until, created_at, updated_at)
     VALUES (?, ?, ?, 1, 0, NULL, ?, ?)`,
  ).bind(USER_ID, 'Viewer', passwordHash, NOW, NOW).run()
  await integrationEnv.DB.prepare(
    `INSERT INTO albums (id, title, photoprism_album_uid, enabled, expires_at, download_enabled, created_at, updated_at)
     VALUES (?, ?, ?, 1, NULL, 1, ?, ?)`,
  ).bind(ALBUM_ID, 'Integration Album', 'opaque-photoprism-uid', NOW, NOW).run()
  await integrationEnv.DB.prepare(
    'INSERT INTO album_permissions (album_id, user_id, created_at) VALUES (?, ?, ?)',
  ).bind(ALBUM_ID, USER_ID, NOW).run()

  const manifest = JSON.stringify({
    schemaVersion: 1,
    albumId: ALBUM_ID,
    title: 'Integration Album',
    source: { type: 'photoprism', albumUid: 'opaque-photoprism-uid' },
    generatedAt: NOW,
    images: {
      thumb: { longEdge: 400, format: 'webp', quality: 85 },
      preview: { longEdge: 1600, format: 'jpg', quality: 90 },
      stripExif: true,
    },
    photos: [{
      id: PHOTO_ID,
      title: 'Integration Photo',
      thumb: `thumbs/${PHOTO_ID}.webp`,
      preview: `previews/${PHOTO_ID}.jpg`,
      takenAt: '2026-08-13T00:00:00Z',
      width: 1600,
      height: 900,
    }],
  })
  await integrationEnv.PHOTO_BUCKET.put(`albums/${ALBUM_ID}/manifest.json`, manifest)
  await integrationEnv.PHOTO_BUCKET.put(`albums/${ALBUM_ID}/thumbs/${PHOTO_ID}.webp`, 'thumb-bytes')
  await integrationEnv.PHOTO_BUCKET.put(`albums/${ALBUM_ID}/previews/${PHOTO_ID}.jpg`, 'preview-bytes')
}

describe('Worker binding integration', () => {
  beforeAll(async () => {
    await applyD1Migrations(integrationEnv.DB, integrationEnv.TEST_MIGRATIONS)
    await seedAuthorizedAlbum()
  })

  it('fails closed before an authenticated session reaches D1 or private R2 content', async () => {
    const albums = await fetchWorker('/albums')
    expect(albums.status).toBe(303)
    expect(albums.headers.get('location')).toBe('/')
    expect(albums.headers.get('cache-control')).toBe('no-store')

    const image = await fetchWorker(`/img/${ALBUM_ID}/preview/${PHOTO_ID}`)
    expect(image.status).toBe(401)
    expect(image.headers.get('cache-control')).toBe('no-store')
  })

  it('uses the deployed Worker route stack with local D1, R2, and rate-limit bindings', async () => {
    const login = await fetchWorker('/api/auth/login', {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
        'CF-Connecting-IP': '203.0.113.12',
      },
      body: new URLSearchParams({ userId: USER_ID, password: PASSWORD }).toString(),
    })
    expect(login.status).toBe(303)
    expect(login.headers.get('location')).toBe('/albums')
    const cookie = cookieFrom(login)

    const albumPage = await fetchWorker('/albums', { headers: { Cookie: cookie } })
    expect(albumPage.status).toBe(200)
    expect(await albumPage.text()).toContain('Integration Album')

    const detail = await fetchWorker(`/albums/${ALBUM_ID}`, { headers: { Cookie: cookie } })
    expect(detail.status).toBe(200)
    const detailHtml = await detail.text()
    expect(detailHtml).toContain('Integration Photo')
    expect(detailHtml).toContain(`/albums/${ALBUM_ID}/photos/${PHOTO_ID}`)

    const image = await fetchWorker(`/img/${ALBUM_ID}/preview/${PHOTO_ID}`, { headers: { Cookie: cookie } })
    expect(image.status).toBe(200)
    expect(image.headers.get('content-type')).toBe('image/jpeg')
    expect(image.headers.get('cache-control')).toBe('private, no-store')
    expect(await bytesAsText(image)).toBe('preview-bytes')

    const download = await fetchWorker(`/download/${ALBUM_ID}/preview/${PHOTO_ID}`, { headers: { Cookie: cookie } })
    expect(download.status).toBe(200)
    expect(download.headers.get('content-type')).toBe('image/jpeg')
    expect(download.headers.get('content-disposition')).toContain('attachment; filename=')
    expect(download.headers.get('cache-control')).toBe('private, no-store')
    expect(await bytesAsText(download)).toBe('preview-bytes')
  })

  it('enforces the configured account limiter before an invalid login reaches D1', async () => {
    const init: RequestInit = {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
        'CF-Connecting-IP': '198.51.100.44',
      },
      body: new URLSearchParams({ userId: '!invalid!', password: PASSWORD }).toString(),
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await fetchWorker('/api/auth/login', init)
      expect(response.status).toBe(303)
      expect(response.headers.get('location')).toBe('/?error=1')
    }

    const limited = await fetchWorker('/api/auth/login', init)
    expect(limited.status).toBe(429)
    expect(limited.headers.get('cache-control')).toBe('no-store')
    expect(limited.headers.get('retry-after')).toBe('60')
  })

  it('enforces the configured network limiter across distinct submitted IDs', async () => {
    const headers = {
      Origin: ORIGIN,
      'Content-Type': 'application/x-www-form-urlencoded',
      'CF-Connecting-IP': '198.51.100.45',
    }

    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await fetchWorker('/api/auth/login', {
        method: 'POST',
        headers,
        body: new URLSearchParams({
          userId: `network-guess-${attempt}`,
          password: PASSWORD,
        }).toString(),
      })
      expect(response.status).toBe(303)
      expect(response.headers.get('location')).toBe('/?error=1')
    }

    const limited = await fetchWorker('/api/auth/login', {
      method: 'POST',
      headers,
      body: new URLSearchParams({
        userId: 'network-guess-final',
        password: PASSWORD,
      }).toString(),
    })
    expect(limited.status).toBe(429)
    expect(limited.headers.get('cache-control')).toBe('no-store')
    expect(limited.headers.get('retry-after')).toBe('60')
  })
})
