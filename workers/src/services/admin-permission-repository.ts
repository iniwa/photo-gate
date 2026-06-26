import {
  databaseOperationError,
  isCanonicalUtcTimestamp,
  isValidId,
} from './repository-validation.js'
import type { AdminPermissionPage, AdminPermissionSummary, AssignmentAlbum, AssignmentOptions, AssignmentUser } from '../types/admin-permission.js'

export const ADMIN_PERMISSIONS_PAGE_SIZE = 50

// Maximum rows for assignment option lists (users and albums). Exceeding this
// limit causes listAssignmentOptions to fail closed rather than silently
// truncate — this private project is not expected to approach 100 users or albums.
export const ASSIGNMENT_OPTIONS_MAX = 100

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

const LIST_ASSIGNMENT_USERS_SQL = `
  SELECT id, display_name, enabled
  FROM users
  ORDER BY id ASC
  LIMIT ?`

const LIST_ASSIGNMENT_ALBUMS_SQL = `
  SELECT id, title, enabled
  FROM albums
  ORDER BY id ASC
  LIMIT ?`

function parseAssignmentUserRow(row: unknown): AssignmentUser {
  if (typeof row !== 'object' || row === null) throw databaseOperationError()
  const r = row as Record<string, unknown>
  if (!isValidId(r['id'])) throw databaseOperationError()
  const displayName = r['display_name']
  if (typeof displayName !== 'string' || Array.from(displayName).length > 1024) throw databaseOperationError()
  const enabled = r['enabled']
  if (enabled !== 0 && enabled !== 1) throw databaseOperationError()
  return { id: r['id'] as string, display_name: displayName, enabled: enabled as 0 | 1 }
}

function parseAssignmentAlbumRow(row: unknown): AssignmentAlbum {
  if (typeof row !== 'object' || row === null) throw databaseOperationError()
  const r = row as Record<string, unknown>
  if (!isValidId(r['id'])) throw databaseOperationError()
  const title = r['title']
  if (typeof title !== 'string' || Array.from(title).length > 1024) throw databaseOperationError()
  const enabled = r['enabled']
  if (enabled !== 0 && enabled !== 1) throw databaseOperationError()
  return { id: r['id'] as string, title: title, enabled: enabled as 0 | 1 }
}

// Idempotent grant: an already-existing (album_id, user_id) pair is left
// untouched (DO NOTHING) and reported as success. All three values are bound
// parameters; nothing is interpolated. A foreign-key violation (unknown album
// or user) surfaces as a generic database operation failure and never as a
// distinct "does not exist" signal.
const GRANT_SQL = `
  INSERT INTO album_permissions (album_id, user_id, created_at)
  VALUES (?, ?, ?)
  ON CONFLICT(album_id, user_id) DO NOTHING`

// Idempotent revoke: deleting an already-absent pair affects zero rows and is
// still reported as success. Both values are bound parameters.
const REVOKE_SQL = `
  DELETE FROM album_permissions
  WHERE album_id = ? AND user_id = ?`

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

  /**
   * Returns safe user and album lists (id, display_name/title, enabled) for
   * building assignment select menus, plus the paginated permission rows. Issues
   * three separate D1 queries. Fails closed if users or albums exceed
   * ASSIGNMENT_OPTIONS_MAX rows — this private project is not expected to reach
   * that limit, and silent truncation would be misleading.
   *
   * Selected columns per table:
   *   users  — id, display_name, enabled  (no password_hash, sessions, photoprism_uid)
   *   albums — id, title, enabled         (no photoprism_album_uid, transform settings)
   *   album_permissions — album_id, user_id, created_at
   */
  async listAssignmentOptions(after?: { albumId: string; userId: string }): Promise<AssignmentOptions> {
    if (after !== undefined) {
      if (!isValidId(after.albumId) || !isValidId(after.userId)) {
        throw new Error('invalid cursor')
      }
    }

    const optionLimit = ASSIGNMENT_OPTIONS_MAX + 1

    let usersResult: D1Result<unknown>
    try {
      usersResult = await this.db.prepare(LIST_ASSIGNMENT_USERS_SQL).bind(optionLimit).all<unknown>()
    } catch {
      throw databaseOperationError()
    }
    if (!Array.isArray(usersResult.results)) throw databaseOperationError()
    if (usersResult.results.length > ASSIGNMENT_OPTIONS_MAX) throw databaseOperationError()
    const users: AssignmentUser[] = []
    const seenUserIds = new Set<string>()
    for (const row of usersResult.results) {
      const u = parseAssignmentUserRow(row)
      if (seenUserIds.has(u.id)) throw databaseOperationError()
      seenUserIds.add(u.id)
      users.push(u)
    }

    let albumsResult: D1Result<unknown>
    try {
      albumsResult = await this.db.prepare(LIST_ASSIGNMENT_ALBUMS_SQL).bind(optionLimit).all<unknown>()
    } catch {
      throw databaseOperationError()
    }
    if (!Array.isArray(albumsResult.results)) throw databaseOperationError()
    if (albumsResult.results.length > ASSIGNMENT_OPTIONS_MAX) throw databaseOperationError()
    const albums: AssignmentAlbum[] = []
    const seenAlbumIds = new Set<string>()
    for (const row of albumsResult.results) {
      const a = parseAssignmentAlbumRow(row)
      if (seenAlbumIds.has(a.id)) throw databaseOperationError()
      seenAlbumIds.add(a.id)
      albums.push(a)
    }

    const permLimit = ADMIN_PERMISSIONS_PAGE_SIZE + 1
    let rawPermsResult: D1Result<unknown>
    try {
      const stmt = after !== undefined
        ? this.db.prepare(LIST_SQL_WITH_CURSOR).bind(after.albumId, after.albumId, after.userId, permLimit)
        : this.db.prepare(LIST_SQL_NO_CURSOR).bind(permLimit)
      rawPermsResult = await stmt.all<unknown>()
    } catch {
      throw databaseOperationError()
    }
    if (!Array.isArray(rawPermsResult.results)) throw databaseOperationError()
    const seen = new Set<string>()
    const permissions: AdminPermissionSummary[] = []
    for (const row of rawPermsResult.results) {
      const perm = parsePermissionRow(row)
      const compositeKey = `${perm.album_id}\n${perm.user_id}`
      if (seen.has(compositeKey)) throw databaseOperationError()
      seen.add(compositeKey)
      permissions.push(perm)
    }
    const hasMore = permissions.length > ADMIN_PERMISSIONS_PAGE_SIZE

    return {
      users,
      albums,
      permissions: permissions.slice(0, ADMIN_PERMISSIONS_PAGE_SIZE),
      hasMore,
    }
  }

  /**
   * Idempotently grant a user access to an album.
   *
   * IDs and the timestamp are validated before any SQL is prepared (defense in
   * depth; the route validates too). The single parameterized INSERT uses
   * ON CONFLICT DO NOTHING so re-granting an existing permission is a successful
   * no-op. Preparation, binding, execution (including foreign-key violations for
   * unknown album/user), a missing/malformed result, or an unsuccessful result
   * all surface as the same sanitized database operation failure — never a
   * distinct existence or cause signal.
   */
  async grantPermission(albumId: string, userId: string, createdAt: string): Promise<void> {
    if (!isValidId(albumId) || !isValidId(userId)) throw databaseOperationError()
    if (!isCanonicalUtcTimestamp(createdAt)) throw databaseOperationError()

    let result: D1Result
    try {
      result = await this.db.prepare(GRANT_SQL).bind(albumId, userId, createdAt).run()
    } catch {
      throw databaseOperationError()
    }
    if (result === null || typeof result !== 'object' || result.success !== true) {
      throw databaseOperationError()
    }
  }

  /**
   * Idempotently revoke a user's access to an album.
   *
   * IDs are validated before any SQL is prepared. The single parameterized
   * DELETE removes the pair if present; deleting an absent pair affects zero
   * rows and is still a success. Preparation, binding, execution, a
   * missing/malformed result, or an unsuccessful result all surface as the same
   * sanitized database operation failure.
   */
  async revokePermission(albumId: string, userId: string): Promise<void> {
    if (!isValidId(albumId) || !isValidId(userId)) throw databaseOperationError()

    let result: D1Result
    try {
      result = await this.db.prepare(REVOKE_SQL).bind(albumId, userId).run()
    } catch {
      throw databaseOperationError()
    }
    if (result === null || typeof result !== 'object' || result.success !== true) {
      throw databaseOperationError()
    }
  }
}
