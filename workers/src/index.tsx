import { Hono } from 'hono'
import type { Env } from './types/env.js'
import { securityHeaders } from './middleware/security-headers.js'
import { createPages, NotFound } from './routes/pages.js'
import { createAuthApi } from './routes/auth-api.js'
import { createImgRoutes } from './routes/img-routes.js'
import { AuthRepository } from './services/auth-repository.js'
import { SessionRepository } from './services/session-repository.js'
import { PermissionRepository } from './services/permission-repository.js'
import { AuthorizedAlbumRepository } from './services/authorized-album-repository.js'
import { PrivateR2Reader } from './services/private-r2-reader.js'

const app = new Hono<{ Bindings: Env }>()

app.use('*', securityHeaders)

// First real D1-backed routes. Mounted before the reserved-401 loop so that
// /api/auth/* reaches this router while every other /api path stays 401.
// If env.DB is undefined at runtime, repository calls reject and handlers
// return 503 (fail closed); no explicit binding check is added here.
app.route('/api/auth', createAuthApi((env) => ({
  authRepo: new AuthRepository(env.DB),
  sessionRepo: new SessionRepository(env.DB),
  clock: () => new Date(),
})))

// Private viewer image routes. Mounted before the reserved-401 loop so the three
// GET shapes (/img/:albumId/cover, /thumb/:photoId, /preview/:photoId) reach this
// router; every other /img path (exact /img, unknown subpaths, non-GET) falls
// through to the reserved 401. If env.DB / env.PHOTO_BUCKET are undefined at
// runtime, the repositories and reader reject and handlers close to 401/403/503/500.
app.route('/img', createImgRoutes((env) => ({
  sessionRepo: new SessionRepository(env.DB),
  permChecker: new PermissionRepository(env.DB),
  clock: () => new Date(),
  reader: new PrivateR2Reader(env.PHOTO_BUCKET),
})))

// Reserved routes fail closed with 401 regardless of auth state.
// No fixture data, no album/photo IDs, no redirect.
const RESERVED = ['/api', '/img', '/admin'] as const
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

// Real viewer SSR pages. Mounted AFTER the reserved-401 loop so /api, /img, and
// /admin are never shadowed by the page router. If env.DB / env.PHOTO_BUCKET are
// undefined at runtime, deps are resolved lazily per call: the public `/` probe
// falls back to the login form, and the authenticated pages fail closed
// (303 to /, 403, 500, or 503) without leaking errors.
app.route('/', createPages((env) => ({
  sessionRepo: new SessionRepository(env.DB),
  permChecker: new PermissionRepository(env.DB),
  albumRepo: new AuthorizedAlbumRepository(env.DB),
  reader: new PrivateR2Reader(env.PHOTO_BUCKET),
  clock: () => new Date(),
})))

app.notFound((c) => {
  c.header('Cache-Control', 'no-store')
  return c.html(<NotFound />, 404)
})

export default app
