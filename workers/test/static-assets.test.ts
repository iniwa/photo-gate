import { describe, expect, it } from 'vitest'
// @ts-expect-error Node test runtime module types are intentionally not part of Workers tsconfig.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('static asset headers', () => {
  it('keeps immutable v3 stylesheet entry and dynamic security block', () => {
    const headers = readFileSync(resolve(process.cwd(), 'public/_headers'), 'utf8').replace(/\r\n/g, '\n')
    expect(headers).toBe(`/styles.css
  Cache-Control: public, max-age=31536000, immutable
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer

/styles-v2.css
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
`)
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
})
