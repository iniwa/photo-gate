import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Env } from '../types/env.js'
import { forbiddenResponse } from '../middleware/auth-response.js'
import { hashPassword } from '../services/auth-crypto.js'
import { PBKDF2_PRODUCTION_ITERATIONS } from '../services/login-policy.js'
import {
  isFormContentType,
  isSameOrigin,
  parseAlbumIdField,
  parseCreateAlbumFields,
  parseCreateUserFields,
  parseMutationFields,
  parseResetPasswordFields,
  parseSyncTargetRemoveFields,
  parseSyncTargetUpsertFields,
  parseUpdateDisplayNameFields,
  parseUpdatePublicMetadataFields,
  parseUserIdField,
} from './admin-form.js'
import type { AdminRouteDeps } from './admin.js'

type AdminEnv = { Bindings: Env }
type AdminContext = Context<AdminEnv>

type MutationRouteDeps = Pick<
  AdminRouteDeps,
  'userRepo' | 'albumRepo' | 'syncTargetRepo' | 'permissionRepo' | 'catalogRepo' | 'clock'
>

/**
 * Registers routine, authenticated admin mutations. The parent admin router
 * owns the Access guard; every handler preserves the established form guards
 * and fixed sanitized failures.
 */
export function registerAdminMutationRoutes(
  admin: Hono<AdminEnv>,
  depsFromEnv: (env: Env) => MutationRouteDeps,
): void {
  // Permission mutations run after the parent admin guard, then enforce strict
  // same-origin, exact form Content-Type, and exactly two valid IDs.
  admin.post('/permissions/grant', async (c) => {
    if (!isSameOrigin(c)) return forbiddenResponse(c)
    if (!isFormContentType(c.req.header('Content-Type'))) {
      c.header('Cache-Control', 'no-store')
      return c.text('Bad Request', 400)
    }
    const fields = await parseMutationFields(c)
    if (fields === null) {
      c.header('Cache-Control', 'no-store')
      return c.text('Bad Request', 400)
    }

    try {
      const deps = depsFromEnv(c.env)
      const createdAt = deps.clock().toISOString()
      await deps.permissionRepo.grantPermission(fields.albumId, fields.userId, createdAt)
    } catch {
      c.header('Cache-Control', 'no-store')
      return c.text('Internal Server Error', 500)
    }

    c.header('Cache-Control', 'no-store')
    c.header('Location', '/admin/permissions')
    return c.body(null, 303)
  })

  admin.post('/permissions/revoke', async (c) => {
    if (!isSameOrigin(c)) return forbiddenResponse(c)
    if (!isFormContentType(c.req.header('Content-Type'))) {
      c.header('Cache-Control', 'no-store')
      return c.text('Bad Request', 400)
    }
    const fields = await parseMutationFields(c)
    if (fields === null) {
      c.header('Cache-Control', 'no-store')
      return c.text('Bad Request', 400)
    }

    try {
      await depsFromEnv(c.env).permissionRepo.revokePermission(fields.albumId, fields.userId)
    } catch {
      c.header('Cache-Control', 'no-store')
      return c.text('Internal Server Error', 500)
    }

    c.header('Cache-Control', 'no-store')
    c.header('Location', '/admin/permissions')
    return c.body(null, 303)
  })

  const handleSetEnabled = async (c: AdminContext, enabled: 0 | 1): Promise<Response> => {
    if (!isSameOrigin(c)) return forbiddenResponse(c)
    if (!isFormContentType(c.req.header('Content-Type'))) {
      c.header('Cache-Control', 'no-store')
      return c.text('Bad Request', 400)
    }
    const fields = await parseAlbumIdField(c)
    if (fields === null) {
      c.header('Cache-Control', 'no-store')
      return c.text('Bad Request', 400)
    }

    const deps = depsFromEnv(c.env)
    let updatedAt: string
    try {
      updatedAt = deps.clock().toISOString()
    } catch {
      c.header('Cache-Control', 'no-store')
      return c.text('Internal Server Error', 500)
    }

    try {
      await deps.albumRepo.setAlbumEnabled(fields.albumId, enabled, updatedAt)
    } catch {
      c.header('Cache-Control', 'no-store')
      return c.text('Internal Server Error', 500)
    }

    c.header('Cache-Control', 'no-store')
    c.header('Location', '/admin/albums')
    return c.body(null, 303)
  }

  admin.post('/albums/enable', (c) => handleSetEnabled(c, 1))
  admin.post('/albums/disable', (c) => handleSetEnabled(c, 0))

  admin.post('/albums/update-public-metadata', async (c) => {
    if (!isSameOrigin(c)) return forbiddenResponse(c)
    if (!isFormContentType(c.req.header('Content-Type'))) {
      c.header('Cache-Control', 'no-store')
      return c.text('Bad Request', 400)
    }
    const fields = await parseUpdatePublicMetadataFields(c)
    if (fields === null) {
      c.header('Cache-Control', 'no-store')
      return c.text('Bad Request', 400)
    }

    const deps = depsFromEnv(c.env)
    let updatedAt: string
    try {
      updatedAt = deps.clock().toISOString()
    } catch {
      c.header('Cache-Control', 'no-store')
      return c.text('Internal Server Error', 500)
    }

    try {
      await deps.albumRepo.updatePublicMetadata(
        fields.albumId,
        fields.title,
        fields.expiresAt,
        fields.downloadEnabled,
        updatedAt,
      )
    } catch {
      c.header('Cache-Control', 'no-store')
      return c.text('Internal Server Error', 500)
    }

    c.header('Cache-Control', 'no-store')
    c.header('Location', '/admin/albums')
    return c.body(null, 303)
  })

  const handleSetUserEnabled = async (c: AdminContext, enabled: 0 | 1): Promise<Response> => {
    if (!isSameOrigin(c)) return forbiddenResponse(c)
    if (!isFormContentType(c.req.header('Content-Type'))) {
      c.header('Cache-Control', 'no-store')
      return c.text('Bad Request', 400)
    }
    const fields = await parseUserIdField(c)
    if (fields === null) {
      c.header('Cache-Control', 'no-store')
      return c.text('Bad Request', 400)
    }

    const deps = depsFromEnv(c.env)
    let updatedAt: string
    try {
      updatedAt = deps.clock().toISOString()
    } catch {
      c.header('Cache-Control', 'no-store')
      return c.text('Internal Server Error', 500)
    }

    try {
      await deps.userRepo.setUserEnabled(fields.userId, enabled, updatedAt)
    } catch {
      c.header('Cache-Control', 'no-store')
      return c.text('Internal Server Error', 500)
    }

    c.header('Cache-Control', 'no-store')
    c.header('Location', '/admin/users')
    return c.body(null, 303)
  }

  admin.post('/users/enable', (c) => handleSetUserEnabled(c, 1))
  admin.post('/users/disable', (c) => handleSetUserEnabled(c, 0))

  admin.post('/users/create', async (c) => {
    if (!isSameOrigin(c)) return forbiddenResponse(c)
    if (!isFormContentType(c.req.header('Content-Type'))) {
      c.header('Cache-Control', 'no-store')
      return c.text('Bad Request', 400)
    }
    const fields = await parseCreateUserFields(c)
    if (fields === null) {
      c.header('Cache-Control', 'no-store')
      return c.text('Bad Request', 400)
    }

    const deps = depsFromEnv(c.env)
    let createdAt: string
    try {
      createdAt = deps.clock().toISOString()
    } catch {
      c.header('Cache-Control', 'no-store')
      return c.text('Internal Server Error', 500)
    }

    let passwordHash: string
    try {
      passwordHash = await hashPassword(fields.password, PBKDF2_PRODUCTION_ITERATIONS)
    } catch {
      c.header('Cache-Control', 'no-store')
      return c.text('Internal Server Error', 500)
    }

    try {
      await deps.userRepo.createUser(fields.userId, fields.displayName, passwordHash, createdAt, createdAt)
    } catch {
      c.header('Cache-Control', 'no-store')
      return c.text('Internal Server Error', 500)
    }

    c.header('Cache-Control', 'no-store')
    c.header('Location', '/admin/users')
    return c.body(null, 303)
  })

  admin.post('/users/reset-password', async (c) => {
    if (!isSameOrigin(c)) return forbiddenResponse(c)
    if (!isFormContentType(c.req.header('Content-Type'))) {
      c.header('Cache-Control', 'no-store')
      return c.text('Bad Request', 400)
    }
    const fields = await parseResetPasswordFields(c)
    if (fields === null) {
      c.header('Cache-Control', 'no-store')
      return c.text('Bad Request', 400)
    }

    const deps = depsFromEnv(c.env)
    let updatedAt: string
    try {
      updatedAt = deps.clock().toISOString()
    } catch {
      c.header('Cache-Control', 'no-store')
      return c.text('Internal Server Error', 500)
    }

    let passwordHash: string
    try {
      passwordHash = await hashPassword(fields.password, PBKDF2_PRODUCTION_ITERATIONS)
    } catch {
      c.header('Cache-Control', 'no-store')
      return c.text('Internal Server Error', 500)
    }

    try {
      await deps.userRepo.resetPassword(fields.userId, passwordHash, updatedAt)
    } catch {
      c.header('Cache-Control', 'no-store')
      return c.text('Internal Server Error', 500)
    }

    c.header('Cache-Control', 'no-store')
    c.header('Location', '/admin/users')
    return c.body(null, 303)
  })

  admin.post('/users/update-display-name', async (c) => {
    if (!isSameOrigin(c)) return forbiddenResponse(c)
    if (!isFormContentType(c.req.header('Content-Type'))) {
      c.header('Cache-Control', 'no-store')
      return c.text('Bad Request', 400)
    }
    const fields = await parseUpdateDisplayNameFields(c)
    if (fields === null) {
      c.header('Cache-Control', 'no-store')
      return c.text('Bad Request', 400)
    }

    const deps = depsFromEnv(c.env)
    let updatedAt: string
    try {
      updatedAt = deps.clock().toISOString()
    } catch {
      c.header('Cache-Control', 'no-store')
      return c.text('Internal Server Error', 500)
    }

    try {
      await deps.userRepo.updateDisplayName(fields.userId, fields.displayName, updatedAt)
    } catch {
      c.header('Cache-Control', 'no-store')
      return c.text('Internal Server Error', 500)
    }

    c.header('Cache-Control', 'no-store')
    c.header('Location', '/admin/users')
    return c.body(null, 303)
  })

  admin.post('/albums/create', async (c) => {
    if (!isSameOrigin(c)) return forbiddenResponse(c)
    if (!isFormContentType(c.req.header('Content-Type'))) {
      c.header('Cache-Control', 'no-store')
      return c.text('Bad Request', 400)
    }
    const fields = await parseCreateAlbumFields(c)
    if (fields === null) {
      c.header('Cache-Control', 'no-store')
      return c.text('Bad Request', 400)
    }

    const deps = depsFromEnv(c.env)
    let createdAt: string
    try {
      createdAt = deps.clock().toISOString()
    } catch {
      c.header('Cache-Control', 'no-store')
      return c.text('Internal Server Error', 500)
    }

    try {
      await deps.albumRepo.createAlbum(
        fields.albumId,
        fields.title,
        fields.photoprismAlbumUid,
        fields.expiresAt,
        fields.downloadEnabled,
        createdAt,
        createdAt,
      )
    } catch {
      c.header('Cache-Control', 'no-store')
      return c.text('Internal Server Error', 500)
    }

    c.header('Cache-Control', 'no-store')
    c.header('Location', '/admin/albums')
    return c.body(null, 303)
  })

  admin.post('/albums/sync-target-upsert', async (c) => {
    if (!isSameOrigin(c)) return forbiddenResponse(c)
    if (!isFormContentType(c.req.header('Content-Type'))) {
      c.header('Cache-Control', 'no-store')
      return c.text('Bad Request', 400)
    }
    const fields = await parseSyncTargetUpsertFields(c)
    if (fields === null) {
      c.header('Cache-Control', 'no-store')
      return c.text('Bad Request', 400)
    }

    const deps = depsFromEnv(c.env)

    // Catalog check before clock/D1/sync-target write: missing or malformed -> 500,
    // absent catalogId in a valid catalog -> 400.
    let catalogHasId: boolean
    try {
      catalogHasId = await deps.catalogRepo.hasCatalogId(fields.catalogId)
    } catch {
      c.header('Cache-Control', 'no-store')
      return c.text('Internal Server Error', 500)
    }
    if (!catalogHasId) {
      c.header('Cache-Control', 'no-store')
      return c.text('Bad Request', 400)
    }

    let publishedAt: string
    try {
      publishedAt = deps.clock().toISOString()
    } catch {
      c.header('Cache-Control', 'no-store')
      return c.text('Internal Server Error', 500)
    }

    let album: { id: string; title: string; expires_at: string | null; download_enabled: 0 | 1 } | null
    try {
      album = await deps.albumRepo.getAlbumForSync(fields.albumId)
    } catch {
      c.header('Cache-Control', 'no-store')
      return c.text('Internal Server Error', 500)
    }
    if (album === null) {
      c.header('Cache-Control', 'no-store')
      return c.text('Internal Server Error', 500)
    }

    try {
      await deps.syncTargetRepo.upsertTarget(
        fields.albumId,
        fields.catalogId,
        album.title,
        album.expires_at,
        album.download_enabled,
        publishedAt,
      )
    } catch {
      c.header('Cache-Control', 'no-store')
      return c.text('Internal Server Error', 500)
    }

    c.header('Cache-Control', 'no-store')
    c.header('Location', '/admin/albums')
    return c.body(null, 303)
  })

  admin.post('/albums/sync-target-remove', async (c) => {
    if (!isSameOrigin(c)) return forbiddenResponse(c)
    if (!isFormContentType(c.req.header('Content-Type'))) {
      c.header('Cache-Control', 'no-store')
      return c.text('Bad Request', 400)
    }
    const fields = await parseSyncTargetRemoveFields(c)
    if (fields === null) {
      c.header('Cache-Control', 'no-store')
      return c.text('Bad Request', 400)
    }

    const deps = depsFromEnv(c.env)
    let publishedAt: string
    try {
      publishedAt = deps.clock().toISOString()
    } catch {
      c.header('Cache-Control', 'no-store')
      return c.text('Internal Server Error', 500)
    }

    try {
      await deps.syncTargetRepo.removeTarget(fields.albumId, publishedAt)
    } catch {
      c.header('Cache-Control', 'no-store')
      return c.text('Internal Server Error', 500)
    }

    c.header('Cache-Control', 'no-store')
    c.header('Location', '/admin/albums')
    return c.body(null, 303)
  })
}
