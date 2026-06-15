/**
 * Compile-time binding shape for Phase 3+ Workers.
 * Binding names follow the approved defaults in docs/fable/autonomy-contract.md.
 * Declared in wrangler.toml; real resources are provisioned at deployment.
 */
export interface Env {
  DB: D1Database
  PHOTO_BUCKET: R2Bucket
  /**
   * /admin Cloudflare Access configuration. Registered at deploy time (Worker
   * vars/secrets), NOT in wrangler.toml or source. All three are optional here so
   * a missing or malformed value fails closed to a generic 403 rather than a type
   * error. See docs/operations/admin-access.md.
   */
  CF_ACCESS_TEAM_DOMAIN?: string
  CF_ACCESS_AUD?: string
  ADMIN_EMAILS?: string
}
