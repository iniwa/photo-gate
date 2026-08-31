import type { Context, MiddlewareHandler } from 'hono'
import type { AuthVariables } from '../types/auth-context.js'
import type { ViewerAlbumAccess } from '../services/viewer-album-access-repository.js'
import { digestSessionToken } from '../services/auth-crypto.js'
import { isValidId } from '../services/repository-validation.js'
import { parseSessionCookie } from '../services/session-cookie.js'
import {
  forbiddenResponse,
  serviceUnavailableResponse,
  unauthorizedResponse,
} from './auth-response.js'

export interface ViewerAlbumAccessFetcher {
  getAuthorizedAlbumAccess(
    tokenDigest: string,
    albumId: string,
    now: string,
  ): Promise<ViewerAlbumAccess | null>
}

type AlbumEnv = { Variables: AuthVariables }

/**
 * Authenticates a session and authorizes one album through a single D1 query.
 * It replaces the former session lookup + permission lookup + summary lookup
 * on the private image, download, and detail-page hot paths.
 */
export function requireViewerAlbumAccess(
  fetcher: ViewerAlbumAccessFetcher,
  albumIdResolver: (c: Context<AlbumEnv>) => string | undefined,
  clock: () => Date,
): MiddlewareHandler<AlbumEnv> {
  return async (c, next) => {
    const rawToken = parseSessionCookie(c.req.header('Cookie') ?? null)
    if (rawToken === undefined) return unauthorizedResponse(c)

    let tokenDigest: string
    let albumId: string | undefined
    let now: string
    try {
      tokenDigest = await digestSessionToken(rawToken)
      albumId = albumIdResolver(c)
      now = clock().toISOString()
    } catch {
      return serviceUnavailableResponse(c)
    }
    if (albumId === undefined) return forbiddenResponse(c)

    let access: ViewerAlbumAccess | null
    try {
      access = await fetcher.getAuthorizedAlbumAccess(tokenDigest, albumId, now)
    } catch {
      return serviceUnavailableResponse(c)
    }
    if (access === null || !isValidId(access.userId)) return unauthorizedResponse(c)
    if (access.album === null) return forbiddenResponse(c)

    c.set('userId', access.userId)
    c.set('authorizedAlbum', access.album)
    await next()
  }
}

/** Page wrapper that preserves the existing 303-to-login behavior for SSR pages. */
export function requireViewerAlbumAccessPage(
  fetcher: ViewerAlbumAccessFetcher,
  albumIdResolver: (c: Context<AlbumEnv>) => string | undefined,
  clock: () => Date,
): MiddlewareHandler<AlbumEnv> {
  const inner = requireViewerAlbumAccess(fetcher, albumIdResolver, clock)
  return async (c, next) => {
    let advanced = false
    const response = await inner(c, async () => {
      advanced = true
      await next()
    })
    if (advanced) return
    if (response instanceof Response && response.status === 401) {
      c.header('Cache-Control', 'no-store')
      c.header('Location', '/')
      return c.body(null, 303)
    }
    return response
  }
}
