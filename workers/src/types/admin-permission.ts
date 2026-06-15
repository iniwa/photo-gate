export interface AdminPermissionSummary {
  album_id: string
  user_id: string
  created_at: string
}

export interface AdminPermissionPage { permissions: AdminPermissionSummary[]; hasMore: boolean }
