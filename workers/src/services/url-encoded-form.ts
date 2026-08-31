/**
 * Bounded parser for application/x-www-form-urlencoded request bodies.
 *
 * Hono's generic parser is convenient, but these small admin and login forms
 * never accept files. Reading the raw stream here lets every mutation reject
 * an oversized body before allocating an unbounded string or object graph.
 */
export type UrlEncodedForm = Record<string, string | string[]>

function hasAllowedContentLength(request: Request, maxBytes: number): boolean {
  const contentLength = request.headers.get('Content-Length')
  if (contentLength === null) return true
  if (!/^\d+$/.test(contentLength)) return false

  const parsed = Number(contentLength)
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= maxBytes
}

function appendField(form: UrlEncodedForm, key: string, value: string): void {
  const existing = form[key]
  if (existing === undefined) {
    form[key] = value
  } else if (typeof existing === 'string') {
    form[key] = [existing, value]
  } else {
    existing.push(value)
  }
}

/**
 * Parses a small URL-encoded form while enforcing a byte ceiling on both the
 * declared Content-Length and the streamed body. Returns null for malformed,
 * oversized, or non-UTF-8 input; callers map that to their existing generic
 * bad-request response.
 */
export async function parseUrlEncodedForm(
  request: Request,
  maxBytes: number,
): Promise<UrlEncodedForm | null> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new Error('invalid form byte limit')
  }
  if (!hasAllowedContentLength(request, maxBytes)) return null
  if (request.body === null) return Object.create(null) as UrlEncodedForm

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!(value instanceof Uint8Array)) return null

      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        try {
          await reader.cancel()
        } catch {
          // The rejection result remains a generic malformed form either way.
        }
        return null
      }
      chunks.push(value)
    }
  } catch {
    return null
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)
  } catch {
    return null
  }

  const form = Object.create(null) as UrlEncodedForm
  try {
    for (const [key, value] of new URLSearchParams(text)) {
      appendField(form, key, value)
    }
  } catch {
    return null
  }
  return form
}
