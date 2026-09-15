/**
 * The Vercel platform boundary.
 *
 * Vercel's Node runtime hands a handler a Node `IncomingMessage` and expects the reply written
 * onto a `ServerResponse`. The route handlers in this app speak the web-standard
 * `Request`/`Response` pair instead, and that is worth keeping: it is what the unit tests drive
 * and it carries no platform detail.
 *
 * So the two representations are translated here, in one place, rather than teaching nine
 * handlers about `res.end()`. Returning a `Response` from the Node signature is the specific
 * mistake to avoid — it type-checks, but nothing ever writes the reply, so every route hangs
 * until the function times out. Both directions live in this file so that failure has exactly
 * one place to be wrong.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

import { OIDC_HEADER, rememberOidcToken } from "./workloadIdentity.js";

const BODYLESS_METHODS = new Set(["GET", "HEAD"]);

async function readBody(request: IncomingMessage): Promise<Buffer | undefined> {
  const method = (request.method ?? "GET").toUpperCase();
  if (BODYLESS_METHODS.has(method)) return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

/** A web `Request` built from the Node request Vercel passes. */
export async function toWebRequest(request: IncomingMessage): Promise<Request> {
  // `IncomingMessage.url` is a bare path, so it needs an origin to become absolute. The host
  // header is preferred so any redirect a handler builds points back at the real deployment;
  // the fallback only covers a request that arrives without one.
  const host = request.headers.host ?? "localhost";
  const url = new URL(request.url ?? "/", `https://${host}`);

  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (typeof value === "string") headers.set(key, value);
    else if (Array.isArray(value)) headers.set(key, value.join(", "));
  }

  // Vercel signs an OIDC token for the invocation and delivers it as a header rather than an
  // environment variable, so this is the only point in the request that can see it. It is stashed
  // for the GCP credential exchange — nothing else reads it, and it never leaves the process.
  const oidcToken = headers.get(OIDC_HEADER);
  if (oidcToken !== null) rememberOidcToken(oidcToken);

  const body = await readBody(request);
  return new Request(url, {
    method: (request.method ?? "GET").toUpperCase(),
    headers,
    ...(body === undefined ? {} : { body }),
  });
}

/** Write a web `Response` onto the Node response Vercel is waiting on. */
export async function sendWebResponse(
  response: ServerResponse,
  web: Response,
): Promise<void> {
  response.statusCode = web.status;
  web.headers.forEach((value, key) => response.setHeader(key, value));
  response.end(Buffer.from(await web.arrayBuffer()));
}
