import { describe, expect, it } from 'vitest'
import { parseUrlEncodedForm } from '../src/services/url-encoded-form.js'

function requestWithBody(
  chunks: Uint8Array[],
  headers: Record<string, string> = {},
): Request {
  let index = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index++]
      if (chunk === undefined) {
        controller.close()
      } else {
        controller.enqueue(chunk)
      }
    },
  })
  return { headers: new Headers(headers), body } as unknown as Request
}

describe('parseUrlEncodedForm', () => {
  it('parses a normal form and preserves repeated fields', async () => {
    const request = new Request('https://app.example/form', {
      method: 'POST',
      body: 'photoId=one&photoId=two&variant=preview',
    })
    await expect(parseUrlEncodedForm(request, 1024)).resolves.toEqual({
      photoId: ['one', 'two'],
      variant: 'preview',
    })
  })

  it('rejects an excessive declared Content-Length without reading the stream', async () => {
    let bodyAccessed = false
    const body = new ReadableStream<Uint8Array>()
    const request = {
      headers: new Headers({ 'Content-Length': '17' }),
    } as unknown as Request
    Object.defineProperty(request, 'body', {
      get() {
        bodyAccessed = true
        return body
      },
    })
    await expect(parseUrlEncodedForm(request, 16)).resolves.toBeNull()
    expect(bodyAccessed).toBe(false)
  })

  it('rejects a streamed body that exceeds the byte limit', async () => {
    const request = requestWithBody([
      new TextEncoder().encode('photoId=one&'),
      new TextEncoder().encode('variant=preview'),
    ])
    await expect(parseUrlEncodedForm(request, 16)).resolves.toBeNull()
  })

  it('rejects malformed declared Content-Length values', async () => {
    const request = requestWithBody([new TextEncoder().encode('a=b')], {
      'Content-Length': '3.5',
    })
    await expect(parseUrlEncodedForm(request, 16)).resolves.toBeNull()
  })

  it('rejects non-UTF-8 bytes rather than replacement-decoding them', async () => {
    const request = requestWithBody([new Uint8Array([0x61, 0x3d, 0xc3, 0x28])])
    await expect(parseUrlEncodedForm(request, 16)).resolves.toBeNull()
  })
})
