import type { AdminCatalogRefreshRequest } from '../types/admin-catalog-refresh-request.js'

export const CATALOG_REFRESH_REQUEST_KEY = 'ops/catalog-refresh-request.json'

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

function catalogRefreshRequestWriteError(): Error {
  return new Error('catalog refresh request write failed')
}

function catalogRefreshRequestReadError(): Error {
  return new Error('catalog refresh request read failed')
}

function parseRequest(parsed: unknown): AdminCatalogRefreshRequest | null {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const obj = parsed as Record<string, unknown>
  const keys = Object.keys(obj)
  if (keys.length !== 4) return null
  for (const key of keys) {
    if (!EXPECTED_REQUEST_KEYS.has(key)) return null
  }
  if (obj['schema'] !== 1) return null
  if (typeof obj['requestId'] !== 'string' || !REQUEST_ID_RE.test(obj['requestId'])) return null
  if (typeof obj['requestedAt'] !== 'string' || !isCanonicalWorkerIso(obj['requestedAt'])) return null
  if (obj['kind'] !== 'publish-catalog') return null
  return {
    schema: 1,
    requestId: obj['requestId'],
    requestedAt: obj['requestedAt'],
    kind: 'publish-catalog',
  }
}

/** Reads and writes the private, catalog-only daemon request object. */
export class AdminCatalogRefreshRequestRepository {
  readonly #bucket: R2Bucket

  constructor(bucket: R2Bucket) {
    this.#bucket = bucket
  }

  async writeRequest(req: AdminCatalogRefreshRequest): Promise<void> {
    if (!REQUEST_ID_RE.test(req.requestId)) throw catalogRefreshRequestWriteError()
    if (!isCanonicalWorkerIso(req.requestedAt)) throw catalogRefreshRequestWriteError()
    if (req.kind !== 'publish-catalog') throw catalogRefreshRequestWriteError()

    const body = JSON.stringify({
      schema: 1,
      requestId: req.requestId,
      requestedAt: req.requestedAt,
      kind: req.kind,
    })
    try {
      await this.#bucket.put(CATALOG_REFRESH_REQUEST_KEY, body, {
        httpMetadata: {
          contentType: 'application/json',
          cacheControl: 'private, no-cache',
        },
      })
    } catch {
      throw catalogRefreshRequestWriteError()
    }
  }

  async getPendingRequest(): Promise<
    | { status: 'missing' }
    | { status: 'found'; value: AdminCatalogRefreshRequest }
  > {
    let object: R2ObjectBody | null
    try {
      object = await this.#bucket.get(CATALOG_REFRESH_REQUEST_KEY)
    } catch {
      throw catalogRefreshRequestReadError()
    }
    if (object === null) return { status: 'missing' }
    if (object.size !== undefined && object.size > MAX_REQUEST_SIZE) {
      throw catalogRefreshRequestReadError()
    }

    let text: string
    try {
      text = await object.text()
    } catch {
      throw catalogRefreshRequestReadError()
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw catalogRefreshRequestReadError()
    }
    const value = parseRequest(parsed)
    if (value === null) throw catalogRefreshRequestReadError()
    return { status: 'found', value }
  }
}
