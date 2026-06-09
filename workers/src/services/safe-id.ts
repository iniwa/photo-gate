const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/

export function isValidId(id: unknown): id is string {
  return typeof id === 'string' && SAFE_ID.test(id)
}
