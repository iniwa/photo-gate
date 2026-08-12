/** Sanitized aggregate result published by the Docker sync daemon. */
export interface AdminSyncResult {
  schema: 1
  publishedAt: string
  operation: 'sync' | 'catalog-refresh'
  triggerKind: 'scheduled' | 'manual'
  result: 'ok' | 'failed' | 'partial'
  startedAt: string
  completedAt: string
  targets: {
    attempted: number
    succeeded: number
    failed: number
  }
  photos: {
    total: number
    uploaded: number
    skipped: number
  }
  catalogRefreshed: boolean
}
