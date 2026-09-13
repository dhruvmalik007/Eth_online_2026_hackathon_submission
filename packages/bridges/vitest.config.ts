import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Live checks are opt-in: the default suite must pass offline, against
    // captured fixtures, so a rate limit never reads as a regression.
    exclude: ["**/node_modules/**", "**/dist/**", "test/live/**"],
  },
});
