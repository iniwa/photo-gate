import { Hono } from 'hono'
import type { Env } from '../types/env.js'
import type { AdminCatalogRefreshRequest } from '../types/admin-catalog-refresh-request.js'
import type { AdminSyncRequest } from '../types/admin-sync-request.js'
import type { AdminSyncResult } from '../types/admin-sync-result.js'
import type { AdminSyncStatus } from '../types/admin-sync-status.js'
import { forbiddenResponse } from '../middleware/auth-response.js'
import {
  isFormContentType,
  isSameOrigin,
  parseCatalogRefreshRequestFields,
  parseSyncRequestFields,
} from './admin-form.js'
import { AdminSyncPage } from './admin-pages.js'
import type { AdminRouteDeps } from './admin.js'

type AdminEnv = { Bindings: Env }

type SyncRouteDeps = Pick<
  AdminRouteDeps,
  'clock' | 'syncStatusRepo' | 'syncRequestRepo' | 'catalogRefreshRequestRepo' | 'syncResultRepo'
>

/**
 * Registers read-only sync status and coalesced request routes on the existing
 * authenticated admin router. The request payload and Docker consumption
 * contract remain unchanged; a second concurrent request joins the pending R2
 * object instead of overwriting it.
 */
export function registerAdminSyncRoutes(
  admin: Hono<AdminEnv>,
  depsFromEnv: (env: Env) => SyncRouteDeps,
): void {
  admin.get('/sync', async (c) => {
    const deps = depsFromEnv(c.env)
    let result: { status: 'missing' } | { status: 'found'; value: AdminSyncStatus }
    let pendingResult: { status: 'missing' } | { status: 'found'; value: AdminSyncRequest }
    let catalogPendingResult: { status: 'missing' } | { status: 'found'; value: AdminCatalogRefreshRequest }
    let syncResult: { status: 'missing' } | { status: 'found'; value: AdminSyncResult }
    try {
      ;[result, pendingResult, catalogPendingResult, syncResult] = await Promise.all([
        deps.syncStatusRepo.getStatus(),
        deps.syncRequestRepo.getPendingRequest(),
        deps.catalogRefreshRequestRepo === undefined
          ? Promise.resolve({ status: 'missing' } as const)
          : deps.catalogRefreshRequestRepo.getPendingRequest(),
        deps.syncResultRepo === undefined
          ? Promise.resolve({ status: 'missing' } as const)
          : deps.syncResultRepo.getResult(),
      ])
    } catch {
      c.header('Cache-Control', 'no-store')
      return c.text('Internal Server Error', 500)
    }
    const isSyncPending = pendingResult.status === 'found'
    const isCatalogRefreshPending = catalogPendingResult.status === 'found'
    c.header('Cache-Control', 'no-store')
    return c.html(
      <AdminSyncPage
        syncStatus={result.status === 'found' ? result.value : null}
        isSyncPending={isSyncPending}
        isCatalogRefreshPending={isCatalogRefreshPending}
        syncResult={syncResult.status === 'found' ? syncResult.value : null}
      />,
    )
  })

  admin.post('/sync/request', async (c) => {
    if (!isSameOrigin(c)) return forbiddenResponse(c)
    if (!isFormContentType(c.req.header('Content-Type'))) {
      c.header('Cache-Control', 'no-store')
      return c.text('Bad Request', 400)
    }
    const fields = await parseSyncRequestFields(c)
    if (fields === null) {
      c.header('Cache-Control', 'no-store')
      return c.text('Bad Request', 400)
    }

    let requestId: string
    try {
      requestId = crypto.randomUUID().replaceAll('-', '')
    } catch {
      c.header('Cache-Control', 'no-store')
      return c.text('Internal Server Error', 500)
    }

    try {
      const deps = depsFromEnv(c.env)
      await deps.syncRequestRepo.writeRequest({
        schema: 1,
        requestId,
        requestedAt: deps.clock().toISOString(),
        kind: fields.kind,
      })
    } catch {
      c.header('Cache-Control', 'no-store')
      return c.text('Internal Server Error', 500)
    }

    c.header('Cache-Control', 'no-store')
    c.header('Location', '/admin/sync')
    return c.body(null, 303)
  })

  admin.post('/catalog-refresh/request', async (c) => {
    if (!isSameOrigin(c)) return forbiddenResponse(c)
    if (!isFormContentType(c.req.header('Content-Type'))) {
      c.header('Cache-Control', 'no-store')
      return c.text('Bad Request', 400)
    }
    const fields = await parseCatalogRefreshRequestFields(c)
    if (fields === null) {
      c.header('Cache-Control', 'no-store')
      return c.text('Bad Request', 400)
    }

    let requestId: string
    try {
      requestId = crypto.randomUUID().replaceAll('-', '')
    } catch {
      c.header('Cache-Control', 'no-store')
      return c.text('Internal Server Error', 500)
    }

    try {
      const deps = depsFromEnv(c.env)
      if (deps.catalogRefreshRequestRepo === undefined) throw new Error('catalog refresh unavailable')
      await deps.catalogRefreshRequestRepo.writeRequest({
        schema: 1,
        requestId,
        requestedAt: deps.clock().toISOString(),
        kind: fields.kind,
      })
    } catch {
      c.header('Cache-Control', 'no-store')
      return c.text('Internal Server Error', 500)
    }

    c.header('Cache-Control', 'no-store')
    c.header('Location', '/admin/sync')
    return c.body(null, 303)
  })
}
