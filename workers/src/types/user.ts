/** Row returned from D1 for authentication purposes only. */
export interface UserAuthRow {
  id: string
  password_hash: string
  enabled: number
  fail_count: number
  locked_until: string | null
}
