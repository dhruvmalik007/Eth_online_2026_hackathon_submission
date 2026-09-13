/**
 * Server-side client for the inference service.
 *
 * ## Why this is server-only
 *
 * The Cloud Run service is deployed `--no-allow-unauthenticated`, so every call needs
 * a Google-issued **identity token** whose `aud` is the service URL. Those tokens
 * cannot exist in a browser: minting one requires the service-account key, and
 * handing that to a client would hand over the ability to call every service the
 * account can reach. So the browser talks to this app's route, and the route talks to
 * Cloud Run.
 *
 * That also makes the app the right place to attach `x-user-id`. It is derived here,
 * server-side — never accepted from the browser — so a client cannot claim to be
 * another user's session. Today it is a configured service identity; when the desk
 * has server-verified Privy sessions it becomes the Privy DID, and nothing else needs
 * to change.
 *
 * ## Token minting
 *
 * `IdTokenClient` caches the token and refreshes it before expiry, so calling
 * {@link inferenceAuthHeaders} per request is the intended usage, not a wasted round
 * trip. Two credential sources are supported, in order:
 *
 * 1. `GOOGLE_SERVICE_ACCOUNT_KEY` — the service-account JSON, raw or base64. This is
 *    the Vercel path, where there is no metadata server and no writable disk.
 * 2. Application Default Credentials — `GOOGLE_APPLICATION_CREDENTIALS`, a workload
 *    identity, or the GCE metadata server. This is the local and GCP path.
 *
 * `INFERENCE_ID_TOKEN` overrides both, for local work against a service you have
 * already authenticated to with `gcloud auth print-identity-token`.
 */
import { GoogleAuth, type IdTokenClient } from "google-auth-library";

/** Thrown for misconfiguration; the route maps this to a 503 rather than a crash. */
export class InferenceNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InferenceNotConfiguredError";
  }
}

/** The service base URL, or `undefined` when the app is not wired to one. */
export function inferenceBaseUrl(): string | undefined {
  const url = process.env.INFERENCE_SERVICE_URL?.trim();
  return url !== undefined && url.length > 0 ? url.replace(/\/+$/, "") : undefined;
}

/** The identity the desk presents for its own runs. Server-derived; never from the browser. */
export function inferenceUserId(): string {
  const configured = process.env.INFERENCE_USER_ID?.trim();
  return configured !== undefined && configured.length > 0 ? configured : "agentic-ems-desk";
}

function serviceAccountCredentials(): Record<string, unknown> | undefined {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.trim();
  if (raw === undefined || raw.length === 0) return undefined;
  // Vercel env vars are awkward for multi-line JSON, so base64 is accepted too.
  const json = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    throw new InferenceNotConfiguredError(
      "GOOGLE_SERVICE_ACCOUNT_KEY is set but is not valid JSON (raw or base64).",
    );
  }
}

let cachedAuth: GoogleAuth | undefined;
const cachedIdTokenClients = new Map<string, IdTokenClient>();

function googleAuth(): GoogleAuth {
  if (cachedAuth === undefined) {
    const credentials = serviceAccountCredentials();
    cachedAuth = new GoogleAuth(credentials === undefined ? {} : { credentials });
  }
  return cachedAuth;
}

/**
 * Headers for one upstream call, including a freshly-minted bearer token.
 *
 * @param baseUrl the service URL, which is also the token's required `aud`.
 */
export async function inferenceAuthHeaders(
  baseUrl: string,
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    "x-user-id": inferenceUserId(),
  };

  const override = process.env.INFERENCE_ID_TOKEN?.trim();
  if (override !== undefined && override.length > 0) {
    headers["authorization"] = `Bearer ${override}`;
    return headers;
  }

  let client = cachedIdTokenClients.get(baseUrl);
  if (client === undefined) {
    client = await googleAuth().getIdTokenClient(baseUrl);
    cachedIdTokenClients.set(baseUrl, client);
  }
  const minted = new Headers(await client.getRequestHeaders());
  const authorization = minted.get("authorization");
  if (authorization === null) {
    throw new InferenceNotConfiguredError(
      "Could not mint an identity token. Set GOOGLE_SERVICE_ACCOUNT_KEY, or " +
        "GOOGLE_APPLICATION_CREDENTIALS, or INFERENCE_ID_TOKEN.",
    );
  }
  headers["authorization"] = authorization;
  return headers;
}

/** A JSON POST that throws on a non-2xx, so callers do not have to check. */
async function postJson<T>(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(body),
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`inference ${url} -> ${response.status} ${detail.slice(0, 300)}`);
  }
  return (await response.json()) as T;
}

/** Create a session. A turn belongs to one, so this precedes every fresh run. */
export async function createSession(
  baseUrl: string,
  headers: Record<string, string>,
  agent: string,
  signal?: AbortSignal,
): Promise<string> {
  const created = await postJson<{ session: { sessionId: string } }>(
    `${baseUrl}/v1/sessions`,
    headers,
    { agent },
    signal,
  );
  const sessionId = created.session?.sessionId;
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw new Error("inference created a session without an id");
  }
  return sessionId;
}

/**
 * Start a turn and hand back the **unconsumed** response.
 *
 * Returned raw rather than parsed because the body is the SSE stream: the caller
 * pipes it straight to the browser, so it must not be buffered here.
 */
export async function startTurn(
  baseUrl: string,
  sessionId: string,
  headers: Record<string, string>,
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  return fetch(`${baseUrl}/v1/sessions/${encodeURIComponent(sessionId)}/turns`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(body),
    ...(signal === undefined ? {} : { signal }),
  });
}

/** SSE response headers, including the one that stops a proxy from buffering. */
export function sseHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    // Without this, an intermediary buffers the whole stream and the desk shows
    // nothing until the run ends — turning a live trace into a blank wait.
    "x-accel-buffering": "no",
    ...extra,
  };
}
