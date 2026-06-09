import type { Manifest } from '../types/manifest.js'
import type { PrivateObjectBody, PrivateObjectReader } from '../types/private-object.js'
import {
  albumManifestKey,
  albumCoverKey,
  photoThumbKey,
  photoPreviewKey,
} from './r2-object-key.js'
import { parseManifest } from './manifest-validator.js'

export type ObjectLoadResult<T> =
  | { status: 'found'; value: T }
  | { status: 'not_found' }

/**
 * Sanitized error from an object-read or manifest-parse failure.
 * Messages and codes are generic; no album IDs, photo IDs, keys, bucket names,
 * or underlying exception text are exposed.
 */
export class ObjectServiceError extends Error {
  readonly code: 'reader_failure' | 'manifest_invalid'

  constructor(code: 'reader_failure' | 'manifest_invalid') {
    super(code === 'reader_failure' ? 'object read failed' : 'manifest invalid')
    this.name = 'ObjectServiceError'
    this.code = code
    Object.setPrototypeOf(this, ObjectServiceError.prototype)
  }
}

async function readObject(
  reader: PrivateObjectReader,
  key: string,
): Promise<PrivateObjectBody | null> {
  try {
    return await reader.get(key)
  } catch {
    throw new ObjectServiceError('reader_failure')
  }
}

function requireReadableBody(obj: PrivateObjectBody): ReadableStream {
  try {
    const body = obj.body
    if (!(body instanceof ReadableStream)) {
      throw new ObjectServiceError('reader_failure')
    }
    return body
  } catch (error) {
    if (error instanceof ObjectServiceError) throw error
    throw new ObjectServiceError('reader_failure')
  }
}

/**
 * Loads and validates the manifest for the given album.
 * Calls the reader exactly once.
 * Returns `not_found` if the manifest object is absent.
 * Throws ObjectServiceError('reader_failure') for any read or body-text failure.
 * Throws ObjectServiceError('manifest_invalid') if the manifest fails validation.
 * Never logs or exposes identifiers, keys, object contents, or internal error details.
 */
export async function loadAlbumManifest(
  reader: PrivateObjectReader,
  albumId: string,
): Promise<ObjectLoadResult<Manifest>> {
  let key: string
  try {
    key = albumManifestKey(albumId)
  } catch {
    throw new ObjectServiceError('reader_failure')
  }

  const obj = await readObject(reader, key)
  if (obj === null) return { status: 'not_found' }

  let text: string
  try {
    text = await obj.text()
  } catch {
    throw new ObjectServiceError('reader_failure')
  }

  try {
    const manifest = parseManifest(text, albumId)
    return { status: 'found', value: manifest }
  } catch {
    throw new ObjectServiceError('manifest_invalid')
  }
}

/**
 * Loads the cover image body for the given album.
 * Returns only the ReadableStream body; all stored metadata is discarded.
 * Returns `not_found` if the cover object is absent.
 * Throws ObjectServiceError('reader_failure') on any read failure.
 */
export async function loadAlbumCover(
  reader: PrivateObjectReader,
  albumId: string,
): Promise<ObjectLoadResult<ReadableStream>> {
  let key: string
  try {
    key = albumCoverKey(albumId)
  } catch {
    throw new ObjectServiceError('reader_failure')
  }

  const obj = await readObject(reader, key)
  if (obj === null) return { status: 'not_found' }

  return { status: 'found', value: requireReadableBody(obj) }
}

/**
 * Loads the thumbnail image body for the given photo.
 * Returns only the ReadableStream body; all stored metadata is discarded.
 * Returns `not_found` if the thumbnail object is absent.
 * Throws ObjectServiceError('reader_failure') on any read failure.
 */
export async function loadPhotoThumb(
  reader: PrivateObjectReader,
  albumId: string,
  photoId: string,
): Promise<ObjectLoadResult<ReadableStream>> {
  let key: string
  try {
    key = photoThumbKey(albumId, photoId)
  } catch {
    throw new ObjectServiceError('reader_failure')
  }

  const obj = await readObject(reader, key)
  if (obj === null) return { status: 'not_found' }

  return { status: 'found', value: requireReadableBody(obj) }
}

/**
 * Loads the preview image body for the given photo.
 * Returns only the ReadableStream body; all stored metadata is discarded.
 * Returns `not_found` if the preview object is absent.
 * Throws ObjectServiceError('reader_failure') on any read failure.
 */
export async function loadPhotoPreview(
  reader: PrivateObjectReader,
  albumId: string,
  photoId: string,
): Promise<ObjectLoadResult<ReadableStream>> {
  let key: string
  try {
    key = photoPreviewKey(albumId, photoId)
  } catch {
    throw new ObjectServiceError('reader_failure')
  }

  const obj = await readObject(reader, key)
  if (obj === null) return { status: 'not_found' }

  return { status: 'found', value: requireReadableBody(obj) }
}
