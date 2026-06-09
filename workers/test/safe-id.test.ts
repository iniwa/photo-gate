import { describe, it, expect } from 'vitest'
import { isValidId } from '../src/services/safe-id.js'

describe('isValidId valid identifiers', () => {
  it('accepts a single alphanumeric character', () => {
    expect(isValidId('a')).toBe(true)
  })

  it('accepts uppercase alphanumeric start', () => {
    expect(isValidId('A')).toBe(true)
  })

  it('accepts digits after the first character', () => {
    expect(isValidId('a0')).toBe(true)
  })

  it('accepts hyphens and underscores after the first character', () => {
    expect(isValidId('album-id_001')).toBe(true)
  })

  it('accepts photo UIDs with mixed case and underscores', () => {
    expect(isValidId('pp_abc001')).toBe(true)
  })

  it('accepts typical album ID', () => {
    expect(isValidId('family-trip-2026')).toBe(true)
  })

  it('accepts typical photoprism album UID', () => {
    expect(isValidId('as6g7xxxxxxx')).toBe(true)
  })

  it('accepts exactly 1 character (minimum length)', () => {
    expect(isValidId('z')).toBe(true)
  })

  it('accepts exactly 128 characters (maximum length)', () => {
    const id = 'a' + 'b'.repeat(127)
    expect(isValidId(id)).toBe(true)
  })

  it('accepts all-digit ID starting with a digit', () => {
    expect(isValidId('123')).toBe(true)
  })
})

describe('isValidId invalid identifiers', () => {
  it('rejects empty string', () => {
    expect(isValidId('')).toBe(false)
  })

  it('rejects ID starting with underscore', () => {
    expect(isValidId('_abc')).toBe(false)
  })

  it('rejects ID starting with hyphen', () => {
    expect(isValidId('-abc')).toBe(false)
  })

  it('rejects ID with spaces', () => {
    expect(isValidId('abc def')).toBe(false)
  })

  it('rejects ID with dot', () => {
    expect(isValidId('abc.def')).toBe(false)
  })

  it('rejects ID with slash', () => {
    expect(isValidId('abc/def')).toBe(false)
  })

  it('rejects ID with null byte', () => {
    expect(isValidId('abc\x00')).toBe(false)
  })

  it('rejects ID with special characters', () => {
    expect(isValidId('!bad!')).toBe(false)
  })

  it('rejects path traversal', () => {
    expect(isValidId('../etc')).toBe(false)
  })

  it('rejects 129 characters (over maximum length)', () => {
    const id = 'a' + 'b'.repeat(128)
    expect(isValidId(id)).toBe(false)
  })

  it('rejects unicode characters outside ASCII', () => {
    expect(isValidId('café')).toBe(false)
  })

  it('rejects non-string values without coercion', () => {
    expect(isValidId(123)).toBe(false)
    expect(isValidId(null)).toBe(false)
    expect(isValidId({ toString: () => 'valid-id' })).toBe(false)
  })
})

describe('isValidId shared safe-ID contract', () => {
  it('accepts values that repositories accept as user/album IDs', () => {
    expect(isValidId('user-abc-123')).toBe(true)
    expect(isValidId('album-xyz-456')).toBe(true)
  })

  it('rejects values that repositories reject', () => {
    expect(isValidId('!invalid!')).toBe(false)
    expect(isValidId('')).toBe(false)
  })
})
