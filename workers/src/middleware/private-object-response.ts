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
