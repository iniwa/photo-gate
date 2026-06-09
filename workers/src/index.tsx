import { Hono } from 'hono'
import { securityHeaders } from './middleware/security-headers.js'
import { pages, NotFound } from './routes/pages.js'

type Env = Record<string, never>

const app = new Hono<{ Bindings: Env }>()

app.use('*', securityHeaders)

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
