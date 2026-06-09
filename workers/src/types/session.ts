/** Session row joined with user enabled status, returned by session repository. */
export interface SessionWithUser {
  token_hash: string
  user_id: string
  expires_at: string
  last_seen_at: string
  user_enabled: number
}
