import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import type { Env } from '../types/env.js'
import type { AdminAuthConfig } from '../types/admin-auth.js'
import type { AdminUserPage } from '../types/admin-user.js'
import type { AdminAlbumPage } from '../types/admin-album.js'
import type { AdminPermissionPage } from '../types/admin-permission.js'
import { Layout } from '../templates/layout.js'
import { requireAdmin } from '../middleware/require-admin.js'
import { isValidId } from '../services/repository-validation.js'

type AdminEnv = { Bindings: Env }

export interface AdminRouteDeps {
  userRepo: { listUsers(afterUserId?: string): Promise<AdminUserPage> }
  albumRepo: { listAlbums(afterAlbumId?: string): Promise<AdminAlbumPage> }
  permissionRepo: { listPermissions(after?: { albumId: string; userId: string }): Promise<AdminPermissionPage> }
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

    let page: AdminAlbumPage
    try {
      page = await depsFromEnv(c.env).albumRepo.listAlbums(after)
    } catch {
      c.header('Cache-Control', 'no-store')
      return c.text('Internal Server Error', 500)
    }

    c.header('Cache-Control', 'no-store')
    return c.html(<AdminAlbumsPage page={page} />)
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

    let page: AdminPermissionPage
    try {
      page = await depsFromEnv(c.env).permissionRepo.listPermissions(cursorArg)
    } catch {
      c.header('Cache-Control', 'no-store')
      return c.text('Internal Server Error', 500)
    }

    c.header('Cache-Control', 'no-store')
    return c.html(<AdminPermissionsPage page={page} />)
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
      </div>
    </Layout>
  )
}

/**
 * Read-only user inventory page.
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
function AdminAlbumsPage({ page }: { page: AdminAlbumPage }) {
  const { albums, hasMore } = page
  const lastId = albums.length > 0 ? albums[albums.length - 1]!.id : undefined

  return (
    <Layout title="アルバム一覧">
      <a class="back-link" href="/admin">
        ← 管理コンソールへ
      </a>
      <h1>アルバム一覧</h1>
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
 * Read-only permission inventory page.
 * No JOIN to users or albums; no display_name, title, email, or password_hash.
 */
function AdminPermissionsPage({ page }: { page: AdminPermissionPage }) {
  const { permissions, hasMore } = page
  const last = permissions.length > 0 ? permissions[permissions.length - 1] : undefined

  return (
    <Layout title="権限一覧">
      <a class="back-link" href="/admin">
        ← 管理コンソールへ
      </a>
      <h1>権限一覧</h1>
      {permissions.length === 0 ? (
        <p class="empty-note">権限がありません</p>
      ) : (
        <table class="user-table">
          <thead>
            <tr>
              <th>アルバムID</th>
              <th>ユーザーID</th>
              <th>作成日時</th>
            </tr>
          </thead>
          <tbody>
            {permissions.map((p) => (
              <tr key={`${p.album_id}/${p.user_id}`}>
                <td>{p.album_id}</td>
                <td>{p.user_id}</td>
                <td>{p.created_at}</td>
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
