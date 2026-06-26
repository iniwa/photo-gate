import type { AdminSyncRequest } from '../types/admin-sync-request.js'

const SYNC_REQUEST_KEY = 'ops/sync-request.json'
const REQUEST_ID_RE = /^[0-9a-f]{32}$/
const WORKER_ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const MAX_REQUEST_SIZE = 4096

const EXPECTED_REQUEST_KEYS = new Set(['schema', 'requestId', 'requestedAt', 'kind'])

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

function syncRequestReadError(): Error {
  return new Error('sync request read failed')
}

function parseRequest(parsed: unknown): AdminSyncRequest | null {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const obj = parsed as Record<string, unknown>
  const keys = Object.keys(obj)
  if (keys.length !== 4) return null
  for (const k of keys) {
    if (!EXPECTED_REQUEST_KEYS.has(k)) return null
  }
  if (obj['schema'] !== 1) return null
  if (typeof obj['requestId'] !== 'string' || !REQUEST_ID_RE.test(obj['requestId'])) return null
  if (typeof obj['requestedAt'] !== 'string' || !isCanonicalWorkerIso(obj['requestedAt'])) return null
  if (obj['kind'] !== 'sync-now') return null
  return {
    schema: 1,
    requestId: obj['requestId'],
    requestedAt: obj['requestedAt'],
    kind: 'sync-now',
  }
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

  async getPendingRequest(): Promise<
    | { status: 'missing' }
    | { status: 'found'; value: AdminSyncRequest }
  > {
    let object: R2ObjectBody | null
    try {
      object = await this.#bucket.get(SYNC_REQUEST_KEY)
    } catch {
      throw syncRequestReadError()
    }
    if (object === null) return { status: 'missing' }

    if (object.size !== undefined && object.size > MAX_REQUEST_SIZE) {
      throw syncRequestReadError()
    }

    let text: string
    try {
      text = await object.text()
    } catch {
      throw syncRequestReadError()
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw syncRequestReadError()
    }

    const value = parseRequest(parsed)
    if (value === null) throw syncRequestReadError()

    return { status: 'found', value }
  }
}
