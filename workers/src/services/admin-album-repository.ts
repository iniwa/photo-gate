import {
  databaseOperationError,
  isCanonicalUtcTimestamp,
  isValidId,
} from './repository-validation.js'
import type { AdminAlbumPage, AdminAlbumSummary } from '../types/admin-album.js'

export interface AlbumForSync {
  id: string
  title: string
  expires_at: string | null
  download_enabled: 0 | 1
}

export interface AlbumForHardDelete {
  id: string
  title: string
  enabled: 0 | 1
}

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

// Idempotent, non-disclosing enabled-state transition. The `enabled <> ?`
// predicate means an album already in the requested state (or an unknown id)
// matches zero rows and is left untouched — including updated_at — yet still
// reports success. Only `enabled` and `updated_at` are written; permissions,
// transform settings, expiry, download, and source identity are never touched.
// All four values are bound parameters; nothing is interpolated. No SELECT runs
// first and no affected-row count is inspected, so existence and prior state
// are never disclosed.
const SET_ENABLED_SQL = `
  UPDATE albums
  SET enabled = ?, updated_at = ?
  WHERE id = ? AND enabled <> ?`

function isValidTitle(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (value.length === 0) return false
  if (/^\s|\s$/.test(value)) return false
  if (/[\x00-\x1f\x7f]/.test(value)) return false
  if (Array.from(value).length > TITLE_MAX_CODE_POINTS) return false
  return true
}

const GET_ALBUM_FOR_SYNC_SQL = `
  SELECT id, title, expires_at, download_enabled
  FROM albums
  WHERE id = ?`

const GET_ALBUM_FOR_HARD_DELETE_SQL = `
  SELECT id, title, enabled
  FROM albums
  WHERE id = ?`

const UPDATE_PUBLIC_METADATA_SQL = `
  UPDATE albums
  SET title = ?, expires_at = ?, download_enabled = ?, updated_at = ?
  WHERE id = ?`

function isValidPhotoprismAlbumUid(value: unknown): value is string {
  return typeof value === 'string' && /^[\x21-\x7e]{1,128}$/.test(value)
}

// enabled is hardcoded as literal 0 (schema default is 1, so INSERT must be explicit).
// Transform/EXIF columns (thumb_*, preview_*, strip_exif) are intentionally omitted
// so schema defaults apply. photoprism_album_uid is write-only: accepted here and
// never selected back.
const CREATE_ALBUM_SQL = `
  INSERT INTO albums (id, title, photoprism_album_uid, enabled, expires_at, download_enabled, created_at, updated_at)
  VALUES (?, ?, ?, 0, ?, ?, ?, ?)`

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

  /**
   * Idempotently set an album's enabled state.
   *
   * The album ID, the numeric enabled flag (exactly 0 or 1), and the canonical
   * UTC timestamp are validated before any SQL is prepared (defense in depth;
   * the route validates too). The single parameterized UPDATE only changes a row
   * whose `enabled` differs from the requested value, so re-applying the current
   * state — or targeting an unknown album — affects zero rows, leaves
   * `updated_at` unchanged, and is still a successful no-op. Preparation,
   * binding, execution, a missing/malformed result, or an unsuccessful result
   * all surface as the same sanitized database operation failure — never an
   * existence, prior-state, or cause signal.
   */
  async setAlbumEnabled(albumId: string, enabled: number, updatedAt: string): Promise<void> {
    if (!isValidId(albumId)) throw databaseOperationError()
    if (enabled !== 0 && enabled !== 1) throw databaseOperationError()
    if (!isCanonicalUtcTimestamp(updatedAt)) throw databaseOperationError()

    let result: D1Result
    try {
      result = await this.db.prepare(SET_ENABLED_SQL).bind(enabled, updatedAt, albumId, enabled).run()
    } catch {
      throw databaseOperationError()
    }
    if (result === null || typeof result !== 'object' || result.success !== true) {
      throw databaseOperationError()
    }
  }

  async createAlbum(
    albumId: string,
    title: string,
    photoprismAlbumUid: string,
    expiresAt: string | null,
    downloadEnabled: 0 | 1,
    createdAt: string,
    updatedAt: string,
  ): Promise<void> {
    if (!isValidId(albumId)) throw databaseOperationError()
    if (!isValidTitle(title)) throw databaseOperationError()
    if (!isValidPhotoprismAlbumUid(photoprismAlbumUid)) throw databaseOperationError()
    if (expiresAt !== null && !isCanonicalUtcTimestamp(expiresAt)) throw databaseOperationError()
    if (downloadEnabled !== 0 && downloadEnabled !== 1) throw databaseOperationError()
    if (!isCanonicalUtcTimestamp(createdAt)) throw databaseOperationError()
    if (!isCanonicalUtcTimestamp(updatedAt)) throw databaseOperationError()

    let result: D1Result
    try {
      result = await this.db
        .prepare(CREATE_ALBUM_SQL)
        .bind(albumId, title, photoprismAlbumUid, expiresAt, downloadEnabled, createdAt, updatedAt)
        .run()
    } catch {
      throw databaseOperationError()
    }
    if (result === null || typeof result !== 'object' || result.success !== true) {
      throw databaseOperationError()
    }
  }

  async getAlbumForSync(albumId: string): Promise<AlbumForSync | null> {
    if (!isValidId(albumId)) throw databaseOperationError()

    let row: unknown
    try {
      row = await this.db
        .prepare(GET_ALBUM_FOR_SYNC_SQL)
        .bind(albumId)
        .first<unknown>()
    } catch {
      throw databaseOperationError()
    }
    if (row === null || row === undefined) return null

    if (typeof row !== 'object' || row === null) throw databaseOperationError()
    const r = row as Record<string, unknown>

    if (!isValidId(r['id'])) throw databaseOperationError()

    const title = r['title']
    if (typeof title !== 'string' || title.length === 0) throw databaseOperationError()

    const expiresAt = r['expires_at']
    if (expiresAt !== null) {
      if (typeof expiresAt !== 'string' || !isCanonicalUtcTimestamp(expiresAt)) {
        throw databaseOperationError()
      }
    }

    const downloadEnabled = r['download_enabled']
    if (downloadEnabled !== 0 && downloadEnabled !== 1) throw databaseOperationError()

    return {
      id: r['id'] as string,
      title: title,
      expires_at: expiresAt as string | null,
      download_enabled: downloadEnabled as 0 | 1,
    }
  }

  async getAlbumForHardDelete(albumId: string): Promise<AlbumForHardDelete | null> {
    if (!isValidId(albumId)) throw databaseOperationError()

    let row: unknown
    try {
      row = await this.db
        .prepare(GET_ALBUM_FOR_HARD_DELETE_SQL)
        .bind(albumId)
        .first<unknown>()
    } catch {
      throw databaseOperationError()
    }
    if (row === null || row === undefined) return null
    if (typeof row !== 'object' || row === null) throw databaseOperationError()
    const r = row as Record<string, unknown>

    if (!isValidId(r['id'])) throw databaseOperationError()
    if (!isSafeTitle(r['title'])) throw databaseOperationError()
    const enabled = r['enabled']
    if (enabled !== 0 && enabled !== 1) throw databaseOperationError()

    return {
      id: r['id'] as string,
      title: r['title'] as string,
      enabled: enabled as 0 | 1,
    }
  }

  async updatePublicMetadata(
    albumId: string,
    title: string,
    expiresAt: string | null,
    downloadEnabled: number,
    updatedAt: string,
  ): Promise<void> {
    if (!isValidId(albumId)) throw databaseOperationError()
    if (!isValidTitle(title)) throw databaseOperationError()
    if (expiresAt !== null && !isCanonicalUtcTimestamp(expiresAt)) throw databaseOperationError()
    if (downloadEnabled !== 0 && downloadEnabled !== 1) throw databaseOperationError()
    if (!isCanonicalUtcTimestamp(updatedAt)) throw databaseOperationError()

    let result: D1Result
    try {
      result = await this.db
        .prepare(UPDATE_PUBLIC_METADATA_SQL)
        .bind(title, expiresAt, downloadEnabled, updatedAt, albumId)
        .run()
    } catch {
      throw databaseOperationError()
    }
    if (result === null || typeof result !== 'object' || result.success !== true) {
      throw databaseOperationError()
    }
    if ((result as unknown as { meta?: { changes?: number } }).meta?.changes === 0) {
      throw databaseOperationError()
    }
  }
}
