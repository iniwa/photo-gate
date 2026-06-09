export interface CapturedQuery {
  sql: string
  params: unknown[]
}

export interface StmtConfig {
  first?: unknown
  throws?: Error
}

class MockStatement {
  private boundParams: unknown[] = []

  constructor(
    public readonly sql: string,
    private readonly capture: CapturedQuery[],
    private readonly config: StmtConfig,
  ) {}

  bind(...values: unknown[]): this {
    this.boundParams = values
    return this
  }

  async first<T = unknown>(): Promise<T | null> {
    this.capture.push({ sql: this.sql, params: this.boundParams })
    if (this.config.throws) throw this.config.throws
    return (this.config.first ?? null) as T | null
  }

  async run(): Promise<D1Result> {
    this.capture.push({ sql: this.sql, params: this.boundParams })
    if (this.config.throws) throw this.config.throws
    return { success: true } as unknown as D1Result
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    this.capture.push({ sql: this.sql, params: this.boundParams })
    return { success: true } as unknown as D1Result<T>
  }

  raw<T extends unknown[] = unknown[]>(): Promise<T[]> {
    return Promise.resolve([])
  }
}

/**
 * Returns a minimal D1Database mock and a log of every (sql, params) pair issued.
 * Each element of `configs` is consumed in order as `.prepare()` is called.
 */
export function makeMockDb(configs: StmtConfig[] = []): {
  db: D1Database
  queries: CapturedQuery[]
} {
  const queries: CapturedQuery[] = []
  let callIndex = 0

  const db = {
    prepare(sql: string): MockStatement {
      const config = configs[callIndex++] ?? {}
      return new MockStatement(sql, queries, config)
    },
    batch(): Promise<D1Result[]> {
      return Promise.resolve([])
    },
    exec(): Promise<D1ExecResult> {
      return Promise.resolve({ count: 0, duration: 0 })
    },
    dump(): Promise<ArrayBuffer> {
      return Promise.resolve(new ArrayBuffer(0))
    },
  } as unknown as D1Database

  return { db, queries }
}
