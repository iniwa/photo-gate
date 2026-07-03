import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import type { Env } from '../types/env.js'
import type { AuthVariables } from '../types/auth-context.js'
import type { SessionWithUser } from '../types/session.js'
import type { PrivateObjectReader } from '../types/private-object.js'
import type { AuthorizedAlbumSummary } from '../types/authorized-album.js'
import { Layout } from '../templates/layout.js'
import { isValidId } from '../services/safe-id.js'
import {
  loadAlbumManifest,
  loadPhotoPreview,
  loadPhotoThumb,
} from '../services/private-album-object-service.js'
import { requireSession } from '../middleware/require-session.js'
import { requireAlbumPermission } from '../middleware/require-album-permission.js'
import {
  buildDownloadFilename,
  buildThumbDownloadFilename,
  privateDownloadResponse,
  privateThumbDownloadResponse,
  objectForbiddenResponse,
  objectNotFoundResponse,
  objectInternalErrorResponse,
} from '../middleware/private-object-response.js'

export interface DownloadRouteDeps {
  sessionRepo: {
    fetchValidSession(tokenDigest: string, now: string): Promise<SessionWithUser | null>
  }
  permChecker: {
    checkPermission(userId: string, albumId: string, now: string): Promise<boolean>
  }
  albumRepo: {
    getAuthorizedAlbum(
      userId: string,
      albumId: string,
      now: string,
    ): Promise<AuthorizedAlbumSummary | null>
  }
  reader: PrivateObjectReader
  clock: () => Date
}

type DownloadEnv = { Bindings: Env; Variables: AuthVariables }
type DownloadContext = Parameters<MiddlewareHandler<DownloadEnv>>[0]

function isSameOrigin(c: DownloadContext): boolean {
  const origin = c.req.header('Origin')
  if (origin === undefined || origin === 'null') return false
  try {
    return origin === new URL(c.req.url).origin
  } catch {
    return false
  }
}

function isFormUrlEncoded(ct: string | undefined): boolean {
  if (ct === undefined) return false
  const base = ct.split(';')[0]?.trim().toLowerCase()
  return base === 'application/x-www-form-urlencoded'
}

function badRequestResponse(): Response {
  return new Response('Bad Request', {
    status: 400,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

/**
 * Viewer download routes. Mounted at `/download` by index.tsx.
 *
 *   GET  /:albumId/thumb/:photoId   -> albums/{albumId}/thumbs/{photoId}.webp as attachment
 *   GET  /:albumId/preview/:photoId -> albums/{albumId}/previews/{photoId}.jpg as attachment
 *   POST /:albumId/selection        -> private HTML page of individual download links
 *
 * GET chain (both routes), in fixed order:
 *   1. requireSession            — invalid session -> 401.
 *   2. requireAlbumPermission    — denied -> 403.
 *   3. isValidId(photoId)        — invalid -> 404, no I/O.
 *   4. getAuthorizedAlbum        — null race -> 403; disabled -> 403.
 *   5. loadAlbumManifest         — absent -> 404; invalid/failure -> 500.
 *   6. manifest membership       — not listed -> 404.
 *   7. loadPhotoThumb/Preview    — absent -> 404; failure -> 500.
 *   8. build filename + response -> 200 attachment.
 *
 * POST /:albumId/selection chain, in fixed order:
 *   1. requireSession            — invalid session -> 401.
 *   2. requireAlbumPermission    — denied -> 403.
 *   3. isSameOrigin              — absent/mismatch/null -> 400.
 *   4. isFormUrlEncoded          — wrong CT -> 400.
 *   5. parseBody                 — extract variant (thumb|preview), photoIds (1..100 valid IDs) -> 400.
 *   6. getAuthorizedAlbum        — null race -> 403; download_enabled !== 1 -> 403; throw -> 500.
 *   7. loadAlbumManifest         — absent -> 404; invalid/failure -> 500.
 *   8. manifest membership       — every selected ID must be present -> 404.
 *   9. render result HTML        — 200, private, no-store. No photo R2 objects are read.
 *
 * No R2 keys, bucket names, album IDs, photo IDs, or exception details are logged or echoed.
 * Only generated, metadata-stripped derivatives are served via the GET routes.
 */
export function createDownloadRoutes(
  depsFromEnv: (env: Env) => DownloadRouteDeps,
): Hono<DownloadEnv> {
  const download = new Hono<DownloadEnv>()

  const lazySessionRepo = (env: Env): DownloadRouteDeps['sessionRepo'] => ({
    fetchValidSession: (tokenDigest, now) =>
      depsFromEnv(env).sessionRepo.fetchValidSession(tokenDigest, now),
  })
  const lazyPermChecker = (env: Env): DownloadRouteDeps['permChecker'] => ({
    checkPermission: (userId, albumId, now) =>
      depsFromEnv(env).permChecker.checkPermission(userId, albumId, now),
  })
  const lazyAlbumRepo = (env: Env): DownloadRouteDeps['albumRepo'] => ({
    getAuthorizedAlbum: (userId, albumId, now) =>
      depsFromEnv(env).albumRepo.getAuthorizedAlbum(userId, albumId, now),
  })
  const lazyReader = (env: Env): PrivateObjectReader => ({
    get: (key) => depsFromEnv(env).reader.get(key),
  })
  const lazyClock = (env: Env): (() => Date) => () => depsFromEnv(env).clock()

  download.use('*', async (c, next) => {
    const middleware = requireSession(lazySessionRepo(c.env), lazyClock(c.env)) as
      unknown as MiddlewareHandler<DownloadEnv>
    return middleware(c, next)
  })

  const albumPermission: MiddlewareHandler<DownloadEnv> = async (c, next) => {
    const middleware = requireAlbumPermission(
      lazyPermChecker(c.env),
      (ctx) => ctx.req.param('albumId'),
      lazyClock(c.env),
    ) as unknown as MiddlewareHandler<DownloadEnv>
    return middleware(c, next)
  }

  download.use('/:albumId/thumb/:photoId', albumPermission)
  download.use('/:albumId/preview/:photoId', albumPermission)
  download.use('/:albumId/selection', albumPermission)

  download.get('/:albumId/thumb/:photoId', async (c) => {
    const albumId = c.req.param('albumId')
    const photoId = c.req.param('photoId')
    const userId = c.get('userId')
    const now = lazyClock(c.env)().toISOString()

    if (!isValidId(photoId)) return objectNotFoundResponse()

    let albumSummary: AuthorizedAlbumSummary | null
    try {
      albumSummary = await lazyAlbumRepo(c.env).getAuthorizedAlbum(userId, albumId, now)
    } catch {
      return objectInternalErrorResponse()
    }
    if (albumSummary === null) return objectForbiddenResponse()
    if (albumSummary.download_enabled !== 1) return objectForbiddenResponse()

    let manifestResult
    try {
      manifestResult = await loadAlbumManifest(lazyReader(c.env), albumId)
    } catch {
      return objectInternalErrorResponse()
    }
    if (manifestResult.status === 'not_found') return objectNotFoundResponse()

    const photo = manifestResult.value.photos.find((p) => p.id === photoId)
    if (photo === undefined) return objectNotFoundResponse()

    let thumbResult
    try {
      thumbResult = await loadPhotoThumb(lazyReader(c.env), albumId, photoId)
    } catch {
      return objectInternalErrorResponse()
    }
    if (thumbResult.status === 'not_found') return objectNotFoundResponse()

    const filename = buildThumbDownloadFilename(photo.title, photoId)
    try {
      return privateThumbDownloadResponse(thumbResult.value, filename)
    } catch {
      return objectInternalErrorResponse()
    }
  })

  download.get('/:albumId/preview/:photoId', async (c) => {
    const albumId = c.req.param('albumId')
    const photoId = c.req.param('photoId')
    const userId = c.get('userId')
    const now = lazyClock(c.env)().toISOString()

    if (!isValidId(photoId)) return objectNotFoundResponse()

    let albumSummary: AuthorizedAlbumSummary | null
    try {
      albumSummary = await lazyAlbumRepo(c.env).getAuthorizedAlbum(userId, albumId, now)
    } catch {
      return objectInternalErrorResponse()
    }
    if (albumSummary === null) return objectForbiddenResponse()
    if (albumSummary.download_enabled !== 1) return objectForbiddenResponse()

    let manifestResult
    try {
      manifestResult = await loadAlbumManifest(lazyReader(c.env), albumId)
    } catch {
      return objectInternalErrorResponse()
    }
    if (manifestResult.status === 'not_found') return objectNotFoundResponse()

    const photo = manifestResult.value.photos.find((p) => p.id === photoId)
    if (photo === undefined) return objectNotFoundResponse()

    let previewResult
    try {
      previewResult = await loadPhotoPreview(lazyReader(c.env), albumId, photoId)
    } catch {
      return objectInternalErrorResponse()
    }
    if (previewResult.status === 'not_found') return objectNotFoundResponse()

    const filename = buildDownloadFilename(photo.title, photoId)
    try {
      return privateDownloadResponse(previewResult.value, filename)
    } catch {
      return objectInternalErrorResponse()
    }
  })

  download.post('/:albumId/selection', async (c) => {
    const albumId = c.req.param('albumId')
    const userId = c.get('userId')
    const now = lazyClock(c.env)().toISOString()

    if (!isSameOrigin(c)) return badRequestResponse()
    if (!isFormUrlEncoded(c.req.header('Content-Type'))) return badRequestResponse()

    let body: Record<string, string | File | (string | File)[]>
    try {
      body = await c.req.parseBody({ all: true })
    } catch {
      return badRequestResponse()
    }
    for (const key of Object.keys(body)) {
      if (key !== 'variant' && key !== 'photoId') return badRequestResponse()
    }

    const rawVariant = body['variant']
    if (typeof rawVariant !== 'string') return badRequestResponse()
    if (rawVariant !== 'thumb' && rawVariant !== 'preview') return badRequestResponse()
    const variant = rawVariant as 'thumb' | 'preview'

    const rawPhotoIds = body['photoId']
    let photoIds: string[]
    if (rawPhotoIds === undefined) {
      photoIds = []
    } else if (typeof rawPhotoIds === 'string') {
      photoIds = [rawPhotoIds]
    } else if (Array.isArray(rawPhotoIds)) {
      if (!rawPhotoIds.every((v): v is string => typeof v === 'string')) return badRequestResponse()
      photoIds = rawPhotoIds
    } else {
      return badRequestResponse()
    }

    if (photoIds.length === 0 || photoIds.length > 100) return badRequestResponse()
    if (!photoIds.every(isValidId)) return badRequestResponse()

    let albumSummary: AuthorizedAlbumSummary | null
    try {
      albumSummary = await lazyAlbumRepo(c.env).getAuthorizedAlbum(userId, albumId, now)
    } catch {
      return objectInternalErrorResponse()
    }
    if (albumSummary === null) return objectForbiddenResponse()
    if (albumSummary.download_enabled !== 1) return objectForbiddenResponse()

    let manifestResult
    try {
      manifestResult = await loadAlbumManifest(lazyReader(c.env), albumId)
    } catch {
      return objectInternalErrorResponse()
    }
    if (manifestResult.status === 'not_found') return objectNotFoundResponse()

    const manifestPhotos = manifestResult.value.photos
    const selectedPhotos: { id: string; title: string }[] = []
    for (const photoId of photoIds) {
      const p = manifestPhotos.find((mp) => mp.id === photoId)
      if (p === undefined) return objectNotFoundResponse()
      selectedPhotos.push({ id: p.id, title: p.title })
    }

    c.header('Cache-Control', 'private, no-store')
    return c.html(
      <SelectionResultPage
        albumId={albumId}
        albumTitle={albumSummary.title}
        variant={variant}
        photos={selectedPhotos}
      />,
    )
  })

  return download
}

function SelectionResultPage({
  albumId,
  albumTitle,
  variant,
  photos,
}: {
  albumId: string
  albumTitle: string
  variant: 'thumb' | 'preview'
  photos: { id: string; title: string }[]
}) {
  const variantLabel = variant === 'thumb' ? '低画質 (WebP)' : '高画質 (JPEG)'
  return (
    <Layout title={`ダウンロード — ${albumTitle}`} authenticated>
      <a class="detail-back-link" href={`/albums/${albumId}`}>
        ← アルバム
      </a>
      <h1>{albumTitle}</h1>
      <p class="selection-count">
        {photos.length}枚 ・ {variantLabel}
      </p>
      <ul class="selection-result">
        {photos.map((photo) => (
          <li key={photo.id}>
            <a class="result-row" href={`/download/${albumId}/${variant}/${photo.id}`} download>
              <span class="result-title">{photo.title}</span>
              <span class="result-save">保存</span>
            </a>
          </li>
        ))}
      </ul>
    </Layout>
  )
}
