/**
 * Compile-time binding shape for Phase 3+ Workers.
 * Not yet attached to the active Hono app or wrangler.toml.
 */
export interface Env {
  DB: D1Database
}
