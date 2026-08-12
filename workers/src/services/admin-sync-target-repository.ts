import type { AdminSyncTarget, AdminSyncTargetList } from '../types/admin-sync-target.js'
import { isValidId, isCanonicalUtcTimestamp } from './repository-validation.js'

export const SYNC_TARGETS_KEY = 'ops/sync-targets.json'

const MAX_TARGETS = 100
const MAX_TARGETS_SIZE = 256 * 1024
const TITLE_MAX_CODE_POINTS = 1024
const WORKER_ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const CATALOG_ID_RE = /^[0-9a-f]{64}$/

const EXPECTED_ROOT_KEYS = new Set(['schema', 'publishedAt', 'targets'])
const EXPECTED_TARGET_KEYS = new Set([
  'albumId', 'catalogId', 'title', 'expiresAt', 'downloadEnabled',
  'thumb', 'preview', 'stripExif',
])
const EXPECTED_IMAGE_KEYS = new Set(['longEdge', 'format', 'quality'])

function isCanonicalWorkerIso(value: string): boolean {
  if (!WORKER_ISO_RE.test(value)) return false
  try {
    return new Date(value).toISOString() === value
  } catch {
    return false
  }
}

function isSafeTitle(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (value.length === 0) return false
  if (/^\s|\s$/.test(value)) return false
  if (/[\x00-\x1f\x7f]/.test(value)) return false
  if (Array.from(value).length > TITLE_MAX_CODE_POINTS) return false
  return true
}

function isValidCatalogId(value: unknown): value is string {
  return typeof value === 'string' && CATALOG_ID_RE.test(value)
}

function parseTarget(obj: unknown): AdminSyncTarget | null {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return null
  const t = obj as Record<string, unknown>

  const keys = Object.keys(t)
  if (keys.length !== 8) return null
  for (const k of keys) {
    if (!EXPECTED_TARGET_KEYS.has(k)) return null
  }

  if (!isValidId(t['albumId'])) return null
  if (!isValidCatalogId(t['catalogId'])) return null
  if (!isSafeTitle(t['title'])) return null

  const expiresAt = t['expiresAt']
  if (expiresAt !== null) {
    if (!isCanonicalUtcTimestamp(expiresAt as string)) return null
    if (typeof expiresAt !== 'string') return null
  }

  const downloadEnabled = t['downloadEnabled']
  if (downloadEnabled !== 0 && downloadEnabled !== 1) return null

  const thumb = t['thumb']
  if (typeof thumb !== 'object' || thumb === null || Array.isArray(thumb)) return null
  const th = thumb as Record<string, unknown>
  const thumbKeys = Object.keys(th)
  if (thumbKeys.length !== 3) return null
  for (const k of thumbKeys) {
    if (!EXPECTED_IMAGE_KEYS.has(k)) return null
  }
  if (th['longEdge'] !== 640 || th['format'] !== 'webp' || th['quality'] !== 80) return null

  const preview = t['preview']
  if (typeof preview !== 'object' || preview === null || Array.isArray(preview)) return null
  const pr = preview as Record<string, unknown>
  const previewKeys = Object.keys(pr)
  if (previewKeys.length !== 3) return null
  for (const k of previewKeys) {
    if (!EXPECTED_IMAGE_KEYS.has(k)) return null
  }
  if (pr['longEdge'] !== 3840 || pr['format'] !== 'jpg' || pr['quality'] !== 88) return null

  if (t['stripExif'] !== 1) return null

  return {
    albumId: t['albumId'] as string,
    catalogId: t['catalogId'] as string,
    title: t['title'] as string,
    expiresAt: expiresAt as string | null,
    downloadEnabled: downloadEnabled as 0 | 1,
    thumb: { longEdge: 640, format: 'webp', quality: 80 },
    preview: { longEdge: 3840, format: 'jpg', quality: 88 },
    stripExif: 1,
  }
}

function parseTargetList(obj: unknown): AdminSyncTarget[] | null {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return null
  const root = obj as Record<string, unknown>

  const rootKeys = Object.keys(root)
  if (rootKeys.length !== 3) return null
  for (const k of rootKeys) {
    if (!EXPECTED_ROOT_KEYS.has(k)) return null
  }
  if (root['schema'] !== 1) return null
  if (typeof root['publishedAt'] !== 'string' || !isCanonicalWorkerIso(root['publishedAt'])) return null

  const targets = root['targets']
  if (!Array.isArray(targets)) return null
  if (targets.length > MAX_TARGETS) return null

  const result: AdminSyncTarget[] = []
  const seenAlbumIds = new Set<string>()
  const seenCatalogIds = new Set<string>()

  for (const t of targets) {
    const parsed = parseTarget(t)
    if (parsed === null) return null
    if (seenAlbumIds.has(parsed.albumId)) return null
    if (seenCatalogIds.has(parsed.catalogId)) return null
    seenAlbumIds.add(parsed.albumId)
    seenCatalogIds.add(parsed.catalogId)
    result.push(parsed)
  }

  return result
}

function syncTargetWriteError(): Error {
  return new Error('sync target write failed')
}

function syncTargetReadError(): Error {
  return new Error('sync target read failed')
}

export class AdminSyncTargetRepository {
  readonly #bucket: R2Bucket

  constructor(bucket: R2Bucket) {
    this.#bucket = bucket
  }

  private async readTargets(): Promise<AdminSyncTarget[]> {
    let object: R2ObjectBody | null
    try {
      object = await this.#bucket.get(SYNC_TARGETS_KEY)
    } catch {
      throw syncTargetReadError()
    }
    if (object === null) return []
    if (object.size !== undefined && object.size > MAX_TARGETS_SIZE) {
      throw syncTargetReadError()
    }

    let text: string
    try {
      text = await object.text()
    } catch {
      throw syncTargetReadError()
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw syncTargetReadError()
    }

    const targets = parseTargetList(parsed)
    if (targets === null) throw syncTargetReadError()

    return targets
  }

  private async writeTargets(targets: AdminSyncTarget[], publishedAt: string): Promise<void> {
    const obj: AdminSyncTargetList = {
      schema: 1,
      publishedAt,
      targets,
    }
    const body = JSON.stringify(obj)
    try {
      await this.#bucket.put(SYNC_TARGETS_KEY, body, {
        httpMetadata: {
          contentType: 'application/json',
          cacheControl: 'private, no-cache',
        },
      })
    } catch {
      throw syncTargetWriteError()
    }
  }

  async upsertTarget(
    albumId: string,
    catalogId: string,
    title: string,
    expiresAt: string | null,
    downloadEnabled: 0 | 1,
    publishedAt: string,
  ): Promise<void> {
    if (!isValidId(albumId)) throw syncTargetWriteError()
    if (!isValidCatalogId(catalogId)) throw syncTargetWriteError()
    if (!isSafeTitle(title)) throw syncTargetWriteError()
    if (expiresAt !== null && !isCanonicalUtcTimestamp(expiresAt)) throw syncTargetWriteError()
    if (downloadEnabled !== 0 && downloadEnabled !== 1) throw syncTargetWriteError()
    if (!isCanonicalWorkerIso(publishedAt)) throw syncTargetWriteError()

    const existing = await this.readTargets()

    // Reject if the new catalogId would duplicate another album's catalogId
    for (const t of existing) {
      if (t.albumId !== albumId && t.catalogId === catalogId) {
        throw syncTargetWriteError()
      }
    }

    const newTarget: AdminSyncTarget = {
      albumId,
      catalogId,
      title,
      expiresAt,
      downloadEnabled,
      thumb: { longEdge: 640, format: 'webp', quality: 80 },
      preview: { longEdge: 3840, format: 'jpg', quality: 88 },
      stripExif: 1,
    }

    const others = existing.filter(t => t.albumId !== albumId)
    const updated = [...others, newTarget]

    await this.writeTargets(updated, publishedAt)
  }

  /**
   * Read the validated target list for administrative readiness reporting.
   * The returned entries contain only already-sanitized Worker IDs, hashed
   * catalog IDs, public titles, and fixed transform settings.
   */
  async getTargets(): Promise<AdminSyncTarget[]> {
    return this.readTargets()
  }

  async removeTarget(albumId: string, publishedAt: string): Promise<void> {
    if (!isValidId(albumId)) throw syncTargetWriteError()
    if (!isCanonicalWorkerIso(publishedAt)) throw syncTargetWriteError()

    const existing = await this.readTargets()
    const updated = existing.filter(t => t.albumId !== albumId)

    await this.writeTargets(updated, publishedAt)
  }
}
