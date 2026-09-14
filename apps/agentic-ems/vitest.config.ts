import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * `@/` is how every module under `app/`, `components/` and `lib/` imports its neighbours, and Next
 * resolves it from `tsconfig.json`'s `paths`. Vitest does not read tsconfig, so without this alias a
 * test could only import a module that happens to have no app-internal imports at all — which is
 * why every existing test here is a pure function imported relatively, and why anything reaching
 * `lib/env.ts` or the route layer has been untestable. This makes the alias real for tests.
 *
 * `environment: node` is explicit rather than implied, because `serverEnv()` refuses to run when
 * `window` exists: a test that silently ran in a DOM environment would fail with a message about
 * the browser rather than about the thing under test.
 *
 * `react-server` in the resolve conditions is what makes `import "server-only"` resolvable. That
 * package's default entry throws on import by design — it exists to fail a client bundle — and it is
 * only replaced by an inert module under the condition Next itself builds server modules with. The
 * modules under test here *are* server modules, so that is the condition they run under.
 */
const SERVER_CONDITIONS = ["react-server", "node", "import", "default"];

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) }, conditions: SERVER_CONDITIONS },
  ssr: { resolve: { conditions: SERVER_CONDITIONS } },
  test: { environment: "node" },
});
