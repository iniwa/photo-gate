import type { Context } from 'hono'

export function unauthorizedResponse(c: Context): Response {
  c.header('Cache-Control', 'no-store')
  return c.text('Unauthorized', 401)
}

export function forbiddenResponse(c: Context): Response {
  c.header('Cache-Control', 'no-store')
  return c.text('Forbidden', 403)
}

export function serviceUnavailableResponse(c: Context): Response {
  c.header('Cache-Control', 'no-store')
  return c.text('Service Unavailable', 503)
}

/** Generic throttle response. It never identifies the matching account or network key. */
export function tooManyRequestsResponse(c: Context): Response {
  c.header('Cache-Control', 'no-store')
  c.header('Retry-After', '60')
  return c.text('Too Many Requests', 429)
}
