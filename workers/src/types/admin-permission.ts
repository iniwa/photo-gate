export interface AdminPermissionSummary {
  album_id: string
  user_id: string
  created_at: string
}

export interface AdminPermissionPage { permissions: AdminPermissionSummary[]; hasMore: boolean }

export interface AssignmentUser {
  id: string
  display_name: string
  enabled: 0 | 1
}

export interface AssignmentAlbum {
  id: string
  title: string
  enabled: 0 | 1
}

export interface AssignmentOptions {
  users: AssignmentUser[]
  albums: AssignmentAlbum[]
  permissions: AdminPermissionSummary[]
  hasMore: boolean
}
