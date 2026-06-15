import {
  databaseOperationError,
  isCanonicalUtcTimestamp,
  isValidId,
} from './repository-validation.js'
import type { AdminAlbumPage, AdminAlbumSummary } from '../types/admin-album.js'

export const ADMIN_ALBUMS_PAGE_SIZE = 50

const TITLE_MAX_CODE_POINTS = 1024

function isSafeTitle(value: unknown): value is string {
  return typeof value === 'string' && Array.from(value).length <= TITLE_MAX_CODE_POINTS
}

function parseAlbumRow(row: unknown): AdminAlbumSummary {
  if (typeof row !== 'object' || row === null) throw databaseOperationError()
  const r = row as Record<string, unknown>

  if (!isValidId(r['id'])) throw databaseOperationError()
  if (!isSafeTitle(r['title'])) throw databaseOperationError()

  const enabled = r['enabled']
  if (enabled !== 0 && enabled !== 1) throw databaseOperationError()

  const expiresAt = r['expires_at']
  if (expiresAt !== null) {
    if (typeof expiresAt !== 'string' || !isCanonicalUtcTimestamp(expiresAt)) {
      throw databaseOperationError()
    }
  }

  const downloadEnabled = r['download_enabled']
  if (downloadEnabled !== 0 && downloadEnabled !== 1) throw databaseOperationError()

  const createdAt = r['created_at']
  if (typeof createdAt !== 'string' || !isCanonicalUtcTimestamp(createdAt)) {
    throw databaseOperationError()
  }

  const updatedAt = r['updated_at']
  if (typeof updatedAt !== 'string' || !isCanonicalUtcTimestamp(updatedAt)) {
    throw databaseOperationError()
  }

  return {
    id: r['id'] as string,
    title: r['title'] as string,
    enabled: enabled as 0 | 1,
    expires_at: expiresAt as string | null,
    download_enabled: downloadEnabled as 0 | 1,
    created_at: createdAt,
    updated_at: updatedAt,
  }
}

const LIST_SQL_NO_CURSOR = `
  SELECT id, title, enabled, expires_at, download_enabled, created_at, updated_at
  FROM albums
  ORDER BY id ASC
  LIMIT ?`

const LIST_SQL_WITH_CURSOR = `
  SELECT id, title, enabled, expires_at, download_enabled, created_at, updated_at
  FROM albums
  WHERE id > ?
  ORDER BY id ASC
  LIMIT ?`

export class AdminAlbumRepository {
  constructor(private readonly db: D1Database) {}

  async listAlbums(afterAlbumId?: string): Promise<AdminAlbumPage> {
    if (afterAlbumId !== undefined && !isValidId(afterAlbumId)) {
      throw new Error('invalid cursor')
    }

    const hasCursor = afterAlbumId !== undefined
    const limit = ADMIN_ALBUMS_PAGE_SIZE + 1

    let rawResult: D1Result<unknown>
    try {
      const stmt = hasCursor
        ? this.db.prepare(LIST_SQL_WITH_CURSOR).bind(afterAlbumId, limit)
        : this.db.prepare(LIST_SQL_NO_CURSOR).bind(limit)
      rawResult = await stmt.all<unknown>()
    } catch {
      throw databaseOperationError()
    }

    if (!Array.isArray(rawResult.results)) throw databaseOperationError()

    const rows: unknown[] = rawResult.results
    const seen = new Set<string>()
    const parsed: AdminAlbumSummary[] = []

    for (const row of rows) {
      const album = parseAlbumRow(row)
      if (seen.has(album.id)) throw databaseOperationError()
      seen.add(album.id)
      parsed.push(album)
    }

    const hasMore = parsed.length > ADMIN_ALBUMS_PAGE_SIZE
    const albums = parsed.slice(0, ADMIN_ALBUMS_PAGE_SIZE)

    return { albums, hasMore }
  }
}
