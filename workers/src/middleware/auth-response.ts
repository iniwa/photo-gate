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
