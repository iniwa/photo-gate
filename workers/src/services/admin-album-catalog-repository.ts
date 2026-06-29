import type { AdminAlbumCatalogEntry } from '../types/admin-album-catalog.js'

export const CATALOG_KEY = 'ops/album-catalog.json'

const MAX_CATALOG_SIZE = 256 * 1024
const MAX_CATALOG_ALBUMS = 1000
const CATALOG_ID_RE = /^[0-9a-f]{64}$/
const DOCKER_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
const TITLE_MAX_CODE_POINTS = 1024
const EXPECTED_ROOT_KEYS = new Set(['schema', 'publishedAt', 'albums'])
const EXPECTED_ENTRY_KEYS = new Set(['catalogId', 'title', 'photoCount', 'updatedAt'])

function isDockerTs(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (!DOCKER_TS_RE.test(value)) return false
  const parsed = new Date(value)
  if (Number.isNaN(parsed.valueOf())) return false
  return parsed.toISOString() === value.slice(0, -1) + '.000Z'
}

function isValidCatalogId(value: unknown): value is string {
  return typeof value === 'string' && CATALOG_ID_RE.test(value)
}

function isSafeTitle(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (value.length === 0) return false
  if (/^\s|\s$/.test(value)) return false
  if (/[\x00-\x1f\x7f]/.test(value)) return false
  if (Array.from(value).length > TITLE_MAX_CODE_POINTS) return false
  return true
}

function isSafeNonNegativeInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
}

function parseEntry(obj: unknown): AdminAlbumCatalogEntry | null {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return null
  const t = obj as Record<string, unknown>
  const keys = Object.keys(t)
  if (keys.length !== 4) return null
  for (const k of keys) {
    if (!EXPECTED_ENTRY_KEYS.has(k)) return null
  }

  if (!isValidCatalogId(t['catalogId'])) return null
  if (!isSafeTitle(t['title'])) return null

  const photoCount = t['photoCount']
  if (photoCount !== null && !isSafeNonNegativeInt(photoCount)) return null

  const updatedAt = t['updatedAt']
  if (updatedAt !== null && !isDockerTs(updatedAt)) return null

  return {
    catalogId: t['catalogId'] as string,
    title: t['title'] as string,
    photoCount: photoCount as number | null,
    updatedAt: updatedAt as string | null,
  }
}

function parseCatalog(parsed: unknown): { publishedAt: string; albums: AdminAlbumCatalogEntry[] } | null {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const root = parsed as Record<string, unknown>
  const keys = Object.keys(root)
  if (keys.length !== 3) return null
  for (const k of keys) {
    if (!EXPECTED_ROOT_KEYS.has(k)) return null
  }
  if (root['schema'] !== 1) return null
  if (!isDockerTs(root['publishedAt'])) return null

  const albums = root['albums']
  if (!Array.isArray(albums)) return null
  if (albums.length > MAX_CATALOG_ALBUMS) return null

  const result: AdminAlbumCatalogEntry[] = []
  const seenCatalogIds = new Set<string>()

  for (const a of albums) {
    const entry = parseEntry(a)
    if (entry === null) return null
    if (seenCatalogIds.has(entry.catalogId)) return null
    seenCatalogIds.add(entry.catalogId)
    result.push(entry)
  }

  return { publishedAt: root['publishedAt'] as string, albums: result }
}

function catalogReadError(): Error {
  return new Error('album catalog read failed')
}

export class AdminAlbumCatalogRepository {
  readonly #bucket: R2Bucket

  constructor(bucket: R2Bucket) {
    this.#bucket = bucket
  }

  async #readCatalog(): Promise<
    | { status: 'missing' }
    | { status: 'available'; publishedAt: string; albums: AdminAlbumCatalogEntry[] }
  > {
    let object: R2ObjectBody | null
    try {
      object = await this.#bucket.get(CATALOG_KEY)
    } catch {
      throw catalogReadError()
    }
    if (object === null) return { status: 'missing' }
    if (object.size !== undefined && object.size > MAX_CATALOG_SIZE) {
      throw catalogReadError()
    }

    let text: string
    try {
      text = await object.text()
    } catch {
      throw catalogReadError()
    }

    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      throw catalogReadError()
    }

    const result = parseCatalog(json)
    if (result === null) throw catalogReadError()

    return { status: 'available', publishedAt: result.publishedAt, albums: result.albums }
  }

  async getCatalog(): Promise<
    | { status: 'missing' }
    | { status: 'available'; publishedAt: string; albums: AdminAlbumCatalogEntry[] }
  > {
    return this.#readCatalog()
  }

  async hasCatalogId(catalogId: string): Promise<boolean> {
    const result = await this.#readCatalog()
    if (result.status === 'missing') throw catalogReadError()
    return result.albums.some(a => a.catalogId === catalogId)
  }
}
