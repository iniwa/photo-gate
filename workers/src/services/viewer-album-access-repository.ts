import type { AuthorizedAlbumSummary } from '../types/authorized-album.js'
import {
  assertCanonicalUtcTimestamp,
  databaseOperationError,
  isValidDigest,
  isValidId,
} from './repository-validation.js'

const TITLE_MAX_CODE_POINTS = 1024

const VIEWER_ALBUM_ACCESS_SQL = `
  SELECT s.user_id AS user_id, a.id, a.title, a.download_enabled
  FROM sessions s
  JOIN users u ON u.id = s.user_id AND u.enabled = 1
  LEFT JOIN album_permissions ap
    ON ap.user_id = s.user_id AND ap.album_id = ?
  LEFT JOIN albums a
    ON a.id = ap.album_id
   AND a.enabled = 1
   AND (a.expires_at IS NULL OR a.expires_at > ?)
  WHERE s.token_hash = ?
    AND s.expires_at > ?
  LIMIT 1`

export interface ViewerAlbumAccess {
  userId: string
  album: AuthorizedAlbumSummary | null
}

function isSafeTitle(value: unknown): value is string {
  return typeof value === 'string' && Array.from(value).length <= TITLE_MAX_CODE_POINTS
}

function parseAccessRow(row: unknown): ViewerAlbumAccess {
  if (typeof row !== 'object' || row === null) throw databaseOperationError()
  const value = row as Record<string, unknown>
  if (!isValidId(value['user_id'])) throw databaseOperationError()

  const id = value['id']
  const title = value['title']
  const downloadEnabled = value['download_enabled']
  if (id === null && title === null && downloadEnabled === null) {
    return { userId: value['user_id'], album: null }
  }
  if (!isValidId(id) || !isSafeTitle(title) || (downloadEnabled !== 0 && downloadEnabled !== 1)) {
    throw databaseOperationError()
  }

  return {
    userId: value['user_id'],
    album: { id, title, download_enabled: downloadEnabled },
  }
}

/**
 * Resolves a viewer session and a requested album in one D1 lookup.
 *
 * A malformed route album ID is bound as NULL rather than rejected before the
 * session check. This preserves the public contract: no valid session is 401,
 * while a valid session requesting an invalid or inaccessible album is 403.
 */
export class ViewerAlbumAccessRepository {
  constructor(private readonly db: D1Database) {}

  async getAuthorizedAlbumAccess(
    tokenDigest: string,
    albumId: string,
    now: string,
  ): Promise<ViewerAlbumAccess | null> {
    if (!isValidDigest(tokenDigest)) return null
    assertCanonicalUtcTimestamp(now)
    const boundAlbumId = isValidId(albumId) ? albumId : null

    let row: unknown
    try {
      row = await this.db
        .prepare(VIEWER_ALBUM_ACCESS_SQL)
        .bind(boundAlbumId, now, tokenDigest, now)
        .first<unknown>()
    } catch {
      throw databaseOperationError()
    }
    if (row === null) return null
    return parseAccessRow(row)
  }
}
