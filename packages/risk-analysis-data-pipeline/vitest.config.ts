import { defineConfig } from 'vitest/config';

/**
 * Offline test profile.
 *
 * The default suite is deliberately network-free so it can run anywhere. Live
 * integration coverage lives behind the opt-in `test:e2e` config
 * (`vitest.e2e.config.ts`) and the `RISK_E2E=1` guard, which keeps CI
 * deterministic while still allowing real end-to-end verification on demand.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/**/*.e2e.test.ts', 'node_modules/**'],
    environment: 'node',
  },
});
