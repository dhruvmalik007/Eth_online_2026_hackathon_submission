/**
 * Run the indexer locally.
 *
 * The deployment on Vercel cannot reach TimescaleDB: the database accepts a fixed IP allowlist and
 * Vercel's egress addresses are not on it, and the sponsored-static-IP tier costs more than this
 * demo is worth. Running the same handlers from a machine that *is* allowed removes the network
 * problem entirely — no tunnel, no proxy, no allowlist change.
 *
 * The handlers are untouched. They already speak `Request`/`Response`, which is exactly what makes
 * this possible: the platform boundary was isolated in `_lib/vercel.ts` when they were ported, so
 * hosting them on Node's own `http` server is a second adapter rather than a second implementation.
 *
 *     pnpm --filter @ethonline2026/indexer dev:local
 *
 * Then point the app at it: `NEXT_PUBLIC_INDEXER_URL=http://localhost:3001`.
 */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";

const PORT = Number(process.env.PORT ?? 3001);
const HERE = dirname(new URL(import.meta.url).pathname);

/**
 * The env files, loaded before any handler is imported.
 *
 * Order matters: `runtime.ts` reads configuration at module scope, so a late load means a handler
 * captures `undefined` and reports a database as unreachable when it is merely unconfigured.
 * `.env.local` wins, matching Next's precedence.
 */
function loadEnv(): void {
  for (const candidate of [
    join(HERE, "..", ".env.local"),
    join(HERE, "..", ".env"),
    join(HERE, "..", "..", "..", ".env"),
  ]) {
    if (!existsSync(candidate)) continue;
    for (const line of readFileSync(candidate, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq);
      // Never clobber something already in the environment — an explicit `PORT=… pnpm dev:local`
      // should beat a file, not lose to it.
      if (process.env[key] !== undefined) continue;
      process.env[key] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    }
  }
}
loadEnv();

/** Route table. Explicit, because the filesystem is the router on Vercel and we are not on Vercel. */
const ROUTES: Record<string, string> = {
  "/api/health": "../api/health.js",
  "/api/metrics": "../api/metrics.js",
  "/api/forecast": "../api/forecast.js",
  "/api/agent": "../api/agent.js",
  "/api/search": "../api/search.js",
  "/api/performance": "../api/performance.js",
  "/api/risk/chains": "../api/risk/chains.js",
  "/api/risk/protocols": "../api/risk/protocols.js",
  "/api/risk/adjustment": "../api/risk/adjustment.js",
};

/**
 * Handlers already speak Node's pair and do their own translation.
 *
 * `_lib/vercel.ts` is called *by the handler*, not by the platform, so this server passes the raw
 * `(request, response)` straight through. Calling the handler with a `Request` and expecting a
 * `Response` back is the mismatch that produced `Cannot set properties of undefined (setting
 * 'statusCode')` — the handler was handed a `Response` as its second argument and wrote to it.
 */
type Handler = (request: IncomingMessage, response: ServerResponse) => Promise<void>;
const loaded = new Map<string, Handler>();

async function handlerFor(route: string): Promise<Handler | undefined> {
  const path = ROUTES[route];
  if (path === undefined) return undefined;
  const cached = loaded.get(route);
  if (cached !== undefined) return cached;
  const module = (await import(pathToFileURL(join(HERE, path)).href)) as {
    default?: Handler;
    GET?: Handler;
  };
  const handler = module.default ?? module.GET;
  if (handler === undefined) throw new Error(`${route} exports no default handler`);
  loaded.set(route, handler);
  return handler;
}

const server = createServer((request, response) => {
  void (async () => {
    const path = (request.url ?? "/").split("?")[0] ?? "/";
    try {
      const handler = await handlerFor(path);
      if (handler === undefined) {
        response.statusCode = 404;
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ error: `No local route for ${path}`, routes: Object.keys(ROUTES) }));
        return;
      }
      await handler(request, response);
    } catch (error) {
      // A crash inside a handler must not take the process down — the demo is running against this,
      // and one bad route should not end the session.
      console.error(`[local] ${path} threw:`, error);
      if (!response.headersSent) {
        response.statusCode = 500;
        response.setHeader("content-type", "application/json");
      }
      response.end(JSON.stringify({ error: (error as Error).message, route: path }));
    }
  })();
});

server.listen(PORT, () => {
  const dsn = process.env.TIMESERIES_DATABASE_URL;
  console.log(`  indexer (local)  → http://localhost:${PORT}`);
  console.log(`  routes           → ${Object.keys(ROUTES).length}`);
  console.log(`  database         → ${dsn === undefined || dsn.length === 0 ? "NOT CONFIGURED" : "configured"}`);
});
