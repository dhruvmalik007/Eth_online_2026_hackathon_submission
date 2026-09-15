/**
 * The small contract every stateless endpoint shares.
 *
 * These functions answer questions about a chain — they do not hold state between calls. That is
 * deliberate: the deployment target is a Vercel Function, which has no long-lived process, so an
 * endpoint that assumed one would work locally and fail in production.
 */
export interface ApiError {
  readonly error: string;
  readonly detail?: string;
}

export function json(body: unknown, status = 200): Response {
  return new Response(`${JSON.stringify(body)}\n`, {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export function failure(message: string, status = 400, detail?: string): Response {
  return json(detail === undefined ? { error: message } : { error: message, detail }, status);
}

/** Reject a method that the endpoint does not implement, naming the ones it does. */
export function requireMethod(request: Request, allowed: readonly string[]): Response | null {
  if (allowed.includes(request.method)) return null;
  return new Response(JSON.stringify({ error: `method ${request.method} not allowed` }), {
    status: 405,
    headers: { allow: allowed.join(", "), "content-type": "application/json" },
  });
}

/** Read and validate a JSON body, returning a response to send when it is unusable. */
export async function readJson<T>(
  request: Request,
  parse: (value: unknown) => T | string,
): Promise<{ ok: true; value: T } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: failure("body must be valid JSON") };
  }
  const parsed = parse(raw);
  if (typeof parsed === "string") return { ok: false, response: failure(parsed) };
  return { ok: true, value: parsed };
}

/**
 * Run a handler and turn any escape into a JSON error.
 *
 * An RPC that is down must not surface as an opaque 500 with an HTML body: a caller needs to know
 * whether the request was wrong or the node was.
 */
export async function guarded(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return failure("upstream rpc error", 502, detail);
  }
}
