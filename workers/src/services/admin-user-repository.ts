import {
  databaseOperationError,
  isCanonicalUtcTimestamp,
  isValidId,
} from './repository-validation.js'
import type { AdminUserPage, AdminUserSummary } from '../types/admin-user.js'

export const ADMIN_USERS_PAGE_SIZE = 50

const DISPLAY_NAME_MAX_CODE_POINTS = 1024

function isSafeDisplayName(value: unknown): value is string {
  return typeof value === 'string' && Array.from(value).length <= DISPLAY_NAME_MAX_CODE_POINTS
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
}
