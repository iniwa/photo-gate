import { isValidId } from './safe-id.js'
import { isStandardPrivateObjectKey } from './r2-object-key.js'
import type { AdminR2CleanupAlbumEntry, AdminR2CleanupReport } from '../types/admin-r2-cleanup.js'

export const R2_CLEANUP_MAX_ALBUM_ROWS = 500
export const R2_CLEANUP_MAX_R2_PAGES = 20
export const R2_CLEANUP_MAX_R2_OBJECTS = 5000

const R2_LIST_PAGE_SIZE = 250

const D1_LIST_SQL = `SELECT id, enabled FROM albums ORDER BY id ASC LIMIT ?`

function cleanupError(): Error {
  return new Error('r2 cleanup operation failed')
}

function parseAlbumRow(row: unknown): { id: string; enabled: 0 | 1 } {
  if (typeof row !== 'object' || row === null) throw cleanupError()
  const r = row as Record<string, unknown>
  if (!isValidId(r['id'])) throw cleanupError()
  const enabled = r['enabled']
  if (enabled !== 0 && enabled !== 1) throw cleanupError()
  return { id: r['id'] as string, enabled: enabled as 0 | 1 }
}

export class AdminR2CleanupRepository {
  constructor(
    private readonly db: D1Database,
    private readonly bucket: R2Bucket,
  ) {}

  async getReport(): Promise<AdminR2CleanupReport> {
    const d1Limit = R2_CLEANUP_MAX_ALBUM_ROWS + 1
    let rawResult: D1Result<unknown>
    try {
      rawResult = await this.db.prepare(D1_LIST_SQL).bind(d1Limit).all<unknown>()
    } catch {
      throw cleanupError()
    }
    if (!Array.isArray(rawResult.results)) throw cleanupError()
    if (rawResult.results.length > R2_CLEANUP_MAX_ALBUM_ROWS) throw cleanupError()

    const albumMap = new Map<string, 0 | 1>()
    for (const row of rawResult.results) {
      const parsed = parseAlbumRow(row)
      if (albumMap.has(parsed.id)) throw cleanupError()
      albumMap.set(parsed.id, parsed.enabled)
    }

    const albumStats = new Map<string, { count: number; bytes: number }>()
    let malformedCount = 0
    let malformedBytes = 0
    let truncated = false
    let albumsCursor: string | undefined
    let albumsPages = 0
    let albumsObjects = 0

    albumsLoop: for (;;) {
      let listed: R2Objects
      try {
        listed = await this.bucket.list(
          albumsCursor !== undefined
            ? { prefix: 'albums/', limit: R2_LIST_PAGE_SIZE, cursor: albumsCursor }
            : { prefix: 'albums/', limit: R2_LIST_PAGE_SIZE },
        )
      } catch {
        throw cleanupError()
      }

      albumsPages++

      for (const obj of listed.objects) {
        albumsObjects++
        if (albumsObjects > R2_CLEANUP_MAX_R2_OBJECTS) {
          truncated = true
          break albumsLoop
        }

        const { key, size } = obj

        if (!isStandardPrivateObjectKey(key)) {
          malformedCount++
          malformedBytes += size
          continue
        }

        const albumId = key.split('/')[1]!
        const existing = albumStats.get(albumId)
        if (existing !== undefined) {
          existing.count++
          existing.bytes += size
        } else {
          albumStats.set(albumId, { count: 1, bytes: size })
        }
      }

      if (!listed.truncated) break
      if (albumsPages >= R2_CLEANUP_MAX_R2_PAGES) {
        truncated = true
        break
      }
      if (listed.cursor === undefined) throw cleanupError()
      albumsCursor = listed.cursor
    }

    let excludedOpsCount = 0
    let opsCursor: string | undefined
    let opsPages = 0

    for (;;) {
      let listed: R2Objects
      try {
        listed = await this.bucket.list(
          opsCursor !== undefined
            ? { prefix: 'ops/', limit: R2_LIST_PAGE_SIZE, cursor: opsCursor }
            : { prefix: 'ops/', limit: R2_LIST_PAGE_SIZE },
        )
      } catch {
        throw cleanupError()
      }
      opsPages++
      excludedOpsCount += listed.objects.length
      if (!listed.truncated) break
      if (opsPages >= R2_CLEANUP_MAX_R2_PAGES) {
        truncated = true
        break
      }
      if (listed.cursor === undefined) throw cleanupError()
      opsCursor = listed.cursor
    }

    const albums: AdminR2CleanupAlbumEntry[] = []
    for (const [albumId, stats] of albumStats) {
      const enabledValue = albumMap.get(albumId)
      let category: 'owned-active' | 'owned-disabled' | 'orphan'
      if (enabledValue === 1) {
        category = 'owned-active'
      } else if (enabledValue === 0) {
        category = 'owned-disabled'
      } else {
        category = 'orphan'
      }
      albums.push({ albumId, category, objectCount: stats.count, totalBytes: stats.bytes })
    }

    const catOrder: Record<string, number> = { 'owned-active': 0, 'owned-disabled': 1, orphan: 2 }
    albums.sort((a, b) => {
      const catDiff = (catOrder[a.category] ?? 3) - (catOrder[b.category] ?? 3)
      if (catDiff !== 0) return catDiff
      return a.albumId.localeCompare(b.albumId)
    })

    return { albums, malformedCount, malformedBytes, excludedOpsCount, truncated }
  }
}
