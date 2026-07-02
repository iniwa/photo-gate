import {
  databaseOperationError,
  isCanonicalUtcTimestamp,
  isValidId,
} from './repository-validation.js'
import type { AdminUserPage, AdminUserSummary } from '../types/admin-user.js'

export interface UserForHardDelete {
  id: string
  display_name: string
  enabled: 0 | 1
}

export const ADMIN_USERS_PAGE_SIZE = 50

const DISPLAY_NAME_MAX_CODE_POINTS = 1024

function isSafeDisplayName(value: unknown): value is string {
  return typeof value === 'string' && Array.from(value).length <= DISPLAY_NAME_MAX_CODE_POINTS
}

function isValidNewDisplayName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !/^\s|\s$/.test(value) &&
    !/[\x00-\x1f\x7f]/.test(value) &&
    Array.from(value).length <= DISPLAY_NAME_MAX_CODE_POINTS
  )
}

function parseUserRow(row: unknown): AdminUserSummary {
  if (typeof row !== 'object' || row === null) throw databaseOperationError()
  const r = row as Record<string, unknown>

  if (!isValidId(r['id'])) throw databaseOperationError()
  if (!isSafeDisplayName(r['display_name'])) throw databaseOperationError()

  const enabled = r['enabled']
  if (enabled !== 0 && enabled !== 1) throw databaseOperationError()

  const failCount = r['fail_count']
  if (!Number.isInteger(failCount) || (failCount as number) < 0) throw databaseOperationError()

  const lockedUntil = r['locked_until']
  if (lockedUntil !== null) {
    if (typeof lockedUntil !== 'string' || !isCanonicalUtcTimestamp(lockedUntil)) {
      throw databaseOperationError()
    }
  }

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
    display_name: r['display_name'] as string,
    enabled: enabled as 0 | 1,
    fail_count: failCount as number,
    locked_until: lockedUntil as string | null,
    created_at: createdAt,
    updated_at: updatedAt,
  }
}

const LIST_SQL_NO_CURSOR = `
  SELECT id, display_name, enabled, fail_count, locked_until, created_at, updated_at
  FROM users
  ORDER BY id ASC
  LIMIT ?`

const LIST_SQL_WITH_CURSOR = `
  SELECT id, display_name, enabled, fail_count, locked_until, created_at, updated_at
  FROM users
  WHERE id > ?
  ORDER BY id ASC
  LIMIT ?`

const SET_USER_ENABLED_SQL = `
  UPDATE users
  SET enabled = ?, updated_at = ?
  WHERE id = ? AND enabled <> ?`

const PBKDF2_HASH_RE = /^pbkdf2-sha256\$100000\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/

function isValidPasswordHashShape(value: unknown): value is string {
  return typeof value === 'string' && PBKDF2_HASH_RE.test(value)
}

const CREATE_USER_SQL = `
  INSERT INTO users (id, display_name, password_hash, enabled, fail_count, locked_until, created_at, updated_at)
  VALUES (?, ?, ?, 1, 0, NULL, ?, ?)`

const RESET_PASSWORD_SQL = `
  UPDATE users
  SET password_hash = ?, fail_count = 0, locked_until = NULL, updated_at = ?
  WHERE id = ?`

const UPDATE_DISPLAY_NAME_SQL = `
  UPDATE users
  SET display_name = ?, updated_at = ?
  WHERE id = ?`

const GET_USER_FOR_HARD_DELETE_SQL = `
  SELECT id, display_name, enabled
  FROM users
  WHERE id = ?`

const DELETE_USER_SQL = `
  DELETE FROM users
  WHERE id = ?`

export class AdminUserRepository {
  constructor(private readonly db: D1Database) {}

  async listUsers(afterUserId?: string): Promise<AdminUserPage> {
    if (afterUserId !== undefined && !isValidId(afterUserId)) {
      throw new Error('invalid cursor')
    }

    const hasCursor = afterUserId !== undefined
    const limit = ADMIN_USERS_PAGE_SIZE + 1

    let rawResult: D1Result<unknown>
    try {
      const stmt = hasCursor
        ? this.db.prepare(LIST_SQL_WITH_CURSOR).bind(afterUserId, limit)
        : this.db.prepare(LIST_SQL_NO_CURSOR).bind(limit)
      rawResult = await stmt.all<unknown>()
    } catch {
      throw databaseOperationError()
    }

    if (!Array.isArray(rawResult.results)) throw databaseOperationError()

    const rows: unknown[] = rawResult.results
    const seen = new Set<string>()
    const parsed: AdminUserSummary[] = []

    for (const row of rows) {
      const user = parseUserRow(row)
      if (seen.has(user.id)) throw databaseOperationError()
      seen.add(user.id)
      parsed.push(user)
    }

    const hasMore = parsed.length > ADMIN_USERS_PAGE_SIZE
    const users = parsed.slice(0, ADMIN_USERS_PAGE_SIZE)

    return { users, hasMore }
  }

  async setUserEnabled(userId: string, enabled: number, updatedAt: string): Promise<void> {
    if (!isValidId(userId)) throw databaseOperationError()
    if (enabled !== 0 && enabled !== 1) throw databaseOperationError()
    if (!isCanonicalUtcTimestamp(updatedAt)) throw databaseOperationError()

    let result: D1Result
    try {
      result = await this.db.prepare(SET_USER_ENABLED_SQL).bind(enabled, updatedAt, userId, enabled).run()
    } catch {
      throw databaseOperationError()
    }
    if (result === null || typeof result !== 'object' || result.success !== true) {
      throw databaseOperationError()
    }
  }

  async createUser(
    userId: string,
    displayName: string,
    passwordHash: string,
    createdAt: string,
    updatedAt: string,
  ): Promise<void> {
    if (!isValidId(userId)) throw databaseOperationError()
    if (!isValidNewDisplayName(displayName)) throw databaseOperationError()
    if (!isValidPasswordHashShape(passwordHash)) throw databaseOperationError()
    if (!isCanonicalUtcTimestamp(createdAt)) throw databaseOperationError()
    if (!isCanonicalUtcTimestamp(updatedAt)) throw databaseOperationError()

    let result: D1Result
    try {
      result = await this.db
        .prepare(CREATE_USER_SQL)
        .bind(userId, displayName, passwordHash, createdAt, updatedAt)
        .run()
    } catch {
      throw databaseOperationError()
    }
    if (result === null || typeof result !== 'object' || result.success !== true) {
      throw databaseOperationError()
    }
  }

  async updateDisplayName(userId: string, displayName: string, updatedAt: string): Promise<void> {
    if (!isValidId(userId)) throw databaseOperationError()
    if (!isValidNewDisplayName(displayName)) throw databaseOperationError()
    if (!isCanonicalUtcTimestamp(updatedAt)) throw databaseOperationError()

    let result: D1Result
    try {
      result = await this.db
        .prepare(UPDATE_DISPLAY_NAME_SQL)
        .bind(displayName, updatedAt, userId)
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

  async resetPassword(userId: string, passwordHash: string, updatedAt: string): Promise<void> {
    if (!isValidId(userId)) throw databaseOperationError()
    if (!isValidPasswordHashShape(passwordHash)) throw databaseOperationError()
    if (!isCanonicalUtcTimestamp(updatedAt)) throw databaseOperationError()

    let result: D1Result
    try {
      result = await this.db
        .prepare(RESET_PASSWORD_SQL)
        .bind(passwordHash, updatedAt, userId)
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
  async getUserForHardDelete(userId: string): Promise<UserForHardDelete | null> {
    if (!isValidId(userId)) throw databaseOperationError()

    let row: unknown
    try {
      row = await this.db
        .prepare(GET_USER_FOR_HARD_DELETE_SQL)
        .bind(userId)
        .first<unknown>()
    } catch {
      throw databaseOperationError()
    }
    if (row === null || row === undefined) return null
    if (typeof row !== 'object' || row === null) throw databaseOperationError()
    const r = row as Record<string, unknown>

    if (!isValidId(r['id'])) throw databaseOperationError()
    if (!isSafeDisplayName(r['display_name'])) throw databaseOperationError()
    const enabled = r['enabled']
    if (enabled !== 0 && enabled !== 1) throw databaseOperationError()

    return {
      id: r['id'] as string,
      display_name: r['display_name'] as string,
      enabled: enabled as 0 | 1,
    }
  }
  async deleteUser(userId: string): Promise<void> {
    if (!isValidId(userId)) throw databaseOperationError()

    let result: D1Result
    try {
      result = await this.db
        .prepare(DELETE_USER_SQL)
        .bind(userId)
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
