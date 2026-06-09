import { describe, it, expect } from 'vitest'
import {
  serializeSessionCookie,
  serializeClearCookie,
  parseSessionCookie,
  COOKIE_NAME,
} from '../src/services/session-cookie.js'
import { generateSessionToken } from '../src/services/auth-crypto.js'

function makeToken(): string {
  return generateSessionToken()
}

describe('serializeSessionCookie', () => {
  it('includes the cookie name and token', () => {
    const token = makeToken()
    const header = serializeSessionCookie(token, 604800)
    expect(header).toContain(`${COOKIE_NAME}=${token}`)
  })

  it('includes HttpOnly', () => {
    expect(serializeSessionCookie(makeToken(), 604800)).toContain('HttpOnly')
  })

  it('includes Secure', () => {
    expect(serializeSessionCookie(makeToken(), 604800)).toContain('Secure')
  })

  it('includes SameSite=Strict', () => {
    expect(serializeSessionCookie(makeToken(), 604800)).toContain('SameSite=Strict')
  })

  it('includes Path=/', () => {
    expect(serializeSessionCookie(makeToken(), 604800)).toContain('Path=/')
  })

  it('includes explicit Max-Age matching the supplied value', () => {
    const header = serializeSessionCookie(makeToken(), 604800)
    expect(header).toContain('Max-Age=604800')
  })

  it('accepts different Max-Age values', () => {
    const header = serializeSessionCookie(makeToken(), 86400)
    expect(header).toContain('Max-Age=86400')
  })

  it('throws for zero maxAge', () => {
    expect(() => serializeSessionCookie(makeToken(), 0)).toThrow()
  })

  it('throws for negative maxAge', () => {
    expect(() => serializeSessionCookie(makeToken(), -1)).toThrow()
  })

  it('throws for fractional or non-finite maxAge', () => {
    expect(() => serializeSessionCookie(makeToken(), 1.5)).toThrow()
    expect(() => serializeSessionCookie(makeToken(), Number.POSITIVE_INFINITY)).toThrow()
  })

  it('throws for a malformed token', () => {
    expect(() => serializeSessionCookie('not-a-session-token', 60)).toThrow()
  })
})

describe('serializeClearCookie', () => {
  it('includes the cookie name', () => {
    expect(serializeClearCookie()).toContain(COOKIE_NAME)
  })

  it('includes Max-Age=0', () => {
    expect(serializeClearCookie()).toContain('Max-Age=0')
  })

  it('includes HttpOnly', () => {
    expect(serializeClearCookie()).toContain('HttpOnly')
  })

  it('includes Secure', () => {
    expect(serializeClearCookie()).toContain('Secure')
  })

  it('includes SameSite=Strict', () => {
    expect(serializeClearCookie()).toContain('SameSite=Strict')
  })
})

describe('parseSessionCookie', () => {
  it('returns the token for a valid single session cookie', () => {
    const token = makeToken()
    const header = `${COOKIE_NAME}=${token}`
    expect(parseSessionCookie(header)).toBe(token)
  })

  it('returns the token when other cookies are present', () => {
    const token = makeToken()
    const header = `other=value; ${COOKIE_NAME}=${token}; another=x`
    expect(parseSessionCookie(header)).toBe(token)
  })

  it('returns undefined for null cookie header', () => {
    expect(parseSessionCookie(null)).toBeUndefined()
  })

  it('returns undefined for empty cookie header', () => {
    expect(parseSessionCookie('')).toBeUndefined()
  })

  it('returns undefined when session cookie is absent', () => {
    expect(parseSessionCookie('other=value; second=x')).toBeUndefined()
  })

  it('returns undefined for duplicate session cookie names', () => {
    const t1 = makeToken()
    const t2 = makeToken()
    const header = `${COOKIE_NAME}=${t1}; ${COOKIE_NAME}=${t2}`
    expect(parseSessionCookie(header)).toBeUndefined()
  })

  it('returns undefined for malformed base64url value', () => {
    const header = `${COOKIE_NAME}=!!!not-base64url!!!`
    expect(parseSessionCookie(header)).toBeUndefined()
  })

  it('returns undefined for padded base64url', () => {
    expect(parseSessionCookie(`${COOKIE_NAME}=${makeToken()}=`)).toBeUndefined()
  })

  it('returns undefined when decoded token is fewer than 32 bytes', () => {
    const short = btoa('tooshort').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
    expect(parseSessionCookie(`${COOKIE_NAME}=${short}`)).toBeUndefined()
  })

  it('returns undefined when decoded token is more than 32 bytes', () => {
    const long = new Uint8Array(33).fill(0)
    let binary = ''
    for (const b of long) binary += String.fromCharCode(b)
    const token = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
    expect(parseSessionCookie(`${COOKIE_NAME}=${token}`)).toBeUndefined()
  })

  it('returns undefined for an empty token value', () => {
    expect(parseSessionCookie(`${COOKIE_NAME}=`)).toBeUndefined()
  })

  it('roundtrips: serialize then parse recovers the token', () => {
    const token = makeToken()
    const setHeader = serializeSessionCookie(token, 3600)
    // Simulate Cookie request header from the Set-Cookie value
    const cookieHeader = `${COOKIE_NAME}=${token}`
    expect(parseSessionCookie(cookieHeader)).toBe(token)
    // Verify serialize produced a valid format
    expect(setHeader).toContain(`${COOKIE_NAME}=${token}`)
  })
})
