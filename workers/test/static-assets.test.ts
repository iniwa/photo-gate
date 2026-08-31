import { describe, expect, it } from 'vitest'
// @ts-expect-error Node test runtime module types are intentionally not part of Workers tsconfig.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('static asset headers', () => {
  it('keeps the rollback and active assets while removing the retired stylesheet', () => {
    const headers = readFileSync(resolve(process.cwd(), 'public/_headers'), 'utf8').replace(/\r\n/g, '\n')
    expect(headers).toBe(`/styles-v2.css
  Cache-Control: public, max-age=31536000, immutable
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer

/styles-v3.css
  Cache-Control: public, max-age=31536000, immutable
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer

/app.js
  Cache-Control: public, max-age=31536000, immutable
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer

/batch-download-v1.js
  Cache-Control: public, max-age=31536000, immutable
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer

/zip-store-v1.js
  Cache-Control: public, max-age=31536000, immutable
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
`)
    expect(headers).not.toContain('/styles.css')
    expect(existsSync(resolve(process.cwd(), 'public/styles.css'))).toBe(false)
  })

  it('serves versioned client-side ZIP assets without changing the legacy app asset', () => {
    const batch = readFileSync(resolve(process.cwd(), 'public/batch-download-v1.js'), 'utf8')
    const zip = readFileSync(resolve(process.cwd(), 'public/zip-store-v1.js'), 'utf8')
    expect(batch).toContain("from '/zip-store-v1.js'")
    expect(batch).toContain('MAX_FILES = 20')
    expect(batch).toContain('MAX_ARCHIVE_BYTES = 100 * 1024 * 1024')
    expect(batch).toContain("if (remaining < 1) throw new Error('archive size limit reached')")
    expect(batch).not.toContain('/raw/')
    expect(zip).toContain('createStoredZip')
    expect(zip).toContain("type: 'application/zip'")
  })

  it('keeps the enhanced selection bar usable on narrow screens', () => {
    const css = readFileSync(resolve(process.cwd(), 'public/styles-v3.css'), 'utf8').replace(/\r\n/g, '\n')
    expect(css).toContain('.selection-bar {\n  display: flex;')
    expect(css).toContain('flex-wrap: wrap;')
    expect(css).toContain('.selection-form:has(input[name=\'photoId\']:checked) .selection-bar {\n      display: grid;')
    expect(css).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));')
  })

  it('defines the CSS-only justified timeline contract', () => {
    const css = readFileSync(resolve(process.cwd(), 'public/styles-v3.css'), 'utf8')
    expect(css).toContain('.justified-grid { display: flex; flex-wrap: wrap;')
    expect(css).toContain(".justified-grid::after { content: ''; flex-grow: 999999; flex-basis: 0; }")
    expect(css).toContain('flex-grow: var(--ar, 100);')
    expect(css).toContain('flex-basis: calc(var(--ar, 100) * 1.4px);')
    expect(css).toContain('object-fit: contain')
    expect(css).not.toContain('style=')
    for (let index = 50; index <= 240; index += 10) {
      expect(css).toContain(`.ar-${String(index).padStart(3, '0')}`)
    }
  })

  it('defines first-class admin styling without the retired compatibility block', () => {
    const css = readFileSync(resolve(process.cwd(), 'public/styles-v3.css'), 'utf8')
    expect(css).toContain('.admin-main')
    expect(css).toContain('.admin-area-chip')
    expect(css).toContain('.admin-table-scroll')
    expect(css).toContain('.admin-danger-panel')
    expect(css).not.toContain('LEGACY COMPAT')
    expect(css).not.toContain('.user-table')
  })
})
