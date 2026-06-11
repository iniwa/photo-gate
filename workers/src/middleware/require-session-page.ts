import type { MiddlewareHandler } from 'hono'
import type { AuthVariables } from '../types/auth-context.js'
import { requireSession } from './require-session.js'
import type { SessionFetcher } from './require-session.js'

/**
 * Page-oriented wrapper around `requireSession`.
 *
 * HTML pages must not show the raw 401 text used by API/image routes; an
 * unauthenticated viewer should be sent to the login page. This wrapper reuses
 * the existing session-validation logic verbatim and post-processes only its
 * outcome: a 401 becomes a `303 See Other` to `/` with `Cache-Control: no-store`
 * and an empty body. A 503 (dependency failure) passes through unchanged, and on
 * success `requireSession` has already set the `userId` variable and called
 * `next()`, so the wrapper does nothing further.
 *
 * Session-validation logic is never duplicated here: `requireSession` runs with a
 * capturing `next` so the wrapper can tell "the chain continued" (success) from
 * "the middleware returned a Response" (failure / 503) and act accordingly.
 */
export function requireSessionPage(
  fetcher: SessionFetcher,
  clock: () => Date,
): MiddlewareHandler<{ Variables: AuthVariables }> {
  const inner = requireSession(fetcher, clock)
  return async (c, next) => {
    let advanced = false
    const res = await inner(c, async () => {
      advanced = true
      await next()
    })

    // Success: requireSession called our capturing next; nothing to rewrite.
    if (advanced) return

    // requireSession short-circuited with a Response (401 or 503).
    if (res instanceof Response && res.status === 401) {
      c.header('Cache-Control', 'no-store')
      c.header('Location', '/')
      return c.body(null, 303)
    }

    // 503 (or any other short-circuit) passes through unchanged.
    return res
  }
}
