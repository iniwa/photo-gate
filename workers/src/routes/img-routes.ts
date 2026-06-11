import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import type { Env } from '../types/env.js'
import type { AuthVariables } from '../types/auth-context.js'
import type { SessionWithUser } from '../types/session.js'
import type { PrivateObjectReader } from '../types/private-object.js'
import { isValidId } from '../services/safe-id.js'
import {
  loadManifestAuthorizedThumb,
  loadManifestAuthorizedPreview,
} from '../services/manifest-authorized-photo-service.js'
import { loadAlbumCover } from '../services/private-album-object-service.js'
import { requireSession } from '../middleware/require-session.js'
import { requireAlbumPermission } from '../middleware/require-album-permission.js'
import {
  privateImageResponse,
  objectNotFoundResponse,
  objectInternalErrorResponse,
} from '../middleware/private-object-response.js'

export interface ImgRouteDeps {
  sessionRepo: {
    fetchValidSession(tokenDigest: string, now: string): Promise<SessionWithUser | null>
  }
  permChecker: {
    checkPermission(userId: string, albumId: string, now: string): Promise<boolean>
  }
  reader: PrivateObjectReader
  clock: () => Date
}

type ImgEnv = { Bindings: Env; Variables: AuthVariables }

/**
 * Private viewer image routes. Mounted at `/img` by index.tsx.
 *
 *   GET /:albumId/cover            -> albums/{albumId}/cover.webp
 *   GET /:albumId/thumb/:photoId   -> albums/{albumId}/thumbs/{photoId}.webp
 *   GET /:albumId/preview/:photoId -> albums/{albumId}/previews/{photoId}.jpg
 *
 * Per-request chain, in fixed order:
 *   1. requireSession      — invalid session -> 401, nothing else runs.
 *   2. requireAlbumPermission — denied / invalid albumId -> 403, reader never reached.
 *   3. handler — thumb/preview enforce manifest membership before any image read;
 *      cover is an album-scoped asset and is NOT manifest-gated (see ADR 2.2.4).
 *
 * Failures map per the ADR table: invalid photoId -> 404 with no reader call;
 * manifest absent / photo unlisted / image absent -> generic 404; manifest invalid /
 * reader failure / any throw -> generic 500. No identifier, key, or error detail is
 * ever logged or echoed.
 */
export function createImgRoutes(
  depsFromEnv: (env: Env) => ImgRouteDeps,
): Hono<ImgEnv> {
  const img = new Hono<ImgEnv>()

  // requireSession / requireAlbumPermission are typed with only { Variables }, which
  // Hono treats as invariant against this router's { Bindings; Variables } env.
  // Widening the handler type here keeps the middleware untouched and is sound: they
  // only read request state and set the `userId` variable.
  //
  // Session validation applies to every path. Permission is attached to the exact
  // parameterized route patterns so that c.req.param('albumId') resolves when the
  // resolver runs (a router-level '*' use does not capture named params).
  //
  // Deps are resolved lazily inside each repository/reader call rather than eagerly per
  // request. This keeps the chain fail-closed: a missing or malformed binding makes the
  // *call* reject (mapped to 503 by the session/permission middleware, or 500 by the
  // object loaders), while the no-cookie path still short-circuits to 401 before any
  // dep is resolved. requireSession parses the cookie before touching the fetcher, so a
  // missing binding never turns a no-cookie request into a 500.
  //
  // `clock` is resolved up front because requireSession/requireAlbumPermission read it,
  // but only after their own cookie/userId/albumId checks; resolving it is just calling
  // depsFromEnv, and any failure there closes to 503/500 through the existing try/catch.
  const lazySessionRepo = (env: Env): ImgRouteDeps['sessionRepo'] => ({
    fetchValidSession: (tokenDigest, now) =>
      depsFromEnv(env).sessionRepo.fetchValidSession(tokenDigest, now),
  })
  const lazyPermChecker = (env: Env): ImgRouteDeps['permChecker'] => ({
    checkPermission: (userId, albumId, now) =>
      depsFromEnv(env).permChecker.checkPermission(userId, albumId, now),
  })
  const lazyReader = (env: Env): PrivateObjectReader => ({
    get: (key) => depsFromEnv(env).reader.get(key),
  })
  const lazyClock = (env: Env): (() => Date) => () => depsFromEnv(env).clock()

  img.use('*', async (c, next) => {
    const middleware = requireSession(lazySessionRepo(c.env), lazyClock(c.env)) as
      unknown as MiddlewareHandler<ImgEnv>
    return middleware(c, next)
  })

  const albumPermission: MiddlewareHandler<ImgEnv> = async (c, next) => {
    const middleware = requireAlbumPermission(
      lazyPermChecker(c.env),
      (ctx) => ctx.req.param('albumId'),
      lazyClock(c.env),
    ) as unknown as MiddlewareHandler<ImgEnv>
    return middleware(c, next)
  }

  img.use('/:albumId/cover', albumPermission)
  img.use('/:albumId/thumb/:photoId', albumPermission)
  img.use('/:albumId/preview/:photoId', albumPermission)

  img.get('/:albumId/cover', async (c) => {
    const albumId = c.req.param('albumId')
    try {
      const result = await loadAlbumCover(lazyReader(c.env), albumId)
      if (result.status === 'not_found') return objectNotFoundResponse()
      return privateImageResponse(result.value, 'cover')
    } catch {
      return objectInternalErrorResponse()
    }
  })

  img.get('/:albumId/thumb/:photoId', async (c) => {
    const albumId = c.req.param('albumId')
    const photoId = c.req.param('photoId')
    if (!isValidId(photoId)) return objectNotFoundResponse()
    try {
      const result = await loadManifestAuthorizedThumb(lazyReader(c.env), albumId, photoId)
      if (result.status === 'not_found') return objectNotFoundResponse()
      return privateImageResponse(result.value, 'thumb')
    } catch {
      return objectInternalErrorResponse()
    }
  })

  img.get('/:albumId/preview/:photoId', async (c) => {
    const albumId = c.req.param('albumId')
    const photoId = c.req.param('photoId')
    if (!isValidId(photoId)) return objectNotFoundResponse()
    try {
      const result = await loadManifestAuthorizedPreview(lazyReader(c.env), albumId, photoId)
      if (result.status === 'not_found') return objectNotFoundResponse()
      return privateImageResponse(result.value, 'preview')
    } catch {
      return objectInternalErrorResponse()
    }
  })

  return img
}
