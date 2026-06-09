import type { SessionWithUser } from '../types/session.js'
import {
  assertCanonicalUtcTimestamp,
  databaseOperationError,
  isValidDigest,
  isValidId,
} from './repository-validation.js'

export class SessionRepository {
  constructor(private readonly db: D1Database) {}

  async insertSession(
    tokenDigest: string,
    userId: string,
    createdAt: string,
    expiresAt: string,
  ): Promise<void> {
    if (!isValidDigest(tokenDigest)) throw new Error('invalid token digest')
    if (!isValidId(userId)) throw new Error('invalid user ID')
    assertCanonicalUtcTimestamp(createdAt)
    assertCanonicalUtcTimestamp(expiresAt)
    try {
      await this.db
        .prepare(
          'INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)',
        )
        .bind(tokenDigest, userId, createdAt, expiresAt, createdAt)
        .run()
    } catch {
      throw databaseOperationError()
    }
  }

  async fetchValidSession(tokenDigest: string, now: string): Promise<SessionWithUser | null> {
    if (!isValidDigest(tokenDigest)) return null
    assertCanonicalUtcTimestamp(now)
    try {
      return await this.db
        .prepare(
          `SELECT s.token_hash, s.user_id, s.expires_at, s.last_seen_at, u.enabled AS user_enabled
           FROM sessions s
           JOIN users u ON u.id = s.user_id
           WHERE s.token_hash = ? AND s.expires_at > ? AND u.enabled = 1`,
        )
        .bind(tokenDigest, now)
        .first<SessionWithUser>()
    } catch {
      throw databaseOperationError()
    }
  }

  async deleteSession(tokenDigest: string): Promise<void> {
    if (!isValidDigest(tokenDigest)) throw new Error('invalid token digest')
    try {
      await this.db
        .prepare('DELETE FROM sessions WHERE token_hash = ?')
        .bind(tokenDigest)
        .run()
    } catch {
      throw databaseOperationError()
    }
  }

  async deleteExpiredSessions(now: string): Promise<void> {
    assertCanonicalUtcTimestamp(now)
    try {
      await this.db
        .prepare('DELETE FROM sessions WHERE expires_at <= ?')
        .bind(now)
        .run()
    } catch {
      throw databaseOperationError()
    }
  }
}
