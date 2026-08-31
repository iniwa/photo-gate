import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import type { Env } from '../types/env.js'
import type { AuthVariables } from '../types/auth-context.js'
import type { PrivateObjectReader } from '../types/private-object.js'
import { Layout } from '../templates/layout.js'
import { isValidId } from '../services/safe-id.js'
import type { ViewerAlbumAccess } from '../services/viewer-album-access-repository.js'
import {
  loadAlbumManifest,
  loadPhotoPreview,
  loadPhotoThumb,
} from '../services/private-album-object-service.js'
import { requireViewerAlbumAccess } from '../middleware/require-viewer-album-access.js'
import { parseUrlEncodedForm } from '../services/url-encoded-form.js'
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
  albumAccessRepo: {
    getAuthorizedAlbumAccess(
      tokenDigest: string,
      albumId: string,
      now: string,
    ): Promise<ViewerAlbumAccess | null>
  }
  reader: PrivateObjectReader
  clock: () => Date
}

type DownloadEnv = { Bindings: Env; Variables: AuthVariables }
type DownloadContext = Parameters<MiddlewareHandler<DownloadEnv>>[0]

const MAX_SELECTION_FORM_BYTES = 32 * 1024

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
 *   1. requireViewerAlbumAccess  — invalid session -> 401; denied -> 403;
 *      session, permission, and album summary use one D1 query.
 *   2. isValidId(photoId)        — invalid -> 404, no I/O.
 *   3. download_enabled          — disabled -> 403.
 *   5. loadAlbumManifest         — absent -> 404; invalid/failure -> 500.
 *   6. manifest membership       — not listed -> 404.
 *   7. loadPhotoThumb/Preview    — absent -> 404; failure -> 500.
 *   8. build filename + response -> 200 attachment.
 *
 * POST /:albumId/selection chain, in fixed order:
 *   1. requireViewerAlbumAccess  — invalid session -> 401; denied -> 403.
 *   3. isSameOrigin              — absent/mismatch/null -> 400.
 *   4. isFormUrlEncoded          — wrong CT -> 400.
 *   5. bounded form parse        — extract variant (thumb|preview), photoIds (1..100 valid IDs) -> 400.
 *   6. download_enabled          — disabled -> 403.
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

  const lazyAlbumAccessRepo = (env: Env): DownloadRouteDeps['albumAccessRepo'] => ({
    getAuthorizedAlbumAccess: (tokenDigest, albumId, now) =>
      depsFromEnv(env).albumAccessRepo.getAuthorizedAlbumAccess(tokenDigest, albumId, now),
  })
  const lazyReader = (env: Env): PrivateObjectReader => ({
    get: (key) => depsFromEnv(env).reader.get(key),
  })
  const lazyClock = (env: Env): (() => Date) => () => depsFromEnv(env).clock()

  const albumAccess: MiddlewareHandler<DownloadEnv> = async (c, next) => {
    const middleware = requireViewerAlbumAccess(
      lazyAlbumAccessRepo(c.env),
      (ctx) => ctx.req.param('albumId'),
      lazyClock(c.env),
    ) as unknown as MiddlewareHandler<DownloadEnv>
    return middleware(c, next)
  }

  download.use('/:albumId/thumb/:photoId', albumAccess)
  download.use('/:albumId/preview/:photoId', albumAccess)
  download.use('/:albumId/selection', albumAccess)

  download.get('/:albumId/thumb/:photoId', async (c) => {
    const albumId = c.req.param('albumId')
    const photoId = c.req.param('photoId')

    if (!isValidId(photoId)) return objectNotFoundResponse()

    const albumSummary = c.get('authorizedAlbum')
    if (albumSummary === undefined) return objectForbiddenResponse()
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

    if (!isValidId(photoId)) return objectNotFoundResponse()

    const albumSummary = c.get('authorizedAlbum')
    if (albumSummary === undefined) return objectForbiddenResponse()
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

    if (!isSameOrigin(c)) return badRequestResponse()
    if (!isFormUrlEncoded(c.req.header('Content-Type'))) return badRequestResponse()

    const body = await parseUrlEncodedForm(c.req.raw, MAX_SELECTION_FORM_BYTES)
    if (body === null) return badRequestResponse()
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

    const albumSummary = c.get('authorizedAlbum')
    if (albumSummary === undefined) return objectForbiddenResponse()
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
