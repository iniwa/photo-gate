import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import type { Env } from '../types/env.js'
import type { AdminAuthConfig } from '../types/admin-auth.js'
import type { AdminUserPage } from '../types/admin-user.js'
import type { AdminAlbumPage } from '../types/admin-album.js'
import type { AssignmentOptions } from '../types/admin-permission.js'
import type { AdminOpsSummary } from '../types/admin-ops.js'
import type { AdminSyncStatus } from '../types/admin-sync-status.js'
import type { AdminSyncRequest } from '../types/admin-sync-request.js'
import type { AdminAlbumCatalogEntry } from '../types/admin-album-catalog.js'
import type { AdminSyncTarget } from '../types/admin-sync-target.js'
import type { AdminCatalogRefreshRequest } from '../types/admin-catalog-refresh-request.js'
import type { AdminSyncResult } from '../types/admin-sync-result.js'
import type { AdminAlbumReadinessFact } from '../types/admin-album-readiness.js'
import type { AdminR2CleanupReport } from '../types/admin-r2-cleanup.js'
import { AdminHome } from './admin-pages.js'
import { requireAdmin } from '../middleware/require-admin.js'
import {
  handleR2CleanupConfirm,
  handleR2CleanupDelete,
} from './admin-r2-cleanup-delete.js'
import {
  handleAlbumHardDeleteConfirm,
  handleAlbumHardDeletePreview,
  handleUserHardDeleteConfirm,
  handleUserHardDeletePreview,
} from './admin-hard-delete.js'
import { registerAdminInventoryRoutes } from './admin-inventory-routes.js'
import { registerAdminMutationRoutes } from './admin-mutation-routes.js'
import { registerAdminSyncRoutes } from './admin-sync-routes.js'

type AdminEnv = { Bindings: Env }

export interface AdminRouteDeps {
  userRepo: {
    listUsers(afterUserId?: string): Promise<AdminUserPage>
    setUserEnabled(userId: string, enabled: number, updatedAt: string): Promise<void>
    createUser(userId: string, displayName: string, passwordHash: string, createdAt: string, updatedAt: string): Promise<void>
    resetPassword(userId: string, passwordHash: string, updatedAt: string): Promise<void>
    updateDisplayName(userId: string, displayName: string, updatedAt: string): Promise<void>
    getUserForHardDelete?(userId: string): Promise<{ id: string; display_name: string; enabled: 0 | 1 } | null>
    deleteUser?(userId: string): Promise<void>
  }
  albumRepo: {
    listAlbums(afterAlbumId?: string): Promise<AdminAlbumPage>
    setAlbumEnabled(albumId: string, enabled: number, updatedAt: string): Promise<void>
    updatePublicMetadata(albumId: string, title: string, expiresAt: string | null, downloadEnabled: number, updatedAt: string): Promise<void>
    createAlbum(albumId: string, title: string, photoprismAlbumUid: string, expiresAt: string | null, downloadEnabled: 0 | 1, createdAt: string, updatedAt: string): Promise<void>
    getAlbumForSync(albumId: string): Promise<{ id: string; title: string; expires_at: string | null; download_enabled: 0 | 1 } | null>
    getAlbumForHardDelete?(albumId: string): Promise<{ id: string; title: string; enabled: 0 | 1 } | null>
    deleteAlbum?(albumId: string): Promise<void>
  }
  syncTargetRepo: {
    upsertTarget(albumId: string, catalogId: string, title: string, expiresAt: string | null, downloadEnabled: 0 | 1, publishedAt: string): Promise<void>
    removeTarget(albumId: string, publishedAt: string): Promise<void>
    getTargets?(): Promise<AdminSyncTarget[]>
  }
  permissionRepo: {
    listAssignmentOptions(after?: { albumId: string; userId: string }): Promise<AssignmentOptions>
    grantPermission(albumId: string, userId: string, createdAt: string): Promise<void>
    revokePermission(albumId: string, userId: string): Promise<void>
  }
  opsRepo: {
    getSummary(now: string, expiringSoonUntil: string): Promise<AdminOpsSummary>
  }
  syncStatusRepo: {
    getStatus(): Promise<{ status: 'missing' } | { status: 'found'; value: AdminSyncStatus }>
  }
  syncRequestRepo: {
    writeRequest(req: AdminSyncRequest): Promise<void | 'created' | 'already-pending'>
    getPendingRequest(): Promise<
      | { status: 'missing' }
      | { status: 'found'; value: AdminSyncRequest }
    >
  }
  catalogRefreshRequestRepo?: {
    writeRequest(req: AdminCatalogRefreshRequest): Promise<void | 'created' | 'already-pending'>
    getPendingRequest(): Promise<
      | { status: 'missing' }
      | { status: 'found'; value: AdminCatalogRefreshRequest }
    >
  }
  syncResultRepo?: {
    getResult(): Promise<{ status: 'missing' } | { status: 'found'; value: AdminSyncResult }>
  }
  albumReadinessRepo?: {
    getFacts(albumIds: readonly string[]): Promise<AdminAlbumReadinessFact[]>
  }
  catalogRepo: {
    getCatalog(): Promise<
      | { status: 'missing' }
      | { status: 'available'; publishedAt: string; albums: AdminAlbumCatalogEntry[] }
    >
    hasCatalogId(catalogId: string): Promise<boolean>
  }
  clock: () => Date
  r2CleanupRepo: {
    getReport(): Promise<AdminR2CleanupReport>
  }
}

/**
 * Admin surface, mounted at `/admin` by index.tsx before the reserved-401 loop.
 * The central router owns only the Access guard, composition, and the destructive
 * confirmation routes; feature modules register the routine inventory, sync, and
 * mutation handlers below the same guard.
 */
export function createAdminRoutes(
  resolveAuthFromEnv: (env: Env) => AdminAuthConfig | null,
  depsFromEnv: (env: Env) => AdminRouteDeps,
): Hono<AdminEnv> {
  const admin = new Hono<AdminEnv>()

  const guard: MiddlewareHandler<AdminEnv> = async (c, next) => {
    const middleware = requireAdmin(() => resolveAuthFromEnv(c.env)) as
      unknown as MiddlewareHandler<AdminEnv>
    return middleware(c, next)
  }
  admin.use('*', guard)

  admin.get('/', (c) => {
    c.header('Cache-Control', 'no-store')
    return c.html(<AdminHome />)
  })

  registerAdminInventoryRoutes(admin, depsFromEnv)

  // R2 cleanup Phase 2: confirmation and deletion-preview routes. Both run after
  // the admin guard; actual R2 deletion remains disabled.
  admin.post('/r2-cleanup/confirm', async (c) => {
    const deps = depsFromEnv(c.env)
    return handleR2CleanupConfirm(c, {
      hmacKey: c.env.R2_CLEANUP_HMAC_KEY,
      r2CleanupRepo: deps.r2CleanupRepo,
      clock: deps.clock,
    })
  })

  admin.post('/r2-cleanup/delete', async (c) => {
    const deps = depsFromEnv(c.env)
    return handleR2CleanupDelete(c, {
      hmacKey: c.env.R2_CLEANUP_HMAC_KEY,
      r2CleanupRepo: deps.r2CleanupRepo,
      clock: deps.clock,
    })
  })

  registerAdminSyncRoutes(admin, depsFromEnv)
  registerAdminMutationRoutes(admin, depsFromEnv)

  // Admin hard-delete routes. User delete performs the approved D1 DELETE after
  // the two-step guard; album delete removes its sync target, then the D1 row.
  admin.post('/users/confirm-delete', async (c) => {
    const deps = depsFromEnv(c.env)
    return handleUserHardDeleteConfirm(c, {
      hmacKey: c.env.HARD_DELETE_HMAC_KEY,
      userRepo: {
        getUserForHardDelete: (userId) => {
          if (deps.userRepo.getUserForHardDelete === undefined) throw new Error('hard delete user repo unavailable')
          return deps.userRepo.getUserForHardDelete(userId)
        },
        deleteUser: (userId) => {
          if (deps.userRepo.deleteUser === undefined) throw new Error('hard delete user repo unavailable')
          return deps.userRepo.deleteUser(userId)
        },
      },
      albumRepo: {
        getAlbumForHardDelete: (albumId) => {
          if (deps.albumRepo.getAlbumForHardDelete === undefined) throw new Error('hard delete album repo unavailable')
          return deps.albumRepo.getAlbumForHardDelete(albumId)
        },
        deleteAlbum: (albumId) => {
          if (deps.albumRepo.deleteAlbum === undefined) throw new Error('hard delete album repo unavailable')
          return deps.albumRepo.deleteAlbum(albumId)
        },
      },
      syncTargetRepo: { removeTarget: (albumId, publishedAt) => deps.syncTargetRepo.removeTarget(albumId, publishedAt) },
      clock: deps.clock,
    })
  })

  admin.post('/users/delete', async (c) => {
    const deps = depsFromEnv(c.env)
    return handleUserHardDeletePreview(c, {
      hmacKey: c.env.HARD_DELETE_HMAC_KEY,
      userRepo: {
        getUserForHardDelete: (userId) => {
          if (deps.userRepo.getUserForHardDelete === undefined) throw new Error('hard delete user repo unavailable')
          return deps.userRepo.getUserForHardDelete(userId)
        },
        deleteUser: (userId) => {
          if (deps.userRepo.deleteUser === undefined) throw new Error('hard delete user repo unavailable')
          return deps.userRepo.deleteUser(userId)
        },
      },
      albumRepo: {
        getAlbumForHardDelete: (albumId) => {
          if (deps.albumRepo.getAlbumForHardDelete === undefined) throw new Error('hard delete album repo unavailable')
          return deps.albumRepo.getAlbumForHardDelete(albumId)
        },
        deleteAlbum: (albumId) => {
          if (deps.albumRepo.deleteAlbum === undefined) throw new Error('hard delete album repo unavailable')
          return deps.albumRepo.deleteAlbum(albumId)
        },
      },
      syncTargetRepo: { removeTarget: (albumId, publishedAt) => deps.syncTargetRepo.removeTarget(albumId, publishedAt) },
      clock: deps.clock,
    })
  })

  admin.post('/albums/confirm-delete', async (c) => {
    const deps = depsFromEnv(c.env)
    return handleAlbumHardDeleteConfirm(c, {
      hmacKey: c.env.HARD_DELETE_HMAC_KEY,
      userRepo: {
        getUserForHardDelete: (userId) => {
          if (deps.userRepo.getUserForHardDelete === undefined) throw new Error('hard delete user repo unavailable')
          return deps.userRepo.getUserForHardDelete(userId)
        },
        deleteUser: (userId) => {
          if (deps.userRepo.deleteUser === undefined) throw new Error('hard delete user repo unavailable')
          return deps.userRepo.deleteUser(userId)
        },
      },
      albumRepo: {
        getAlbumForHardDelete: (albumId) => {
          if (deps.albumRepo.getAlbumForHardDelete === undefined) throw new Error('hard delete album repo unavailable')
          return deps.albumRepo.getAlbumForHardDelete(albumId)
        },
        deleteAlbum: (albumId) => {
          if (deps.albumRepo.deleteAlbum === undefined) throw new Error('hard delete album repo unavailable')
          return deps.albumRepo.deleteAlbum(albumId)
        },
      },
      syncTargetRepo: { removeTarget: (albumId, publishedAt) => deps.syncTargetRepo.removeTarget(albumId, publishedAt) },
      clock: deps.clock,
    })
  })

  admin.post('/albums/delete', async (c) => {
    const deps = depsFromEnv(c.env)
    return handleAlbumHardDeletePreview(c, {
      hmacKey: c.env.HARD_DELETE_HMAC_KEY,
      userRepo: {
        getUserForHardDelete: (userId) => {
          if (deps.userRepo.getUserForHardDelete === undefined) throw new Error('hard delete user repo unavailable')
          return deps.userRepo.getUserForHardDelete(userId)
        },
        deleteUser: (userId) => {
          if (deps.userRepo.deleteUser === undefined) throw new Error('hard delete user repo unavailable')
          return deps.userRepo.deleteUser(userId)
        },
      },
      albumRepo: {
        getAlbumForHardDelete: (albumId) => {
          if (deps.albumRepo.getAlbumForHardDelete === undefined) throw new Error('hard delete album repo unavailable')
          return deps.albumRepo.getAlbumForHardDelete(albumId)
        },
        deleteAlbum: (albumId) => {
          if (deps.albumRepo.deleteAlbum === undefined) throw new Error('hard delete album repo unavailable')
          return deps.albumRepo.deleteAlbum(albumId)
        },
      },
      syncTargetRepo: { removeTarget: (albumId, publishedAt) => deps.syncTargetRepo.removeTarget(albumId, publishedAt) },
      clock: deps.clock,
    })
  })

  // Any other method/path under /admin stays behind the guard and returns a
  // generic authenticated 404 — never the viewer router, never any data.
  admin.all('*', (c) => {
    c.header('Cache-Control', 'no-store')
    return c.text('Not Found', 404)
  })

  return admin
}
