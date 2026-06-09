import { describe, it, expect } from 'vitest'
import { PermissionRepository } from '../src/services/permission-repository.js'
import { makeMockDb } from './helpers/mock-d1.js'

const VALID_USER_ID = 'user-abc-123'
const VALID_ALBUM_ID = 'album-xyz-456'
const NOW = '2026-06-09T00:00:00.000Z'

describe('PermissionRepository.checkPermission', () => {
  it('issues a parameterized JOIN query with user_id, album_id, and now', async () => {
    const { db, queries } = makeMockDb([{ first: { has_permission: 1 } }])
    await new PermissionRepository(db).checkPermission(VALID_USER_ID, VALID_ALBUM_ID, NOW)
    expect(queries).toHaveLength(1)
    expect(queries[0]?.sql).toContain('album_permissions')
    expect(queries[0]?.sql).toContain('JOIN albums')
    expect(queries[0]?.sql).toContain('JOIN users')
    expect(queries[0]?.sql).toContain('?')
    expect(queries[0]?.params).toContain(VALID_USER_ID)
    expect(queries[0]?.params).toContain(VALID_ALBUM_ID)
    expect(queries[0]?.params).toContain(NOW)
  })

  it('SQL does not contain user_id or album_id as literals', async () => {
    const { db, queries } = makeMockDb([{ first: { has_permission: 1 } }])
    await new PermissionRepository(db).checkPermission(VALID_USER_ID, VALID_ALBUM_ID, NOW)
    expect(queries[0]?.sql).not.toContain(VALID_USER_ID)
    expect(queries[0]?.sql).not.toContain(VALID_ALBUM_ID)
  })

  it('SQL checks album.enabled = 1', async () => {
    const { db, queries } = makeMockDb([{ first: { has_permission: 1 } }])
    await new PermissionRepository(db).checkPermission(VALID_USER_ID, VALID_ALBUM_ID, NOW)
    expect(queries[0]?.sql).toMatch(/a\.enabled\s*=\s*1/)
  })

  it('SQL checks album expires_at', async () => {
    const { db, queries } = makeMockDb([{ first: { has_permission: 1 } }])
    await new PermissionRepository(db).checkPermission(VALID_USER_ID, VALID_ALBUM_ID, NOW)
    expect(queries[0]?.sql).toContain('expires_at')
  })

  it('SQL checks user.enabled = 1', async () => {
    const { db, queries } = makeMockDb([{ first: { has_permission: 1 } }])
    await new PermissionRepository(db).checkPermission(VALID_USER_ID, VALID_ALBUM_ID, NOW)
    expect(queries[0]?.sql).toMatch(/u\.enabled\s*=\s*1/)
  })

  it('returns true when D1 returns has_permission = 1', async () => {
    const { db } = makeMockDb([{ first: { has_permission: 1 } }])
    expect(await new PermissionRepository(db).checkPermission(VALID_USER_ID, VALID_ALBUM_ID, NOW)).toBe(true)
  })

  it('returns false when D1 returns null (no permission row)', async () => {
    const { db } = makeMockDb([{ first: null }])
    expect(await new PermissionRepository(db).checkPermission(VALID_USER_ID, VALID_ALBUM_ID, NOW)).toBe(false)
  })

  it('returns false for an invalid user ID without hitting D1', async () => {
    const { db, queries } = makeMockDb([])
    expect(await new PermissionRepository(db).checkPermission('!bad!', VALID_ALBUM_ID, NOW)).toBe(false)
    expect(queries).toHaveLength(0)
  })

  it('returns false for an invalid album ID without hitting D1', async () => {
    const { db, queries } = makeMockDb([])
    expect(await new PermissionRepository(db).checkPermission(VALID_USER_ID, '!bad!', NOW)).toBe(false)
    expect(queries).toHaveLength(0)
  })

  it('returns false for an empty user ID', async () => {
    const { db, queries } = makeMockDb([])
    expect(await new PermissionRepository(db).checkPermission('', VALID_ALBUM_ID, NOW)).toBe(false)
    expect(queries).toHaveLength(0)
  })

  it('returns false for an empty album ID', async () => {
    const { db, queries } = makeMockDb([])
    expect(await new PermissionRepository(db).checkPermission(VALID_USER_ID, '', NOW)).toBe(false)
    expect(queries).toHaveLength(0)
  })

  it('returns false for a non-canonical timestamp without hitting D1', async () => {
    const { db, queries } = makeMockDb([])
    expect(
      await new PermissionRepository(db).checkPermission(
        VALID_USER_ID,
        VALID_ALBUM_ID,
        '2026-06-09T00:00:00Z',
      ),
    ).toBe(false)
    expect(queries).toHaveLength(0)
  })

  it('throws database operation error on D1 failure', async () => {
    const { db } = makeMockDb([{ throws: new Error('D1 connection failure') }])
    await expect(
      new PermissionRepository(db).checkPermission(VALID_USER_ID, VALID_ALBUM_ID, NOW),
    ).rejects.toThrow('database operation failed')
  })

  it('does not expose D1 error details in thrown error', async () => {
    const { db } = makeMockDb([{ throws: new Error('sensitive_table_name info') }])
    await expect(
      new PermissionRepository(db).checkPermission(VALID_USER_ID, VALID_ALBUM_ID, NOW),
    ).rejects.toThrow('database operation failed')
  })
})
