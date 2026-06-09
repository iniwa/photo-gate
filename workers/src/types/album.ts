export interface AlbumSummary {
  id: string
  title: string
  photoCount: number
}

export interface PhotoSummary {
  id: string
  title: string
}

export interface AlbumDetail {
  id: string
  title: string
  photos: PhotoSummary[]
}
