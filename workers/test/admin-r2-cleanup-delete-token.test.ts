import { describe, it, expect } from 'vitest'
import {
  computeOrphanFingerprint,
  signCleanupToken,
  verifyCleanupToken,
  R2_CLEANUP_TOKEN_TTL_MS,
  type CleanupTokenPayload,
} from '../src/services/admin-r2-cleanup-delete-token.js'

function strToBase64url(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function arrayBufToBase64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

const VALID_KEY = 'test-hmac-key-0000000000000000000' // 35 chars, > 32

const BASE_PAYLOAD: CleanupTokenPayload = {
  schema: 1,
  issuedAt: 1000000,
  expiresAt: 1000000 + R2_CLEANUP_TOKEN_TTL_MS,
  category: 'orphan',
  fingerprint: 'aabbcc',
  orphanPrefixCount: 2,
  orphanObjectCount: 5,
}

// ---------------------------------------------------------------------------
// computeOrphanFingerprint
// ---------------------------------------------------------------------------

describe('computeOrphanFingerprint', () => {
  it('returns a 64-char hex string', async () => {
    const fp = await computeOrphanFingerprint([])
    expect(fp).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic', async () => {
    const entries = [
      { albumId: 'album-b', objectCount: 3 },
      { albumId: 'album-a', objectCount: 1 },
    ]
    const fp1 = await computeOrphanFingerprint(entries)
    const fp2 = await computeOrphanFingerprint(entries)
    expect(fp1).toBe(fp2)
  })

  it('is order-independent (sorts by albumId)', async () => {
    const a = await computeOrphanFingerprint([
      { albumId: 'album-a', objectCount: 1 },
      { albumId: 'album-b', objectCount: 3 },
    ])
    const b = await computeOrphanFingerprint([
      { albumId: 'album-b', objectCount: 3 },
      { albumId: 'album-a', objectCount: 1 },
    ])
    expect(a).toBe(b)
  })

  it('differs when objectCount changes', async () => {
    const fp1 = await computeOrphanFingerprint([{ albumId: 'album-a', objectCount: 1 }])
    const fp2 = await computeOrphanFingerprint([{ albumId: 'album-a', objectCount: 2 }])
    expect(fp1).not.toBe(fp2)
  })

  it('differs when albumId changes', async () => {
    const fp1 = await computeOrphanFingerprint([{ albumId: 'album-a', objectCount: 1 }])
    const fp2 = await computeOrphanFingerprint([{ albumId: 'album-b', objectCount: 1 }])
    expect(fp1).not.toBe(fp2)
  })

  it('differs when entries are added', async () => {
    const fp1 = await computeOrphanFingerprint([{ albumId: 'album-a', objectCount: 1 }])
    const fp2 = await computeOrphanFingerprint([
      { albumId: 'album-a', objectCount: 1 },
      { albumId: 'album-b', objectCount: 2 },
    ])
    expect(fp1).not.toBe(fp2)
  })
})

// ---------------------------------------------------------------------------
// signCleanupToken / verifyCleanupToken round-trip
// ---------------------------------------------------------------------------

describe('signCleanupToken + verifyCleanupToken', () => {
  it('round-trips a valid payload', async () => {
    const token = await signCleanupToken(VALID_KEY, BASE_PAYLOAD)
    const result = await verifyCleanupToken(VALID_KEY, token, BASE_PAYLOAD.issuedAt)
    expect(result).not.toBeNull()
    expect(result!.schema).toBe(1)
    expect(result!.category).toBe('orphan')
    expect(result!.fingerprint).toBe(BASE_PAYLOAD.fingerprint)
    expect(result!.orphanPrefixCount).toBe(BASE_PAYLOAD.orphanPrefixCount)
    expect(result!.orphanObjectCount).toBe(BASE_PAYLOAD.orphanObjectCount)
  })

  it('token is a string containing exactly one dot', async () => {
    const token = await signCleanupToken(VALID_KEY, BASE_PAYLOAD)
    expect(typeof token).toBe('string')
    expect(token.split('.').length).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// verifyCleanupToken — rejection cases
// ---------------------------------------------------------------------------

describe('verifyCleanupToken — rejection', () => {
  it('returns null for an expired token (nowMs >= expiresAt)', async () => {
    const token = await signCleanupToken(VALID_KEY, BASE_PAYLOAD)
    const result = await verifyCleanupToken(VALID_KEY, token, BASE_PAYLOAD.expiresAt)
    expect(result).toBeNull()
  })

  it('returns null for a token that expired one millisecond ago', async () => {
    const token = await signCleanupToken(VALID_KEY, BASE_PAYLOAD)
    const result = await verifyCleanupToken(VALID_KEY, token, BASE_PAYLOAD.expiresAt + 1)
    expect(result).toBeNull()
  })

  it('returns null when the HMAC signature is tampered', async () => {
    const token = await signCleanupToken(VALID_KEY, BASE_PAYLOAD)
    const [payloadPart, sigPart] = token.split('.')
    const tamperedToken = `${payloadPart}.${sigPart!.slice(0, -4)}AAAA`
    const result = await verifyCleanupToken(VALID_KEY, tamperedToken, BASE_PAYLOAD.issuedAt)
    expect(result).toBeNull()
  })

  it('returns null when the payload is tampered (signature no longer matches)', async () => {
    const token = await signCleanupToken(VALID_KEY, BASE_PAYLOAD)
    const [, sigPart] = token.split('.')
    // Replace payload with a modified version signed with a different key
    const tamperedPayloadB64 = strToBase64url(
      JSON.stringify({ ...BASE_PAYLOAD, orphanPrefixCount: 99 }),
    )
    const tamperedToken = `${tamperedPayloadB64}.${sigPart}`
    const result = await verifyCleanupToken(VALID_KEY, tamperedToken, BASE_PAYLOAD.issuedAt)
    expect(result).toBeNull()
  })

  it('returns null for a token with no dot separator', async () => {
    const result = await verifyCleanupToken(VALID_KEY, 'nodothere', BASE_PAYLOAD.issuedAt)
    expect(result).toBeNull()
  })

  it('returns null for a token with dot at index 0', async () => {
    const result = await verifyCleanupToken(VALID_KEY, '.signature', BASE_PAYLOAD.issuedAt)
    expect(result).toBeNull()
  })

  it('returns null for an empty string token', async () => {
    const result = await verifyCleanupToken(VALID_KEY, '', BASE_PAYLOAD.issuedAt)
    expect(result).toBeNull()
  })

  it('returns null when signed with a different key', async () => {
    const token = await signCleanupToken('different-key-0000000000000000000', BASE_PAYLOAD)
    const result = await verifyCleanupToken(VALID_KEY, token, BASE_PAYLOAD.issuedAt)
    expect(result).toBeNull()
  })

  it('returns null for a payload with wrong schema', async () => {
    const badPayload = { ...BASE_PAYLOAD, schema: 2 } as unknown as CleanupTokenPayload
    const token = await signCleanupToken(VALID_KEY, badPayload)
    const result = await verifyCleanupToken(VALID_KEY, token, BASE_PAYLOAD.issuedAt)
    expect(result).toBeNull()
  })

  it('returns null for a payload with wrong category', async () => {
    const badPayload = { ...BASE_PAYLOAD, category: 'malformed' } as unknown as CleanupTokenPayload
    const token = await signCleanupToken(VALID_KEY, badPayload)
    const result = await verifyCleanupToken(VALID_KEY, token, BASE_PAYLOAD.issuedAt)
    expect(result).toBeNull()
  })

  it('returns null for a token whose payload is not valid JSON', async () => {
    const notJson = strToBase64url('not-json!')
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(VALID_KEY),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(notJson))
    const sigB64 = arrayBufToBase64url(sigBuf)
    const result = await verifyCleanupToken(VALID_KEY, `${notJson}.${sigB64}`, BASE_PAYLOAD.issuedAt)
    expect(result).toBeNull()
  })
})
