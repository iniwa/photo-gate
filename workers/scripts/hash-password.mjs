#!/usr/bin/env node
// hash-password.mjs
//
// Generates a password hash in the exact format consumed by
// workers/src/services/auth-crypto.ts parsePasswordHash.
//
// Format: pbkdf2-sha256$<iterations>$<salt-b64url>$<digest-b64url>
//   - PBKDF2-HMAC-SHA256
//   - 16-byte random salt
//   - 32-byte derived key
//   - 100,000 iterations (PBKDF2_PRODUCTION_ITERATIONS)
//   - base64url-unpadded: '+' -> '-', '/' -> '_', strip '='
//
// COMPATIBILITY CONTRACT: this file and auth-crypto.ts must stay byte-format
// compatible. If the encoding in either changes (algorithm, salt size, key
// size, iteration encoding, base64url variant), change BOTH files and update
// this comment.
//
// Usage:
//   node workers/scripts/hash-password.mjs
//
//   The script reads the password from stdin (one line, no echo on TTY via
//   readline with input mode manipulation where supported; on Windows the
//   readline interface cannot suppress echo without native addons, so the
//   password will echo — use a secure terminal session and clear the line
//   afterwards). The password is NEVER accepted via argv or environment
//   variables. Output is the hash line only (stdout). All other messages go
//   to stderr.
//
//   Exit codes:
//     0  success — hash printed to stdout
//     1  invalid input or runtime error

import { createInterface } from 'node:readline'

const ALGORITHM = 'pbkdf2-sha256'
const ITERATIONS = 100_000
const SALT_BYTES = 16
const KEY_BYTES = 32
const MIN_LENGTH = 1
const MAX_LENGTH = 1024

function base64urlEncode(bytes) {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

async function hashPassword(password) {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const keyMaterial = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const derivedBits = await globalThis.crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS },
    keyMaterial,
    KEY_BYTES * 8,
  )
  const derived = new Uint8Array(derivedBits)
  return `${ALGORITHM}$${ITERATIONS}$${base64urlEncode(salt)}$${base64urlEncode(derived)}`
}

function printUsage() {
  process.stderr.write(
    [
      'Usage: node workers/scripts/hash-password.mjs',
      '',
      'Reads password from stdin and prints the PBKDF2-SHA256 hash to stdout.',
      `Password must be between ${MIN_LENGTH} and ${MAX_LENGTH} characters.`,
      '',
      'NOTE: On Windows, readline cannot suppress echo without native addons.',
      'The password will be visible as you type. Use a secure terminal session.',
      'The password is never stored, logged, or passed via argv/env.',
      '',
    ].join('\n'),
  )
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsage()
    process.exit(0)
  }

  // Attempt to disable echo on TTY (Unix). On Windows this is a no-op in Node
  // without native addons, so we warn instead.
  const isTTY = process.stdin.isTTY === true
  if (isTTY) {
    if (process.platform === 'win32') {
      process.stderr.write('WARNING: echo suppression is not available on Windows without native addons.\n')
      process.stderr.write('The password will be visible as you type.\n')
    } else {
      // On Unix, attempt to put the terminal into raw/no-echo mode.
      try {
        process.stdin.setRawMode(true)
      } catch {
        // setRawMode may not be available in all environments; continue anyway.
      }
    }
  }

  process.stderr.write('Password: ')

  const rl = createInterface({
    input: process.stdin,
    output: isTTY && process.platform !== 'win32' ? null : undefined,
    terminal: false,
  })

  let password = null
  let lineCount = 0

  await new Promise((resolve, reject) => {
    rl.once('line', (line) => {
      lineCount++
      password = line
      rl.close()
    })
    rl.once('close', resolve)
    rl.once('error', reject)
    process.stdin.once('error', reject)
  })

  // Restore terminal if we set raw mode
  if (isTTY && process.platform !== 'win32') {
    try {
      process.stdin.setRawMode(false)
    } catch {
      // ignore
    }
    process.stderr.write('\n')
  } else if (isTTY) {
    process.stderr.write('\n')
  }

  if (password === null || lineCount === 0) {
    process.stderr.write('Error: no password provided (empty stdin).\n')
    printUsage()
    process.exit(1)
  }

  if (password.length < MIN_LENGTH) {
    process.stderr.write(`Error: password must be at least ${MIN_LENGTH} character.\n`)
    process.exit(1)
  }

  if (password.length > MAX_LENGTH) {
    process.stderr.write(`Error: password must be at most ${MAX_LENGTH} characters.\n`)
    process.exit(1)
  }

  let hash
  try {
    hash = await hashPassword(password)
  } catch (err) {
    process.stderr.write('Error: hash computation failed.\n')
    if (err instanceof Error) {
      // Do NOT include the password in any error output.
      process.stderr.write(`Details: ${err.message}\n`)
    }
    process.exit(1)
  }

  // Only the hash line goes to stdout. No trailing whitespace beyond the newline.
  process.stdout.write(`${hash}\n`)
  process.exit(0)
}

main().catch((err) => {
  process.stderr.write('Error: unexpected failure.\n')
  if (err instanceof Error) {
    process.stderr.write(`${err.message}\n`)
  }
  process.exit(1)
})
