import { describe, expect, it } from 'vitest'
import {
  crc32,
  createStoredZip,
  readResponseBytes,
  uniqueZipEntryFilename,
  zipEntryFilename,
} from '../public/zip-store-v1.js'

function uint16(bytes, offset) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true)
}

function uint32(bytes, offset) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true)
}

describe('client ZIP store writer', () => {
  it('writes a standards-compatible uncompressed archive with deterministic entry metadata', async () => {
    const first = new TextEncoder().encode('hello')
    const second = new Uint8Array([0, 1, 2])
    const archive = new Uint8Array(await createStoredZip([
      { name: 'first.jpg', data: first },
      { name: 'second.webp', data: second },
    ]).arrayBuffer())

    expect(uint32(archive, 0)).toBe(0x04034b50)
    expect(uint16(archive, 8)).toBe(0)
    expect(uint16(archive, 12)).toBe(33)
    expect(uint32(archive, 14)).toBe(0x3610a686)
    expect(new TextDecoder().decode(archive.slice(30, 39))).toBe('first.jpg')
    expect(new TextDecoder().decode(archive.slice(39, 44))).toBe('hello')

    const endOffset = archive.byteLength - 22
    expect(uint32(archive, endOffset)).toBe(0x06054b50)
    expect(uint16(archive, endOffset + 8)).toBe(2)
    const centralOffset = uint32(archive, endOffset + 16)
    expect(uint32(archive, centralOffset)).toBe(0x02014b50)
    expect(uint32(archive, centralOffset + 42)).toBe(0)
  })

  it('calculates CRC-32 and rejects unsafe entry paths', () => {
    expect(crc32(new TextEncoder().encode('hello'))).toBe(0x3610a686)
    expect(() => createStoredZip([{ name: '../private.jpg', data: new Uint8Array([1]) }]))
      .toThrow('invalid ZIP entry name')
  })

  it('reads a response body only up to the caller-provided byte ceiling', async () => {
    const withinLimit = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]))
        controller.enqueue(new Uint8Array([3]))
        controller.close()
      },
    }))
    await expect(readResponseBytes(withinLimit, 3)).resolves.toEqual(new Uint8Array([1, 2, 3]))

    const overLimit = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]))
        controller.enqueue(new Uint8Array([3, 4]))
        controller.close()
      },
    }))
    await expect(readResponseBytes(overLimit, 3)).rejects.toThrow('download exceeds size limit')
  })

  it('uses the validated attachment filename or a deterministic flat fallback', () => {
    expect(zipEntryFilename('attachment; filename="Sunset_photo-1.jpg"', 1, '.jpg'))
      .toBe('Sunset_photo-1.jpg')
    expect(zipEntryFilename('attachment; filename="../source.jpg"', 2, '.jpg'))
      .toBe('photo-002.jpg')

    const used = new Set()
    expect(uniqueZipEntryFilename('photo.jpg', used)).toBe('photo.jpg')
    expect(uniqueZipEntryFilename('photo.jpg', used)).toBe('photo-2.jpg')

    const maximumLengthName = `${'a'.repeat(236)}.jpg`
    const maximumLengthUsed = new Set()
    expect(uniqueZipEntryFilename(maximumLengthName, maximumLengthUsed)).toBe(maximumLengthName)
    expect(uniqueZipEntryFilename(maximumLengthName, maximumLengthUsed)).toHaveLength(240)
  })
})
