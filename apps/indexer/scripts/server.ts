/**
 * One HTTP server for the indexer, used by both the local runner and Cloud Run.
 *
 * The route table is explicit because the filesystem is the router on Vercel and we are not on
 * Vercel here. Handlers already speak Node's `(request, response)` pair and translate to the
 * web-standard types themselves (`api/_lib/vercel.ts`), so this server passes the raw pair straight
 * through — calling a handler with a `Request` and expecting a `Response` back is the mismatch that
 * previously produced `Cannot set properties of undefined (setting 'statusCode')`.
 *
 * Cloud Run health checks hit `/healthz`, which is answered here and never touches a dependency:
 * a liveness probe that fails because a database is slow would restart a healthy instance.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

type Handler = (request: IncomingMessage, response: ServerResponse) => Promise<void>;

/** Explicit route table. Every file in `api/` must appear here; `test/serve.test.ts` enforces it. */
export const ROUTES: Readonly<Record<string, string>> = {
  "/api/health": "../api/health.js",
  "/api/metrics": "../api/metrics.js",
  "/api/forecast": "../api/forecast.js",
  "/api/agent": "../api/agent.js",
  "/api/search": "../api/search.js",
  "/api/performance": "../api/performance.js",
  "/api/risk/chains": "../api/risk/chains.js",
  "/api/risk/protocols": "../api/risk/protocols.js",
  "/api/risk/adjustment": "../api/risk/adjustment.js",
  "/api/pools": "../api/pools.js",
  "/api/model-status": "../api/model-status.js",
  "/api/cache/manifest": "../api/cache/manifest.js",
  "/api/cron/probe": "../api/cron/probe.js",
};

/** Parse `KEY=VALUE` lines, ignoring comments and blank lines. Pure, so it is testable. */
export function parseEnvLines(text: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    parsed[trimmed.slice(0, separator)] = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return parsed;
}

/**
 * Load env files before any handler is imported.
 *
 * Order matters: `runtime.ts` reads configuration at module scope, so a late load means a handler
 * captures `undefined` and reports a database as unreachable when it is merely unconfigured. An
 * explicit environment always wins over a file.
 */
export function loadEnvFiles(paths: readonly string[]): void {
  for (const path of paths) {
    if (!existsSync(path)) continue;
    for (const [key, value] of Object.entries(parseEnvLines(readFileSync(path, "utf8")))) {
      if (process.env[key] !== undefined) continue;
      process.env[key] = value;
    }
  }
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

export interface ServerOptions {
  readonly here: string;
  readonly port: number;
  readonly logger?: (message: string) => void;
}

/**
 * Build the server. Handlers are imported lazily and cached, so a cold start does not pay for
 * routes that are never called — which matters on Cloud Run, where the first request after scale-to
 * -zero is the one a user is waiting on.
 */
export function createIndexerServer(options: ServerOptions): Server {
  const log = options.logger ?? ((message: string) => console.log(message));
  const loaded = new Map<string, Handler>();

  async function handlerFor(route: string): Promise<Handler | undefined> {
    const path = ROUTES[route];
    if (path === undefined) return undefined;
    const cached = loaded.get(route);
    if (cached !== undefined) return cached;
    const module = (await import(pathToFileURL(join(options.here, path)).href)) as {
      default?: Handler;
      GET?: Handler;
    };
    const handler = module.default ?? module.GET;
    if (handler === undefined) throw new Error(`${route} exports no default handler`);
    loaded.set(route, handler);
    return handler;
  }

  return createServer((request, response) => {
    void (async () => {
      const path = (request.url ?? "/").split("?")[0] ?? "/";
      // Answered without touching a dependency: a liveness probe must not fail because a database is slow.
      if (path === "/healthz") {
        json(response, 200, { status: "ok", service: "indexer" });
        return;
      }
      if (request.method === "OPTIONS") {
        response.statusCode = 204;
        response.setHeader("access-control-allow-origin", "*");
        response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
        response.setHeader("access-control-allow-headers", "content-type,authorization");
        response.end();
        return;
      }
      try {
        const handler = await handlerFor(path);
        if (handler === undefined) {
          json(response, 404, { error: `No route for ${path}`, routes: Object.keys(ROUTES) });
          return;
        }
        await handler(request, response);
      } catch (error) {
        // One bad route must not take the process down — the service is serving a live dashboard.
        log(`[indexer] ${path} threw: ${error instanceof Error ? error.message : String(error)}`);
        if (!response.headersSent) json(response, 500, { error: "Unexpected server error." });
        else response.end();
      }
    })();
  });
}

/** The directory scripts run from, so relative route paths resolve the same everywhere. */
export function scriptsDir(): string {
  return dirname(new URL(import.meta.url).pathname);
}
