import {
  databaseOperationError,
  isCanonicalUtcTimestamp,
} from './repository-validation.js'
import type { AdminOpsSummary } from '../types/admin-ops.js'

const USERS_SQL = `
  SELECT
    COUNT(*) AS total,
    COALESCE(SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END), 0) AS enabled,
    COALESCE(SUM(CASE WHEN enabled = 0 THEN 1 ELSE 0 END), 0) AS disabled,
    COALESCE(SUM(CASE WHEN locked_until IS NOT NULL AND locked_until > ? THEN 1 ELSE 0 END), 0) AS locked
  FROM users`

const ALBUMS_SQL = `
  SELECT
    COUNT(*) AS total,
    COALESCE(SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END), 0) AS enabled,
    COALESCE(SUM(CASE WHEN enabled = 0 THEN 1 ELSE 0 END), 0) AS disabled,
    COALESCE(SUM(CASE WHEN expires_at IS NOT NULL AND expires_at <= ? THEN 1 ELSE 0 END), 0) AS expired,
    COALESCE(SUM(CASE WHEN expires_at IS NOT NULL AND expires_at > ? AND expires_at <= ? THEN 1 ELSE 0 END), 0) AS expiring_soon,
    COALESCE(SUM(CASE WHEN download_enabled = 1 THEN 1 ELSE 0 END), 0) AS downloadable
  FROM albums`

const PERMISSIONS_SQL = `
  SELECT COUNT(*) AS total
  FROM album_permissions`

const SESSIONS_SQL = `
  SELECT
    COUNT(*) AS total,
    COALESCE(SUM(CASE WHEN expires_at <= ? THEN 1 ELSE 0 END), 0) AS expired
  FROM sessions`

function isSafeCount(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
}

function parseUsersRow(row: unknown): AdminOpsSummary['users'] {
  if (typeof row !== 'object' || row === null) throw databaseOperationError()
  const r = row as Record<string, unknown>
  if (!isSafeCount(r['total'])) throw databaseOperationError()
  if (!isSafeCount(r['enabled'])) throw databaseOperationError()
  if (!isSafeCount(r['disabled'])) throw databaseOperationError()
  if (!isSafeCount(r['locked'])) throw databaseOperationError()
  return {
    total: r['total'] as number,
    enabled: r['enabled'] as number,
    disabled: r['disabled'] as number,
    locked: r['locked'] as number,
  }
}

function parseAlbumsRow(row: unknown): AdminOpsSummary['albums'] {
  if (typeof row !== 'object' || row === null) throw databaseOperationError()
  const r = row as Record<string, unknown>
  if (!isSafeCount(r['total'])) throw databaseOperationError()
  if (!isSafeCount(r['enabled'])) throw databaseOperationError()
  if (!isSafeCount(r['disabled'])) throw databaseOperationError()
  if (!isSafeCount(r['expired'])) throw databaseOperationError()
  if (!isSafeCount(r['expiring_soon'])) throw databaseOperationError()
  if (!isSafeCount(r['downloadable'])) throw databaseOperationError()
  return {
    total: r['total'] as number,
    enabled: r['enabled'] as number,
    disabled: r['disabled'] as number,
    expired: r['expired'] as number,
    expiringSoon: r['expiring_soon'] as number,
    downloadable: r['downloadable'] as number,
  }
}

function parsePermissionsRow(row: unknown): AdminOpsSummary['permissions'] {
  if (typeof row !== 'object' || row === null) throw databaseOperationError()
  const r = row as Record<string, unknown>
  if (!isSafeCount(r['total'])) throw databaseOperationError()
  return { total: r['total'] as number }
}

function parseSessionsRow(row: unknown): AdminOpsSummary['sessions'] {
  if (typeof row !== 'object' || row === null) throw databaseOperationError()
  const r = row as Record<string, unknown>
  if (!isSafeCount(r['total'])) throw databaseOperationError()
  if (!isSafeCount(r['expired'])) throw databaseOperationError()
  return { total: r['total'] as number, expired: r['expired'] as number }
}

export class AdminOpsRepository {
  constructor(private readonly db: D1Database) {}

  async getSummary(now: string, expiringSoonUntil: string): Promise<AdminOpsSummary> {
    if (!isCanonicalUtcTimestamp(now)) throw databaseOperationError()
    if (!isCanonicalUtcTimestamp(expiringSoonUntil)) throw databaseOperationError()
    if (new Date(expiringSoonUntil).valueOf() <= new Date(now).valueOf()) throw databaseOperationError()

    let usersRow: unknown
    let albumsRow: unknown
    let permissionsRow: unknown
    let sessionsRow: unknown

    try {
      usersRow = await this.db.prepare(USERS_SQL).bind(now).first()
    } catch {
      throw databaseOperationError()
    }
    if (usersRow === null) throw databaseOperationError()

    try {
      albumsRow = await this.db.prepare(ALBUMS_SQL).bind(now, now, expiringSoonUntil).first()
    } catch {
      throw databaseOperationError()
    }
    if (albumsRow === null) throw databaseOperationError()

    try {
      permissionsRow = await this.db.prepare(PERMISSIONS_SQL).first()
    } catch {
      throw databaseOperationError()
    }
    if (permissionsRow === null) throw databaseOperationError()

    try {
      sessionsRow = await this.db.prepare(SESSIONS_SQL).bind(now).first()
    } catch {
      throw databaseOperationError()
    }
    if (sessionsRow === null) throw databaseOperationError()

    return {
      generatedAt: now,
      users: parseUsersRow(usersRow),
      albums: parseAlbumsRow(albumsRow),
      permissions: parsePermissionsRow(permissionsRow),
      sessions: parseSessionsRow(sessionsRow),
    }
  }
}
