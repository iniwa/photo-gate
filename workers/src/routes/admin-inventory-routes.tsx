import { Hono } from 'hono'
import type { Env } from '../types/env.js'
import type { AdminAlbumPage } from '../types/admin-album.js'
import type { AdminAlbumCatalogEntry } from '../types/admin-album-catalog.js'
import type {
  AdminAlbumReadiness,
  AdminAlbumReadinessFact,
  AdminAlbumReadinessStatus,
} from '../types/admin-album-readiness.js'
import type { AdminOpsSummary } from '../types/admin-ops.js'
import type { AdminR2CleanupReport } from '../types/admin-r2-cleanup.js'
import type { AdminSyncTarget } from '../types/admin-sync-target.js'
import type { AdminUserPage } from '../types/admin-user.js'
import type { AssignmentOptions } from '../types/admin-permission.js'
import { isValidId } from '../services/repository-validation.js'
import {
  AdminAlbumsPage,
  AdminOpsPage,
  AdminPermissionsPage,
  AdminR2CleanupPage,
  AdminUsersPage,
} from './admin-pages.js'
import type { AdminRouteDeps } from './admin.js'

type AdminEnv = { Bindings: Env }

type InventoryRouteDeps = Pick<
  AdminRouteDeps,
  | 'userRepo'
  | 'albumRepo'
  | 'permissionRepo'
  | 'opsRepo'
  | 'syncTargetRepo'
  | 'albumReadinessRepo'
  | 'catalogRepo'
  | 'r2CleanupRepo'
  | 'clock'
>

function readinessLabel(status: AdminAlbumReadinessStatus): string {
  if (status === 'catalog-unavailable') return 'カタログ更新待ち'
  if (status === 'target-not-configured') return '同期対象未設定'
  if (status === 'target-needs-refresh') return '同期対象を再設定'
  if (status === 'sync-pending') return '同期待ち'
  if (status === 'expired') return '期限切れ'
  if (status === 'activation-required') return '有効化が必要'
  if (status === 'permission-required') return '共有先未設定'
  if (status === 'ready') return '共有可能'
  return '状態確認不可'
}

function readiness(status: AdminAlbumReadinessStatus): AdminAlbumReadiness {
  return { status, label: readinessLabel(status) }
}

/**
 * Derive an administrator-visible sharing state from safe aggregate facts.
 * No PhotoPrism UID, R2 key, manifest body, or photo identity is accepted or
 * rendered here.
 */
function buildAlbumReadiness(
  page: AdminAlbumPage,
  catalog: { status: 'missing' } | { status: 'available'; publishedAt: string; albums: AdminAlbumCatalogEntry[] },
  targets: AdminSyncTarget[] | null,
  facts: AdminAlbumReadinessFact[] | null,
  now: Date,
): ReadonlyMap<string, AdminAlbumReadiness> {
  const result = new Map<string, AdminAlbumReadiness>()
  const targetByAlbum = targets === null ? null : new Map(targets.map((target) => [target.albumId, target]))
  const factByAlbum = facts === null ? null : new Map(facts.map((fact) => [fact.albumId, fact]))
  const catalogIds = catalog.status === 'available' ? new Set(catalog.albums.map((entry) => entry.catalogId)) : null

  for (const album of page.albums) {
    if (catalog.status === 'missing') {
      result.set(album.id, readiness('catalog-unavailable'))
      continue
    }
    if (targetByAlbum === null || factByAlbum === null || catalogIds === null) {
      result.set(album.id, readiness('unknown'))
      continue
    }
    const target = targetByAlbum.get(album.id)
    if (target === undefined) {
      result.set(album.id, readiness('target-not-configured'))
      continue
    }
    if (!catalogIds.has(target.catalogId)) {
      result.set(album.id, readiness('target-needs-refresh'))
      continue
    }
    const fact = factByAlbum.get(album.id)
    if (fact === undefined || fact.manifest === 'unknown') {
      result.set(album.id, readiness('unknown'))
      continue
    }
    if (fact.manifest === 'missing') {
      result.set(album.id, readiness('sync-pending'))
      continue
    }
    const expiry = album.expires_at === null ? null : new Date(album.expires_at)
    if (expiry !== null && (!Number.isFinite(expiry.valueOf()) || expiry <= now)) {
      result.set(album.id, readiness('expired'))
      continue
    }
    if (album.enabled === 0) {
      result.set(album.id, readiness('activation-required'))
      continue
    }
    if (fact.permissionCount === 0) {
      result.set(album.id, readiness('permission-required'))
      continue
    }
    result.set(album.id, readiness('ready'))
  }
  return result
}

/** Registers the authenticated, read-only admin inventories and safe reports. */
export function registerAdminInventoryRoutes(
  admin: Hono<AdminEnv>,
  depsFromEnv: (env: Env) => InventoryRouteDeps,
): void {
  admin.get('/users', async (c) => {
    // Cursor validation: reject repeated params and invalid IDs before any repo call.
    const afters = c.req.queries('after') ?? []
    if (afters.length > 1) {
      c.header('Cache-Control', 'no-store')
      return c.text('Bad Request', 400)
    }
    const after = afters[0]
    if (after !== undefined && !isValidId(after)) {
      c.header('Cache-Control', 'no-store')
      return c.text('Bad Request', 400)
    }

    let page: AdminUserPage
    try {
      page = await depsFromEnv(c.env).userRepo.listUsers(after)
    } catch {
      c.header('Cache-Control', 'no-store')
      return c.text('Internal Server Error', 500)
    }

    c.header('Cache-Control', 'no-store')
    return c.html(<AdminUsersPage page={page} />)
  })

  admin.get('/albums', async (c) => {
    // Cursor validation: reject repeated params and invalid IDs before any repo call.
    const afters = c.req.queries('after') ?? []
    if (afters.length > 1) {
      c.header('Cache-Control', 'no-store')
      return c.text('Bad Request', 400)
    }
    const after = afters[0]
    if (after !== undefined && !isValidId(after)) {
      c.header('Cache-Control', 'no-store')
      return c.text('Bad Request', 400)
    }

    const deps = depsFromEnv(c.env)

    let page: AdminAlbumPage
    try {
      page = await deps.albumRepo.listAlbums(after)
    } catch {
      c.header('Cache-Control', 'no-store')
      return c.text('Internal Server Error', 500)
    }

    let catalog: { status: 'missing' } | { status: 'available'; publishedAt: string; albums: AdminAlbumCatalogEntry[] }
    let targets: AdminSyncTarget[] | null
    let facts: AdminAlbumReadinessFact[] | null
    let now: Date
    try {
      ;[catalog, targets, facts] = await Promise.all([
        deps.catalogRepo.getCatalog(),
        deps.syncTargetRepo.getTargets === undefined
          ? Promise.resolve(null)
          : deps.syncTargetRepo.getTargets(),
        deps.albumReadinessRepo === undefined
          ? Promise.resolve(null)
          : deps.albumReadinessRepo.getFacts(page.albums.map((album) => album.id)),
      ])
      now = deps.clock()
    } catch {
      c.header('Cache-Control', 'no-store')
      return c.text('Internal Server Error', 500)
    }

    c.header('Cache-Control', 'no-store')
    return c.html(
      <AdminAlbumsPage
        page={page}
        catalog={catalog}
        readinessByAlbumId={buildAlbumReadiness(page, catalog, targets, facts, now)}
      />,
    )
  })

  admin.get('/permissions', async (c) => {
    // Composite cursor validation: both params must be present or both absent.
    const aa = c.req.queries('after_album') ?? []
    const au = c.req.queries('after_user') ?? []

    if (aa.length > 1 || au.length > 1) {
      c.header('Cache-Control', 'no-store')
      return c.text('Bad Request', 400)
    }

    const a = aa[0]
    const u = au[0]

    // Both-or-neither: providing only one is invalid.
    if ((a === undefined) !== (u === undefined)) {
      c.header('Cache-Control', 'no-store')
      return c.text('Bad Request', 400)
    }

    if (a !== undefined && (!isValidId(a) || !isValidId(u!))) {
      c.header('Cache-Control', 'no-store')
      return c.text('Bad Request', 400)
    }

    const cursorArg = a === undefined ? undefined : { albumId: a, userId: u! }

    let options: AssignmentOptions
    try {
      options = await depsFromEnv(c.env).permissionRepo.listAssignmentOptions(cursorArg)
    } catch {
      c.header('Cache-Control', 'no-store')
      return c.text('Internal Server Error', 500)
    }

    c.header('Cache-Control', 'no-store')
    return c.html(<AdminPermissionsPage options={options} />)
  })

  admin.get('/ops', async (c) => {
    const deps = depsFromEnv(c.env)
    let summary: AdminOpsSummary
    try {
      const now = deps.clock()
      const nowIso = now.toISOString()
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000
      const expiringSoonUntil = new Date(now.valueOf() + sevenDaysMs).toISOString()
      summary = await deps.opsRepo.getSummary(nowIso, expiringSoonUntil)
    } catch {
      c.header('Cache-Control', 'no-store')
      return c.text('Internal Server Error', 500)
    }
    c.header('Cache-Control', 'no-store')
    return c.html(<AdminOpsPage summary={summary} />)
  })

  admin.get('/r2-cleanup', async (c) => {
    let report: AdminR2CleanupReport
    try {
      report = await depsFromEnv(c.env).r2CleanupRepo.getReport()
    } catch {
      c.header('Cache-Control', 'no-store')
      return c.text('Internal Server Error', 500)
    }
    c.header('Cache-Control', 'no-store')
    return c.html(<AdminR2CleanupPage report={report} />)
  })
}
