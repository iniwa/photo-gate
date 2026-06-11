import type { MiddlewareHandler } from 'hono'

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  // 'same-origin', not 'no-referrer': per the Fetch spec, navigation POSTs
  // (the login form) serialize the Origin header according to the referrer
  // policy, so 'no-referrer' makes every browser send "Origin: null" and the
  // login origin check correctly fails closed with 403 for everyone.
  // 'same-origin' keeps referrers inside this origin and sends nothing
  // cross-origin, which is equivalent here: the app has no external links.
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
}

export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next()
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    c.res.headers.set(name, value)
  }
}
