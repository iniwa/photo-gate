import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import type { Env } from '../types/env.js'
import type { AuthVariables } from '../types/auth-context.js'
import type { SessionWithUser } from '../types/session.js'
import type { PrivateObjectReader } from '../types/private-object.js'
import type { AuthorizedAlbumSummary } from '../types/authorized-album.js'
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

/**
 * Viewer download routes. Mounted at `/download` by index.tsx.
 *
 *   GET /:albumId/thumb/:photoId   -> albums/{albumId}/thumbs/{photoId}.webp as attachment
 *   GET /:albumId/preview/:photoId -> albums/{albumId}/previews/{photoId}.jpg as attachment
 *
 * Per-request chain (both routes), in fixed order:
 *   1. requireSession      — invalid session -> 401, nothing else runs.
 *   2. requireAlbumPermission — denied / invalid albumId -> 403.
 *   3. isValidId(photoId)  — invalid -> 404, no I/O.
 *   4. getAuthorizedAlbum  — re-reads download_enabled; null race -> 403; disabled -> 403.
 *   5. loadAlbumManifest   — absent -> 404; invalid/failure -> 500.
 *   6. manifest membership — photo not listed -> 404; present -> captures photo.title.
 *   7. loadPhotoThumb / loadPhotoPreview — absent -> 404; failure -> 500.
 *   8. buildThumbDownloadFilename / buildDownloadFilename + response -> 200 attachment.
 *
 * No R2 keys, bucket names, album IDs, photo IDs, or exception details are ever
 * logged or echoed. Only generated, metadata-stripped derivatives are served.
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

  return download
}
