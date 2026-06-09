import {
  assertCanonicalUtcTimestamp,
  databaseOperationError,
  isValidId,
} from './repository-validation.js'
import type { AuthorizedAlbumSummary } from '../types/authorized-album.js'

const TITLE_MAX_CODE_POINTS = 1024

function isSafeTitle(value: unknown): value is string {
  return typeof value === 'string' && Array.from(value).length <= TITLE_MAX_CODE_POINTS
}

function parseAlbumRow(row: unknown): AuthorizedAlbumSummary {
  if (typeof row !== 'object' || row === null) throw databaseOperationError()
  const r = row as Record<string, unknown>
  if (!isValidId(r['id'])) throw databaseOperationError()
  if (!isSafeTitle(r['title'])) throw databaseOperationError()
  return { id: r['id'] as string, title: r['title'] as string }
}

const LIST_SQL_NO_CURSOR = `
  SELECT a.id, a.title
  FROM album_permissions ap
  JOIN albums a ON a.id = ap.album_id
  JOIN users u ON u.id = ap.user_id
  WHERE ap.user_id = ?
    AND a.enabled = 1
    AND (a.expires_at IS NULL OR a.expires_at > ?)
    AND u.enabled = 1
  ORDER BY a.id ASC
  LIMIT ?`

const LIST_SQL_WITH_CURSOR = `
  SELECT a.id, a.title
  FROM album_permissions ap
  JOIN albums a ON a.id = ap.album_id
  JOIN users u ON u.id = ap.user_id
  WHERE ap.user_id = ?
    AND a.enabled = 1
    AND (a.expires_at IS NULL OR a.expires_at > ?)
    AND u.enabled = 1
    AND a.id > ?
  ORDER BY a.id ASC
  LIMIT ?`

const GET_SQL = `
  SELECT a.id, a.title
  FROM album_permissions ap
  JOIN albums a ON a.id = ap.album_id
  JOIN users u ON u.id = ap.user_id
  WHERE ap.user_id = ?
    AND ap.album_id = ?
    AND a.enabled = 1
    AND (a.expires_at IS NULL OR a.expires_at > ?)
    AND u.enabled = 1`

export class AuthorizedAlbumRepository {
  constructor(private readonly db: D1Database) {}

  async listAuthorizedAlbums(
    userId: string,
    now: string,
    limit: number,
    afterAlbumId?: string,
  ): Promise<AuthorizedAlbumSummary[]> {
    if (!isValidId(userId)) return []
    assertCanonicalUtcTimestamp(now)
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('invalid limit')
    if (afterAlbumId !== undefined && !isValidId(afterAlbumId)) throw new Error('invalid cursor')

    const hasCursor = afterAlbumId !== undefined
    let rawResult: D1Result<unknown>
    try {
      const stmt = hasCursor
        ? this.db.prepare(LIST_SQL_WITH_CURSOR).bind(userId, now, afterAlbumId, limit)
        : this.db.prepare(LIST_SQL_NO_CURSOR).bind(userId, now, limit)
      rawResult = await stmt.all<unknown>()
    } catch {
      throw databaseOperationError()
    }

    if (!Array.isArray(rawResult.results)) throw databaseOperationError()
    const rows: unknown[] = rawResult.results
    const seen = new Set<string>()
    const albums: AuthorizedAlbumSummary[] = []
    for (const row of rows) {
      const album = parseAlbumRow(row)
      if (seen.has(album.id)) throw databaseOperationError()
      seen.add(album.id)
      albums.push(album)
    }
    return albums
  }

  async getAuthorizedAlbum(
    userId: string,
    albumId: string,
    now: string,
  ): Promise<AuthorizedAlbumSummary | null> {
    if (!isValidId(userId)) return null
    if (!isValidId(albumId)) return null
    assertCanonicalUtcTimestamp(now)

    let row: unknown
    try {
      row = await this.db.prepare(GET_SQL).bind(userId, albumId, now).first<unknown>()
    } catch {
      throw databaseOperationError()
    }

    if (row === null) return null
    return parseAlbumRow(row)
  }
}
