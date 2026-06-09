/** Compile-time contract matching docker/src/photo_gate/manifest.py schemaVersion 1. */

export interface ManifestThumbSpec {
  longEdge: number
  format: 'webp'
  quality: number
}

export interface ManifestPreviewSpec {
  longEdge: number
  format: 'jpg'
  quality: number
}

export interface ManifestImages {
  thumb: ManifestThumbSpec
  preview: ManifestPreviewSpec
  /** Always true; EXIF must be stripped before R2 upload. */
  stripExif: true
}

export interface ManifestSource {
  type: 'photoprism'
  albumUid: string
}

export interface ManifestPhoto {
  id: string
  title: string
  /** "thumbs/{id}.webp", relative to album prefix */
  thumb: string
  /** "previews/{id}.jpg", relative to album prefix */
  preview: string
  /** Timezone-aware ISO 8601 datetime string */
  takenAt: string
  width: number
  height: number
}

export interface Manifest {
  schemaVersion: 1
  albumId: string
  title: string
  source: ManifestSource
  /** Timezone-aware ISO 8601 datetime string */
  generatedAt: string
  images: ManifestImages
  photos: ManifestPhoto[]
}
