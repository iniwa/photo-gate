import { databaseOperationError, isCanonicalUtcTimestamp, isValidId } from './repository-validation.js'

export class PermissionRepository {
  constructor(private readonly db: D1Database) {}

  async checkPermission(userId: string, albumId: string, now: string): Promise<boolean> {
    if (!isValidId(userId) || !isValidId(albumId) || !isCanonicalUtcTimestamp(now)) return false
    try {
      const row = await this.db
        .prepare(
          `SELECT 1 AS has_permission
           FROM album_permissions ap
           JOIN albums a ON a.id = ap.album_id
           JOIN users u ON u.id = ap.user_id
           WHERE ap.user_id = ? AND ap.album_id = ?
             AND a.enabled = 1
             AND (a.expires_at IS NULL OR a.expires_at > ?)
             AND u.enabled = 1`,
        )
        .bind(userId, albumId, now)
        .first<{ has_permission: number }>()
      return row !== null && row.has_permission === 1
    } catch {
      throw databaseOperationError()
    }
  }
}
