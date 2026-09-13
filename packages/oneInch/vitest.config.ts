import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Fork checks are opt-in: the default suite must pass offline against pinned
    // fixture values, so a missing RPC never reads as a regression.
    exclude: ["**/node_modules/**", "**/dist/**", "test/fork/**"],
  },
});
