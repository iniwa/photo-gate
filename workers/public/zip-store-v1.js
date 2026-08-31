// Minimal ZIP "store" writer for already-compressed WebP/JPEG derivatives.
// It intentionally performs no compression: that avoids a heavy browser CPU
// task and does not materially shrink image formats that are already compressed.

var UINT16_MAX = 0xffff
var UINT32_MAX = 0xffffffff
var ZIP_EPOCH_DATE = 33 // 1980-01-01 in the DOS date format.
var encoder = new TextEncoder()

var crcTable = (function () {
  var table = new Uint32Array(256)
  for (var index = 0; index < 256; index += 1) {
    var value = index
    for (var bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

function assertUint32(value, message) {
  if (!Number.isSafeInteger(value) || value < 0 || value > UINT32_MAX) {
    throw new Error(message)
  }
}

function writeUint16(bytes, offset, value) {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint16(offset, value, true)
}

function writeUint32(bytes, offset, value) {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value, true)
}

function checkedEntryName(name) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._ -]{0,239}$/.test(name)) {
    throw new Error('invalid ZIP entry name')
  }
  if (name === '.' || name === '..' || name.includes('..')) {
    throw new Error('invalid ZIP entry name')
  }
  var encoded = encoder.encode(name)
  if (encoded.byteLength === 0 || encoded.byteLength > UINT16_MAX) {
    throw new Error('invalid ZIP entry name')
  }
  return encoded
}

function checkedEntryData(data) {
  if (!(data instanceof Uint8Array)) throw new Error('invalid ZIP entry data')
  assertUint32(data.byteLength, 'ZIP entry is too large')
  return data
}

/** Returns the standard IEEE CRC-32 for one ZIP entry. */
export function crc32(data) {
  var bytes = checkedEntryData(data)
  var value = 0xffffffff
  for (var index = 0; index < bytes.byteLength; index += 1) {
    value = crcTable[(value ^ bytes[index]) & 0xff] ^ (value >>> 8)
  }
  return (value ^ 0xffffffff) >>> 0
}

/**
 * Builds a standards-compatible, uncompressed ZIP Blob. Entries must already
 * be bounded by the caller; ZIP64 is intentionally unsupported.
 */
export function createStoredZip(entries) {
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > UINT16_MAX) {
    throw new Error('invalid ZIP entries')
  }

  var localParts = []
  var centralParts = []
  var offset = 0

  entries.forEach(function (entry) {
    if (!entry || typeof entry !== 'object') throw new Error('invalid ZIP entry')
    var name = checkedEntryName(entry.name)
    var data = checkedEntryData(entry.data)
    var checksum = crc32(data)
    var localHeader = new Uint8Array(30)
    writeUint32(localHeader, 0, 0x04034b50)
    writeUint16(localHeader, 4, 20) // ZIP specification version 2.0
    writeUint16(localHeader, 6, 0) // flags: ASCII names, no data descriptor
    writeUint16(localHeader, 8, 0) // compression method: store
    writeUint16(localHeader, 10, 0) // fixed time: 00:00
    writeUint16(localHeader, 12, ZIP_EPOCH_DATE)
    writeUint32(localHeader, 14, checksum)
    writeUint32(localHeader, 18, data.byteLength)
    writeUint32(localHeader, 22, data.byteLength)
    writeUint16(localHeader, 26, name.byteLength)
    writeUint16(localHeader, 28, 0)

    assertUint32(offset, 'ZIP archive is too large')
    var localOffset = offset
    offset += localHeader.byteLength + name.byteLength + data.byteLength
    assertUint32(offset, 'ZIP archive is too large')
    localParts.push(localHeader, name, data)

    var centralHeader = new Uint8Array(46)
    writeUint32(centralHeader, 0, 0x02014b50)
    writeUint16(centralHeader, 4, 20) // made by: DOS / ZIP 2.0
    writeUint16(centralHeader, 6, 20)
    writeUint16(centralHeader, 8, 0)
    writeUint16(centralHeader, 10, 0)
    writeUint16(centralHeader, 12, 0)
    writeUint16(centralHeader, 14, ZIP_EPOCH_DATE)
    writeUint32(centralHeader, 16, checksum)
    writeUint32(centralHeader, 20, data.byteLength)
    writeUint32(centralHeader, 24, data.byteLength)
    writeUint16(centralHeader, 28, name.byteLength)
    writeUint16(centralHeader, 30, 0)
    writeUint16(centralHeader, 32, 0)
    writeUint16(centralHeader, 34, 0)
    writeUint16(centralHeader, 36, 0)
    writeUint32(centralHeader, 38, 0)
    writeUint32(centralHeader, 42, localOffset)
    centralParts.push(centralHeader, name)
  })

  var centralOffset = offset
  var centralSize = centralParts.reduce(function (total, part) {
    return total + part.byteLength
  }, 0)
  assertUint32(centralOffset, 'ZIP archive is too large')
  assertUint32(centralSize, 'ZIP archive is too large')

  var end = new Uint8Array(22)
  writeUint32(end, 0, 0x06054b50)
  writeUint16(end, 4, 0)
  writeUint16(end, 6, 0)
  writeUint16(end, 8, entries.length)
  writeUint16(end, 10, entries.length)
  writeUint32(end, 12, centralSize)
  writeUint32(end, 16, centralOffset)
  writeUint16(end, 20, 0)

  return new Blob(localParts.concat(centralParts, [end]), { type: 'application/zip' })
}

/**
 * Reads a successful derivative response without trusting Content-Length. The
 * caller receives a bounded Uint8Array and can enforce an archive-wide limit.
 */
export async function readResponseBytes(response, maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('invalid download limit')
  if (!response || !(response.body instanceof ReadableStream)) {
    throw new Error('download response has no body')
  }

  var reader = response.body.getReader()
  var chunks = []
  var total = 0
  try {
    while (true) {
      var step = await reader.read()
      if (step.done) break
      if (!(step.value instanceof Uint8Array)) throw new Error('invalid download response')
      total += step.value.byteLength
      if (total > maxBytes) {
        try {
          await reader.cancel()
        } catch (_) {
          // The caller receives the same bounded-size failure either way.
        }
        throw new Error('download exceeds size limit')
      }
      chunks.push(step.value)
    }
  } finally {
    reader.releaseLock()
  }

  var result = new Uint8Array(total)
  var offset = 0
  chunks.forEach(function (chunk) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  })
  return result
}

/**
 * Returns a safe filename from the server's fixed attachment header, or a
 * deterministic ordinal fallback. The generated server header is already
 * ASCII-only; this second validation keeps ZIP paths flat and non-sensitive.
 */
export function zipEntryFilename(contentDisposition, ordinal, extension) {
  if (!Number.isSafeInteger(ordinal) || ordinal < 1) throw new Error('invalid ZIP entry ordinal')
  if (extension !== '.webp' && extension !== '.jpg') throw new Error('invalid ZIP extension')

  var match = typeof contentDisposition === 'string'
    ? /^attachment;\s*filename="([A-Za-z0-9][A-Za-z0-9._ -]{0,239})"$/i.exec(contentDisposition)
    : null
  if (match && match[1] && match[1].toLowerCase().endsWith(extension)) {
    return match[1]
  }
  return `photo-${String(ordinal).padStart(3, '0')}${extension}`
}

/** Ensures header-derived names cannot collide inside one archive. */
export function uniqueZipEntryFilename(name, usedNames) {
  if (!(usedNames instanceof Set)) throw new Error('invalid ZIP name set')
  if (!usedNames.has(name)) {
    usedNames.add(name)
    return name
  }
  var lastDot = name.lastIndexOf('.')
  var stem = lastDot > 0 ? name.slice(0, lastDot) : name
  var extension = lastDot > 0 ? name.slice(lastDot) : ''
  for (var suffix = 2; suffix <= UINT16_MAX; suffix += 1) {
    var suffixText = `-${suffix}`
    var maxStemLength = 240 - extension.length - suffixText.length
    var candidate = `${stem.slice(0, Math.max(1, maxStemLength))}${suffixText}${extension}`
    if (!usedNames.has(candidate)) {
      usedNames.add(candidate)
      return candidate
    }
  }
  throw new Error('too many ZIP filename collisions')
}
