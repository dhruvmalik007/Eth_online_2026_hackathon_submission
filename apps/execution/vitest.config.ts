import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // The store's live checks are opt-in; the default suite must run offline.
    exclude: ["**/node_modules/**", "**/dist/**", "test/e2e/**"],
  },
});
