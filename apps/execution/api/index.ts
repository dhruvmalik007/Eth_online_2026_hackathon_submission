/**
 * Vercel entrypoint for the execution service.
 *
 * The service is a long-running Fastify server on a container: `main.ts` calls `listen()`
 * and owns the port. Vercel has no port, so this file adapts the same app to the platform.
 *
 * The signature is the Node one — `(req, res)`, write the reply onto `res` — not the
 * web-standard `(request) => Response`. Vercel's Node runtime hands over a Node
 * `IncomingMessage`, which is why `req.url` is the bare path rather than an absolute URL.
 * Returning a `Response` from that signature type-checks but nothing ever writes the reply:
 * the runtime is waiting for `res.end()`, so every route hangs until the 60s timeout.
 *
 * `inject()` is used rather than forwarding through `app.server`: it drives the real router,
 * hooks and error handler through the supported entry point, so the deployed service
 * exercises the same code path the tests do instead of a parallel one.
 *
 * The app is built once per function instance. Fluid compute keeps instances warm, and
 * `createRuntime()` opens a database pool and venue registry — rebuilding per request would
 * churn connections for no benefit.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { HTTPMethods } from "fastify";
import { buildApp } from "../src/app.js";
import { HeaderAuthenticator } from "../src/http.js";
import { createRuntime } from "../src/runtime.js";

type App = ReturnType<typeof buildApp>;

let instance: App | null = null;

function app(): App {
  if (instance === null) {
    // `buildApp` calls `assertDeployable`, so a live-mode deployment on the development
    // authenticator fails here — at boot, not on the first request that can sign.
    instance = buildApp({ runtime: createRuntime(), authenticator: new HeaderAuthenticator() });
  }
  return instance;
}

async function readBody(request: IncomingMessage, method: string): Promise<string | undefined> {
  if (method === "GET" || method === "HEAD") return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return chunks.length > 0 ? Buffer.concat(chunks).toString("utf8") : undefined;
}

function headersOf(request: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.headers)) {
    if (typeof value === "string") out[key] = value;
    else if (Array.isArray(value)) out[key] = value.join(", ");
  }
  return out;
}

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  // `IncomingMessage.url` is a bare path, so it is resolved against a base; only the path
  // and query are forwarded, and the base is discarded.
  const url = new URL(request.url ?? "/", "http://localhost");
  const method = (request.method ?? "GET").toUpperCase() as HTTPMethods;
  const body = await readBody(request, method);

  const result = await app().inject({
    method,
    url: url.pathname + url.search,
    headers: headersOf(request),
    ...(body === undefined ? {} : { payload: body }),
  });

  response.statusCode = result.statusCode;
  for (const [key, value] of Object.entries(result.headers)) {
    if (typeof value === "string") response.setHeader(key, value);
  }
  response.end(result.body);
}
