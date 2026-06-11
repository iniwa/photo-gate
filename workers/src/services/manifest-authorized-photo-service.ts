import type { PrivateObjectReader } from '../types/private-object.js'
import { isValidId } from './safe-id.js'
import {
  loadAlbumManifest,
  loadPhotoThumb,
  loadPhotoPreview,
  ObjectServiceError,
  type ObjectLoadResult,
} from './private-album-object-service.js'

type PhotoObjectLoader = (
  reader: PrivateObjectReader,
  albumId: string,
  photoId: string,
) => Promise<ObjectLoadResult<ReadableStream>>

/**
 * Loads a photo object only after confirming exact membership in the album's
 * current validated manifest.
 *
 * Read order is fixed: the manifest is always read and validated first, and the
 * image object is read only after an exact `photo.id` match succeeds. This
 * prevents callers from probing arbitrary safe photo IDs under an authorized
 * album prefix and from reading stale or orphaned image objects that remain in
 * R2 after manifest updates.
 *
 * Reader call counts:
 * - invalid album/photo ID: zero reader calls, sanitized failure;
 * - missing manifest: exactly one reader call, `not_found`;
 * - photo not listed: exactly one reader call, `not_found` (the image key is
 *   never probed, so object existence is never revealed);
 * - photo listed: exactly two reader calls, manifest then the explicit image key.
 *
 * Manifest read/validation failures stop immediately; the image read is never
 * attempted. All failures use the existing sanitized ObjectServiceError behavior
 * and never expose identifiers, keys, manifest contents, or underlying errors.
 */
async function loadManifestAuthorizedPhotoObject(
  reader: PrivateObjectReader,
  albumId: string,
  photoId: string,
  loadPhotoObject: PhotoObjectLoader,
): Promise<ObjectLoadResult<ReadableStream>> {
  if (!isValidId(albumId) || !isValidId(photoId)) {
    throw new ObjectServiceError('reader_failure')
  }

  const manifestResult = await loadAlbumManifest(reader, albumId)
  if (manifestResult.status === 'not_found') return { status: 'not_found' }

  const listed = manifestResult.value.photos.some((photo) => photo.id === photoId)
  if (!listed) return { status: 'not_found' }

  return loadPhotoObject(reader, albumId, photoId)
}

/**
 * Loads the thumbnail for `photoId` only if it is listed by exact ID in the
 * album's current validated manifest. See loadManifestAuthorizedPhotoObject
 * for read order, call counts, and failure behavior.
 */
export async function loadManifestAuthorizedThumb(
  reader: PrivateObjectReader,
  albumId: string,
  photoId: string,
): Promise<ObjectLoadResult<ReadableStream>> {
  return loadManifestAuthorizedPhotoObject(reader, albumId, photoId, loadPhotoThumb)
}

/**
 * Loads the preview for `photoId` only if it is listed by exact ID in the
 * album's current validated manifest. See loadManifestAuthorizedPhotoObject
 * for read order, call counts, and failure behavior.
 */
export async function loadManifestAuthorizedPreview(
  reader: PrivateObjectReader,
  albumId: string,
  photoId: string,
): Promise<ObjectLoadResult<ReadableStream>> {
  return loadManifestAuthorizedPhotoObject(reader, albumId, photoId, loadPhotoPreview)
}
