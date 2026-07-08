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
        albumTitle={summary.title}
        photo={photo}
        position={photoIndex + 1}
        total={photos.length}
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
      <div class="login-page">
        <p class="login-wordmark">
          photo-gate
          <span class="login-wordmark-dot" aria-hidden="true">
            ・
          </span>
        </p>
        {showError ? (
          <p class="form-error" role="alert">
            ユーザーIDまたはパスワードが正しくありません
          </p>
        ) : null}
        <form class="login-form" method="post" action="/api/auth/login">
          <label class="field">
            <span class="field-label">ユーザーID</span>
            <input type="text" name="userId" autocomplete="username" required />
          </label>
          <label class="field">
            <span class="field-label">パスワード</span>
            <input type="password" name="password" autocomplete="current-password" required />
          </label>
          <button type="submit" class="login-submit">
            ログイン
          </button>
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
        <p class="albums-empty">閲覧できるアルバムがありません</p>
      ) : (
        <div class="album-grid">
          {albums.map((album) => (
            <a class="album-card" href={`/albums/${album.id}`} key={album.id}>
              <img class="album-card-cover" src={`/img/${album.id}/cover`} alt="" />
              <span class="album-card-title">{album.title}</span>
            </a>
          ))}
        </div>
      )}
      {nextCursor !== undefined ? (
        <nav class="pagination">
          <a class="pagination-next" href={`/albums?after=${nextCursor}`}>
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
      <div class="status-page">
        <p class="status-glyph">準備中</p>
        <h1 class="status-title">{title}</h1>
        <p class="status-message">このアルバムは準備中です</p>
        <a class="status-link" href="/albums">
          アルバム一覧へ戻る
        </a>
      </div>
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
  const grid = (
    <div class="contact-sheet">
      {photos.map((photo) => (
        <div class="contact-cell" key={photo.id}>
          <a class="contact-link" href={`/albums/${albumId}/photos/${photo.id}`}>
            <img src={`/img/${albumId}/thumb/${photo.id}`} alt={photo.title} loading="lazy" />
          </a>
          {downloadEnabled ? (
            <input
              type="checkbox"
              class="contact-checkbox"
              name="photoId"
              value={photo.id}
              aria-label={`「${photo.title}」を選択`}
            />
          ) : null}
        </div>
      ))}
    </div>
  )

  return (
    <Layout title={title} authenticated>
      <div class="album-detail-header">
        <a class="detail-back-link" href="/albums">
          ← アルバム
        </a>
        <h1>{title}</h1>
        <span class="photo-count">{photos.length}枚</span>
      </div>
      {downloadEnabled ? (
        <form method="post" action={`/download/${albumId}/selection`} class="selection-form">
          {grid}
          <div class="selection-bar">
            <select name="variant" class="selection-variant">
              <option value="thumb">低画質 (WebP)</option>
              <option value="preview">高画質 (JPEG)</option>
            </select>
            <button type="submit" class="selection-submit">
              ダウンロードリンクを表示
            </button>
          </div>
        </form>
      ) : (
        grid
      )}
    </Layout>
  )
}

function PhotoPreviewPage({
  albumId,
  albumTitle,
  photo,
  position,
  total,
  prevPhotoId,
  nextPhotoId,
  downloadEnabled,
}: {
  albumId: string
  albumTitle: string
  photo: { id: string; title: string }
  position: number
  total: number
  prevPhotoId: string | undefined
  nextPhotoId: string | undefined
  downloadEnabled: boolean
}) {
  const prevHref =
    prevPhotoId !== undefined ? `/albums/${albumId}/photos/${prevPhotoId}` : undefined
  const nextHref =
    nextPhotoId !== undefined ? `/albums/${albumId}/photos/${nextPhotoId}` : undefined
  const prefetchHref =
    nextPhotoId !== undefined ? `/img/${albumId}/preview/${nextPhotoId}` : undefined

  return (
    <Layout
      title={photo.title}
      authenticated
      chrome="immersive"
      head={prefetchHref !== undefined ? <link rel="prefetch" href={prefetchHref} /> : null}
    >
      <div class="preview-topbar">
        <div class="preview-topbar-row">
          <a class="preview-back" href={`/albums/${albumId}`}>
            ← {albumTitle}
          </a>
          <span class="preview-position tabular">
            {position} / {total}
          </span>
        </div>
        <p class="preview-title">{photo.title}</p>
      </div>
      <div class="preview-stage">
        <img
          class="preview-stage-image"
          src={`/img/${albumId}/preview/${photo.id}`}
          alt={photo.title}
        />
      </div>
      <div class="preview-bottombar">
        {prevHref !== undefined ? (
          <a class="preview-nav" data-nav="prev" href={prevHref}>
            前へ
          </a>
        ) : (
          <span class="preview-nav preview-nav-disabled" aria-hidden="true">
            前へ
          </span>
        )}
        {downloadEnabled ? (
          <details class="preview-download">
            <summary class="preview-download-summary">
              保存 <span aria-hidden="true">▴</span>
            </summary>
            <div class="preview-download-menu">
              <a class="preview-download-link" href={`/download/${albumId}/thumb/${photo.id}`} download>
                低画質 (WebP)
              </a>
              <a
                class="preview-download-link"
                href={`/download/${albumId}/preview/${photo.id}`}
                download
              >
                高画質 (JPEG)
              </a>
            </div>
          </details>
        ) : null}
        {nextHref !== undefined ? (
          <a class="preview-nav" data-nav="next" href={nextHref}>
            次へ
          </a>
        ) : (
          <span class="preview-nav preview-nav-disabled" aria-hidden="true">
            次へ
          </span>
        )}
      </div>
    </Layout>
  )
}

function ErrorPage() {
  return (
    <Layout title="エラー">
      <div class="status-page">
        <p class="status-glyph">500</p>
        <h1 class="status-title">エラーが発生しました</h1>
        <p class="status-message">時間をおいて再度お試しください。</p>
        <a class="status-link" href="/albums">
          アルバム一覧へ戻る
        </a>
      </div>
    </Layout>
  )
}

function ForbiddenPage() {
  return (
    <Layout title="アクセスできません">
      <div class="status-page">
        <p class="status-glyph">403</p>
        <h1 class="status-title">アクセスできません</h1>
        <p class="status-message">このアルバムを閲覧する権限がありません。</p>
        <a class="status-link" href="/albums">
          アルバム一覧へ戻る
        </a>
      </div>
    </Layout>
  )
}

export function NotFound() {
  return (
    <Layout title="ページが見つかりません">
      <div class="status-page">
        <p class="status-glyph">404</p>
        <h1 class="status-title">ページが見つかりません</h1>
        <p class="status-message">お探しのページは見つかりませんでした。</p>
        <a class="status-link" href="/albums">
          アルバム一覧へ戻る
        </a>
      </div>
    </Layout>
  )
}
