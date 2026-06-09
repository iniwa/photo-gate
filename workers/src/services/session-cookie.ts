import { base64urlDecode } from './auth-crypto.js'

export const COOKIE_NAME = 'photo_gate_session'
const TOKEN_BYTES = 32

export function serializeSessionCookie(token: string, maxAge: number): string {
  const decoded = base64urlDecode(token)
  if (decoded === null || decoded.length !== TOKEN_BYTES) throw new Error('invalid session token format')
  if (!Number.isSafeInteger(maxAge) || maxAge <= 0) {
    throw new Error('maxAge must be a positive integer')
  }
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`
}

export function serializeClearCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`
}

export function parseSessionCookie(cookieHeader: string | null): string | undefined {
  if (!cookieHeader) return undefined

  const matches: string[] = []
  for (const part of cookieHeader.split(';')) {
    const eqIdx = part.indexOf('=')
    if (eqIdx === -1) continue
    const name = part.slice(0, eqIdx).trim()
    if (name === COOKIE_NAME) {
      matches.push(part.slice(eqIdx + 1).trim())
    }
  }

  if (matches.length !== 1) return undefined

  const token = matches[0] ?? ''
  const decoded = base64urlDecode(token)
  if (decoded === null || decoded.length !== TOKEN_BYTES) return undefined

  return token
}
