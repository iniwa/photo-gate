import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { JWTPayload, JWTVerifyGetKey } from 'jose'
import type { AccessConfig, AccessTokenVerifier } from '../types/admin-auth.js'

/**
 * Cloudflare Access JWT verification.
 *
 * Cloudflare's guidance is that the Worker must validate the
 * `Cf-Access-Jwt-Assertion` header itself even when Access sits in front: verify
 * the signature via the team-domain JWKS endpoint, plus issuer, audience, and the
 * standard temporal claims. We use `jose` (`createRemoteJWKSet` + `jwtVerify`) and
 * never hand-roll parsing or crypto.
 *
 * Testability: `verifyAccessToken` takes the `jwtVerify`-shaped function and the
 * key resolver as parameters, so unit tests inject a fake and never make a real
 * Cloudflare request, mint a real JWT, or rely on a production bypass. The
 * production verifier built by `createAccessTokenVerifier` wires the real `jose`
 * primitives. There is no environment switch or debug header that skips
 * verification.
 */

// Strict hostname allowlist for a Cloudflare Access team domain. Prefix labels
// are alphanumeric with internal hyphens; ASCII only. This rejects arbitrary
// custom domains, schemes, paths, ports, userinfo, and encoded forms so the
// JWKS URL can only ever target a *.cloudflareaccess.com host.
const TEAM_DOMAIN =
  /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+cloudflareaccess\.com$/

// AUD tag: non-empty, no whitespace or control characters, bounded length.
const AUD = /^[\x21-\x7e]{1,256}$/

/**
 * Validate the operator-supplied team domain and audience and derive the issuer
 * and JWKS URL. Returns `null` (fail closed) for any missing or malformed value;
 * the caller maps that to the same generic 403 as every other failure.
 *
 * The JWKS URL is constructed only from the validated `teamDomain`, never from a
 * caller-controlled string, so an attacker cannot point key resolution elsewhere.
 */
export function parseAccessConfig(
  teamDomain: string | undefined,
  aud: string | undefined,
): AccessConfig | null {
  if (typeof teamDomain !== 'string' || !TEAM_DOMAIN.test(teamDomain)) return null
  if (typeof aud !== 'string' || !AUD.test(aud)) return null
  return {
    teamDomain,
    aud,
    issuer: `https://${teamDomain}`,
    jwksUrl: `https://${teamDomain}/cdn-cgi/access/certs`,
  }
}

/** The subset of `jose`'s `jwtVerify` signature this module depends on. */
export type JwtVerifyFn = (
  token: string,
  getKey: JWTVerifyGetKey,
  options: { issuer: string; audience: string; requiredClaims: string[] },
) => Promise<{ payload: JWTPayload }>

/**
 * Core verification, isolated from `jose` for tests. Enforces signature (via
 * `getKey`), issuer, audience, and — through `requiredClaims` plus `jose`'s
 * built-in temporal checks — a present, unexpired `exp` and an honored `nbf` when
 * present. Requires `email` to be present and a string; any failure throws and is
 * mapped to the generic 403 upstream.
 */
export async function verifyAccessToken(
  token: string,
  getKey: JWTVerifyGetKey,
  config: AccessConfig,
  verify: JwtVerifyFn,
): Promise<{ email: string }> {
  const { payload } = await verify(token, getKey, {
    issuer: config.issuer,
    audience: config.aud,
    requiredClaims: ['exp', 'email'],
  })
  const email = payload.email
  if (typeof email !== 'string') {
    throw new Error('admin access: email claim missing or not a string')
  }
  return { email }
}

/**
 * Build the production verifier for a validated configuration. The remote JWKS is
 * created once per verifier (it maintains its own key cache); identity and claims
 * are never stored. Use `createVerifierCache` to reuse a verifier across requests
 * for the same configuration.
 */
export function createAccessTokenVerifier(config: AccessConfig): AccessTokenVerifier {
  const getKey = createRemoteJWKSet(new URL(config.jwksUrl))
  return (token) =>
    verifyAccessToken(token, getKey, config, (t, k, o) => jwtVerify(t, k, o))
}

/**
 * Memoize verifiers by configuration so the JWKS key cache is reused across
 * requests instead of refetched every time. The cache is keyed only by the
 * non-secret team domain and audience — never by request-specific identity or
 * claims — and holds verification key resolvers, not tokens or emails.
 */
export function createVerifierCache(): (config: AccessConfig) => AccessTokenVerifier {
  const cache = new Map<string, AccessTokenVerifier>()
  return (config) => {
    const key = `${config.teamDomain}\n${config.aud}`
    let verifier = cache.get(key)
    if (verifier === undefined) {
      verifier = createAccessTokenVerifier(config)
      cache.set(key, verifier)
    }
    return verifier
  }
}
