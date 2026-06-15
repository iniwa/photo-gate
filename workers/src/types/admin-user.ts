export interface AdminUserSummary {
  id: string
  display_name: string
  enabled: 0 | 1
  fail_count: number
  locked_until: string | null
  created_at: string
  updated_at: string
}

export interface AdminUserPage {
  users: AdminUserSummary[]   // at most 50
  hasMore: boolean            // true if a 51st row existed
}
