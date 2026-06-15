import {
  databaseOperationError,
  isCanonicalUtcTimestamp,
  isValidId,
} from './repository-validation.js'
import type { AdminPermissionPage, AdminPermissionSummary } from '../types/admin-permission.js'

export const ADMIN_PERMISSIONS_PAGE_SIZE = 50

function parsePermissionRow(row: unknown): AdminPermissionSummary {
  if (typeof row !== 'object' || row === null) throw databaseOperationError()
  const r = row as Record<string, unknown>

  if (!isValidId(r['album_id'])) throw databaseOperationError()
  if (!isValidId(r['user_id'])) throw databaseOperationError()

  const createdAt = r['created_at']
  if (typeof createdAt !== 'string' || !isCanonicalUtcTimestamp(createdAt)) {
    throw databaseOperationError()
  }

  return {
    album_id: r['album_id'] as string,
    user_id: r['user_id'] as string,
    created_at: createdAt,
  }
}

const LIST_SQL_NO_CURSOR = `
  SELECT album_id, user_id, created_at
  FROM album_permissions
  ORDER BY album_id ASC, user_id ASC
  LIMIT ?`

const LIST_SQL_WITH_CURSOR = `
  SELECT album_id, user_id, created_at
  FROM album_permissions
  WHERE album_id > ? OR (album_id = ? AND user_id > ?)
  ORDER BY album_id ASC, user_id ASC
  LIMIT ?`

export class AdminPermissionRepository {
  constructor(private readonly db: D1Database) {}

  async listPermissions(after?: { albumId: string; userId: string }): Promise<AdminPermissionPage> {
    if (after !== undefined) {
      if (!isValidId(after.albumId) || !isValidId(after.userId)) {
        throw new Error('invalid cursor')
      }
    }

    const limit = ADMIN_PERMISSIONS_PAGE_SIZE + 1

    let rawResult: D1Result<unknown>
    try {
      const stmt = after !== undefined
        ? this.db.prepare(LIST_SQL_WITH_CURSOR).bind(after.albumId, after.albumId, after.userId, limit)
        : this.db.prepare(LIST_SQL_NO_CURSOR).bind(limit)
      rawResult = await stmt.all<unknown>()
    } catch {
      throw databaseOperationError()
    }

    if (!Array.isArray(rawResult.results)) throw databaseOperationError()

    const rows: unknown[] = rawResult.results
    const seen = new Set<string>()
    const parsed: AdminPermissionSummary[] = []

    for (const row of rows) {
      const perm = parsePermissionRow(row)
      const compositeKey = `${perm.album_id}\n${perm.user_id}`
      if (seen.has(compositeKey)) throw databaseOperationError()
      seen.add(compositeKey)
      parsed.push(perm)
    }

    const hasMore = parsed.length > ADMIN_PERMISSIONS_PAGE_SIZE
    const permissions = parsed.slice(0, ADMIN_PERMISSIONS_PAGE_SIZE)

    return { permissions, hasMore }
  }
}
