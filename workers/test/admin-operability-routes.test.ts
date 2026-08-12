import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { createAdminRoutes, type AdminRouteDeps } from '../src/routes/admin.js'
import type { AdminAuthConfig } from '../src/types/admin-auth.js'
import type { AdminAlbumPage, AdminAlbumSummary } from '../src/types/admin-album.js'
import type { AdminAlbumReadinessFact } from '../src/types/admin-album-readiness.js'
import type { AdminCatalogRefreshRequest } from '../src/types/admin-catalog-refresh-request.js'
import type { AdminSyncResult } from '../src/types/admin-sync-result.js'
import type { AdminSyncTarget } from '../src/types/admin-sync-target.js'
import type { Env } from '../src/types/env.js'

const NOW = '2026-08-12T00:00:00.000Z'
const TOKEN = 'unit-token'
const ADMIN_EMAIL = 'admin@example.test'
const ALBUM: AdminAlbumSummary = {
  id: 'album-ready-001',
  title: 'Ready Album',
  enabled: 1,
  expires_at: null,
  download_enabled: 1,
  created_at: NOW,
  updated_at: NOW,
}
const CATALOG_ID = 'a'.repeat(64)
const TARGET: AdminSyncTarget = {
  albumId: ALBUM.id,
  catalogId: CATALOG_ID,
  title: ALBUM.title,
  expiresAt: null,
  downloadEnabled: 1,
  thumb: { longEdge: 640, format: 'webp', quality: 80 },
  preview: { longEdge: 3840, format: 'jpg', quality: 88 },
  stripExif: 1,
}
const FACT: AdminAlbumReadinessFact = { albumId: ALBUM.id, permissionCount: 1, manifest: 'present' }
const RESULT: AdminSyncResult = {
  schema: 1,
  publishedAt: '2026-08-12T00:01:00Z',
  operation: 'sync',
  triggerKind: 'manual',
  result: 'ok',
  startedAt: '2026-08-12T00:00:00Z',
  completedAt: '2026-08-12T00:01:00Z',
  targets: { attempted: 1, succeeded: 1, failed: 0 },
  photos: { total: 5, uploaded: 1, skipped: 4 },
  catalogRefreshed: true,
}

type Options = {
  albumPage?: AdminAlbumPage
  catalogStatus?: 'missing' | 'available'
  targets?: AdminSyncTarget[]
  facts?: AdminAlbumReadinessFact[]
  syncResult?: AdminSyncResult | null
}

function goodAuth(): (env: Env) => AdminAuthConfig | null {
  return () => ({
    verifier: async () => ({ email: ADMIN_EMAIL }),
    allowlist: new Set([ADMIN_EMAIL]),
  })
}

function makeApp(options: Options = {}) {
  const catalogWrites: AdminCatalogRefreshRequest[] = []
  const albumPage = options.albumPage ?? { albums: [ALBUM], hasMore: false }
  const catalogStatus = options.catalogStatus ?? 'available'
  const targets = options.targets ?? [TARGET]
  const facts = options.facts ?? [FACT]
  const deps: AdminRouteDeps = {
    userRepo: {
      listUsers: async () => ({ users: [], hasMore: false }),
      setUserEnabled: async () => {},
      createUser: async () => {},
      resetPassword: async () => {},
      updateDisplayName: async () => {},
    },
    albumRepo: {
      listAlbums: async () => albumPage,
      setAlbumEnabled: async () => {},
      updatePublicMetadata: async () => {},
      createAlbum: async () => {},
      getAlbumForSync: async () => null,
    },
    permissionRepo: {
      listAssignmentOptions: async () => ({ users: [], albums: [], permissions: [], hasMore: false }),
      grantPermission: async () => {},
      revokePermission: async () => {},
    },
    opsRepo: { getSummary: async () => ({
      generatedAt: NOW,
      users: { total: 0, enabled: 0, disabled: 0, locked: 0 },
      albums: { total: 0, enabled: 0, disabled: 0, expired: 0, expiringSoon: 0, downloadable: 0 },
      permissions: { total: 0 },
      sessions: { total: 0, expired: 0 },
    }) },
    syncStatusRepo: { getStatus: async () => ({ status: 'missing' as const }) },
    syncRequestRepo: {
      writeRequest: async () => {},
      getPendingRequest: async () => ({ status: 'missing' as const }),
    },
    catalogRefreshRequestRepo: {
      writeRequest: async (request) => { catalogWrites.push(request) },
      getPendingRequest: async () => ({ status: 'missing' as const }),
    },
    syncResultRepo: {
      getResult: async () => options.syncResult === null
        ? ({ status: 'missing' as const })
        : ({ status: 'found' as const, value: options.syncResult ?? RESULT }),
    },
    syncTargetRepo: {
      upsertTarget: async () => {},
      removeTarget: async () => {},
      getTargets: async () => targets,
    },
    catalogRepo: {
      getCatalog: async () => catalogStatus === 'missing'
        ? ({ status: 'missing' as const })
        : ({ status: 'available' as const, publishedAt: '2026-08-12T00:00:00Z', albums: [{ catalogId: CATALOG_ID, title: 'Catalog Album', photoCount: 5, updatedAt: NOW }] }),
      hasCatalogId: async () => true,
    },
    albumReadinessRepo: { getFacts: async () => facts },
    r2CleanupRepo: { getReport: async () => ({ albums: [], malformedCount: 0, malformedBytes: 0, excludedOpsCount: 0, truncated: false }) },
    clock: () => new Date(NOW),
  }
  const app = new Hono()
  app.route('/admin', createAdminRoutes(goodAuth(), () => deps))
  return { app, catalogWrites }
}

function headers(extra: Record<string, string> = {}) {
  return { 'Cf-Access-Jwt-Assertion': TOKEN, ...extra }
}

describe('admin operability routes', () => {
  it('renders an end-to-end sharing readiness state without source identifiers', async () => {
    const { app } = makeApp()
    const response = await app.request('https://unit.test/admin/albums', { headers: headers() })
    const body = await response.text()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(body).toContain('共有準備')
    expect(body).toContain('共有可能')
    expect(body).toContain('共有手順')
    expect(body).not.toContain('photoprism_album_uid')
    expect(body).not.toContain('albums/album-ready-001/manifest.json')
  })

  it('makes missing target, missing manifest, expired or disabled album, and missing permissions actionable', async () => {
    const cases: Array<{ options: Options; label: string }> = [
      { options: { targets: [] }, label: '同期対象未設定' },
      { options: { facts: [{ ...FACT, manifest: 'missing' }] }, label: '同期待ち' },
      { options: { albumPage: { albums: [{ ...ALBUM, expires_at: '2026-08-11T00:00:00.000Z' }], hasMore: false } }, label: '期限切れ' },
      { options: { albumPage: { albums: [{ ...ALBUM, enabled: 0 }], hasMore: false } }, label: '有効化が必要' },
      { options: { facts: [{ ...FACT, permissionCount: 0 }] }, label: '共有先未設定' },
      { options: { catalogStatus: 'missing' }, label: 'カタログ更新待ち' },
    ]
    for (const testCase of cases) {
      const { app } = makeApp(testCase.options)
      const body = await (await app.request('https://unit.test/admin/albums', { headers: headers() })).text()
      expect(body).toContain(testCase.label)
    }
  })

  it('renders the catalog-only form and a sanitized aggregate result', async () => {
    const { app } = makeApp()
    const response = await app.request('https://unit.test/admin/sync', { headers: headers() })
    const body = await response.text()
    expect(response.status).toBe(200)
    expect(body).toContain('action="/admin/catalog-refresh/request"')
    expect(body).toContain('カタログを更新')
    expect(body).toContain('画像の同期・アップロードは行いません')
    expect(body).toContain('合計 5 / 更新 1 / スキップ 4')
    expect(body).not.toContain('photoId')
    expect(body).not.toContain('token')
  })

  it('writes a strict catalog-only request to its own repository and redirects', async () => {
    const { app, catalogWrites } = makeApp()
    const response = await app.request('https://unit.test/admin/catalog-refresh/request', {
      method: 'POST',
      headers: headers({ Origin: 'https://unit.test', 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: 'kind=publish-catalog',
    })
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/admin/sync')
    expect(catalogWrites).toHaveLength(1)
    expect(catalogWrites[0]?.kind).toBe('publish-catalog')
    expect(catalogWrites[0]?.requestId).toMatch(/^[0-9a-f]{32}$/)
  })

  it('rejects a malformed catalog-only form before writing a request', async () => {
    const { app, catalogWrites } = makeApp()
    const response = await app.request('https://unit.test/admin/catalog-refresh/request', {
      method: 'POST',
      headers: headers({ Origin: 'https://unit.test', 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: 'kind=sync-now',
    })
    expect(response.status).toBe(400)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(catalogWrites).toEqual([])
  })
})
