import { Hono } from 'hono'
import type { Env } from './types/env.js'
import type { AdminAuthConfig } from './types/admin-auth.js'
import { securityHeaders } from './middleware/security-headers.js'
import { createPages, NotFound } from './routes/pages.js'
import { createAuthApi } from './routes/auth-api.js'
import { createImgRoutes } from './routes/img-routes.js'
import { createDownloadRoutes } from './routes/download-routes.js'
import { createAdminRoutes } from './routes/admin.js'
import { AdminUserRepository } from './services/admin-user-repository.js'
import { AdminAlbumRepository } from './services/admin-album-repository.js'
import { AdminPermissionRepository } from './services/admin-permission-repository.js'
import { AdminOpsRepository } from './services/admin-ops-repository.js'
import { AdminSyncStatusRepository } from './services/admin-sync-status-repository.js'
import { AdminSyncRequestRepository } from './services/admin-sync-request-repository.js'
import { AdminCatalogRefreshRequestRepository } from './services/admin-catalog-refresh-request-repository.js'
import { AdminSyncResultRepository } from './services/admin-sync-result-repository.js'
import { AdminSyncTargetRepository } from './services/admin-sync-target-repository.js'
import { AdminAlbumCatalogRepository } from './services/admin-album-catalog-repository.js'
import { AdminAlbumReadinessRepository } from './services/admin-album-readiness-repository.js'
import { AdminR2CleanupRepository } from './services/admin-r2-cleanup-repository.js'
import { AuthRepository } from './services/auth-repository.js'
import { SessionRepository } from './services/session-repository.js'
import { AuthorizedAlbumRepository } from './services/authorized-album-repository.js'
import { ViewerAlbumAccessRepository } from './services/viewer-album-access-repository.js'
import { PrivateR2Reader } from './services/private-r2-reader.js'
import { parseAccessConfig, createVerifierCache } from './services/cloudflare-access-jwt.js'
import { parseAdminAllowlist } from './middleware/require-admin.js'

const app = new Hono<{ Bindings: Env }>()

// Memoize Access verifiers by configuration (non-secret team domain + audience)
// so the JWKS key cache is reused across requests. This holds only config-derived
// key resolvers — never request-specific identity or claims.
const adminVerifierCache = createVerifierCache()

/**
 * Resolve per-request admin auth from the Worker env, or null (fail closed) when
 * any of the three Access values is missing or malformed. The middleware maps a
 * null result to the same generic 403 as every other admin failure.
 */
function resolveAdminAuth(env: Env): AdminAuthConfig | null {
  const config = parseAccessConfig(env.CF_ACCESS_TEAM_DOMAIN, env.CF_ACCESS_AUD)
  if (config === null) return null
  const allowlist = parseAdminAllowlist(env.ADMIN_EMAILS)
  if (allowlist === null) return null
  return { verifier: adminVerifierCache(config), allowlist }
}

app.use('*', securityHeaders)

// First real D1-backed routes. Mounted before the reserved-401 loop so that
// /api/auth/* reaches this router while every other /api path stays 401.
// If env.DB is undefined at runtime, repository calls reject and handlers
// return 503 (fail closed); no explicit binding check is added here.
app.route('/api/auth', createAuthApi((env) => ({
  authRepo: new AuthRepository(env.DB),
  sessionRepo: new SessionRepository(env.DB),
  loginRateLimit: {
    async allowAttempt(accountKey, networkKey) {
      const [account, network] = await Promise.all([
        env.LOGIN_ACCOUNT_RATE_LIMIT.limit({ key: accountKey }),
        env.LOGIN_NETWORK_RATE_LIMIT.limit({ key: networkKey }),
      ])
      return account.success && network.success
    },
  },
  clock: () => new Date(),
})))

// Private viewer image routes. Mounted before the reserved-401 loop so the three
// GET shapes (/img/:albumId/cover, /thumb/:photoId, /preview/:photoId) reach this
// router; every other /img path (exact /img, unknown subpaths, non-GET) falls
// through to the reserved 401. If env.DB / env.PHOTO_BUCKET are undefined at
// runtime, the repositories and reader reject and handlers close to 401/403/503/500.
app.route('/img', createImgRoutes((env) => ({
  albumAccessRepo: new ViewerAlbumAccessRepository(env.DB),
  clock: () => new Date(),
  reader: new PrivateR2Reader(env.PHOTO_BUCKET),
})))

// Admin surface. Mounted before the reserved-401 loop so every /admin and
// /admin/* request reaches this router and never falls through to the public
// viewer page router. The router's own guard fails closed with a generic 403
// (Cloudflare Access JWT + administrator allowlist); missing/malformed config
// resolves to that same 403. No viewer/album/R2/PhotoPrism/NAS data is exposed.
app.route('/admin', createAdminRoutes(resolveAdminAuth, (env) => ({
  userRepo: new AdminUserRepository(env.DB),
  albumRepo: new AdminAlbumRepository(env.DB),
  permissionRepo: new AdminPermissionRepository(env.DB),
  opsRepo: new AdminOpsRepository(env.DB),
  syncStatusRepo: new AdminSyncStatusRepository(env.PHOTO_BUCKET),
  syncRequestRepo: new AdminSyncRequestRepository(env.PHOTO_BUCKET),
  catalogRefreshRequestRepo: new AdminCatalogRefreshRequestRepository(env.PHOTO_BUCKET),
  syncResultRepo: new AdminSyncResultRepository(env.PHOTO_BUCKET),
  syncTargetRepo: new AdminSyncTargetRepository(env.PHOTO_BUCKET),
  catalogRepo: new AdminAlbumCatalogRepository(env.PHOTO_BUCKET),
  albumReadinessRepo: new AdminAlbumReadinessRepository(env.DB, env.PHOTO_BUCKET),
  r2CleanupRepo: new AdminR2CleanupRepository(env.DB, env.PHOTO_BUCKET),
  clock: () => new Date(),
})))

// Viewer download route. Mounted before the reserved-401 loop so GET shapes
// (/download/:albumId/preview/:photoId) reach this router. A single D1 lookup
// confirms the session and album access before the download-enabled gate and any
// manifest or R2 object read.
app.route('/download', createDownloadRoutes((env) => ({
  albumAccessRepo: new ViewerAlbumAccessRepository(env.DB),
  reader: new PrivateR2Reader(env.PHOTO_BUCKET),
  clock: () => new Date(),
})))

// Reserved routes fail closed with 401 regardless of auth state.
// No fixture data, no album/photo IDs, no redirect.
const RESERVED = ['/api', '/img'] as const
for (const prefix of RESERVED) {
  app.all(prefix, (c) => {
    c.header('Cache-Control', 'no-store')
    return c.text('Unauthorized', 401)
  })
  app.all(`${prefix}/*`, (c) => {
    c.header('Cache-Control', 'no-store')
    return c.text('Unauthorized', 401)
  })
}

// Real viewer SSR pages. Mounted AFTER the admin router and reserved-401 loop so
// /admin, /api, and /img are never shadowed by the page router. If env.DB /
// env.PHOTO_BUCKET are undefined at runtime, deps are resolved lazily per call: the public `/` probe
// falls back to the login form, and the authenticated pages fail closed
// (303 to /, 403, 500, or 503) without leaking errors.
app.route('/', createPages((env) => ({
  sessionRepo: new SessionRepository(env.DB),
  albumRepo: new AuthorizedAlbumRepository(env.DB),
  albumAccessRepo: new ViewerAlbumAccessRepository(env.DB),
  reader: new PrivateR2Reader(env.PHOTO_BUCKET),
  clock: () => new Date(),
})))

app.notFound((c) => {
  c.header('Cache-Control', 'no-store')
  return c.html(<NotFound />, 404)
})

/**
 * Daily expired-session cleanup (approved default; wrangler.toml cron trigger).
 * Failures are swallowed with a generic operational signal only: a missed
 * cleanup run is harmless (expired sessions are already rejected at read time
 * by fetchValidSession) and the next run catches up.
 */
export async function runScheduledSessionCleanup(env: Env): Promise<void> {
  try {
    await new SessionRepository(env.DB).deleteExpiredSessions(new Date().toISOString())
  } catch {
    console.error('scheduled session cleanup failed')
  }
}

/** Exported for in-process tests; the deployable worker is the default export. */
export { app }

export default {
  fetch: app.fetch,
  scheduled: (_event: ScheduledController, env: Env, ctx: ExecutionContext): void => {
    ctx.waitUntil(runScheduledSessionCleanup(env))
  },
}
