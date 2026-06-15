export interface AdminAlbumSummary {
  id: string
  title: string
  enabled: 0 | 1
  expires_at: string | null
  download_enabled: 0 | 1
  created_at: string
  updated_at: string
}

export interface AdminAlbumPage { albums: AdminAlbumSummary[]; hasMore: boolean }
