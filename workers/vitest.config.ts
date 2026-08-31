import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/index.tsx'],
    },
    // The integration smoke uses the Cloudflare Workers pool and is executed
    // explicitly through `npm run test:integration`.
    exclude: [...configDefaults.exclude, 'test/worker-integration.test.ts'],
  },
})
