import type { ManifestPhoto } from '../types/manifest.js'

export interface PhotoDateGroup {
  dateKey: string | null
  heading: string
  photos: ManifestPhoto[]
}

function localDateKey(takenAt: unknown): string | null {
  if (typeof takenAt !== 'string') return null
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/.exec(takenAt)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  const offsetHour = match[8] === 'Z' ? 0 : Number(match[9])
  const offsetMinute = match[8] === 'Z' ? 0 : Number(match[10])
  if (year < 1 || month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) return null
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
  if (daysInMonth === undefined || day > daysInMonth) return null
  return `${match[1]}-${match[2]}-${match[3]}`
}

export function formatPhotoDateHeading(dateKey: string | null, includeYear = false): string {
  if (dateKey === null) return '日付不明'
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey)
  if (!match) return '日付不明'
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
  if (year < 1 || daysInMonth === undefined || day < 1 || day > daysInMonth) return '日付不明'
  const date = new Date(0)
  date.setUTCHours(0, 0, 0, 0)
  date.setUTCFullYear(year, month - 1, day)
  if (Number.isNaN(date.getTime())) return '日付不明'
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'UTC', month: 'long', day: 'numeric', weekday: 'short',
    ...(includeYear ? { year: 'numeric' as const } : {}),
  }).formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return includeYear
    ? `${get('year')}年${get('month')}月${get('day')}日（${get('weekday')}）`
    : `${get('month')}月${get('day')}日（${get('weekday')}）`
}

export function groupPhotosByDate(photos: ManifestPhoto[]): PhotoDateGroup[] {
  const years = new Set(
    photos.map((photo) => localDateKey(photo.takenAt)?.slice(0, 4)).filter(Boolean),
  )
  const includeYear = years.size > 1
  const groups: PhotoDateGroup[] = []
  for (const photo of photos) {
    const dateKey = localDateKey(photo.takenAt)
    const previous = groups[groups.length - 1]
    if (previous && previous.dateKey === dateKey) previous.photos.push(photo)
    else {
      groups.push({ dateKey, heading: formatPhotoDateHeading(dateKey, includeYear), photos: [photo] })
    }
  }
  return groups
}

export function aspectRatioClass(width: unknown, height: unknown): string {
  if (!validDimension(width) || !validDimension(height)) return 'ar-100'
  const value = Math.max(0.5, Math.min(2.4, Math.round((width / height) * 10) / 10))
  return `ar-${String(Math.round(value * 100)).padStart(3, '0')}`
}

export function validDimension(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && Number.isSafeInteger(value) && value > 0
}
