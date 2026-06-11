import { Hono } from 'hono'
import type { Env } from './types/env.js'
import { securityHeaders } from './middleware/security-headers.js'
import { pages, NotFound } from './routes/pages.js'
import { createAuthApi } from './routes/auth-api.js'
import { AuthRepository } from './services/auth-repository.js'
import { SessionRepository } from './services/session-repository.js'

const app = new Hono<{ Bindings: Env }>()

app.use('*', securityHeaders)

// First real D1-backed routes. Mounted before the reserved-401 loop so that
// /api/auth/* reaches this router while every other /api path stays 401.
// If env.DB is undefined at runtime, repository calls reject and handlers
// return 503 (fail closed); no explicit binding check is added here.
app.route('/api/auth', createAuthApi((env) => ({
  authRepo: new AuthRepository(env.DB),
  sessionRepo: new SessionRepository(env.DB),
  clock: () => new Date(),
})))

// Reserved routes fail closed with 401 regardless of auth state.
// No fixture data, no album/photo IDs, no redirect.
const RESERVED = ['/api', '/img', '/admin'] as const
for (const prefix of RESERVED) {
  app.all(prefix, (c) => {
    c.header('Cache-Control', 'no-store')
    return c.text('Unauthorized', 401)
  })
  app.all(`${prefix}/*`, (c) => {
    c.header('Cache-Control', 'no-store')
    return c.text('Unauthorized', 401)
  })
}

app.route('/', pages)

app.notFound((c) => {
  c.header('Cache-Control', 'no-store')
  return c.html(<NotFound />, 404)
})

export default app
