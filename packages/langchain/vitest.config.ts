import { defineConfig } from 'vitest/config';

/**
 * The offline suite.
 *
 * `test/e2e` is excluded deliberately. Those tests reach Vertex AI and a mainnet subgraph, so they
 * are not unit tests with a slow assertion — they are a different kind of verification, requiring
 * credentials, network, and a duration that depends on a third party. Running them here meant the
 * offline gate failed whenever the network was slow for reasons that had nothing to do with the
 * change under test. They run on their own (`pnpm test:e2e`) and in the environment battery.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'test/e2e/**'],
  },
});
