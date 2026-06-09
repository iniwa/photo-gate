import { describe, it, expect } from 'vitest'
import {
  hashPassword,
  verifyPassword,
  constantTimeEqual,
  generateSessionToken,
  digestSessionToken,
  base64urlDecode,
  MIN_ITERATIONS,
  MAX_ITERATIONS,
} from '../src/services/auth-crypto.js'

describe('hashPassword', () => {
  it('produces the expected format string', async () => {
    const hash = await hashPassword('test-password', MIN_ITERATIONS)
    const parts = hash.split('$')
    expect(parts).toHaveLength(4)
    expect(parts[0]).toBe('pbkdf2-sha256')
    expect(parts[1]).toBe(String(MIN_ITERATIONS))
  })

  it('encodes salt as unpadded base64url (no = + /)', async () => {
    const hash = await hashPassword('test-password', MIN_ITERATIONS)
    const salt = hash.split('$')[2] ?? ''
    expect(salt).not.toContain('=')
    expect(salt).not.toContain('+')
    expect(salt).not.toContain('/')
    const decoded = base64urlDecode(salt)
    expect(decoded).not.toBeNull()
    expect(decoded!.length).toBe(16)
  })

  it('encodes derived key as unpadded base64url of 32 bytes', async () => {
    const hash = await hashPassword('test-password', MIN_ITERATIONS)
    const digest = hash.split('$')[3] ?? ''
    const decoded = base64urlDecode(digest)
    expect(decoded).not.toBeNull()
    expect(decoded!.length).toBe(32)
  })

  it('uses a random salt so two hashes of the same password differ', async () => {
    const h1 = await hashPassword('same', MIN_ITERATIONS)
    const h2 = await hashPassword('same', MIN_ITERATIONS)
    expect(h1).not.toBe(h2)
  })

  it('stores the explicit iteration count', async () => {
    const hash = await hashPassword('pw', MIN_ITERATIONS)
    expect(hash.split('$')[1]).toBe(String(MIN_ITERATIONS))
  })

  it('rejects iterations below MIN_ITERATIONS', async () => {
    await expect(hashPassword('pw', MIN_ITERATIONS - 1)).rejects.toThrow()
  })

  it('rejects iterations above MAX_ITERATIONS', async () => {
    await expect(hashPassword('pw', MAX_ITERATIONS + 1)).rejects.toThrow()
  })

  it('rejects non-integer iterations', async () => {
    await expect(hashPassword('pw', MIN_ITERATIONS + 0.5)).rejects.toThrow()
  })

  it('error message does not include the password', async () => {
    await expect(hashPassword('secret-password', MIN_ITERATIONS - 1)).rejects.toSatisfy(
      (e: unknown) => !(e instanceof Error) || !e.message.includes('secret-password'),
    )
  })
})

describe('verifyPassword', () => {
  it('returns true for correct password', async () => {
    const hash = await hashPassword('correct', MIN_ITERATIONS)
    expect(await verifyPassword('correct', hash)).toBe(true)
  })

  it('returns false for wrong password', async () => {
    const hash = await hashPassword('correct', MIN_ITERATIONS)
    expect(await verifyPassword('wrong', hash)).toBe(false)
  })

  it('returns false for empty string password when hash is non-empty', async () => {
    const hash = await hashPassword('nonempty', MIN_ITERATIONS)
    expect(await verifyPassword('', hash)).toBe(false)
  })

  it('returns false for malformed hash (wrong field count)', async () => {
    expect(await verifyPassword('pw', 'notahash')).toBe(false)
  })

  it('returns false for unsupported algorithm', async () => {
    const hash = await hashPassword('pw', MIN_ITERATIONS)
    const bad = hash.replace('pbkdf2-sha256', 'md5')
    expect(await verifyPassword('pw', bad)).toBe(false)
  })

  it('returns false for iteration count below minimum', async () => {
    const hash = await hashPassword('pw', MIN_ITERATIONS)
    const parts = hash.split('$')
    parts[1] = '99999'
    expect(await verifyPassword('pw', parts.join('$'))).toBe(false)
  })

  it('returns false for iteration count above maximum', async () => {
    const hash = await hashPassword('pw', MIN_ITERATIONS)
    const parts = hash.split('$')
    parts[1] = String(MAX_ITERATIONS + 1)
    expect(await verifyPassword('pw', parts.join('$'))).toBe(false)
  })

  it('returns false for a non-canonical iteration count', async () => {
    const hash = await hashPassword('pw', MIN_ITERATIONS)
    const parts = hash.split('$')
    parts[1] = `${MIN_ITERATIONS}junk`
    expect(await verifyPassword('pw', parts.join('$'))).toBe(false)
  })

  it('returns false for padded or standard-base64 encodings', async () => {
    const hash = await hashPassword('pw', MIN_ITERATIONS)
    const parts = hash.split('$')
    parts[2] = `${parts[2]}=`
    expect(await verifyPassword('pw', parts.join('$'))).toBe(false)
  })

  it('returns false for malformed base64url salt', async () => {
    expect(await verifyPassword('pw', 'pbkdf2-sha256$100000$!!!$aaaa')).toBe(false)
  })

  it('returns false for truncated digest', async () => {
    const hash = await hashPassword('pw', MIN_ITERATIONS)
    const parts = hash.split('$')
    parts[3] = (parts[3] ?? '').slice(0, 10)
    expect(await verifyPassword('pw', parts.join('$'))).toBe(false)
  })

  it('does not throw for any malformed input', async () => {
    const inputs = ['', '$$$', 'a$b$c$d', 'pbkdf2-sha256$x$y$z']
    for (const input of inputs) {
      await expect(verifyPassword('pw', input)).resolves.toBe(false)
    }
  })

  it('never includes the password in a thrown error', async () => {
    let threw = false
    try {
      await verifyPassword('ultra-secret', '')
    } catch (e) {
      threw = true
      if (e instanceof Error) expect(e.message).not.toContain('ultra-secret')
    }
    if (threw) expect(true).toBe(true)
  })
})

describe('constantTimeEqual', () => {
  it('returns true for equal byte arrays', () => {
    const a = new Uint8Array([1, 2, 3, 4])
    const b = new Uint8Array([1, 2, 3, 4])
    expect(constantTimeEqual(a, b)).toBe(true)
  })

  it('returns false for different byte arrays of equal length', () => {
    const a = new Uint8Array([1, 2, 3, 4])
    const b = new Uint8Array([1, 2, 3, 5])
    expect(constantTimeEqual(a, b)).toBe(false)
  })

  it('returns false for arrays of different lengths', () => {
    const a = new Uint8Array([1, 2, 3])
    const b = new Uint8Array([1, 2, 3, 4])
    expect(constantTimeEqual(a, b)).toBe(false)
  })

  it('returns true for two empty arrays', () => {
    expect(constantTimeEqual(new Uint8Array(0), new Uint8Array(0))).toBe(true)
  })

  it('returns false when only the first byte differs', () => {
    const a = new Uint8Array(32).fill(0)
    const b = new Uint8Array(32).fill(0)
    b[0] = 1
    expect(constantTimeEqual(a, b)).toBe(false)
  })

  it('returns false when only the last byte differs', () => {
    const a = new Uint8Array(32).fill(0)
    const b = new Uint8Array(32).fill(0)
    b[31] = 1
    expect(constantTimeEqual(a, b)).toBe(false)
  })
})

describe('generateSessionToken', () => {
  it('returns an unpadded base64url string (no = + /)', () => {
    const token = generateSessionToken()
    expect(token).not.toContain('=')
    expect(token).not.toContain('+')
    expect(token).not.toContain('/')
  })

  it('decodes to exactly 32 bytes', () => {
    const token = generateSessionToken()
    const bytes = base64urlDecode(token)
    expect(bytes).not.toBeNull()
    expect(bytes!.length).toBe(32)
  })

  it('generates unique tokens across calls', () => {
    const tokens = new Set(Array.from({ length: 10 }, () => generateSessionToken()))
    expect(tokens.size).toBe(10)
  })
})

describe('digestSessionToken', () => {
  it('returns a 64-character lowercase hex string', async () => {
    const token = generateSessionToken()
    const digest = await digestSessionToken(token)
    expect(digest).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic for the same token', async () => {
    const token = generateSessionToken()
    const d1 = await digestSessionToken(token)
    const d2 = await digestSessionToken(token)
    expect(d1).toBe(d2)
  })

  it('produces different digests for different tokens', async () => {
    const t1 = generateSessionToken()
    const t2 = generateSessionToken()
    const d1 = await digestSessionToken(t1)
    const d2 = await digestSessionToken(t2)
    expect(d1).not.toBe(d2)
  })

  it('throws for an empty string', async () => {
    await expect(digestSessionToken('')).rejects.toThrow()
  })

  it('throws for malformed base64url', async () => {
    await expect(digestSessionToken('!!!invalid!!!')).rejects.toThrow()
  })

  it('throws for padded base64url', async () => {
    await expect(digestSessionToken(`${generateSessionToken()}=`)).rejects.toThrow()
  })

  it('throws for a token that decodes to fewer than 32 bytes', async () => {
    const short = btoa('short').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
    await expect(digestSessionToken(short)).rejects.toThrow()
  })

  it('throws for a token that decodes to more than 32 bytes', async () => {
    const long = new Uint8Array(33).fill(0)
    let binary = ''
    for (const b of long) binary += String.fromCharCode(b)
    const token = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
    await expect(digestSessionToken(token)).rejects.toThrow()
  })

  it('error message does not include the token', async () => {
    await expect(digestSessionToken('bad-token-value')).rejects.toSatisfy(
      (e: unknown) => !(e instanceof Error) || !e.message.includes('bad-token-value'),
    )
  })
})
