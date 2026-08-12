/**
 * Safe sharing-readiness states for an administrator. The values deliberately
 * contain no PhotoPrism, R2 object-key, or photo-level identity.
 */
export type AdminAlbumReadinessStatus =
  | 'catalog-unavailable'
  | 'target-not-configured'
  | 'target-needs-refresh'
  | 'sync-pending'
  | 'expired'
  | 'activation-required'
  | 'permission-required'
  | 'ready'
  | 'unknown'

export interface AdminAlbumReadiness {
  status: AdminAlbumReadinessStatus
  label: string
}

export type AdminAlbumManifestState = 'present' | 'missing' | 'unknown'

export interface AdminAlbumReadinessFact {
  albumId: string
  permissionCount: number
  manifest: AdminAlbumManifestState
}
