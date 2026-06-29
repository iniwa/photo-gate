export interface AdminSyncTargetThumb {
  longEdge: 640
  format: 'webp'
  quality: 80
}

export interface AdminSyncTargetPreview {
  longEdge: 3840
  format: 'jpg'
  quality: 88
}

export interface AdminSyncTarget {
  albumId: string
  catalogId: string
  title: string
  expiresAt: string | null
  downloadEnabled: 0 | 1
  thumb: AdminSyncTargetThumb
  preview: AdminSyncTargetPreview
  stripExif: 1
}

export interface AdminSyncTargetList {
  schema: 1
  publishedAt: string
  targets: AdminSyncTarget[]
}
