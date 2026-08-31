/**
 * Compile-time binding shape for Phase 3+ Workers.
 * Binding names follow the approved defaults in docs/fable/autonomy-contract.md.
 * Declared in wrangler.toml; real resources are provisioned at deployment.
 */
export interface Env {
  DB: D1Database
  PHOTO_BUCKET: R2Bucket
  /**
   * Lightweight login throttles configured in wrangler.toml. They are not
   * identity stores and must never replace the D1 account lockout policy.
   */
  LOGIN_ACCOUNT_RATE_LIMIT: RateLimit
  LOGIN_NETWORK_RATE_LIMIT: RateLimit
  /**
   * /admin Cloudflare Access configuration. Registered at deploy time (Worker
   * vars/secrets), NOT in wrangler.toml or source. All three are optional here so
   * a missing or malformed value fails closed to a generic 403 rather than a type
   * error. See docs/operations/admin-access.md.
   */
  CF_ACCESS_TEAM_DOMAIN?: string
  CF_ACCESS_AUD?: string
  ADMIN_EMAILS?: string
  /**
   * HMAC-SHA-256 key for signing R2 cleanup confirmation tokens. Registered at
   * deploy time as a Worker secret, NOT in wrangler.toml or source. Optional here
   * so a missing value fails closed to 500 in the confirmation routes rather than
   * a type error. Must be at least 32 characters; shorter values are rejected at
   * request time.
   */
  R2_CLEANUP_HMAC_KEY?: string
  /**
   * HMAC-SHA-256 key for admin hard-delete confirmation-preview tokens.
   * Registered as a Worker secret, not in source. Optional so missing values
   * fail closed to 500 in the preview routes. Must be at least 32 characters.
   */
  HARD_DELETE_HMAC_KEY?: string
}
