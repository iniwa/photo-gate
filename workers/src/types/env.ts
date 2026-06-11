/**
 * Compile-time binding shape for Phase 3+ Workers.
 * Binding names follow the approved defaults in docs/fable/autonomy-contract.md.
 * Declared in wrangler.toml; real resources are provisioned at deployment.
 */
export interface Env {
  DB: D1Database
  PHOTO_BUCKET: R2Bucket
}
