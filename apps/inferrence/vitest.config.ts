import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // The default suite must run offline: no database, no model call, no network.
    // Live sandbox/model checks are opt-in behind an env gate (`test/live/`).
    exclude: ["**/node_modules/**", "**/dist/**", "test/live/**"],
  },
});
