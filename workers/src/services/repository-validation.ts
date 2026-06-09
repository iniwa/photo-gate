const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/
const SHA256_HEX = /^[0-9a-f]{64}$/

export function isValidId(id: string): boolean {
  return SAFE_ID.test(id)
}

export function isValidDigest(digest: string): boolean {
  return SHA256_HEX.test(digest)
}

export function isCanonicalUtcTimestamp(value: string): boolean {
  const parsed = new Date(value)
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value
}

export function assertCanonicalUtcTimestamp(value: string): void {
  if (!isCanonicalUtcTimestamp(value)) {
    throw new Error('invalid UTC timestamp')
  }
}

export function databaseOperationError(): Error {
  return new Error('database operation failed')
}
