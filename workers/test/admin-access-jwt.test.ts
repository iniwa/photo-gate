import { describe, it, expect } from 'vitest'
import type { JWTVerifyGetKey } from 'jose'
import {
  parseAccessConfig,
  verifyAccessToken,
  type JwtVerifyFn,
} from '../src/services/cloudflare-access-jwt.js'

// A key resolver placeholder. The injected verify fake never calls it, so a real
// JWKS fetch never happens in these tests.
const dummyKey = (() => {
  throw new Error('getKey must not be invoked by tests')
}) as unknown as JWTVerifyGetKey

const TEAM = 'photogate.cloudflareaccess.com'
const AUD = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f60000'

describe('parseAccessConfig — valid', () => {
  it('derives issuer and JWKS URL from the validated team domain only', () => {
    const config = parseAccessConfig(TEAM, AUD)
    expect(config).not.toBeNull()
    expect(config?.teamDomain).toBe(TEAM)
    expect(config?.aud).toBe(AUD)
    expect(config?.issuer).toBe(`https://${TEAM}`)
    expect(config?.jwksUrl).toBe(`https://${TEAM}/cdn-cgi/access/certs`)
  })

  it('accepts a multi-label Cloudflare Access team domain', () => {
    expect(parseAccessConfig('photo.gate.cloudflareaccess.com', AUD)).not.toBeNull()
  })
})

describe('parseAccessConfig — fail closed on malformed team domain', () => {
  const badDomains: Array<[string, string | undefined]> = [
    ['undefined', undefined],
    ['empty', ''],
    ['scheme included', 'https://photogate.cloudflareaccess.com'],
    ['path included', 'photogate.cloudflareaccess.com/cdn-cgi'],
    ['leading slash', '/photogate.cloudflareaccess.com'],
    ['trailing slash', 'photogate.cloudflareaccess.com/'],
    ['internal whitespace', 'photo gate.cloudflareaccess.com'],
    ['surrounding whitespace', ' photogate.cloudflareaccess.com '],
    ['single label', 'localhost'],
    ['port included', 'photogate.cloudflareaccess.com:8443'],
    ['double dot', 'photogate..cloudflareaccess.com'],
    ['userinfo', 'user@photogate.cloudflareaccess.com'],
    ['trailing dot', 'photogate.cloudflareaccess.com.'],
    ['leading hyphen label', '-bad.cloudflareaccess.com'],
    ['arbitrary custom domain', 'access.example.co.uk'],
    ['suffix lookalike', 'team.cloudflareaccess.com.example.test'],
    ['bare Cloudflare Access domain', 'cloudflareaccess.com'],
  ]
  for (const [label, value] of badDomains) {
    it(`rejects ${label}`, () => {
      expect(parseAccessConfig(value, AUD)).toBeNull()
    })
  }
})

describe('parseAccessConfig — fail closed on malformed audience', () => {
  const badAud: Array<[string, string | undefined]> = [
    ['undefined', undefined],
    ['empty', ''],
    ['internal whitespace', 'aud with space'],
    ['surrounding whitespace', ` ${AUD} `],
    ['control character', 'audtag'],
    ['too long', 'a'.repeat(257)],
  ]
  for (const [label, value] of badAud) {
    it(`rejects ${label}`, () => {
      expect(parseAccessConfig(TEAM, value)).toBeNull()
    })
  }
})

describe('verifyAccessToken — success', () => {
  it('returns the asserted email on a successful verification', async () => {
    const config = parseAccessConfig(TEAM, AUD)!
    const verify: JwtVerifyFn = async () => ({ payload: { email: 'admin@example.com', exp: 1 } })
    const result = await verifyAccessToken('token', dummyKey, config, verify)
    expect(result.email).toBe('admin@example.com')
  })

  it('passes issuer, audience, and required exp/email claims to the verifier', async () => {
    const config = parseAccessConfig(TEAM, AUD)!
    let captured: { token: string; options: { issuer: string; audience: string; requiredClaims: string[] } } | undefined
    const verify: JwtVerifyFn = async (token, _key, options) => {
      captured = { token, options }
      return { payload: { email: 'admin@example.com', exp: 1 } }
    }
    await verifyAccessToken('the-token', dummyKey, config, verify)
    expect(captured?.token).toBe('the-token')
    expect(captured?.options.issuer).toBe(`https://${TEAM}`)
    expect(captured?.options.audience).toBe(AUD)
    expect(captured?.options.requiredClaims).toContain('exp')
    expect(captured?.options.requiredClaims).toContain('email')
  })

  it('forwards the injected key resolver to the verifier', async () => {
    const config = parseAccessConfig(TEAM, AUD)!
    let sameKey = false
    const verify: JwtVerifyFn = async (_t, key) => {
      sameKey = key === dummyKey
      return { payload: { email: 'admin@example.com', exp: 1 } }
    }
    await verifyAccessToken('token', dummyKey, config, verify)
    expect(sameKey).toBe(true)
  })
})

describe('verifyAccessToken — fail closed', () => {
  it('propagates a verifier rejection (bad signature / issuer / audience / expiry)', async () => {
    const config = parseAccessConfig(TEAM, AUD)!
    const verify: JwtVerifyFn = async () => {
      throw new Error('JWTExpired')
    }
    await expect(verifyAccessToken('token', dummyKey, config, verify)).rejects.toThrow()
  })

  it('throws when the email claim is missing', async () => {
    const config = parseAccessConfig(TEAM, AUD)!
    const verify: JwtVerifyFn = async () => ({ payload: { exp: 1 } })
    await expect(verifyAccessToken('token', dummyKey, config, verify)).rejects.toThrow()
  })

  it('throws when the email claim is not a string', async () => {
    const config = parseAccessConfig(TEAM, AUD)!
    const verify: JwtVerifyFn = async () => ({ payload: { email: 42 as unknown as string, exp: 1 } })
    await expect(verifyAccessToken('token', dummyKey, config, verify)).rejects.toThrow()
  })
})
