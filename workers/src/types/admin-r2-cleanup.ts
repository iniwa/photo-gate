export interface AdminR2CleanupAlbumEntry {
  albumId: string
  category: 'owned-active' | 'owned-disabled' | 'orphan'
  objectCount: number
  totalBytes: number
}

export interface AdminR2CleanupReport {
  albums: AdminR2CleanupAlbumEntry[]
  malformedCount: number
  malformedBytes: number
  excludedOpsCount: number
  truncated: boolean
}
