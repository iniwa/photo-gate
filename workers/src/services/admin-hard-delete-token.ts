import { isValidId } from './repository-validation.js'

export type HardDeleteCategory = 'user-delete' | 'album-delete'

export interface HardDeleteTokenPayload {
  schema: 1
  issuedAt: number
  expiresAt: number
  category: HardDeleteCategory
  targetId: string
}

export const HARD_DELETE_HMAC_MIN_KEY_LEN = 32
export const HARD_DELETE_TOKEN_TTL_MS = 15 * 60 * 1000

function bufToBase64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function base64urlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/')
  const pad = (4 - (padded.length % 4)) % 4
  const binary = atob(padded + '='.repeat(pad))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function importHmacKey(raw: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(raw),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

export async function signHardDeleteToken(
  hmacKeyRaw: string,
  payload: HardDeleteTokenPayload,
): Promise<string> {
  const payloadB64 = bufToBase64url(new TextEncoder().encode(JSON.stringify(payload)))
  const key = await importHmacKey(hmacKeyRaw)
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64))
  return `${payloadB64}.${bufToBase64url(sigBuf)}`
}

export async function verifyHardDeleteToken(
  hmacKeyRaw: string,
  token: string,
  nowMs: number,
): Promise<HardDeleteTokenPayload | null> {
  const dotIdx = token.indexOf('.')
  if (dotIdx < 1) return null
  const payloadB64 = token.slice(0, dotIdx)
  const sigB64 = token.slice(dotIdx + 1)
  if (!sigB64) return null

  let sigBytes: Uint8Array
  try {
    sigBytes = base64urlDecode(sigB64)
  } catch {
    return null
  }

  let key: CryptoKey
  try {
    key = await importHmacKey(hmacKeyRaw)
  } catch {
    return null
  }

  let valid: boolean
  try {
    valid = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes,
      new TextEncoder().encode(payloadB64),
    )
  } catch {
    return null
  }
  if (!valid) return null

  let payloadStr: string
  try {
    payloadStr = new TextDecoder().decode(base64urlDecode(payloadB64))
  } catch {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(payloadStr)
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null) return null
  const p = parsed as Record<string, unknown>
  if (p['schema'] !== 1) return null
  if (p['category'] !== 'user-delete' && p['category'] !== 'album-delete') return null
  if (typeof p['issuedAt'] !== 'number') return null
  if (typeof p['expiresAt'] !== 'number') return null
  if (!isValidId(p['targetId'])) return null
  if (nowMs >= (p['expiresAt'] as number)) return null

  return {
    schema: 1,
    issuedAt: p['issuedAt'] as number,
    expiresAt: p['expiresAt'] as number,
    category: p['category'] as HardDeleteCategory,
    targetId: p['targetId'] as string,
  }
}
