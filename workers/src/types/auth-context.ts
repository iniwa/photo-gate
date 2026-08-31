import type { AuthorizedAlbumSummary } from './authorized-album.js'

export interface AuthVariables {
  userId: string
  /** Present only after the combined viewer session-and-album guard succeeds. */
  authorizedAlbum?: AuthorizedAlbumSummary
}
