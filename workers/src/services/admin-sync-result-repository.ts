import type { AdminSyncResult } from '../types/admin-sync-result.js'

export const SYNC_RESULT_KEY = 'ops/sync-result.json'

const MAX_RESULT_SIZE = 8192
const DOCKER_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
const EXPECTED_ROOT_KEYS = new Set([
  'schema', 'publishedAt', 'operation', 'triggerKind', 'result', 'startedAt',
  'completedAt', 'targets', 'photos', 'catalogRefreshed',
])
const EXPECTED_TARGET_KEYS = new Set(['attempted', 'succeeded', 'failed'])
const EXPECTED_PHOTO_KEYS = new Set(['total', 'uploaded', 'skipped'])

function isDockerTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !DOCKER_TS_RE.test(value)) return false
  const parsed = new Date(value)
  if (Number.isNaN(parsed.valueOf())) return false
  return parsed.toISOString() === `${value.slice(0, -1)}.000Z`
}

function isSafeCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000
}

function hasExactKeys(value: Record<string, unknown>, expected: Set<string>): boolean {
  const keys = Object.keys(value)
  return keys.length === expected.size && keys.every((key) => expected.has(key))
}

function parseResult(parsed: unknown): AdminSyncResult | null {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const root = parsed as Record<string, unknown>
  if (!hasExactKeys(root, EXPECTED_ROOT_KEYS)) return null
  if (root['schema'] !== 1) return null
  if (!isDockerTimestamp(root['publishedAt']) || !isDockerTimestamp(root['startedAt']) || !isDockerTimestamp(root['completedAt'])) return null
  if (root['operation'] !== 'sync' && root['operation'] !== 'catalog-refresh') return null
  if (root['triggerKind'] !== 'scheduled' && root['triggerKind'] !== 'manual') return null
  if (root['result'] !== 'ok' && root['result'] !== 'failed' && root['result'] !== 'partial') return null
  if (typeof root['catalogRefreshed'] !== 'boolean') return null

  const targets = root['targets']
  if (typeof targets !== 'object' || targets === null || Array.isArray(targets)) return null
  const targetValues = targets as Record<string, unknown>
  if (!hasExactKeys(targetValues, EXPECTED_TARGET_KEYS)) return null
  if (!isSafeCount(targetValues['attempted']) || !isSafeCount(targetValues['succeeded']) || !isSafeCount(targetValues['failed'])) return null
  if (targetValues['succeeded'] + targetValues['failed'] > targetValues['attempted']) return null

  const photos = root['photos']
  if (typeof photos !== 'object' || photos === null || Array.isArray(photos)) return null
  const photoValues = photos as Record<string, unknown>
  if (!hasExactKeys(photoValues, EXPECTED_PHOTO_KEYS)) return null
  if (!isSafeCount(photoValues['total']) || !isSafeCount(photoValues['uploaded']) || !isSafeCount(photoValues['skipped'])) return null
  if (photoValues['uploaded'] + photoValues['skipped'] > photoValues['total']) return null

  return {
    schema: 1,
    publishedAt: root['publishedAt'] as string,
    operation: root['operation'] as 'sync' | 'catalog-refresh',
    triggerKind: root['triggerKind'] as 'scheduled' | 'manual',
    result: root['result'] as 'ok' | 'failed' | 'partial',
    startedAt: root['startedAt'] as string,
    completedAt: root['completedAt'] as string,
    targets: {
      attempted: targetValues['attempted'] as number,
      succeeded: targetValues['succeeded'] as number,
      failed: targetValues['failed'] as number,
    },
    photos: {
      total: photoValues['total'] as number,
      uploaded: photoValues['uploaded'] as number,
      skipped: photoValues['skipped'] as number,
    },
    catalogRefreshed: root['catalogRefreshed'] as boolean,
  }
}

function syncResultReadError(): Error {
  return new Error('sync result read failed')
}

/** Reads a single sanitized aggregate; it never reads image or manifest bodies. */
export class AdminSyncResultRepository {
  readonly #bucket: R2Bucket

  constructor(bucket: R2Bucket) {
    this.#bucket = bucket
  }

  async getResult(): Promise<
    | { status: 'missing' }
    | { status: 'found'; value: AdminSyncResult }
  > {
    let object: R2ObjectBody | null
    try {
      object = await this.#bucket.get(SYNC_RESULT_KEY)
    } catch {
      throw syncResultReadError()
    }
    if (object === null) return { status: 'missing' }
    if (object.size !== undefined && object.size > MAX_RESULT_SIZE) throw syncResultReadError()

    let text: string
    try {
      text = await object.text()
    } catch {
      throw syncResultReadError()
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw syncResultReadError()
    }
    const value = parseResult(parsed)
    if (value === null) throw syncResultReadError()
    return { status: 'found', value }
  }
}
