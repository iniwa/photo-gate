import type { UserAuthRow } from '../types/user.js'
import {
  assertCanonicalUtcTimestamp,
  databaseOperationError,
  isValidId,
} from './repository-validation.js'

export class AuthRepository {
  constructor(private readonly db: D1Database) {}

  async fetchUserForAuth(userId: string): Promise<UserAuthRow | null> {
    if (!isValidId(userId)) return null
    try {
      return await this.db
        .prepare(
          'SELECT id, password_hash, enabled, fail_count, locked_until FROM users WHERE id = ? AND enabled = 1',
        )
        .bind(userId)
        .first<UserAuthRow>()
    } catch {
      throw databaseOperationError()
    }
  }

  async recordLoginFailure(userId: string, now: string): Promise<void> {
    if (!isValidId(userId)) throw new Error('invalid user ID')
    assertCanonicalUtcTimestamp(now)
    try {
      await this.db
        .prepare('UPDATE users SET fail_count = fail_count + 1, updated_at = ? WHERE id = ?')
        .bind(now, userId)
        .run()
    } catch {
      throw databaseOperationError()
    }
  }

  async resetLoginFailure(userId: string, now: string): Promise<void> {
    if (!isValidId(userId)) throw new Error('invalid user ID')
    assertCanonicalUtcTimestamp(now)
    try {
      await this.db
        .prepare(
          'UPDATE users SET fail_count = 0, locked_until = NULL, updated_at = ? WHERE id = ?',
        )
        .bind(now, userId)
        .run()
    } catch {
      throw databaseOperationError()
    }
  }
}
