import { isValidId } from './safe-id.js'

function requireValidAlbumId(albumId: string): void {
  if (!isValidId(albumId)) throw new Error('invalid album ID')
}

function requireValidPhotoId(photoId: string): void {
  if (!isValidId(photoId)) throw new Error('invalid photo ID')
}

export function albumManifestKey(albumId: string): string {
  requireValidAlbumId(albumId)
  return `albums/${albumId}/manifest.json`
}

export function albumCoverKey(albumId: string): string {
  requireValidAlbumId(albumId)
  return `albums/${albumId}/cover.webp`
}

export function photoThumbKey(albumId: string, photoId: string): string {
  requireValidAlbumId(albumId)
  requireValidPhotoId(photoId)
  return `albums/${albumId}/thumbs/${photoId}.webp`
}

export function photoPreviewKey(albumId: string, photoId: string): string {
  requireValidAlbumId(albumId)
  requireValidPhotoId(photoId)
  return `albums/${albumId}/previews/${photoId}.jpg`
}

export function isStandardPrivateObjectKey(key: unknown): key is string {
  if (typeof key !== 'string') return false
  const segments = key.split('/')
  if (segments[0] !== 'albums') return false

  const albumId = segments[1]
  if (albumId === undefined || !isValidId(albumId)) return false

  if (segments.length === 3) {
    return segments[2] === 'manifest.json' || segments[2] === 'cover.webp'
  }

  if (segments.length !== 4) return false
  const filename = segments[3]
  if (filename === undefined) return false

  if (segments[2] === 'thumbs' && filename.endsWith('.webp')) {
    return isValidId(filename.slice(0, -'.webp'.length))
  }
  if (segments[2] === 'previews' && filename.endsWith('.jpg')) {
    return isValidId(filename.slice(0, -'.jpg'.length))
  }
  return false
}
