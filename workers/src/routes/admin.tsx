import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import type { Env } from '../types/env.js'
import type { AdminAuthConfig } from '../types/admin-auth.js'
import { Layout } from '../templates/layout.js'
import { requireAdmin } from '../middleware/require-admin.js'

type AdminEnv = { Bindings: Env }

/**
 * Admin surface, mounted at `/admin` by index.tsx BEFORE the reserved-401 loop so
 * it owns every `/admin` and `/admin/*` request and nothing falls through to the
 * public viewer page router.
 *
 *   GET /admin           -> minimal SSR admin page (allowlisted Access identity only)
 *   everything else      -> authenticated 404 (still behind the admin guard)
 *
 * The guard (`requireAdmin`) runs on every path and method first, so an
 * unauthenticated or non-allowlisted caller always gets the same generic 403
 * regardless of the path — an unknown `/admin/*` path reveals 404 only to a
 * verified administrator. All responses use `Cache-Control: no-store`.
 *
 * This handoff establishes only the authentication boundary; no administration
 * feature, viewer/album/R2/PhotoPrism/NAS data, or D1/R2 access is added here.
 */
export function createAdminRoutes(
  resolveAuthFromEnv: (env: Env) => AdminAuthConfig | null,
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

  // Any other method/path under /admin stays behind the guard and returns a
  // generic authenticated 404 — never the viewer router, never any data.
  admin.all('*', (c) => {
    c.header('Cache-Control', 'no-store')
    return c.text('Not Found', 404)
  })

  return admin
}

/**
 * Minimal placeholder admin page. Intentionally contains no viewer, album, R2,
 * PhotoPrism, or NAS data — administration features are out of scope for this
 * authentication-foundation handoff.
 */
function AdminHome() {
  return (
    <Layout title="管理コンソール">
      <div class="login-box">
        <h1>管理コンソール</h1>
        <p>管理機能は未実装です。</p>
      </div>
    </Layout>
  )
}
