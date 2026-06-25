import { isValidId } from './safe-id.js'
import type { AdminSyncStatus } from '../types/admin-sync-status.js'

const SYNC_STATUS_KEY = 'ops/sync-status.json'

// Forbidden content in lastError (case-insensitive)
const LAST_ERROR_FORBIDDEN =
  /http:\/\/|https:\/\/|token|secret|password|authorization|cf-access-jwt-assertion/i

const EXPECTED_KEY_COUNT = 12
const EXPECTED_KEYS = new Set([
  'schema', 'publishedAt', 'albumId', 'intervalSeconds', 'startedAt',
  'heartbeatAt', 'lastAttemptStartedAt', 'lastAttemptCompletedAt',
  'lastResult', 'lastError', 'consecutiveFailures', 'runsCompleted',
])

// Docker daemon emits YYYY-MM-DDTHH:mm:ssZ (no milliseconds).
// Worker clock emits YYYY-MM-DDTHH:mm:ss.sssZ (milliseconds).
// Accept both; reject timezone offsets like +09:00.
const DOCKER_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/

function isSyncStatusTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const parsed = new Date(value)
  if (Number.isNaN(parsed.valueOf())) return false
  if (!value.endsWith('Z')) return false
  const iso = parsed.toISOString() // always YYYY-MM-DDTHH:mm:ss.sssZ
  if (iso === value) return true
  // Accept Docker second form: YYYY-MM-DDTHH:mm:ssZ
  if (DOCKER_TS_RE.test(value)) {
    return iso === value.slice(0, -1) + '.000Z'
  }
  return false
}

function isSafeNonNegativeInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
}

function isValidLastError(value: unknown): value is string | null {
  if (value === null) return true
  if (typeof value !== 'string') return false
  if ([...value].length > 256) return false
  if (/[\x00-\x1F\x7F]/.test(value)) return false
  if (LAST_ERROR_FORBIDDEN.test(value)) return false
  return true
}

function parseSyncStatus(parsed: unknown): AdminSyncStatus | null {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const obj = parsed as Record<string, unknown>
  const keys = Object.keys(obj)
  if (keys.length !== EXPECTED_KEY_COUNT) return null
  for (const k of keys) {
    if (!EXPECTED_KEYS.has(k)) return null
  }

  if (obj['schema'] !== 1) return null
  if (!isSyncStatusTimestamp(obj['publishedAt'])) return null
  if (!isValidId(obj['albumId'])) return null
  if (!isSafeNonNegativeInt(obj['intervalSeconds'])) return null
  if (!isSyncStatusTimestamp(obj['startedAt'])) return null
  if (!isSyncStatusTimestamp(obj['heartbeatAt'])) return null

  const laStarted = obj['lastAttemptStartedAt']
  if (laStarted !== null && !isSyncStatusTimestamp(laStarted)) return null

  const laCompleted = obj['lastAttemptCompletedAt']
  if (laCompleted !== null && !isSyncStatusTimestamp(laCompleted)) return null

  const lastResult = obj['lastResult']
  if (lastResult !== null && lastResult !== 'ok' && lastResult !== 'failed') return null

  if (!isValidLastError(obj['lastError'])) return null
  if (!isSafeNonNegativeInt(obj['consecutiveFailures'])) return null
  if (!isSafeNonNegativeInt(obj['runsCompleted'])) return null

  return {
    schema: 1,
    publishedAt: obj['publishedAt'] as string,
    albumId: obj['albumId'] as string,
    intervalSeconds: obj['intervalSeconds'] as number,
    startedAt: obj['startedAt'] as string,
    heartbeatAt: obj['heartbeatAt'] as string,
    lastAttemptStartedAt: laStarted as string | null,
    lastAttemptCompletedAt: laCompleted as string | null,
    lastResult: lastResult as 'ok' | 'failed' | null,
    lastError: obj['lastError'] as string | null,
    consecutiveFailures: obj['consecutiveFailures'] as number,
    runsCompleted: obj['runsCompleted'] as number,
  }
}

function syncStatusReadError(): Error {
  return new Error('sync status read failed')
}

export class AdminSyncStatusRepository {
  readonly #bucket: R2Bucket

  constructor(bucket: R2Bucket) {
    this.#bucket = bucket
  }

  async getStatus(): Promise<
    | { status: 'missing' }
    | { status: 'found'; value: AdminSyncStatus }
  > {
    let object: R2ObjectBody | null
    try {
      object = await this.#bucket.get(SYNC_STATUS_KEY)
    } catch {
      throw syncStatusReadError()
    }
    if (object === null) return { status: 'missing' }

    let text: string
    try {
      text = await object.text()
    } catch {
      throw syncStatusReadError()
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw syncStatusReadError()
    }

    const value = parseSyncStatus(parsed)
    if (value === null) throw syncStatusReadError()

    return { status: 'found', value }
  }
}
