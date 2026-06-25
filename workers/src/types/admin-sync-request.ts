export interface AdminSyncRequest {
  schema: 1
  requestId: string
  requestedAt: string
  kind: 'sync-now'
}
