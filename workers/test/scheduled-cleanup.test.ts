import { describe, it, expect } from 'vitest'
import worker, { runScheduledSessionCleanup } from '../src/index.js'
import type { Env } from '../src/types/env.js'

interface RecordedQuery {
  sql: string
  params: unknown[]
}

function makeMockDb(opts: { throws?: boolean } = {}): {
  db: D1Database
  queries: RecordedQuery[]
} {
  const queries: RecordedQuery[] = []
  const db = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          queries.push({ sql, params })
          return {
            run: async () => {
              if (opts.throws) throw new Error('sensitive D1 details')
              return {}
            },
          }
        },
      }
    },
  } as unknown as D1Database
  return { db, queries }
}

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

describe('runScheduledSessionCleanup', () => {
  it('deletes expired sessions with a parameterized canonical UTC timestamp', async () => {
    const { db, queries } = makeMockDb()
    await runScheduledSessionCleanup({ DB: db } as Env)

    expect(queries).toHaveLength(1)
    expect(queries[0]?.sql).toContain('DELETE FROM sessions')
    expect(queries[0]?.sql).toContain('expires_at <= ?')
    expect(queries[0]?.params).toHaveLength(1)
    expect(queries[0]?.params[0]).toMatch(ISO_UTC)
  })

  it('swallows D1 failures without throwing', async () => {
    const { db } = makeMockDb({ throws: true })
    await expect(runScheduledSessionCleanup({ DB: db } as Env)).resolves.toBeUndefined()
  })

  it('swallows a missing DB binding without throwing', async () => {
    await expect(runScheduledSessionCleanup({} as Env)).resolves.toBeUndefined()
  })
})

describe('worker default export', () => {
  it('exposes fetch and scheduled', () => {
    expect(typeof worker.fetch).toBe('function')
    expect(typeof worker.scheduled).toBe('function')
  })

  it('scheduled runs the cleanup through ctx.waitUntil', async () => {
    const { db, queries } = makeMockDb()
    const waited: Promise<unknown>[] = []
    const ctx = { waitUntil: (p: Promise<unknown>) => waited.push(p) } as unknown as ExecutionContext

    worker.scheduled({} as ScheduledController, { DB: db } as Env, ctx)

    expect(waited).toHaveLength(1)
    await Promise.all(waited)
    expect(queries).toHaveLength(1)
    expect(queries[0]?.sql).toContain('DELETE FROM sessions')
  })
})
