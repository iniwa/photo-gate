import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import type { Env } from '../types/env.js'
import type { AuthVariables } from '../types/auth-context.js'
import type { SessionWithUser } from '../types/session.js'
import type { PrivateObjectReader } from '../types/private-object.js'
import type { AuthorizedAlbumSummary } from '../types/authorized-album.js'
import { Layout } from '../templates/layout.js'
import { isValidId } from '../services/safe-id.js'
import { parseSessionCookie } from '../services/session-cookie.js'
import { digestSessionToken } from '../services/auth-crypto.js'
import { loadAlbumManifest } from '../services/private-album-object-service.js'
import { requireSessionPage } from '../middleware/require-session-page.js'
import { requireAlbumPermission } from '../middleware/require-album-permission.js'

const ALBUMS_PER_PAGE = 50

export interface PageDeps {
  sessionRepo: {
    fetchValidSession(tokenDigest: string, now: string): Promise<SessionWithUser | null>
  }
  permChecker: {
    checkPermission(userId: string, albumId: string, now: string): Promise<boolean>
  }
  albumRepo: {
    listAuthorizedAlbums(
      userId: string,
      now: string,
      limit: number,
      afterAlbumId?: string,
    ): Promise<AuthorizedAlbumSummary[]>
    getAuthorizedAlbum(
      userId: string,
      albumId: string,
      now: string,
    ): Promise<AuthorizedAlbumSummary | null>
  }
  reader: PrivateObjectReader
  clock: () => Date
}

type PageEnv = { Bindings: Env; Variables: AuthVariables }

/**
 * Real viewer SSR pages, replacing the Phase 2 fixtures.
 *
 *   GET /                 -> login form (or 303 /albums if already logged in)
 *   GET /albums           -> authorized album list (keyset pagination)
 *   GET /albums/:albumId  -> album detail (manifest photo grid / 準備中 page)
 *
 * Deps are resolved lazily per call (the img-routes pattern) so a missing or
 * malformed binding cannot turn an unauthenticated `/` request into a 500: the
 * login probe and the page middleware short-circuit before any dep is touched,
 * and a dep failure during a probe falls back to the login form (fail-safe).
 */
export function createPages(depsFromEnv: (env: Env) => PageDeps): Hono<PageEnv> {
  const pages = new Hono<PageEnv>()

  const lazySessionRepo = (env: Env): PageDeps['sessionRepo'] => ({
    fetchValidSession: (tokenDigest, now) =>
      depsFromEnv(env).sessionRepo.fetchValidSession(tokenDigest, now),
  })
  const lazyPermChecker = (env: Env): PageDeps['permChecker'] => ({
    checkPermission: (userId, albumId, now) =>
      depsFromEnv(env).permChecker.checkPermission(userId, albumId, now),
  })
  const lazyReader = (env: Env): PrivateObjectReader => ({
    get: (key) => depsFromEnv(env).reader.get(key),
  })
  const lazyClock = (env: Env): (() => Date) => () => depsFromEnv(env).clock()

  // GET / — public login form. If a valid session cookie is present, redirect to
  // /albums. The session lookup here is a best-effort probe on a PUBLIC page:
  // any failure (no binding, D1 throw, crypto throw) falls back to rendering the
  // login form rather than surfacing a 503/500, and records nothing.
  pages.get('/', async (c) => {
    if (await hasValidSession(c.req.header('Cookie') ?? null, lazySessionRepo(c.env), lazyClock(c.env))) {
      c.header('Cache-Control', 'no-store')
      c.header('Location', '/albums')
      return c.body(null, 303)
    }

    const showError = c.req.query('error') === '1'
    c.header('Cache-Control', 'private, no-cache')
    return c.html(<LoginPage showError={showError} />)
  })

  // GET /albums — requireSessionPage then handler.
  const sessionPage: MiddlewareHandler<PageEnv> = async (c, next) => {
    const middleware = requireSessionPage(lazySessionRepo(c.env), lazyClock(c.env)) as
      unknown as MiddlewareHandler<PageEnv>
    return middleware(c, next)
  }

  const albumPermission: MiddlewareHandler<PageEnv> = async (c, next) => {
    const middleware = requireAlbumPermission(
      lazyPermChecker(c.env),
      (ctx) => ctx.req.param('albumId'),
      lazyClock(c.env),
    ) as unknown as MiddlewareHandler<PageEnv>
    return middleware(c, next)
  }

  pages.use('/albums', sessionPage)
  pages.use('/albums/:albumId', sessionPage)
  pages.use('/albums/:albumId', albumPermission)
  pages.use('/albums/:albumId/photos/:photoId', sessionPage)
  pages.use('/albums/:albumId/photos/:photoId', albumPermission)

  pages.get('/albums', async (c) => {
    const userId = c.get('userId')
    const now = lazyClock(c.env)().toISOString()

    const rawAfter = c.req.query('after')
    // Invalid cursor -> first page (fail-safe), not a 400 (ADR §2.4).
    const after = rawAfter !== undefined && isValidId(rawAfter) ? rawAfter : undefined

    let albums: AuthorizedAlbumSummary[]
    try {
      albums = await depsFromEnv(c.env).albumRepo.listAuthorizedAlbums(
        userId,
        now,
        ALBUMS_PER_PAGE,
        after,
      )
    } catch {
      return genericError(c)
    }

    const nextCursor =
      albums.length === ALBUMS_PER_PAGE ? albums[albums.length - 1]?.id : undefined

    c.header('Cache-Control', 'private, no-cache')
    return c.html(<AlbumsPage albums={albums} nextCursor={nextCursor} />)
  })

  pages.get('/albums/:albumId', async (c) => {
    const userId = c.get('userId')
    const albumId = c.req.param('albumId')
    const now = lazyClock(c.env)().toISOString()

    let summary: AuthorizedAlbumSummary | null
    try {
      summary = await depsFromEnv(c.env).albumRepo.getAuthorizedAlbum(userId, albumId, now)
    } catch {
      return genericError(c)
    }
    // Permission already passed, but the album may have raced away. Fail closed.
    if (summary === null) return genericForbidden(c)

    // loadAlbumManifest throws ObjectServiceError (manifest_invalid / reader_failure)
    // or any other error -> generic 500. Manifest absence is a value, not a throw.
    let manifestResult
    try {
      manifestResult = await loadAlbumManifest(lazyReader(c.env), albumId)
    } catch {
      return genericError(c)
    }

    if (manifestResult.status === 'not_found') {
      // Sync has not produced a manifest yet: 準備中 page, not a 404 (ADR §2.5).
      c.header('Cache-Control', 'private, no-cache')
      return c.html(<AlbumPreparingPage title={summary.title} />)
    }

    c.header('Cache-Control', 'private, no-cache')
    return c.html(
      <AlbumDetailPage
        albumId={albumId}
        title={summary.title}
        photos={manifestResult.value.photos}
        downloadEnabled={summary.download_enabled === 1}
      />,
    )
  })

  pages.get('/albums/:albumId/photos/:photoId', async (c) => {
    const albumId = c.req.param('albumId')
    const photoId = c.req.param('photoId')
    const userId = c.get('userId')
    const now = lazyClock(c.env)().toISOString()

    if (!isValidId(photoId)) return genericNotFound(c)

    let summary: AuthorizedAlbumSummary | null
    try {
      summary = await depsFromEnv(c.env).albumRepo.getAuthorizedAlbum(userId, albumId, now)
    } catch {
      return genericError(c)
    }
    if (summary === null) return genericForbidden(c)

    let manifestResult
    try {
      manifestResult = await loadAlbumManifest(lazyReader(c.env), albumId)
    } catch {
      return genericError(c)
    }
    if (manifestResult.status === 'not_found') return genericNotFound(c)

    const photos = manifestResult.value.photos
    const photoIndex = photos.findIndex((p) => p.id === photoId)
    if (photoIndex === -1) return genericNotFound(c)

    const photo = photos[photoIndex]!
    const prevPhoto = photoIndex > 0 ? photos[photoIndex - 1] : undefined
    const nextPhoto = photoIndex < photos.length - 1 ? photos[photoIndex + 1] : undefined

    c.header('Cache-Control', 'private, no-cache')
    return c.html(
      <PhotoPreviewPage
        albumId={albumId}
        photo={photo}
        prevPhotoId={prevPhoto?.id}
        nextPhotoId={nextPhoto?.id}
        downloadEnabled={summary.download_enabled === 1}
      />,
    )
  })

  return pages
}

/**
 * Best-effort, fail-safe session probe for the public `/` page. Returns true only
 * for a confirmed valid session; treats a missing cookie and ANY failure (crypto,
 * binding, D1 throw) as "not logged in" so the login form is always reachable.
 */
async function hasValidSession(
  cookieHeader: string | null,
  fetcher: PageDeps['sessionRepo'],
  clock: () => Date,
): Promise<boolean> {
  const rawToken = parseSessionCookie(cookieHeader)
  if (rawToken === undefined) return false
  try {
    const tokenDigest = await digestSessionToken(rawToken)
    const now = clock().toISOString()
    const session = await fetcher.fetchValidSession(tokenDigest, now)
    return session !== null && session.user_enabled === 1 && isValidId(session.user_id)
  } catch {
    return false
  }
}

async function genericError(c: Parameters<MiddlewareHandler<PageEnv>>[0]): Promise<Response> {
  c.header('Cache-Control', 'no-store')
  return c.html(<ErrorPage />, 500)
}

async function genericForbidden(c: Parameters<MiddlewareHandler<PageEnv>>[0]): Promise<Response> {
  c.header('Cache-Control', 'no-store')
  return c.html(<ForbiddenPage />, 403)
}

async function genericNotFound(c: Parameters<MiddlewareHandler<PageEnv>>[0]): Promise<Response> {
  c.header('Cache-Control', 'no-store')
  return c.html(<NotFound />, 404)
}

function LoginPage({ showError }: { showError: boolean }) {
  return (
    <Layout title="ログイン">
      <div class="login-box viewer-login-box">
        <h1>photo-gate</h1>
        {showError ? (
          <p class="form-error" role="alert">
            ユーザーIDまたはパスワードが正しくありません
          </p>
        ) : null}
        <form class="login-form" method="post" action="/api/auth/login">
          <label class="field">
            <span>ユーザーID</span>
            <input type="text" name="userId" autocomplete="username" required />
          </label>
          <label class="field">
            <span>パスワード</span>
            <input type="password" name="password" autocomplete="current-password" required />
          </label>
          <button type="submit">ログイン</button>
        </form>
      </div>
    </Layout>
  )
}

function AlbumsPage({
  albums,
  nextCursor,
}: {
  albums: AuthorizedAlbumSummary[]
  nextCursor: string | undefined
}) {
  return (
    <Layout title="アルバム" authenticated>
      <h1>アルバム</h1>
      {albums.length === 0 ? (
        <p class="empty-note">閲覧できるアルバムがありません</p>
      ) : (
        <div class="card-grid">
          {albums.map((album) => (
            <div class="card" key={album.id}>
              <a href={`/albums/${album.id}`}>
                <img class="card-cover" src={`/img/${album.id}/cover`} alt="" />
                <div class="card-body">
                  <div class="card-title">{album.title}</div>
                </div>
              </a>
            </div>
          ))}
        </div>
      )}
      {nextCursor !== undefined ? (
        <nav class="pagination">
          <a class="next-link viewer-action" href={`/albums?after=${nextCursor}`}>
            次へ
          </a>
        </nav>
      ) : null}
    </Layout>
  )
}

function AlbumPreparingPage({ title }: { title: string }) {
  return (
    <Layout title={title} authenticated>
      <a class="back-link" href="/albums">
        アルバム一覧へ戻る
      </a>
      <h1>{title}</h1>
      <p class="empty-note">このアルバムは準備中です</p>
    </Layout>
  )
}

function AlbumDetailPage({
  albumId,
  title,
  photos,
  downloadEnabled,
}: {
  albumId: string
  title: string
  photos: { id: string; title: string }[]
  downloadEnabled: boolean
}) {
  return (
    <Layout title={title} authenticated>
      <a class="back-link" href="/albums">
        アルバム一覧へ戻る
      </a>
      <h1>{title}</h1>
      <div class="photo-grid">
        {photos.map((photo) => (
          <div class="photo-item" key={photo.id}>
            <a class="photo" href={`/albums/${albumId}/photos/${photo.id}`}>
              <img src={`/img/${albumId}/thumb/${photo.id}`} alt={photo.title} loading="lazy" />
            </a>
            {downloadEnabled ? (
              <a class="download-link viewer-action" href={`/download/${albumId}/preview/${photo.id}`} download>
                ダウンロード
              </a>
            ) : null}
          </div>
        ))}
      </div>
    </Layout>
  )
}

function PhotoPreviewPage({
  albumId,
  photo,
  prevPhotoId,
  nextPhotoId,
  downloadEnabled,
}: {
  albumId: string
  photo: { id: string; title: string }
  prevPhotoId: string | undefined
  nextPhotoId: string | undefined
  downloadEnabled: boolean
}) {
  return (
    <Layout title={photo.title} authenticated>
      <a class="back-link" href={`/albums/${albumId}`}>
        アルバムへ戻る
      </a>
      <div class="photo-preview">
        <img
          class="preview-image"
          src={`/img/${albumId}/preview/${photo.id}`}
          alt={photo.title}
        />
      </div>
      <nav class="photo-nav">
        {prevPhotoId !== undefined ? (
          <a class="prev-link viewer-action" href={`/albums/${albumId}/photos/${prevPhotoId}`}>
            前の写真
          </a>
        ) : null}
        {nextPhotoId !== undefined ? (
          <a class="next-link viewer-action" href={`/albums/${albumId}/photos/${nextPhotoId}`}>
            次の写真
          </a>
        ) : null}
      </nav>
      {downloadEnabled ? (
        <a class="download-link viewer-action" href={`/download/${albumId}/preview/${photo.id}`} download>
          ダウンロード
        </a>
      ) : null}
    </Layout>
  )
}

function ErrorPage() {
  return (
    <Layout title="エラー">
      <div class="not-found">
        <div class="code">500</div>
        <h1>エラーが発生しました</h1>
        <p>時間をおいて再度お試しください。</p>
        <a href="/albums">アルバム一覧へ戻る</a>
      </div>
    </Layout>
  )
}

function ForbiddenPage() {
  return (
    <Layout title="アクセスできません">
      <div class="not-found">
        <div class="code">403</div>
        <h1>アクセスできません</h1>
        <p>このアルバムを閲覧する権限がありません。</p>
        <a href="/albums">アルバム一覧へ戻る</a>
      </div>
    </Layout>
  )
}

export function NotFound() {
  return (
    <Layout title="Not Found">
      <div class="not-found">
        <div class="code">404</div>
        <h1>Page not found</h1>
        <p>The page you requested does not exist.</p>
        <a href="/albums">Back to albums</a>
      </div>
    </Layout>
  )
}
