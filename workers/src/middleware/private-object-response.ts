/**
 * Response helpers for authenticated private image objects and object-route failures.
 *
 * Successful responses:
 * - Fixed Content-Type per kind (cover/thumb: image/webp; preview: image/jpeg)
 * - Cache-Control: private, no-store
 * - X-Content-Type-Options: nosniff
 *
 * No ETag, Last-Modified, Content-Length, Content-Disposition, stored cache headers,
 * stored content types, or any R2 object metadata are forwarded.
 *
 * Failure responses (404 / 500) are generic and never reveal identifiers, keys,
 * object type, storage provider, or internal error details.
 */

/** Allowlisted object kinds. Determines Content-Type; no other values are accepted. */
export type ImageKind = 'cover' | 'thumb' | 'preview'

const CONTENT_TYPE: Record<ImageKind, string> = {
  cover: 'image/webp',
  thumb: 'image/webp',
  preview: 'image/jpeg',
}

/**
 * Constructs a 200 response for an authenticated private image.
 * Content-Type is fixed by kind; the body is not buffered or inspected.
 */
export function privateImageResponse(
  body: ReadableStream,
  kind: ImageKind,
): Response {
  if (!(body instanceof ReadableStream) || !Object.hasOwn(CONTENT_TYPE, kind)) {
    throw new Error('invalid private image response')
  }
  try {
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': CONTENT_TYPE[kind],
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    throw new Error('invalid private image response')
  }
}

/** 404 response for an absent object. Generic body; no object details revealed. */
export function objectNotFoundResponse(): Response {
  return new Response('Not Found', {
    status: 404,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

/** 500 response for an internal read or manifest failure. Generic body; no details revealed. */
export function objectInternalErrorResponse(): Response {
  return new Response('Internal Server Error', {
    status: 500,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

/** Maximum character length of the title-derived base filename (before extension). */
const FILENAME_MAX_LEN = 100

function buildDownloadBase(rawTitle: string, photoId: string): string {
  const stripped = rawTitle
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[/\\:"*?<>|]/g, '')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/\s+/g, '_')
    .trim()
    .slice(0, FILENAME_MAX_LEN)
  if (stripped.length === 0) return photoId
  const suffix = `_${photoId}`
  if (suffix.length >= FILENAME_MAX_LEN) return photoId
  const titleMaxLen = Math.max(0, FILENAME_MAX_LEN - suffix.length)
  return `${stripped.slice(0, titleMaxLen)}${suffix}`.slice(0, FILENAME_MAX_LEN)
}

/**
 * Derives a safe ASCII `.jpg` filename for preview downloads.
 * Never includes album IDs, R2 keys, bucket names, PhotoPrism UIDs, or source hashes.
 */
export function buildDownloadFilename(rawTitle: string, photoId: string): string {
  return buildDownloadBase(rawTitle, photoId) + '.jpg'
}

/**
 * Derives a safe ASCII `.webp` filename for thumb downloads.
 * Never includes album IDs, R2 keys, bucket names, PhotoPrism UIDs, or source hashes.
 */
export function buildThumbDownloadFilename(rawTitle: string, photoId: string): string {
  return buildDownloadBase(rawTitle, photoId) + '.webp'
}

/**
 * Constructs a 200 attachment response for an authenticated private preview download.
 * Content-Type is fixed to image/jpeg. No R2 object metadata is forwarded.
 */
export function privateDownloadResponse(
  body: ReadableStream,
  filename: string,
): Response {
  if (!(body instanceof ReadableStream)) {
    throw new Error('invalid private download response')
  }
  try {
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    throw new Error('invalid private download response')
  }
}

/**
 * Constructs a 200 attachment response for an authenticated private thumb download.
 * Content-Type is fixed to image/webp. No R2 object metadata is forwarded.
 */
export function privateThumbDownloadResponse(
  body: ReadableStream,
  filename: string,
): Response {
  if (!(body instanceof ReadableStream)) {
    throw new Error('invalid private download response')
  }
  try {
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'image/webp',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    throw new Error('invalid private download response')
  }
}

/** 403 response when downloads are disabled or a race removes the album. Generic body. */
export function objectForbiddenResponse(): Response {
  return new Response('Forbidden', {
    status: 403,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
