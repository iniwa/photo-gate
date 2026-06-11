// Minimal ambient declarations for Node.js globals and modules used in
// hash-password-script.test.ts. These cover only what the test requires.
// Do not expand this file without updating the accompanying comment.

// process global (Node.js)
declare const process: {
  env: Record<string, string | undefined>
  cwd(): string
}

// import.meta.url (available in Node ESM and in vitest)
interface ImportMeta {
  url: string
}

// node:child_process — spawnSync only
declare module 'node:child_process' {
  interface SpawnSyncOptions {
    input?: string | Buffer
    encoding?: BufferEncoding | 'buffer'
    env?: NodeJS.ProcessEnv | Record<string, string | undefined>
    timeout?: number
    cwd?: string
    shell?: boolean | string
  }

  interface SpawnSyncReturns {
    stdout: string | null
    stderr: string | null
    status: number | null
    signal: string | null
    error?: Error
  }

  function spawnSync(
    command: string,
    args?: ReadonlyArray<string>,
    options?: SpawnSyncOptions,
  ): SpawnSyncReturns

  export { spawnSync }
}

// node:path — resolve only
declare module 'node:path' {
  function resolve(...paths: string[]): string
  export { resolve }
}
