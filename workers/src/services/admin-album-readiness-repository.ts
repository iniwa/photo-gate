import type { AdminAlbumReadinessFact, AdminAlbumManifestState } from '../types/admin-album-readiness.js'
import { albumManifestKey } from './r2-object-key.js'
import { databaseOperationError, isValidId } from './repository-validation.js'

const MAX_ALBUMS = 50
const HEAD_CONCURRENCY = 4

function readinessReadError(): Error {
  return new Error('album readiness read failed')
}

function parsePermissionRows(rows: unknown[], ids: readonly string[]): Map<string, number> {
  const wanted = new Set(ids)
  const counts = new Map<string, number>()
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) throw databaseOperationError()
    const record = row as Record<string, unknown>
    const albumId = record['album_id']
    const count = record['permission_count']
    if (!isValidId(albumId) || !wanted.has(albumId)) throw databaseOperationError()
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
      throw databaseOperationError()
    }
    if (counts.has(albumId)) throw databaseOperationError()
    counts.set(albumId, count)
  }
  return counts
}

/**
 * Computes only safe, aggregate sharing facts. It reads D1 active-user permission counts
 * and R2 manifest metadata (`head`) but never an image, manifest body, object
 * listing, or source identity.
 */
export class AdminAlbumReadinessRepository {
  readonly #db: D1Database
  readonly #bucket: R2Bucket

  constructor(db: D1Database, bucket: R2Bucket) {
    this.#db = db
    this.#bucket = bucket
  }

  async getFacts(albumIds: readonly string[]): Promise<AdminAlbumReadinessFact[]> {
    const ids = [...new Set(albumIds)]
    if (ids.length !== albumIds.length || ids.length > MAX_ALBUMS || ids.some((id) => !isValidId(id))) {
      throw readinessReadError()
    }
    if (ids.length === 0) return []

    const placeholders = ids.map(() => '?').join(', ')
    const sql = `
      SELECT album_permissions.album_id, COUNT(*) AS permission_count
      FROM album_permissions
      INNER JOIN users ON users.id = album_permissions.user_id
      WHERE album_permissions.album_id IN (${placeholders})
        AND users.enabled = 1
      GROUP BY album_permissions.album_id`

    let result: D1Result<unknown>
    try {
      result = await this.#db.prepare(sql).bind(...ids).all<unknown>()
    } catch {
      throw databaseOperationError()
    }
    if (!Array.isArray(result.results)) throw databaseOperationError()
    const permissionCounts = parsePermissionRows(result.results, ids)

    const manifestStates = new Map<string, AdminAlbumManifestState>()
    let next = 0
    const inspectOne = async (): Promise<void> => {
      while (next < ids.length) {
        const albumId = ids[next++]
        if (albumId === undefined) return
        try {
          const object = await this.#bucket.head(albumManifestKey(albumId))
          manifestStates.set(albumId, object === null ? 'missing' : 'present')
        } catch {
          // A readiness probe must never claim that a manifest is absent after
          // an R2 error. Keep the admin page usable but make the state explicit.
          manifestStates.set(albumId, 'unknown')
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(HEAD_CONCURRENCY, ids.length) }, inspectOne))

    return ids.map((albumId) => ({
      albumId,
      permissionCount: permissionCounts.get(albumId) ?? 0,
      manifest: manifestStates.get(albumId) ?? 'unknown',
    }))
  }
}
