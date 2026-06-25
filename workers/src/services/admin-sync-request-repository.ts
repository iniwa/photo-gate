import type { AdminSyncRequest } from '../types/admin-sync-request.js'

const SYNC_REQUEST_KEY = 'ops/sync-request.json'
const REQUEST_ID_RE = /^[0-9a-f]{32}$/
const WORKER_ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

function isCanonicalWorkerIso(value: string): boolean {
  if (!WORKER_ISO_RE.test(value)) return false
  try {
    return new Date(value).toISOString() === value
  } catch {
    return false
  }
}

function syncRequestWriteError(): Error {
  return new Error('sync request write failed')
}

export class AdminSyncRequestRepository {
  readonly #bucket: R2Bucket

  constructor(bucket: R2Bucket) {
    this.#bucket = bucket
  }

  async writeRequest(req: AdminSyncRequest): Promise<void> {
    if (!REQUEST_ID_RE.test(req.requestId)) throw syncRequestWriteError()
    if (!isCanonicalWorkerIso(req.requestedAt)) throw syncRequestWriteError()
    if (req.kind !== 'sync-now') throw syncRequestWriteError()

    const body = JSON.stringify({
      schema: 1,
      requestId: req.requestId,
      requestedAt: req.requestedAt,
      kind: req.kind,
    })

    try {
      await this.#bucket.put(SYNC_REQUEST_KEY, body, {
        httpMetadata: {
          contentType: 'application/json',
          cacheControl: 'private, no-cache',
        },
      })
    } catch {
      throw syncRequestWriteError()
    }
  }
}
