import { Hono } from 'hono'
import type { Context, MiddlewareHandler } from 'hono'
import type { Env } from '../types/env.js'
import type { AdminAuthConfig } from '../types/admin-auth.js'
import type { AdminUserPage } from '../types/admin-user.js'
import type { AdminAlbumPage } from '../types/admin-album.js'
import type { AssignmentOptions } from '../types/admin-permission.js'
import type { AdminOpsSummary } from '../types/admin-ops.js'
import type { AdminSyncStatus } from '../types/admin-sync-status.js'
import type { AdminSyncRequest } from '../types/admin-sync-request.js'
import type { AdminAlbumCatalogEntry } from '../types/admin-album-catalog.js'
import { Layout } from '../templates/layout.js'
import { requireAdmin } from '../middleware/require-admin.js'
import { forbiddenResponse } from '../middleware/auth-response.js'
import { isValidId } from '../services/repository-validation.js'
import { hashPassword } from '../services/auth-crypto.js'
import { PBKDF2_PRODUCTION_ITERATIONS } from '../services/login-policy.js'
import type { AdminR2CleanupReport } from '../types/admin-r2-cleanup.js'
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

type AdminEnv = { Bindings: Env }
type AdminContext = Context<AdminEnv>

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
    writeRequest(req: AdminSyncRequest): Promise<void>
    getPendingRequest(): Promise<
      | { status: 'missing' }
      | { status: 'found'; value: AdminSyncRequest }
    >
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
 * Strict same-origin guard for admin mutations. Unlike the viewer login (which
 * tolerates a missing Origin), every admin mutation requires an Origin header
 * that exactly equals the request URL origin. An absent, literal `null`,
 * malformed, or mismatched Origin fails closed. The request URL origin is
 * recomputed per request; nothing is interpolated.
 */
function isSameOrigin(c: AdminContext): boolean {
  const origin = c.req.header('Origin')
  if (origin === undefined || origin === 'null') return false
  let requestOrigin: string
  try {
    requestOrigin = new URL(c.req.url).origin
  } catch {
    return false
  }
  return origin === requestOrigin
}

/** A request body Content-Type that is exactly the URL-encoded form type (optional charset). */
function isFormContentType(contentType: string | undefined): boolean {
  if (contentType === undefined) return false
  const parts = contentType.split(';')
  if (parts[0]?.trim().toLowerCase() !== 'application/x-www-form-urlencoded') {
    return false
  }
  if (parts.length === 1) return true
  if (parts.length !== 2) return false
  return /^charset\s*=\s*(?:"[^"]+"|[a-z0-9._-]+)$/i.test(parts[1]!.trim())
}

/**
 * Parse and strictly validate an admin mutation body. Returns the two validated
 * IDs, or `null` for any ambiguity. Uses `{ all: true }` so a repeated field
 * arrives as an array and is rejected. Requires exactly two keys, both single
 * string values named `albumId` and `userId`, each passing the canonical ID
 * rule. Missing, repeated, file-valued, additional, or invalid fields all yield
 * `null`. Input is never reflected and no repository or clock is touched here.
 */
async function parseMutationFields(
  c: AdminContext,
): Promise<{ albumId: string; userId: string } | null> {
  let body: Record<string, string | File | (string | File)[]>
  try {
    body = await c.req.parseBody({ all: true })
  } catch {
    return null
  }
  if (Object.keys(body).length !== 2) return null
  const albumId = body['albumId']
  const userId = body['userId']
  if (typeof albumId !== 'string' || typeof userId !== 'string') return null
  if (!isValidId(albumId) || !isValidId(userId)) return null
  return { albumId, userId }
}

/**
 * Parse and strictly validate a single-field admin album mutation body. Returns
 * the one validated ID, or `null` for any ambiguity. Same strictness as
 * `parseMutationFields` but for exactly one key `albumId`: a repeated field
 * arrives as an array (rejected), and any extra/missing/file-valued/invalid
 * field yields `null`. Input is never reflected and no repository or clock is
 * touched here.
 */
async function parseAlbumIdField(
  c: AdminContext,
): Promise<{ albumId: string } | null> {
  let body: Record<string, string | File | (string | File)[]>
  try {
    body = await c.req.parseBody({ all: true })
  } catch {
    return null
  }
  if (Object.keys(body).length !== 1) return null
  const albumId = body['albumId']
  if (typeof albumId !== 'string') return null
  if (!isValidId(albumId)) return null
  return { albumId }
}

async function parseUserIdField(
  c: AdminContext,
): Promise<{ userId: string } | null> {
  let body: Record<string, string | File | (string | File)[]>
  try {
    body = await c.req.parseBody({ all: true })
  } catch {
    return null
  }
  if (Object.keys(body).length !== 1) return null
  const userId = body['userId']
  if (typeof userId !== 'string') return null
  if (!isValidId(userId)) return null
  return { userId }
}

const ADMIN_DISPLAY_NAME_MAX_CODE_POINTS = 1024

function isValidDisplayName(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (value.length === 0) return false
  if (/^\s|\s$/.test(value)) return false
  if (/[\x00-\x1f\x7f]/.test(value)) return false
  if (Array.from(value).length > ADMIN_DISPLAY_NAME_MAX_CODE_POINTS) return false
  return true
}

function isValidPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 1024
}

const ADMIN_TITLE_MAX_CODE_POINTS = 1024

function isValidTitle(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (value.length === 0) return false
  if (/^\s|\s$/.test(value)) return false
  if (/[\x00-\x1f\x7f]/.test(value)) return false
  if (Array.from(value).length > ADMIN_TITLE_MAX_CODE_POINTS) return false
  return true
}

function isValidExpiresAt(value: unknown): boolean {
  if (typeof value !== 'string') return false
  if (value === '') return true
  const parsed = new Date(value)
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value
}

function isValidDownloadEnabled(value: unknown): value is '0' | '1' {
  return value === '0' || value === '1'
}

async function parseUpdatePublicMetadataFields(
  c: AdminContext,
): Promise<{ albumId: string; title: string; expiresAt: string | null; downloadEnabled: 0 | 1 } | null> {
  let body: Record<string, string | File | (string | File)[]>
  try {
    body = await c.req.parseBody({ all: true })
  } catch {
    return null
  }
  if (Object.keys(body).length !== 4) return null
  const albumId = body['albumId']
  const title = body['title']
  const expiresAt = body['expiresAt']
  const downloadEnabled = body['downloadEnabled']
  if (
    typeof albumId !== 'string' ||
    typeof title !== 'string' ||
    typeof expiresAt !== 'string' ||
    typeof downloadEnabled !== 'string'
  ) return null
  if (!isValidId(albumId)) return null
  if (!isValidTitle(title)) return null
  if (!isValidExpiresAt(expiresAt)) return null
  if (!isValidDownloadEnabled(downloadEnabled)) return null
  return {
    albumId,
    title,
    expiresAt: expiresAt === '' ? null : expiresAt,
    downloadEnabled: Number(downloadEnabled) as 0 | 1,
  }
}

function isValidPhotoprismUid(value: unknown): value is string {
  return typeof value === 'string' && /^[\x21-\x7e]{1,128}$/.test(value)
}

async function parseCreateAlbumFields(
  c: AdminContext,
): Promise<{ albumId: string; title: string; photoprismAlbumUid: string; expiresAt: string | null; downloadEnabled: 0 | 1 } | null> {
  let body: Record<string, string | File | (string | File)[]>
  try {
    body = await c.req.parseBody({ all: true })
  } catch {
    return null
  }
  if (Object.keys(body).length !== 5) return null
  const albumId = body['albumId']
  const title = body['title']
  const photoprismAlbumUid = body['photoprismAlbumUid']
  const expiresAt = body['expiresAt']
  const downloadEnabled = body['downloadEnabled']
  if (
    typeof albumId !== 'string' ||
    typeof title !== 'string' ||
    typeof photoprismAlbumUid !== 'string' ||
    typeof expiresAt !== 'string' ||
    typeof downloadEnabled !== 'string'
  ) return null
  if (!isValidId(albumId)) return null
  if (!isValidTitle(title)) return null
  if (!isValidPhotoprismUid(photoprismAlbumUid)) return null
  if (!isValidExpiresAt(expiresAt)) return null
  if (!isValidDownloadEnabled(downloadEnabled)) return null
  return {
    albumId,
    title,
    photoprismAlbumUid,
    expiresAt: expiresAt === '' ? null : expiresAt,
    downloadEnabled: Number(downloadEnabled) as 0 | 1,
  }
}

async function parseCreateUserFields(
  c: AdminContext,
): Promise<{ userId: string; displayName: string; password: string } | null> {
  let body: Record<string, string | File | (string | File)[]>
  try {
    body = await c.req.parseBody({ all: true })
  } catch {
    return null
  }
  if (Object.keys(body).length !== 3) return null
  const userId = body['userId']
  const displayName = body['displayName']
  const password = body['password']
  if (typeof userId !== 'string' || typeof displayName !== 'string' || typeof password !== 'string') return null
  if (!isValidId(userId)) return null
  if (!isValidDisplayName(displayName)) return null
  if (!isValidPassword(password)) return null
  return { userId, displayName, password }
}

async function parseResetPasswordFields(
  c: AdminContext,
): Promise<{ userId: string; password: string } | null> {
  let body: Record<string, string | File | (string | File)[]>
  try {
    body = await c.req.parseBody({ all: true })
  } catch {
    return null
  }
  if (Object.keys(body).length !== 2) return null
  const userId = body['userId']
  const password = body['password']
  if (typeof userId !== 'string' || typeof password !== 'string') return null
  if (!isValidId(userId)) return null
  if (!isValidPassword(password)) return null
  return { userId, password }
}

async function parseUpdateDisplayNameFields(
  c: AdminContext,
): Promise<{ userId: string; displayName: string } | null> {
  let body: Record<string, string | File | (string | File)[]>
  try {
    body = await c.req.parseBody({ all: true })
  } catch {
    return null
  }
  if (Object.keys(body).length !== 2) return null
  const userId = body['userId']
  const displayName = body['displayName']
  if (typeof userId !== 'string' || typeof displayName !== 'string') return null
  if (!isValidId(userId)) return null
  if (!isValidDisplayName(displayName)) return null
  return { userId, displayName }
}

const CATALOG_ID_RE = /^[0-9a-f]{64}$/

function isValidCatalogId(value: unknown): value is string {
  return typeof value === 'string' && CATALOG_ID_RE.test(value)
}

/**
 * Parse sync-target-upsert body. Exactly two fields: `albumId` (valid ID) and
 * `catalogId` (64 lowercase hex). Missing, repeated, extra, or invalid fields yield null.
 */
async function parseSyncTargetUpsertFields(
  c: AdminContext,
): Promise<{ albumId: string; catalogId: string } | null> {
  let body: Record<string, string | File | (string | File)[]>
  try {
    body = await c.req.parseBody({ all: true })
  } catch {
    return null
  }
  if (Object.keys(body).length !== 2) return null
  const albumId = body['albumId']
  const catalogId = body['catalogId']
  if (typeof albumId !== 'string' || typeof catalogId !== 'string') return null
  if (!isValidId(albumId)) return null
  if (!isValidCatalogId(catalogId)) return null
  return { albumId, catalogId }
}

/**
 * Parse sync-target-remove body. Exactly one field: `albumId` (valid ID).
 */
async function parseSyncTargetRemoveFields(
  c: AdminContext,
): Promise<{ albumId: string } | null> {
  let body: Record<string, string | File | (string | File)[]>
  try {
    body = await c.req.parseBody({ all: true })
  } catch {
    return null
  }
  if (Object.keys(body).length !== 1) return null
  const albumId = body['albumId']
  if (typeof albumId !== 'string') return null
  if (!isValidId(albumId)) return null
  return { albumId }
}

/**
 * Parse and strictly validate the sync-request form body. Returns `{ kind: 'sync-now' }`
 * or `null` for any ambiguity. Exactly one field `kind=sync-now` is accepted; missing,
 * repeated, file-valued, extra, or wrong-value fields all yield `null`. Input is never
 * reflected and no repository or clock is touched here.
 */
async function parseSyncRequestFields(
  c: AdminContext,
): Promise<{ kind: 'sync-now' } | null> {
  let body: Record<string, string | File | (string | File)[]>
  try {
    body = await c.req.parseBody({ all: true })
  } catch {
    return null
  }
  if (Object.keys(body).length !== 1) return null
  const kind = body['kind']
  if (typeof kind !== 'string') return null
  if (kind !== 'sync-now') return null
  return { kind: 'sync-now' }
}

/**
 * Admin surface, mounted at `/admin` by index.tsx BEFORE the reserved-401 loop so
 * it owns every `/admin` and `/admin/*` request and nothing falls through to the
 * public viewer page router.
 *
 *   GET /admin                -> minimal SSR admin page (allowlisted Access identity only)
 *   GET /admin/users          -> read-only user inventory (allowlisted Access identity only)
 *   GET /admin/albums         -> read-only album inventory (allowlisted Access identity only)
 *   GET /admin/permissions    -> read-only permission inventory (allowlisted Access identity only)
 *   everything else           -> authenticated 404 (still behind the admin guard)
 *
 * The guard (`requireAdmin`) runs on every path and method first, so an
 * unauthenticated or non-allowlisted caller always gets the same generic 403
 * regardless of the path — an unknown `/admin/*` path reveals 404 only to a
 * verified administrator. All responses use `Cache-Control: no-store`.
 *
 * password_hash, photoprism_album_uid, transform settings, and session data are
 * never selected, returned, rendered, logged, or exposed.
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

  admin.get('/users', async (c) => {
    // Cursor validation: reject repeated params and invalid IDs before any repo call
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
    // Cursor validation: reject repeated params and invalid IDs before any repo call
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
    try {
      catalog = await deps.catalogRepo.getCatalog()
    } catch {
      c.header('Cache-Control', 'no-store')
      return c.text('Internal Server Error', 500)
    }

    c.header('Cache-Control', 'no-store')
    return c.html(<AdminAlbumsPage page={page} catalog={catalog} />)
  })

  admin.get('/permissions', async (c) => {
    // Composite cursor validation: both params must be present or both absent
    const aa = c.req.queries('after_album') ?? []
    const au = c.req.queries('after_user') ?? []

    if (aa.length > 1 || au.length > 1) {
      c.header('Cache-Control', 'no-store')
      return c.text('Bad Request', 400)
    }

    const a = aa[0]
    const u = au[0]

    // Both-or-neither: providing only one is invalid
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

  admin.get('/sync', async (c) => {
    const deps = depsFromEnv(c.env)
    let result: { status: 'missing' } | { status: 'found'; value: AdminSyncStatus }
    try {
      result = await deps.syncStatusRepo.getStatus()
    } catch {
      c.header('Cache-Control', 'no-store')
      return c.text('Internal Server Error', 500)
    }
    let pendingResult: { status: 'missing' } | { status: 'found'; value: AdminSyncRequest }
    try {
      pendingResult = await deps.syncRequestRepo.getPendingRequest()
    } catch {
      c.header('Cache-Control', 'no-store')
      return c.text('Internal Server Error', 500)
    }
    const isPending = pendingResult.status === 'found'
    c.header('Cache-Control', 'no-store')
    if (result.status === 'missing') {
      return c.html(<AdminSyncPage syncStatus={null} isPending={isPending} />)
    }
    return c.html(<AdminSyncPage syncStatus={result.value} isPending={isPending} />)
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

  // R2 cleanup Phase 2: confirmation and deletion-preview routes. Both run AFTER
  // the admin guard, then enforce: strict same-origin -> exact form Content-Type ->
  // body validation -> HMAC key check -> fresh re-scan. Actual R2 deletion is
  // disabled in Phase 2; the delete route renders a fixed "not yet enabled" page.
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

  // Sync request writer. Runs AFTER the admin guard, then enforces: strict
  // same-origin, exact form Content-Type, exactly one field `kind=sync-now`.
  // Only after all cheap validation passes does it generate a requestId, read
  // the clock, and write to R2. No requestId, timestamp, admin identity, R2
  // key, bucket name, or error detail is reflected or logged.
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
      const requestedAt = deps.clock().toISOString()
      await deps.syncRequestRepo.writeRequest({ schema: 1, requestId, requestedAt, kind: 'sync-now' })
    } catch {
      c.header('Cache-Control', 'no-store')
      return c.text('Internal Server Error', 500)
    }

    c.header('Cache-Control', 'no-store')
    c.header('Location', '/admin/sync')
    return c.body(null, 303)
  })

  // First admin mutations. Both POST routes run AFTER the admin guard (mounted
  // on '*' above), then enforce, in order and before any clock or repository
  // call: strict same-origin, exact form Content-Type, and an exact two-field
  // url-encoded body of valid IDs. Each failure class returns a fixed, no-store,
  // bodyless-or-generic response and never reflects input, reveals a cause, or
  // discloses whether the album or user exists. Success is 303 to the inventory.
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
      // Clock is read only after the request is fully validated. Clock or
      // timestamp serialization failures use the same fixed response as D1
      // failures so every admin outcome remains non-cacheable and sanitized.
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

  // Album enable/disable. Reuses the permission-mutation security contract:
  // guard (above) -> strict same-origin -> exact form Content-Type -> exactly
  // one valid `albumId` -> clock (only after validation) -> single idempotent
  // UPDATE. Enable binds 1, disable binds 0; nothing else differs. Each failure
  // class returns the same fixed, no-store response and never reflects input,
  // reveals a cause, or discloses whether the album exists or changed state.
  // Disabling never touches permission rows.
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
    // Clock is read only after the request is fully validated; a throwing clock
    // or an invalid date (toISOString RangeError) fails closed before any repo.
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

  // Album public metadata update. Same security contract as album enable/disable:
  // guard (above) -> strict same-origin -> exact form Content-Type -> exact field
  // validation -> clock -> single D1 UPDATE. Only title, expires_at,
  // download_enabled, and updated_at are written; enabled, photoprism_album_uid,
  // transform settings, created_at, permissions, sessions, and R2 are never touched.
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

  // User enable/disable. Same security contract as album enable/disable: guard
  // (above) -> strict same-origin -> exact form Content-Type -> exactly one
  // valid `userId` -> clock (only after validation) -> single idempotent UPDATE.
  // Enable binds 1, disable binds 0. Session rows and permission rows are never
  // touched; lockout state is not reset. Re-enabling may restore an unexpired
  // retained session without creating a new one.
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

  // User create and password reset. Same security contract as user enable/disable:
  // guard (above) -> strict same-origin -> exact form Content-Type -> exact field
  // validation -> clock -> hash -> single D1 write. Password is hashed only after
  // all cheap validation passes and is never reflected in any response. Sessions
  // and permissions are never touched.
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

  // User display-name update. Same security contract as user enable/disable:
  // guard (above) -> strict same-origin -> exact form Content-Type -> exact two-field
  // validation (userId, displayName) -> clock -> single D1 UPDATE. Only display_name
  // and updated_at are written; password_hash, enabled, fail_count, locked_until,
  // created_at, sessions, and permissions are never touched. Unknown userId surfaces
  // as a generic 500 (matches reset-password behavior, not the idempotent enable/disable).
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

  // Album create. Same security contract as album update-public-metadata:
  // guard (above) -> strict same-origin -> exact form Content-Type -> exact five-field
  // validation -> clock -> D1 INSERT. enabled is hardcoded to 0; photoprism_album_uid
  // is accepted write-only and never selected, rendered, logged, or returned in errors.
  // Transform/EXIF columns are omitted so schema defaults apply.
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

  // Sync target upsert. Security contract: guard (above) -> strict same-origin ->
  // exact form Content-Type -> exactly two valid fields (albumId, catalogId) ->
  // clock -> D1 read (album for sync) -> R2 read+write (target list). Never selects
  // or renders photoprism_album_uid. Unknown album or malformed existing object → 500.
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

    // Catalog check before clock/D1/sync-target write: missing or malformed → 500,
    // absent catalogId in valid catalog → 400. No clock or repo is touched on failure.
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

  // Sync target remove. Same security contract as upsert: guard (above) ->
  // strict same-origin -> exact form Content-Type -> exactly one valid field (albumId) ->
  // clock -> R2 read+write (target list). Removing a non-existent target is a no-op.
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


  // Admin hard-delete routes. User delete performs the approved Phase 3 D1
  // DELETE after the two-step guard; album delete remains preview-only.
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

/**
 * Minimal admin home page with links to the inventories.
 */
function AdminHome() {
  return (
    <Layout title="管理コンソール">
      <div class="login-box">
        <h1>管理コンソール</h1>
        <p>
          <a href="/admin/users">ユーザー一覧</a>
        </p>
        <p>
          <a href="/admin/albums">アルバム一覧</a>
        </p>
        <p>
          <a href="/admin/permissions">権限一覧</a>
        </p>
        <p>
          <a href="/admin/ops">運用サマリ</a>
        </p>
        <p>
          <a href="/admin/sync">同期状態</a>
        </p>
        <p>
          <a href="/admin/r2-cleanup">R2 クリーンアップレポート（ドライラン）</a>
        </p>
      </div>
    </Layout>
  )
}

/**
 * User inventory page with create-user form and per-row password-reset form.
 * password_hash is never selected, returned, rendered, or logged.
 */
function AdminUsersPage({ page }: { page: AdminUserPage }) {
  const { users, hasMore } = page
  const lastId = users.length > 0 ? users[users.length - 1]!.id : undefined

  return (
    <Layout title="ユーザー一覧">
      <a class="back-link" href="/admin">
        ← 管理コンソールへ
      </a>
      <h1>ユーザー一覧</h1>
      <form class="admin-form" method="post" action="/admin/users/create">
        <h2>ユーザーを作成</h2>
        <label>
          ユーザーID
          <input type="text" name="userId" required />
        </label>
        <label>
          表示名
          <input type="text" name="displayName" required />
        </label>
        <label>
          パスワード
          <input type="password" name="password" required />
        </label>
        <button type="submit">作成</button>
      </form>
      {users.length === 0 ? (
        <p class="empty-note">ユーザーがいません</p>
      ) : (
        <table class="user-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>表示名</th>
              <th>状態</th>
              <th>ログイン失敗回数</th>
              <th>ロック</th>
              <th>作成日時</th>
              <th>更新日時</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.id}</td>
                <td>{u.display_name}</td>
                <td>{u.enabled === 1 ? '有効' : '無効'}</td>
                <td>{u.fail_count}</td>
                <td>
                  {u.locked_until === null
                    ? 'なし'
                    : `ロック中 (${u.locked_until})`}
                </td>
                <td>{u.created_at}</td>
                <td>{u.updated_at}</td>
                <td>
                  {u.enabled === 1 ? (
                    <form method="post" action="/admin/users/disable">
                      <input type="hidden" name="userId" value={u.id} />
                      <button type="submit">無効化</button>
                    </form>
                  ) : (
                    <form method="post" action="/admin/users/enable">
                      <input type="hidden" name="userId" value={u.id} />
                      <button type="submit">有効化</button>
                    </form>
                  )}
                  <form method="post" action="/admin/users/update-display-name">
                    <input type="hidden" name="userId" value={u.id} />
                    <input type="text" name="displayName" value={u.display_name} required />
                    <button type="submit">表示名変更</button>
                  </form>
                  <form method="post" action="/admin/users/reset-password">
                    <input type="hidden" name="userId" value={u.id} />
                    <input type="password" name="password" required />
                    <button type="submit">パスワードリセット</button>
                  </form>
                  <form method="post" action="/admin/users/confirm-delete">
                    <input type="hidden" name="userId" value={u.id} />
                    <button type="submit">削除確認プレビュー</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {hasMore && lastId !== undefined ? (
        <div class="pagination">
          <a class="next-link" href={`/admin/users?after=${lastId}`}>
            次へ
          </a>
        </div>
      ) : null}
    </Layout>
  )
}

/**
 * Read-only album inventory page.
 * photoprism_album_uid, transform settings, and strip_exif are never selected,
 * returned, rendered, or logged.
 */
function AdminAlbumsPage({
  page,
  catalog,
}: {
  page: AdminAlbumPage
  catalog: { status: 'missing' } | { status: 'available'; publishedAt: string; albums: AdminAlbumCatalogEntry[] }
}) {
  const { albums, hasMore } = page
  const lastId = albums.length > 0 ? albums[albums.length - 1]!.id : undefined
  const catalogEntries = catalog.status === 'available' ? catalog.albums : []

  return (
    <Layout title="アルバム一覧">
      <a class="back-link" href="/admin">
        ← 管理コンソールへ
      </a>
      <h1>アルバム一覧</h1>
      <form class="admin-form" method="post" action="/admin/albums/create">
        <h2>アルバムを作成</h2>
        <label>
          アルバムID
          <input type="text" name="albumId" required />
        </label>
        <label>
          タイトル
          <input type="text" name="title" required />
        </label>
        <label>
          PhotoPrism album UID
          <input type="text" name="photoprismAlbumUid" required />
        </label>
        <label>
          有効期限
          <input type="text" name="expiresAt" placeholder="YYYY-MM-DDTHH:mm:ss.sssZ または空" />
        </label>
        <label>
          ダウンロード
          <select name="downloadEnabled">
            <option value="0" selected>不可</option>
            <option value="1">許可</option>
          </select>
        </label>
        <button type="submit">作成</button>
      </form>
      {albums.length === 0 ? (
        <p class="empty-note">アルバムがありません</p>
      ) : (
        <table class="user-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>タイトル</th>
              <th>状態</th>
              <th>有効期限</th>
              <th>ダウンロード</th>
              <th>作成日時</th>
              <th>更新日時</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {albums.map((a) => (
              <tr key={a.id}>
                <td>{a.id}</td>
                <td>{a.title}</td>
                <td>{a.enabled === 1 ? '有効' : '無効'}</td>
                <td>{a.expires_at === null ? 'なし' : a.expires_at}</td>
                <td>{a.download_enabled === 1 ? '許可' : '不可'}</td>
                <td>{a.created_at}</td>
                <td>{a.updated_at}</td>
                <td>
                  {a.enabled === 1 ? (
                    <form method="post" action="/admin/albums/disable">
                      <input type="hidden" name="albumId" value={a.id} />
                      <button type="submit">無効化</button>
                    </form>
                  ) : (
                    <form method="post" action="/admin/albums/enable">
                      <input type="hidden" name="albumId" value={a.id} />
                      <button type="submit">有効化</button>
                    </form>
                  )}
                  <form method="post" action="/admin/albums/update-public-metadata">
                    <input type="hidden" name="albumId" value={a.id} />
                    <input type="text" name="title" value={a.title} required />
                    <input type="text" name="expiresAt" value={a.expires_at ?? ''} placeholder="YYYY-MM-DDTHH:mm:ss.sssZ または空" />
                    <select name="downloadEnabled">
                      <option value="0" selected={a.download_enabled === 0}>不可</option>
                      <option value="1" selected={a.download_enabled === 1}>許可</option>
                    </select>
                    <button type="submit">メタデータ更新</button>
                  </form>
                  {catalogEntries.length > 0 ? (
                    <form method="post" action="/admin/albums/sync-target-upsert">
                      <input type="hidden" name="albumId" value={a.id} />
                      <select name="catalogId" required>
                        {catalogEntries.map(entry => (
                          <option key={entry.catalogId} value={entry.catalogId}>
                            {entry.title} ({entry.photoCount !== null ? `${entry.photoCount}枚` : '不明'}, {entry.updatedAt ?? '不明'})
                          </option>
                        ))}
                      </select>
                      <button type="submit">同期ターゲット設定</button>
                    </form>
                  ) : (
                    <p>カタログ未取得</p>
                  )}
                  <form method="post" action="/admin/albums/sync-target-remove">
                    <input type="hidden" name="albumId" value={a.id} />
                    <button type="submit">同期ターゲット削除</button>
                  </form>
                  <form method="post" action="/admin/albums/confirm-delete">
                    <input type="hidden" name="albumId" value={a.id} />
                    <button type="submit">削除確認プレビュー</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {hasMore && lastId !== undefined ? (
        <div class="pagination">
          <a class="next-link" href={`/admin/albums?after=${lastId}`}>
            次へ
          </a>
        </div>
      ) : null}
    </Layout>
  )
}

/**
 * Read-only operational summary page. Displays only aggregate counts.
 * No row-level identity, title, hash, token, PhotoPrism UID, or R2 data.
 */
function AdminOpsPage({ summary }: { summary: AdminOpsSummary }) {
  return (
    <Layout title="運用サマリ">
      <a class="back-link" href="/admin">
        ← 管理コンソールへ
      </a>
      <h1>運用サマリ</h1>
      <p>生成日時: {summary.generatedAt}</p>
      <h2>ユーザー</h2>
      <table class="user-table">
        <tbody>
          <tr><th>合計</th><td>{summary.users.total}</td></tr>
          <tr><th>有効</th><td>{summary.users.enabled}</td></tr>
          <tr><th>無効</th><td>{summary.users.disabled}</td></tr>
          <tr><th>ロック中</th><td>{summary.users.locked}</td></tr>
        </tbody>
      </table>
      <h2>アルバム</h2>
      <table class="user-table">
        <tbody>
          <tr><th>合計</th><td>{summary.albums.total}</td></tr>
          <tr><th>有効</th><td>{summary.albums.enabled}</td></tr>
          <tr><th>無効</th><td>{summary.albums.disabled}</td></tr>
          <tr><th>期限切れ</th><td>{summary.albums.expired}</td></tr>
          <tr><th>まもなく期限切れ (7日以内)</th><td>{summary.albums.expiringSoon}</td></tr>
          <tr><th>ダウンロード許可</th><td>{summary.albums.downloadable}</td></tr>
        </tbody>
      </table>
      <h2>権限</h2>
      <table class="user-table">
        <tbody>
          <tr><th>合計</th><td>{summary.permissions.total}</td></tr>
        </tbody>
      </table>
      <h2>セッション</h2>
      <table class="user-table">
        <tbody>
          <tr><th>合計</th><td>{summary.sessions.total}</td></tr>
          <tr><th>期限切れ</th><td>{summary.sessions.expired}</td></tr>
        </tbody>
      </table>
    </Layout>
  )
}

/**
 * Permission assignment page. Renders safe select menus (album title, user
 * display_name, enabled status) for the grant form and existing revoke forms.
 *
 * Selected/rendered fields only:
 *   users  — id (hidden value), display_name (option label), enabled (status badge)
 *   albums — id (hidden value), title (option label), enabled (status badge)
 *   album_permissions — album_id, user_id, created_at
 *
 * Never renders: password_hash, session tokens, photoprism_album_uid, R2 keys,
 * transform settings, fail_count, locked_until, or PhotoPrism/NAS source data.
 */
function AdminPermissionsPage({ options }: { options: AssignmentOptions }) {
  const { users, albums, permissions, hasMore } = options
  const last = permissions.length > 0 ? permissions[permissions.length - 1] : undefined

  return (
    <Layout title="権限一覧">
      <a class="back-link" href="/admin">
        ← 管理コンソールへ
      </a>
      <h1>権限一覧</h1>
      <form class="admin-form" method="post" action="/admin/permissions/grant">
        <h2>権限を付与</h2>
        <label>
          アルバム
          <select name="albumId" required>
            {albums.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}{a.enabled === 0 ? ' (無効)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          ユーザー
          <select name="userId" required>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.display_name}{u.enabled === 0 ? ' (無効)' : ''}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">付与</button>
      </form>
      {permissions.length === 0 ? (
        <p class="empty-note">権限がありません</p>
      ) : (
        <table class="user-table">
          <thead>
            <tr>
              <th>アルバムID</th>
              <th>ユーザーID</th>
              <th>作成日時</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {permissions.map((p) => (
              <tr key={`${p.album_id}/${p.user_id}`}>
                <td>{p.album_id}</td>
                <td>{p.user_id}</td>
                <td>{p.created_at}</td>
                <td>
                  <form method="post" action="/admin/permissions/revoke">
                    <input type="hidden" name="albumId" value={p.album_id} />
                    <input type="hidden" name="userId" value={p.user_id} />
                    <button type="submit">取り消し</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {hasMore && last !== undefined ? (
        <div class="pagination">
          <a class="next-link" href={`/admin/permissions?after_album=${last.album_id}&after_user=${last.user_id}`}>
            次へ
          </a>
        </div>
      ) : null}
    </Layout>
  )
}

function triggerKindLabel(kind: 'scheduled' | 'manual' | null): string {
  if (kind === 'scheduled') return '定期実行'
  if (kind === 'manual') return '手動実行'
  return '未報告'
}

/**
 * Sync status page. Renders sanitized operational fields, a pending indicator,
 * and a no-JS form to trigger a manual sync.
 * No album title, PhotoPrism UID/URL/token, R2 credentials, raw JSON,
 * pending request ID, or pending timestamp is rendered.
 */
function AdminSyncPage({ syncStatus, isPending }: { syncStatus: AdminSyncStatus | null; isPending: boolean }) {
  return (
    <Layout title="同期状態">
      <a class="back-link" href="/admin">
        ← 管理コンソールへ
      </a>
      <h1>同期状態</h1>
      {isPending && (<p class="empty-note">同期リクエスト処理待ち</p>)}
      <form method="post" action="/admin/sync/request">
        <input type="hidden" name="kind" value="sync-now" />
        <button type="submit">今すぐ同期</button>
      </form>
      {syncStatus === null ? (
        <p class="empty-note">未報告 (status not reported yet)</p>
      ) : (
        <>
          <p>公開日時: {syncStatus.publishedAt}</p>
          <table class="user-table">
            <tbody>
              <tr><th>アルバムID</th><td>{syncStatus.albumId}</td></tr>
              <tr><th>同期間隔 (秒)</th><td>{syncStatus.intervalSeconds}</td></tr>
              <tr><th>開始日時</th><td>{syncStatus.startedAt}</td></tr>
              <tr><th>最終ハートビート</th><td>{syncStatus.heartbeatAt}</td></tr>
              <tr><th>最終試行開始</th><td>{syncStatus.lastAttemptStartedAt ?? '未実行'}</td></tr>
              <tr><th>最終試行完了</th><td>{syncStatus.lastAttemptCompletedAt ?? '未完了'}</td></tr>
              <tr><th>最終結果</th><td>{syncStatus.lastResult ?? '未実行'}</td></tr>
              <tr><th>最終エラー</th><td>{syncStatus.lastError ?? 'なし'}</td></tr>
              <tr><th>連続失敗回数</th><td>{syncStatus.consecutiveFailures}</td></tr>
              <tr><th>完了回数</th><td>{syncStatus.runsCompleted}</td></tr>
              <tr><th>トリガー種別</th><td>{triggerKindLabel(syncStatus.lastTriggerKind)}</td></tr>
              {syncStatus.lastHandledRequestId !== null && (
                <tr><th>最終処理リクエストID</th><td>{syncStatus.lastHandledRequestId}</td></tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </Layout>
  )
}

function categoryLabel(category: 'owned-active' | 'owned-disabled' | 'orphan'): string {
  if (category === 'owned-active') return '所有（有効）'
  if (category === 'owned-disabled') return '所有（無効）'
  return '孤立'
}

function AdminR2CleanupPage({ report }: { report: AdminR2CleanupReport }) {
  const orphanCount = report.albums.filter((e) => e.category === 'orphan').length
  return (
    <Layout title="R2 クリーンアップレポート">
      <a class="back-link" href="/admin">
        ← 管理コンソールへ
      </a>
      <h1>R2 クリーンアップレポート（ドライラン）</h1>
      <p>このレポートは読み取り専用です。R2 オブジェクトの削除は行いません。</p>
      {report.truncated ? (
        <p class="empty-note">
          警告: オブジェクト数または取得ページ数が上限に達しました。結果が切り詰められています。
        </p>
      ) : null}
      <h2>アルバムプレフィックス</h2>
      {report.albums.length === 0 ? (
        <p class="empty-note">アルバムプレフィックスがありません</p>
      ) : (
        <table class="user-table">
          <thead>
            <tr>
              <th>カテゴリ</th>
              <th>アルバムID</th>
              <th>オブジェクト数</th>
              <th>合計バイト数（概算）</th>
            </tr>
          </thead>
          <tbody>
            {report.albums.map((entry) => (
              <tr key={entry.albumId}>
                <td>{categoryLabel(entry.category)}</td>
                <td>{entry.albumId}</td>
                <td>{entry.objectCount}</td>
                <td>{entry.totalBytes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h2>集計</h2>
      <table class="user-table">
        <tbody>
          <tr>
            <th>不正形式オブジェクト数</th>
            <td>{report.malformedCount}</td>
          </tr>
          <tr>
            <th>不正形式合計バイト数</th>
            <td>{report.malformedBytes}</td>
          </tr>
          <tr>
            <th>除外 ops/ オブジェクト数</th>
            <td>{report.excludedOpsCount}</td>
          </tr>
        </tbody>
      </table>
      {!report.truncated && orphanCount > 0 ? (
        <div>
          <h2>孤立プレフィックス確認プレビュー（Phase 2）</h2>
          <p>
            孤立プレフィックスの確認プレビューを開始できます。実際の R2
            オブジェクト削除は行われません。サーバー側で再スキャンと候補セット検証のみ行います。
          </p>
          <form method="post" action="/admin/r2-cleanup/confirm">
            <button type="submit">孤立プレフィックス確認プレビューを開始</button>
          </form>
        </div>
      ) : null}
    </Layout>
  )
}
