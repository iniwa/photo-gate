import type { Context, MiddlewareHandler } from 'hono'
import type { AuthVariables } from '../types/auth-context.js'
import { isValidId } from '../services/repository-validation.js'
import { forbiddenResponse, serviceUnavailableResponse, unauthorizedResponse } from './auth-response.js'

export interface PermissionChecker {
  checkPermission(userId: string, albumId: string, now: string): Promise<boolean>
}

type AlbumEnv = { Variables: AuthVariables }

export function requireAlbumPermission(
  permChecker: PermissionChecker,
  albumIdResolver: (c: Context<AlbumEnv>) => string | undefined,
  clock: () => Date,
): MiddlewareHandler<AlbumEnv> {
  return async (c, next) => {
    const userId = c.get('userId') as string | undefined
    if (!userId || !isValidId(userId)) {
      return unauthorizedResponse(c)
    }

    let albumId: string | undefined
    try {
      albumId = albumIdResolver(c)
    } catch {
      return serviceUnavailableResponse(c)
    }

    if (!albumId || !isValidId(albumId)) {
      return forbiddenResponse(c)
    }

    let allowed: boolean
    try {
      const now = clock().toISOString()
      allowed = await permChecker.checkPermission(userId, albumId, now)
    } catch {
      return serviceUnavailableResponse(c)
    }

    if (!allowed) {
      return forbiddenResponse(c)
    }

    await next()
  }
}
