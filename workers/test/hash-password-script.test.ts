import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { verifyPassword } from '../src/services/auth-crypto.js'

// Resolve the script path relative to this test file's directory.
// __dirname is not available in ESM; use import.meta.url instead.
const scriptPath = resolve(new URL('../scripts/hash-password.mjs', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'))

function runScript(input: string): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync('node', [scriptPath], {
    input,
    encoding: 'utf8',
    // Do not inherit env — use process.env so PATH is available on all platforms
    env: process.env,
    timeout: 30_000,
  })
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status,
  }
}

describe('hash-password.mjs', () => {
  it('produces a parseable hash that verifies with the correct password', async () => {
    const password = 'correct-horse-battery-staple'
    const result = runScript(`${password}\n`)

    expect(result.status).toBe(0)

    const hash = result.stdout.trim()
    expect(hash).toMatch(/^pbkdf2-sha256\$100000\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/)

    const verified = await verifyPassword(password, hash)
    expect(verified).toBe(true)
  })

  it('produces a hash that does NOT verify with the wrong password', async () => {
    const password = 'correct-horse-battery-staple'
    const result = runScript(`${password}\n`)

    expect(result.status).toBe(0)

    const hash = result.stdout.trim()
    const verified = await verifyPassword('wrong-password', hash)
    expect(verified).toBe(false)
  })

  it('uses exactly 100000 iterations in the encoded hash', () => {
    const result = runScript('a-valid-password\n')
    expect(result.status).toBe(0)

    const parts = result.stdout.trim().split('$')
    expect(parts[1]).toBe('100000')
  })

  it('produces a different hash on each run (random salt)', () => {
    const password = 'same-password'
    const r1 = runScript(`${password}\n`)
    const r2 = runScript(`${password}\n`)

    expect(r1.status).toBe(0)
    expect(r2.status).toBe(0)

    // Different salt → different encoded hash
    expect(r1.stdout.trim()).not.toBe(r2.stdout.trim())
  })

  it('exits non-zero for empty input (no newline)', () => {
    const result = runScript('')
    expect(result.status).not.toBe(0)
  })

  it('exits non-zero for a line containing only a newline (empty password)', () => {
    const result = runScript('\n')
    expect(result.status).not.toBe(0)
  })

  it('exits non-zero when password exceeds 1024 characters', () => {
    const longPassword = 'a'.repeat(1025)
    const result = runScript(`${longPassword}\n`)
    expect(result.status).not.toBe(0)
  })

  it('accepts a password of exactly 1024 characters', () => {
    const maxPassword = 'b'.repeat(1024)
    const result = runScript(`${maxPassword}\n`)
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toMatch(/^pbkdf2-sha256\$/)
  })

  it('outputs only the hash line to stdout (no extra lines)', () => {
    const result = runScript('my-test-password\n')
    expect(result.status).toBe(0)

    const lines = result.stdout.split('\n').filter(l => l.length > 0)
    expect(lines).toHaveLength(1)
  })
})
