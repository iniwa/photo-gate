/** Compile-time contract matching docker/src/photo_gate/manifest.py schemaVersion 1. */

export interface ManifestImageSpec {
  longEdge: number
  format: string
  quality: number
}

export interface ManifestImages {
  thumb: ManifestImageSpec
  preview: ManifestImageSpec
  stripExif: boolean
}

export interface ManifestSource {
  type: 'photoprism'
  albumUid: string
}

export interface ManifestPhoto {
  id: string
  title: string
  /** Relative path within the album prefix, e.g. "thumbs/pp_abc001.webp" */
  thumb: string
  /** Relative path within the album prefix, e.g. "previews/pp_abc001.jpg" */
  preview: string
  /** ISO 8601 datetime string */
  takenAt: string
  width: number
  height: number
}

export interface Manifest {
  schemaVersion: 1
  albumId: string
  title: string
  source: ManifestSource
  /** ISO 8601 datetime string */
  generatedAt: string
  images: ManifestImages
  photos: ManifestPhoto[]
}
