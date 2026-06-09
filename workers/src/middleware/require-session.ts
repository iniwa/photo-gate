import type { MiddlewareHandler } from 'hono'
import type { SessionWithUser } from '../types/session.js'
import type { AuthVariables } from '../types/auth-context.js'
import { parseSessionCookie } from '../services/session-cookie.js'
import { digestSessionToken } from '../services/auth-crypto.js'
import { isValidId } from '../services/repository-validation.js'
import { serviceUnavailableResponse, unauthorizedResponse } from './auth-response.js'

export interface SessionFetcher {
  fetchValidSession(tokenDigest: string, now: string): Promise<SessionWithUser | null>
}

export function requireSession(
  fetcher: SessionFetcher,
  clock: () => Date,
): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    const rawToken = parseSessionCookie(c.req.header('Cookie') ?? null)
    if (rawToken === undefined) {
      return unauthorizedResponse(c)
    }

    let tokenDigest: string
    let now: string
    try {
      tokenDigest = await digestSessionToken(rawToken)
      now = clock().toISOString()
    } catch {
      return serviceUnavailableResponse(c)
    }

    let session: SessionWithUser | null
    try {
      session = await fetcher.fetchValidSession(tokenDigest, now)
    } catch {
      return serviceUnavailableResponse(c)
    }

    if (session === null || session.user_enabled !== 1 || !isValidId(session.user_id)) {
      return unauthorizedResponse(c)
    }

    c.set('userId', session.user_id)
    await next()
  }
}
