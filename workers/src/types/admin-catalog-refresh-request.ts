/**
 * A one-shot, private request for the Docker daemon to refresh only the
 * sanitized PhotoPrism album catalog. It deliberately uses a separate R2 key
 * from a sync request so an older daemon cannot mistake it for an image sync.
 */
export interface AdminCatalogRefreshRequest {
  schema: 1
  requestId: string
  requestedAt: string
  kind: 'publish-catalog'
}
