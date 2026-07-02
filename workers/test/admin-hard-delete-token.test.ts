import { describe, it, expect } from 'vitest'
import {
  HARD_DELETE_TOKEN_TTL_MS,
  signHardDeleteToken,
  verifyHardDeleteToken,
  type HardDeleteTokenPayload,
} from '../src/services/admin-hard-delete-token.js'

function strToBase64url(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function arrayBufToBase64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

const VALID_KEY = 'hard-delete-hmac-key-0000000000000'
const NOW = 1000000

const BASE_PAYLOAD: HardDeleteTokenPayload = {
  schema: 1,
  issuedAt: NOW,
  expiresAt: NOW + HARD_DELETE_TOKEN_TTL_MS,
  category: 'user-delete',
  targetId: 'user-sample-001',
}

describe('signHardDeleteToken + verifyHardDeleteToken', () => {
  it('round-trips a user-delete payload', async () => {
    const token = await signHardDeleteToken(VALID_KEY, BASE_PAYLOAD)
    const result = await verifyHardDeleteToken(VALID_KEY, token, NOW)
    expect(result).toEqual(BASE_PAYLOAD)
  })

  it('round-trips an album-delete payload', async () => {
    const payload: HardDeleteTokenPayload = {
      ...BASE_PAYLOAD,
      category: 'album-delete',
      targetId: 'album-sample-001',
    }
    const token = await signHardDeleteToken(VALID_KEY, payload)
    const result = await verifyHardDeleteToken(VALID_KEY, token, NOW)
    expect(result).toEqual(payload)
  })

  it('token has exactly one dot separator', async () => {
    const token = await signHardDeleteToken(VALID_KEY, BASE_PAYLOAD)
    expect(token.split('.')).toHaveLength(2)
  })
})

describe('verifyHardDeleteToken rejection', () => {
  it('returns null for expired tokens', async () => {
    const token = await signHardDeleteToken(VALID_KEY, BASE_PAYLOAD)
    await expect(verifyHardDeleteToken(VALID_KEY, token, BASE_PAYLOAD.expiresAt)).resolves.toBeNull()
  })

  it('returns null for tampered signatures', async () => {
    const token = await signHardDeleteToken(VALID_KEY, BASE_PAYLOAD)
    const [payload, sig] = token.split('.')
    await expect(
      verifyHardDeleteToken(VALID_KEY, `${payload}.${sig!.slice(0, -2)}aa`, NOW),
    ).resolves.toBeNull()
  })

  it('returns null for tampered payload before parsing modified JSON', async () => {
    const token = await signHardDeleteToken(VALID_KEY, BASE_PAYLOAD)
    const [, sig] = token.split('.')
    const tamperedPayload = strToBase64url(JSON.stringify({ ...BASE_PAYLOAD, targetId: 'user-other' }))
    await expect(verifyHardDeleteToken(VALID_KEY, `${tamperedPayload}.${sig}`, NOW)).resolves.toBeNull()
  })

  it('returns null for malformed token shapes', async () => {
    await expect(verifyHardDeleteToken(VALID_KEY, '', NOW)).resolves.toBeNull()
    await expect(verifyHardDeleteToken(VALID_KEY, 'nodot', NOW)).resolves.toBeNull()
    await expect(verifyHardDeleteToken(VALID_KEY, '.sig', NOW)).resolves.toBeNull()
  })

  it('returns null for wrong category', async () => {
    const payload = { ...BASE_PAYLOAD, category: 'orphan' } as unknown as HardDeleteTokenPayload
    const token = await signHardDeleteToken(VALID_KEY, payload)
    await expect(verifyHardDeleteToken(VALID_KEY, token, NOW)).resolves.toBeNull()
  })

  it('returns null for invalid targetId', async () => {
    const payload = { ...BASE_PAYLOAD, targetId: '!bad!' } as unknown as HardDeleteTokenPayload
    const token = await signHardDeleteToken(VALID_KEY, payload)
    await expect(verifyHardDeleteToken(VALID_KEY, token, NOW)).resolves.toBeNull()
  })

  it('returns null for signed non-JSON payloads', async () => {
    const payloadB64 = strToBase64url('not-json')
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(VALID_KEY),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64))
    await expect(
      verifyHardDeleteToken(VALID_KEY, `${payloadB64}.${arrayBufToBase64url(sig)}`, NOW),
    ).resolves.toBeNull()
  })
})
