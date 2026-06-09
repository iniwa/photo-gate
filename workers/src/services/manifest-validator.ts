import type { Manifest, ManifestPhoto } from '../types/manifest.js'
import { isValidId } from './safe-id.js'

/** Defensive parser limits, not product or synchronization limits. */
export const MANIFEST_LIMITS = {
  /** Maximum input JSON UTF-8 byte length. */
  MAX_JSON_BYTES: 8 * 1024 * 1024,
  /** Maximum number of photos in a single manifest. */
  MAX_PHOTOS: 20_000,
  /** Maximum photo and album title length in Unicode code points. */
  MAX_TITLE_CODE_POINTS: 1_024,
  /** Maximum pixel dimension (width or height) per photo. */
  MAX_DIMENSION: 100_000,
  /** Maximum long-edge value for thumb and preview image specs. */
  MAX_LONG_EDGE: 100_000,
} as const

function fail(): never {
  throw new Error('invalid manifest')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(obj: Record<string, unknown>, expected: readonly string[]): void {
  const keys = Object.keys(obj)
  if (keys.length !== expected.length) fail()
  for (const key of expected) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) fail()
  }
}

// Matches timezone-aware ISO 8601 datetimes as produced by Python's datetime.isoformat().
// Accepts Z, +HH:MM, or -HH:MM timezone indicators. Fractional seconds are optional.
const ISO8601_TZ = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/

function isTimezoneAwareIso8601(value: string): boolean {
  const match = ISO8601_TZ.exec(value)
  if (match === null) return false

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  const offsetHour = match[8] === 'Z' ? 0 : Number(match[10])
  const offsetMinute = match[8] === 'Z' ? 0 : Number(match[11])

  if (year < 1 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) {
    return false
  }
  if (offsetHour > 23 || offsetMinute > 59) return false

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return day >= 1 && day <= daysInMonth
}

/**
 * Parses a raw JSON string from R2 and validates it against the schemaVersion 1
 * manifest contract produced by the Docker sync service.
 *
 * The `expectedAlbumId` must match `manifest.albumId` exactly; this prevents
 * serving one album's manifest in response to another album's request.
 *
 * All validation errors throw Error('invalid manifest'). No input values,
 * album IDs, photo IDs, titles, paths, or JSON content are included in errors.
 *
 * Returns a freshly constructed Manifest object. The raw parsed input is never
 * returned or mutated.
 */
export function parseManifest(json: string, expectedAlbumId: string): Manifest {
  if (!isValidId(expectedAlbumId)) fail()
  if (new TextEncoder().encode(json).byteLength > MANIFEST_LIMITS.MAX_JSON_BYTES) fail()

  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    fail()
  }

  if (!isRecord(raw)) fail()

  exactKeys(raw, ['schemaVersion', 'albumId', 'title', 'source', 'generatedAt', 'images', 'photos'])

  const schemaVersion = raw['schemaVersion']
  if (schemaVersion !== 1) fail()

  const albumId = raw['albumId']
  if (typeof albumId !== 'string' || !isValidId(albumId)) fail()
  if (albumId !== expectedAlbumId) fail()

  const title = raw['title']
  if (typeof title !== 'string') fail()
  if ([...title].length > MANIFEST_LIMITS.MAX_TITLE_CODE_POINTS) fail()

  const rawSource = raw['source']
  if (!isRecord(rawSource)) fail()
  exactKeys(rawSource, ['type', 'albumUid'])
  const sourceType = rawSource['type']
  if (sourceType !== 'photoprism') fail()
  const sourceAlbumUid = rawSource['albumUid']
  if (typeof sourceAlbumUid !== 'string' || !isValidId(sourceAlbumUid)) fail()

  const generatedAt = raw['generatedAt']
  if (typeof generatedAt !== 'string') fail()
  if (!isTimezoneAwareIso8601(generatedAt)) fail()

  const rawImages = raw['images']
  if (!isRecord(rawImages)) fail()
  exactKeys(rawImages, ['thumb', 'preview', 'stripExif'])

  const stripExif = rawImages['stripExif']
  if (stripExif !== true) fail()

  const rawThumb = rawImages['thumb']
  if (!isRecord(rawThumb)) fail()
  exactKeys(rawThumb, ['longEdge', 'format', 'quality'])
  const thumbFormat = rawThumb['format']
  if (thumbFormat !== 'webp') fail()
  const thumbLongEdge = rawThumb['longEdge']
  if (
    typeof thumbLongEdge !== 'number' ||
    !Number.isInteger(thumbLongEdge) ||
    thumbLongEdge < 1 ||
    thumbLongEdge > MANIFEST_LIMITS.MAX_LONG_EDGE
  ) fail()
  const thumbQuality = rawThumb['quality']
  if (
    typeof thumbQuality !== 'number' ||
    !Number.isInteger(thumbQuality) ||
    thumbQuality < 1 ||
    thumbQuality > 100
  ) fail()

  const rawPreview = rawImages['preview']
  if (!isRecord(rawPreview)) fail()
  exactKeys(rawPreview, ['longEdge', 'format', 'quality'])
  const previewFormat = rawPreview['format']
  if (previewFormat !== 'jpg') fail()
  const previewLongEdge = rawPreview['longEdge']
  if (
    typeof previewLongEdge !== 'number' ||
    !Number.isInteger(previewLongEdge) ||
    previewLongEdge < 1 ||
    previewLongEdge > MANIFEST_LIMITS.MAX_LONG_EDGE
  ) fail()
  const previewQuality = rawPreview['quality']
  if (
    typeof previewQuality !== 'number' ||
    !Number.isInteger(previewQuality) ||
    previewQuality < 1 ||
    previewQuality > 100
  ) fail()

  const rawPhotos = raw['photos']
  if (!Array.isArray(rawPhotos)) fail()
  if (rawPhotos.length > MANIFEST_LIMITS.MAX_PHOTOS) fail()

  const seenIds = new Set<string>()
  const validatedPhotos: ManifestPhoto[] = []

  for (const rawPhoto of rawPhotos) {
    if (!isRecord(rawPhoto)) fail()
    exactKeys(rawPhoto, ['id', 'title', 'thumb', 'preview', 'takenAt', 'width', 'height'])

    const photoId = rawPhoto['id']
    if (typeof photoId !== 'string' || !isValidId(photoId)) fail()
    if (seenIds.has(photoId)) fail()
    seenIds.add(photoId)

    const photoTitle = rawPhoto['title']
    if (typeof photoTitle !== 'string') fail()
    if ([...photoTitle].length > MANIFEST_LIMITS.MAX_TITLE_CODE_POINTS) fail()

    const thumbPath = rawPhoto['thumb']
    if (typeof thumbPath !== 'string') fail()
    if (thumbPath !== `thumbs/${photoId}.webp`) fail()

    const previewPath = rawPhoto['preview']
    if (typeof previewPath !== 'string') fail()
    if (previewPath !== `previews/${photoId}.jpg`) fail()

    const takenAt = rawPhoto['takenAt']
    if (typeof takenAt !== 'string') fail()
    if (!isTimezoneAwareIso8601(takenAt)) fail()

    const width = rawPhoto['width']
    if (
      typeof width !== 'number' ||
      !Number.isInteger(width) ||
      width < 1 ||
      width > MANIFEST_LIMITS.MAX_DIMENSION
    ) fail()

    const height = rawPhoto['height']
    if (
      typeof height !== 'number' ||
      !Number.isInteger(height) ||
      height < 1 ||
      height > MANIFEST_LIMITS.MAX_DIMENSION
    ) fail()

    validatedPhotos.push({ id: photoId, title: photoTitle, thumb: thumbPath, preview: previewPath, takenAt, width, height })
  }

  return {
    schemaVersion: 1,
    albumId,
    title,
    source: { type: 'photoprism', albumUid: sourceAlbumUid },
    generatedAt,
    images: {
      thumb: { longEdge: thumbLongEdge, format: 'webp', quality: thumbQuality },
      preview: { longEdge: previewLongEdge, format: 'jpg', quality: previewQuality },
      stripExif: true,
    },
    photos: validatedPhotos,
  }
}
