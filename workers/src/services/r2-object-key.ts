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
