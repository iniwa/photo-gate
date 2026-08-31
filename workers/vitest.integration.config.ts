import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      main: './src/index.tsx',
      miniflare: {
        // Keep the configured production binding names, but run the application
        // entry point directly so the static-asset fallback cannot intercept
        // private application routes in this binding smoke test.
        compatibilityDate: '2026-06-09',
        d1Databases: ['DB'],
        r2Buckets: ['PHOTO_BUCKET'],
        ratelimits: {
          LOGIN_ACCOUNT_RATE_LIMIT: {
            namespace_id: '487013621',
            simple: { limit: 5, period: 60 },
          },
          LOGIN_NETWORK_RATE_LIMIT: {
            namespace_id: '487013622',
            simple: { limit: 30, period: 60 },
          },
        },
        // The production Worker does not receive this binding. It contains only
        // checked-in migration SQL used to initialize this isolated local D1.
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations('./migrations'),
        },
      },
    })),
  ],
  test: {
    include: ['test/worker-integration.test.ts'],
  },
})
