import type { Context } from 'hono'
import type { Env } from '../types/env.js'
import { isValidId } from '../services/repository-validation.js'
import { parseUrlEncodedForm } from '../services/url-encoded-form.js'

export type AdminFormContext = Context<{ Bindings: Env }>

const MAX_ADMIN_FORM_BYTES = 16 * 1024
const ADMIN_DISPLAY_NAME_MAX_CODE_POINTS = 1024
const ADMIN_TITLE_MAX_CODE_POINTS = 1024
const CATALOG_ID_RE = /^[0-9a-f]{64}$/

/** Strict same-origin guard for every admin mutation. */
export function isSameOrigin(c: AdminFormContext): boolean {
  const origin = c.req.header('Origin')
  if (origin === undefined || origin === 'null') return false
  let requestOrigin: string
  try {
    requestOrigin = new URL(c.req.url).origin
  } catch {
    return false
  }
  return origin === requestOrigin
}

/** Accepts exactly URL-encoded forms with, at most, one valid charset suffix. */
export function isFormContentType(contentType: string | undefined): boolean {
  if (contentType === undefined) return false
  const parts = contentType.split(';')
  if (parts[0]?.trim().toLowerCase() !== 'application/x-www-form-urlencoded') {
    return false
  }
  if (parts.length === 1) return true
  if (parts.length !== 2) return false
  return /^charset\s*=\s*(?:"[^"]+"|[a-z0-9._-]+)$/i.test(parts[1]!.trim())
}

async function parseForm(c: AdminFormContext) {
  return parseUrlEncodedForm(c.req.raw, MAX_ADMIN_FORM_BYTES)
}

/** Parse exactly one albumId and one userId, both canonical. */
export async function parseMutationFields(
  c: AdminFormContext,
): Promise<{ albumId: string; userId: string } | null> {
  const body = await parseForm(c)
  if (body === null || Object.keys(body).length !== 2) return null
  const albumId = body['albumId']
  const userId = body['userId']
  if (typeof albumId !== 'string' || typeof userId !== 'string') return null
  if (!isValidId(albumId) || !isValidId(userId)) return null
  return { albumId, userId }
}

export async function parseAlbumIdField(
  c: AdminFormContext,
): Promise<{ albumId: string } | null> {
  const body = await parseForm(c)
  if (body === null || Object.keys(body).length !== 1) return null
  const albumId = body['albumId']
  if (typeof albumId !== 'string' || !isValidId(albumId)) return null
  return { albumId }
}

export async function parseUserIdField(
  c: AdminFormContext,
): Promise<{ userId: string } | null> {
  const body = await parseForm(c)
  if (body === null || Object.keys(body).length !== 1) return null
  const userId = body['userId']
  if (typeof userId !== 'string' || !isValidId(userId)) return null
  return { userId }
}

function isValidDisplayName(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false
  if (/^\s|\s$/.test(value) || /[\x00-\x1f\x7f]/.test(value)) return false
  return Array.from(value).length <= ADMIN_DISPLAY_NAME_MAX_CODE_POINTS
}

function isValidPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 1024
}

function isValidTitle(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false
  if (/^\s|\s$/.test(value) || /[\x00-\x1f\x7f]/.test(value)) return false
  return Array.from(value).length <= ADMIN_TITLE_MAX_CODE_POINTS
}

function isValidExpiresAt(value: unknown): boolean {
  if (typeof value !== 'string') return false
  if (value === '') return true
  const parsed = new Date(value)
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value
}

function isValidDownloadEnabled(value: unknown): value is '0' | '1' {
  return value === '0' || value === '1'
}

export async function parseUpdatePublicMetadataFields(
  c: AdminFormContext,
): Promise<{ albumId: string; title: string; expiresAt: string | null; downloadEnabled: 0 | 1 } | null> {
  const body = await parseForm(c)
  if (body === null || Object.keys(body).length !== 4) return null
  const albumId = body['albumId']
  const title = body['title']
  const expiresAt = body['expiresAt']
  const downloadEnabled = body['downloadEnabled']
  if (
    typeof albumId !== 'string' ||
    typeof title !== 'string' ||
    typeof expiresAt !== 'string' ||
    typeof downloadEnabled !== 'string'
  ) return null
  if (!isValidId(albumId) || !isValidTitle(title) || !isValidExpiresAt(expiresAt) || !isValidDownloadEnabled(downloadEnabled)) {
    return null
  }
  return {
    albumId,
    title,
    expiresAt: expiresAt === '' ? null : expiresAt,
    downloadEnabled: Number(downloadEnabled) as 0 | 1,
  }
}

function isValidPhotoprismUid(value: unknown): value is string {
  return typeof value === 'string' && /^[\x21-\x7e]{1,128}$/.test(value)
}

export async function parseCreateAlbumFields(
  c: AdminFormContext,
): Promise<{ albumId: string; title: string; photoprismAlbumUid: string; expiresAt: string | null; downloadEnabled: 0 | 1 } | null> {
  const body = await parseForm(c)
  if (body === null || Object.keys(body).length !== 5) return null
  const albumId = body['albumId']
  const title = body['title']
  const photoprismAlbumUid = body['photoprismAlbumUid']
  const expiresAt = body['expiresAt']
  const downloadEnabled = body['downloadEnabled']
  if (
    typeof albumId !== 'string' ||
    typeof title !== 'string' ||
    typeof photoprismAlbumUid !== 'string' ||
    typeof expiresAt !== 'string' ||
    typeof downloadEnabled !== 'string'
  ) return null
  if (
    !isValidId(albumId) ||
    !isValidTitle(title) ||
    !isValidPhotoprismUid(photoprismAlbumUid) ||
    !isValidExpiresAt(expiresAt) ||
    !isValidDownloadEnabled(downloadEnabled)
  ) return null
  return {
    albumId,
    title,
    photoprismAlbumUid,
    expiresAt: expiresAt === '' ? null : expiresAt,
    downloadEnabled: Number(downloadEnabled) as 0 | 1,
  }
}

export async function parseCreateUserFields(
  c: AdminFormContext,
): Promise<{ userId: string; displayName: string; password: string } | null> {
  const body = await parseForm(c)
  if (body === null || Object.keys(body).length !== 3) return null
  const userId = body['userId']
  const displayName = body['displayName']
  const password = body['password']
  if (typeof userId !== 'string' || typeof displayName !== 'string' || typeof password !== 'string') return null
  if (!isValidId(userId) || !isValidDisplayName(displayName) || !isValidPassword(password)) return null
  return { userId, displayName, password }
}

export async function parseResetPasswordFields(
  c: AdminFormContext,
): Promise<{ userId: string; password: string } | null> {
  const body = await parseForm(c)
  if (body === null || Object.keys(body).length !== 2) return null
  const userId = body['userId']
  const password = body['password']
  if (typeof userId !== 'string' || typeof password !== 'string') return null
  if (!isValidId(userId) || !isValidPassword(password)) return null
  return { userId, password }
}

export async function parseUpdateDisplayNameFields(
  c: AdminFormContext,
): Promise<{ userId: string; displayName: string } | null> {
  const body = await parseForm(c)
  if (body === null || Object.keys(body).length !== 2) return null
  const userId = body['userId']
  const displayName = body['displayName']
  if (typeof userId !== 'string' || typeof displayName !== 'string') return null
  if (!isValidId(userId) || !isValidDisplayName(displayName)) return null
  return { userId, displayName }
}

function isValidCatalogId(value: unknown): value is string {
  return typeof value === 'string' && CATALOG_ID_RE.test(value)
}

export async function parseSyncTargetUpsertFields(
  c: AdminFormContext,
): Promise<{ albumId: string; catalogId: string } | null> {
  const body = await parseForm(c)
  if (body === null || Object.keys(body).length !== 2) return null
  const albumId = body['albumId']
  const catalogId = body['catalogId']
  if (typeof albumId !== 'string' || typeof catalogId !== 'string') return null
  if (!isValidId(albumId) || !isValidCatalogId(catalogId)) return null
  return { albumId, catalogId }
}

export async function parseSyncTargetRemoveFields(
  c: AdminFormContext,
): Promise<{ albumId: string } | null> {
  return parseAlbumIdField(c)
}

export async function parseSyncRequestFields(
  c: AdminFormContext,
): Promise<{ kind: 'sync-now' } | null> {
  const body = await parseForm(c)
  if (body === null || Object.keys(body).length !== 1 || body['kind'] !== 'sync-now') return null
  return { kind: 'sync-now' }
}

export async function parseCatalogRefreshRequestFields(
  c: AdminFormContext,
): Promise<{ kind: 'publish-catalog' } | null> {
  const body = await parseForm(c)
  if (body === null || Object.keys(body).length !== 1 || body['kind'] !== 'publish-catalog') return null
  return { kind: 'publish-catalog' }
}
