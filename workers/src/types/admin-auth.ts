/**
 * Shared types for the /admin Cloudflare Access authentication boundary.
 *
 * The verifier and allowlist are dependency-injected so the production JWT/JWKS
 * path (services/cloudflare-access-jwt.ts) and the request middleware
 * (middleware/require-admin.ts) stay decoupled and individually testable without
 * real Cloudflare requests, real JWTs, or any test bypass.
 */

/** Validated Cloudflare Access configuration derived from the Worker env. */
export interface AccessConfig {
  /** Validated team domain hostname, e.g. `<team>.cloudflareaccess.com`. */
  teamDomain: string
  /** Access application Audience (AUD) tag. */
  aud: string
  /** Expected `iss` claim: `https://<teamDomain>`. */
  issuer: string
  /** JWKS endpoint, always derived from the validated team domain only. */
  jwksUrl: string
}

/**
 * Verifies a raw Access JWT and returns the asserted email on success. Rejects
 * (throws) on any signature/issuer/audience/temporal/claim failure. The returned
 * email is the raw claim value; allowlist normalization happens in require-admin.
 */
export type AccessTokenVerifier = (token: string) => Promise<{ email: string }>

/** Per-request admin auth dependencies resolved from a valid configuration. */
export interface AdminAuthConfig {
  verifier: AccessTokenVerifier
  /** Normalized (trimmed, lowercased) administrator email allowlist. */
  allowlist: ReadonlySet<string>
}
