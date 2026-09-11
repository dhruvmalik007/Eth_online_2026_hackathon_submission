import { defineConfig } from 'vitest/config';

/**
 * Live end-to-end test profile.
 *
 * These tests touch real hosted services (Camoufox-driven fetches, the Tiger
 * Cloud TimescaleDB instance, a scratch GCS prefix), so they are opt-in: the
 * suite skips unless `RISK_E2E=1`. Run with `pnpm test:e2e`.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.e2e.test.ts'],
    environment: 'node',
    testTimeout: 300_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
