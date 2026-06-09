import { describe, it, expect } from 'vitest'
import sql001 from '../migrations/0001_users_sessions.sql?raw'
import sql002 from '../migrations/0002_albums_permissions.sql?raw'

describe('0001_users_sessions.sql', () => {
  it('enables foreign keys', () => {
    expect(sql001).toMatch(/PRAGMA\s+foreign_keys\s*=\s*ON/i)
  })

  it('creates the users table', () => {
    expect(sql001).toMatch(/CREATE\s+TABLE\s+users/i)
  })

  it('users has id TEXT PRIMARY KEY', () => {
    expect(sql001).toContain('id TEXT PRIMARY KEY')
  })

  it('users constrains IDs to the repository-safe format', () => {
    expect(sql001).toContain("substr(id, 1, 1) GLOB '[A-Za-z0-9]'")
    expect(sql001).toContain("id NOT GLOB '*[^A-Za-z0-9_-]*'")
  })

  it('users has display_name column', () => {
    expect(sql001).toContain('display_name TEXT NOT NULL')
  })

  it('users has password_hash column', () => {
    expect(sql001).toContain('password_hash TEXT NOT NULL')
  })

  it('users has enabled column with CHECK constraint', () => {
    expect(sql001).toContain('enabled INTEGER NOT NULL')
    expect(sql001).toMatch(/enabled\s+IN\s*\(\s*0\s*,\s*1\s*\)/)
  })

  it('users has fail_count column with non-negative CHECK', () => {
    expect(sql001).toContain('fail_count INTEGER NOT NULL')
    expect(sql001).toMatch(/fail_count\s*>=\s*0/)
  })

  it('users has locked_until column', () => {
    expect(sql001).toContain('locked_until TEXT')
  })

  it('users has ISO timestamp columns', () => {
    expect(sql001).toContain('created_at TEXT NOT NULL')
    expect(sql001).toContain('updated_at TEXT NOT NULL')
  })

  it('creates the sessions table', () => {
    expect(sql001).toMatch(/CREATE\s+TABLE\s+sessions/i)
  })

  it('sessions has token_hash TEXT PRIMARY KEY', () => {
    expect(sql001).toContain('token_hash TEXT PRIMARY KEY')
  })

  it('sessions constrains token hashes to lowercase SHA-256 hex', () => {
    expect(sql001).toContain('length(token_hash) = 64')
    expect(sql001).toContain("token_hash NOT GLOB '*[^0-9a-f]*'")
  })

  it('sessions has user_id with REFERENCES users CASCADE', () => {
    expect(sql001).toContain('REFERENCES users(id)')
    expect(sql001).toContain('ON DELETE CASCADE')
  })

  it('sessions has expires_at column', () => {
    expect(sql001).toContain('expires_at TEXT NOT NULL')
  })

  it('sessions has last_seen_at column', () => {
    expect(sql001).toContain('last_seen_at TEXT NOT NULL')
  })

  it('has an index on sessions.user_id', () => {
    expect(sql001).toMatch(/CREATE\s+INDEX.*sessions.*user_id/i)
  })

  it('has an index on sessions.expires_at for cleanup queries', () => {
    expect(sql001).toMatch(/CREATE\s+INDEX.*sessions.*expires_at/i)
  })
})

describe('0002_albums_permissions.sql', () => {
  it('enables foreign keys', () => {
    expect(sql002).toMatch(/PRAGMA\s+foreign_keys\s*=\s*ON/i)
  })

  it('creates the albums table', () => {
    expect(sql002).toMatch(/CREATE\s+TABLE\s+albums/i)
  })

  it('albums has id TEXT PRIMARY KEY', () => {
    expect(sql002).toContain('id TEXT PRIMARY KEY')
  })

  it('albums constrains IDs to the repository-safe format', () => {
    expect(sql002).toContain("substr(id, 1, 1) GLOB '[A-Za-z0-9]'")
    expect(sql002).toContain("id NOT GLOB '*[^A-Za-z0-9_-]*'")
  })

  it('albums has title, photoprism_album_uid, enabled', () => {
    expect(sql002).toContain('title TEXT NOT NULL')
    expect(sql002).toContain('photoprism_album_uid TEXT NOT NULL')
    expect(sql002).toContain('enabled INTEGER NOT NULL')
  })

  it('albums has expires_at for album-level expiry', () => {
    expect(sql002).toContain('expires_at TEXT')
  })

  it('albums has strip_exif enforced via CHECK', () => {
    expect(sql002).toContain('strip_exif INTEGER NOT NULL')
    expect(sql002).toMatch(/strip_exif\s+IN\s*\(\s*0\s*,\s*1\s*\)/)
  })

  it('albums has download_enabled enforced via CHECK', () => {
    expect(sql002).toContain('download_enabled INTEGER NOT NULL')
    expect(sql002).toMatch(/download_enabled\s+IN\s*\(\s*0\s*,\s*1\s*\)/)
  })

  it('albums has ISO timestamp columns', () => {
    expect(sql002).toContain('created_at TEXT NOT NULL')
    expect(sql002).toContain('updated_at TEXT NOT NULL')
  })

  it('creates the album_permissions table', () => {
    expect(sql002).toMatch(/CREATE\s+TABLE\s+album_permissions/i)
  })

  it('album_permissions has composite PRIMARY KEY (album_id, user_id)', () => {
    expect(sql002).toMatch(/PRIMARY\s+KEY\s*\(\s*album_id\s*,\s*user_id\s*\)/)
  })

  it('album_permissions.album_id references albums with CASCADE', () => {
    expect(sql002).toContain('REFERENCES albums(id)')
    expect(sql002).toContain('ON DELETE CASCADE')
  })

  it('album_permissions.user_id references users with CASCADE', () => {
    expect(sql002).toContain('REFERENCES users(id)')
    expect(sql002).toContain('ON DELETE CASCADE')
  })

  it('has an index on album_permissions.user_id', () => {
    expect(sql002).toMatch(/CREATE\s+INDEX.*album_permissions.*user_id/i)
  })
})
