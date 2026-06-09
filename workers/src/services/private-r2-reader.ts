import type { PrivateObjectBody, PrivateObjectReader } from '../types/private-object.js'
import { isStandardPrivateObjectKey } from './r2-object-key.js'

export class PrivateR2ReaderError extends Error {
  constructor() {
    super('private object read failed')
    this.name = 'PrivateR2ReaderError'
    Object.setPrototypeOf(this, PrivateR2ReaderError.prototype)
  }
}

function readerError(): PrivateR2ReaderError {
  return new PrivateR2ReaderError()
}

export class PrivateR2Reader implements PrivateObjectReader {
  readonly #bucket: R2Bucket

  constructor(bucket: R2Bucket) {
    this.#bucket = bucket
  }

  async get(key: string): Promise<PrivateObjectBody | null> {
    if (!isStandardPrivateObjectKey(key)) throw readerError()

    let object: R2ObjectBody | null
    try {
      object = await this.#bucket.get(key)
    } catch {
      throw readerError()
    }
    if (object === null) return null

    let body: ReadableStream
    let readText: () => Promise<string>
    try {
      if (!(object.body instanceof ReadableStream) || typeof object.text !== 'function') {
        throw readerError()
      }
      body = object.body
      readText = object.text.bind(object)
    } catch {
      throw readerError()
    }

    return {
      body,
      text: async (): Promise<string> => {
        try {
          const text = await readText()
          if (typeof text !== 'string') throw readerError()
          return text
        } catch {
          throw readerError()
        }
      },
    }
  }
}
