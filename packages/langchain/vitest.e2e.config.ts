import { defineConfig } from 'vitest/config';

/**
 * The live suite: real credentials, real network, real latency.
 *
 * Timeouts are generous because these wait on a model and a chain, not on a local assertion. A tight
 * timeout here does not detect a regression, it detects a slow afternoon.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/e2e/**/*.test.ts'],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
