import { defineConfig } from "vitest/config";

/**
 * Offline by default. Anything needing a chain is a Foundry fork test in
 * `packages/oneInch/contracts/test/fork/`, or an explicit scenario in
 * `apps/fork-execution` — never a unit test that quietly depends on an RPC.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    exclude: ["node_modules", "dist"],
  },
});
