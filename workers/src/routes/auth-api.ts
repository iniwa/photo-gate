import { Hono } from 'hono'
import type { Context, MiddlewareHandler } from 'hono'
import type { Env } from '../types/env.js'
import type { AuthVariables } from '../types/auth-context.js'
import type { UserAuthRow } from '../types/user.js'
import type { SessionWithUser } from '../types/session.js'
import { isValidId } from '../services/repository-validation.js'
import {
  MAX_LOGIN_FAILURES,
  SESSION_LIFETIME_SECONDS,
  isAccountLocked,
  lockoutExpiresAtFrom,
  sessionExpiresAtFrom,
} from '../services/login-policy.js'
import {
  digestSessionToken,
  generateSessionToken,
  verifyPassword,
} from '../services/auth-crypto.js'
import {
  parseSessionCookie,
  serializeClearCookie,
  serializeSessionCookie,
} from '../services/session-cookie.js'
import { requireSession } from '../middleware/require-session.js'
import {
  serviceUnavailableResponse,
  unauthorizedResponse,
  forbiddenResponse,
} from '../middleware/auth-response.js'

/**
 * Fixed dummy PBKDF2 hash used as a timing decoy when no user row is found.
 *
 * This is a PUBLIC timing decoy, not a secret: verifying a candidate password
 * against it always fails, but it makes the unknown-user / invalid-user / locked
 * paths spend the same PBKDF2 work as a real verification, so an attacker cannot
 * distinguish "user exists" from "user does not exist" by response timing.
 *
 * It is a well-formed `pbkdf2-sha256$100000$<16-byte salt>$<32-byte digest>`
 * value with fixed arbitrary salt and digest bytes. No password verifies against
 * it, and even if one did the dummy path always returns failure.
 */
const DUMMY_PASSWORD_HASH =
  'pbkdf2-sha256$100000$ASNFZ4mrze8BI0VniavN7w$ABEiM0RVZneImaq7zN3u_wARIjNEVWZ3iJmqu8zd7v8'

const MAX_PASSWORD_LENGTH = 1024

export interface AuthApiDeps {
  authRepo: {
    fetchUserForAuth(userId: string): Promise<UserAuthRow | null>
    recordLoginFailure(
      userId: string,
      now: string,
      lockoutThreshold: number,
      lockedUntil: string,
    ): Promise<void>
    resetLoginFailure(userId: string, now: string): Promise<void>
  }
  sessionRepo: {
    insertSession(
      tokenDigest: string,
      userId: string,
      createdAt: string,
      expiresAt: string,
    ): Promise<void>
    deleteSession(tokenDigest: string): Promise<void>
    fetchValidSession(tokenDigest: string, now: string): Promise<SessionWithUser | null>
  }
  clock: () => Date
}

type AuthApiContext = Context<{ Bindings: Env; Variables: AuthVariables }>

/** Rejects state-changing requests whose Origin header does not match the request URL. */
function originMismatch(c: AuthApiContext): boolean {
  const origin = c.req.header('Origin')
  if (origin === undefined) return false
  return origin !== new URL(c.req.url).origin
}

/** A request body Content-Type that is exactly the URL-encoded form type (optional charset). */
function isFormContentType(contentType: string | undefined): boolean {
  if (contentType === undefined) return false
  const base = contentType.split(';', 1)[0]?.trim().toLowerCase()
  return base === 'application/x-www-form-urlencoded'
}

export function createAuthApi(
  depsFromEnv: (env: Env) => AuthApiDeps,
): Hono<{ Bindings: Env; Variables: AuthVariables }> {
  const auth = new Hono<{ Bindings: Env; Variables: AuthVariables }>()

  auth.post('/login', async (c) => {
    // 1. Origin check before anything else. Do not parse the body.
    if (originMismatch(c)) return forbiddenResponse(c)

    // 2. Content-Type must be url-encoded form. Malformed requests are not
    //    credential guesses: fail generically without repo calls or dummy verify.
    if (!isFormContentType(c.req.header('Content-Type'))) {
      return unauthorizedResponse(c)
    }

    // 3. Parse form body. Missing / wrong-type / oversize fields fail generically
    //    without any repo call or dummy verify.
    let body: Record<string, string | File>
    try {
      body = await c.req.parseBody()
    } catch {
      return unauthorizedResponse(c)
    }
    const userId = body['userId']
    const password = body['password']
    if (typeof userId !== 'string' || typeof password !== 'string') {
      return unauthorizedResponse(c)
    }
    if (password.length < 1 || password.length > MAX_PASSWORD_LENGTH) {
      return unauthorizedResponse(c)
    }

    const deps = depsFromEnv(c.env)

    // 4. Current time.
    const now = deps.clock().toISOString()

    // 5. Candidate resolution. No repo call when the ID is invalid.
    const idValid = isValidId(userId)
    let row: UserAuthRow | null
    try {
      row = idValid ? await deps.authRepo.fetchUserForAuth(userId) : null
    } catch {
      return serviceUnavailableResponse(c)
    }

    // 6. Lock check (fail closed on corrupt locked_until inside isAccountLocked).
    let locked: boolean
    try {
      locked = row !== null && isAccountLocked(row.locked_until, now)
    } catch {
      return serviceUnavailableResponse(c)
    }

    // 7. Uniform password verification: always run, against the real or dummy hash.
    let ok: boolean
    try {
      ok = await verifyPassword(
        password,
        row !== null ? row.password_hash : DUMMY_PASSWORD_HASH,
      )
    } catch {
      return serviceUnavailableResponse(c)
    }

    // 8. Failure path: dummy-hash success must never grant access.
    if (row === null || locked || !ok) {
      if (idValid) {
        try {
          await deps.authRepo.recordLoginFailure(
            userId,
            now,
            MAX_LOGIN_FAILURES,
            lockoutExpiresAtFrom(now),
          )
        } catch {
          return serviceUnavailableResponse(c)
        }
      }
      return unauthorizedResponse(c)
    }

    // 9. Success path.
    try {
      await deps.authRepo.resetLoginFailure(userId, now)
    } catch {
      return serviceUnavailableResponse(c)
    }

    let token: string
    let digest: string
    try {
      token = generateSessionToken()
      digest = await digestSessionToken(token)
    } catch {
      return serviceUnavailableResponse(c)
    }

    try {
      await deps.sessionRepo.insertSession(digest, userId, now, sessionExpiresAtFrom(now))
    } catch {
      return serviceUnavailableResponse(c)
    }

    c.header('Cache-Control', 'no-store')
    c.header('Set-Cookie', serializeSessionCookie(token, SESSION_LIFETIME_SECONDS))
    c.header('Location', '/albums')
    return c.body(null, 303)
  })

  auth.post('/logout', async (c) => {
    // 1. Origin check before anything else.
    if (originMismatch(c)) return forbiddenResponse(c)

    const token = parseSessionCookie(c.req.header('Cookie') ?? null)

    // 2. No valid token: idempotent clear-and-redirect.
    if (token === undefined) {
      c.header('Cache-Control', 'no-store')
      c.header('Set-Cookie', serializeClearCookie())
      c.header('Location', '/')
      return c.body(null, 303)
    }

    // 3. Valid token: delete the server-side session first.
    const deps = depsFromEnv(c.env)
    let digest: string
    try {
      digest = await digestSessionToken(token)
    } catch {
      return serviceUnavailableResponse(c)
    }
    try {
      await deps.sessionRepo.deleteSession(digest)
    } catch {
      // Never clear the cookie while a live server-side session may remain.
      return serviceUnavailableResponse(c)
    }

    c.header('Cache-Control', 'no-store')
    c.header('Set-Cookie', serializeClearCookie())
    c.header('Location', '/')
    return c.body(null, 303)
  })

  auth.use('/me', async (c, next) => {
    const deps = depsFromEnv(c.env)
    // requireSession is typed with only { Variables }, which Hono treats as
    // invariant against this router's { Bindings; Variables } env. Widening the
    // handler type here keeps the middleware untouched and is sound: the
    // middleware only reads request headers and sets the `userId` variable.
    const middleware = requireSession(deps.sessionRepo, deps.clock) as
      unknown as MiddlewareHandler<{ Bindings: Env; Variables: AuthVariables }>
    return middleware(c, next)
  })

  auth.get('/me', (c) => {
    c.header('Cache-Control', 'no-store')
    return c.json({ userId: c.get('userId') })
  })

  return auth
}
