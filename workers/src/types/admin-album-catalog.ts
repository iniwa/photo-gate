export interface AdminAlbumCatalogEntry {
  catalogId: string
  title: string
  photoCount: number | null
  updatedAt: string | null
}

export interface AdminAlbumCatalog {
  schema: 1
  publishedAt: string
  albums: AdminAlbumCatalogEntry[]
}
