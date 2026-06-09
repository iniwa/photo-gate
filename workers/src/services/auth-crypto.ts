const ALGORITHM = 'pbkdf2-sha256'
const SALT_BYTES = 16
const KEY_BYTES = 32
export const MIN_ITERATIONS = 100_000
export const MAX_ITERATIONS = 10_000_000

interface ParsedHash {
  iterations: number
  salt: Uint8Array
  digest: Uint8Array
}

function base64urlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

export function base64urlDecode(str: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(str) || str.length % 4 === 1) return null
  try {
    const padded = str.replace(/-/g, '+').replace(/_/g, '/') +
      '='.repeat((4 - (str.length % 4)) % 4)
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return base64urlEncode(bytes) === str ? bytes : null
  } catch {
    return null
  }
}

function parsePasswordHash(hash: string): ParsedHash | null {
  const parts = hash.split('$')
  if (parts.length !== 4) return null

  const algo = parts[0]
  const iterStr = parts[1]
  const saltB64 = parts[2]
  const digestB64 = parts[3]

  if (algo !== ALGORITHM) return null

  if (!/^[1-9][0-9]*$/.test(iterStr ?? '')) return null
  const iterations = Number(iterStr)
  if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) return null

  const salt = base64urlDecode(saltB64 ?? '')
  if (salt === null || salt.length !== SALT_BYTES) return null

  const digest = base64urlDecode(digestB64 ?? '')
  if (digest === null || digest.length !== KEY_BYTES) return null

  return { iterations, salt, digest }
}

export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let result = a.length ^ b.length
  const length = Math.max(a.length, b.length)
  for (let i = 0; i < length; i++) {
    result |= (a[i] ?? 0) ^ (b[i] ?? 0)
  }
  return result === 0
}

export async function hashPassword(password: string, iterations: number): Promise<string> {
  if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
    throw new Error('iteration count out of allowed range')
  }
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    keyMaterial,
    KEY_BYTES * 8,
  )
  const derived = new Uint8Array(derivedBits)
  return `${ALGORITHM}$${iterations}$${base64urlEncode(salt)}$${base64urlEncode(derived)}`
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  const parsed = parsePasswordHash(encodedHash)
  if (parsed === null) return false
  try {
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveBits'],
    )
    const derivedBits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: parsed.salt, iterations: parsed.iterations },
      keyMaterial,
      KEY_BYTES * 8,
    )
    return constantTimeEqual(new Uint8Array(derivedBits), parsed.digest)
  } catch {
    return false
  }
}

export function generateSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return base64urlEncode(bytes)
}

export async function digestSessionToken(token: string): Promise<string> {
  const bytes = base64urlDecode(token)
  if (bytes === null || bytes.length !== 32) {
    throw new Error('invalid session token format')
  }
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}
