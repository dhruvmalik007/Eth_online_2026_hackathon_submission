/**
 * `POST /api/inference` — the desk's door to the inference service.
 *
 * A thin, streaming pass-through: it authenticates to Cloud Run (see
 * `lib/inference/client.ts` for why that has to happen on the server), ensures the
 * turn has a session, and then pipes the SSE stream back **unbuffered**. Nothing here
 * interprets the events — `lib/inference/stream.ts` does that on the client, so this
 * route has no opinion about the wire contract and does not need to change when it
 * grows.
 *
 * ## What it returns
 *
 * The upstream `text/event-stream` body, verbatim, plus:
 *   - `x-inference-session-id` — so a follow-up turn reuses the session.
 *   - `x-inference-run-id` — the correlation id, echoed for tracing.
 *
 * ## Failure modes, deliberately distinguished
 *
 *   - `401` there is no session, so there is nobody to attribute the run to. Checked first:
 *     the run is scoped to a DID downstream, and a route that answered configuration
 *     questions before asking who was calling would hand the deployment's shape to anyone.
 *   - `503` the app is **not configured** (no `INFERENCE_SERVICE_URL`, or no usable
 *     credentials). Different from an outage: retrying will not help until an env var
 *     is set, so it says so rather than looking like the service is down.
 *   - `400` the request itself is malformed.
 *   - `502` the service was reached but refused or failed; its body is forwarded
 *     because the service's error messages are more specific than anything this route
 *     could invent.
 */
import { NextResponse } from "next/server";
import { currentSession, unauthenticated } from "@/lib/auth/session";
import {
  InferenceNotConfiguredError,
  createSession,
  inferenceAuthHeaders,
  inferenceBaseUrl,
  sseHeaders,
  startTurn,
} from "@/lib/inference/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** A turn streams for as long as the agent runs; keep the function alive for it. */
export const maxDuration = 300;

const MODES = new Set(["v01", "deep"]);

interface TurnBody {
  query: string;
  mode: string;
  sessionId?: string;
  dry?: boolean;
  horizonDays?: number;
}

function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

/** Validate and normalise the browser's request, or explain what is wrong with it. */
function parseBody(raw: unknown): TurnBody | { error: string } {
  if (raw === null || typeof raw !== "object") return { error: "body must be a JSON object" };
  const body = raw as Record<string, unknown>;

  const query = typeof body["query"] === "string" ? body["query"].trim() : "";
  if (query.length === 0) return { error: "`query` is required and must be a non-empty string" };

  const mode = typeof body["mode"] === "string" ? body["mode"] : "v01";
  if (!MODES.has(mode)) return { error: `\`mode\` must be one of ${[...MODES].join(", ")}` };

  const sessionId = typeof body["sessionId"] === "string" ? body["sessionId"] : undefined;
  const turn: TurnBody = { query, mode };
  if (sessionId !== undefined && sessionId.length > 0) turn.sessionId = sessionId;
  if (typeof body["dry"] === "boolean") turn.dry = body["dry"];
  if (typeof body["horizonDays"] === "number") turn.horizonDays = body["horizonDays"];
  return turn;
}

export async function POST(request: Request): Promise<Response> {
  const session = await currentSession();
  if (session === null) return unauthenticated();

  const baseUrl = inferenceBaseUrl();
  if (baseUrl === undefined) {
    return NextResponse.json(
      {
        error:
          "inference is not configured: set INFERENCE_SERVICE_URL to the Cloud Run service URL",
      },
      { status: 503 },
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return badRequest("body must be valid JSON");
  }

  const parsed = parseBody(rawBody);
  if ("error" in parsed) return badRequest(parsed.error);

  // Tear down the upstream request if the browser disconnects, so an abandoned tab
  // does not leave the agent running against Cloud Run.
  const signal = request.signal;

  try {
    const headers = await inferenceAuthHeaders(baseUrl, session.did);
    const sessionId =
      parsed.sessionId ?? (await createSession(baseUrl, headers, parsed.mode, signal));

    const upstream = await startTurn(
      baseUrl,
      sessionId,
      headers,
      { query: parsed.query, mode: parsed.mode, dry: parsed.dry ?? true },
      signal,
    );

    if (!upstream.ok || upstream.body === null) {
      // Forward the service's own diagnosis; it knows more than this route does.
      const detail = await upstream.text().catch(() => "");
      return NextResponse.json(
        { error: `inference returned ${upstream.status}`, detail: detail.slice(0, 2000) },
        { status: 502 },
      );
    }

    const runId = upstream.headers.get("x-inference-run-id");
    return new Response(upstream.body, {
      status: 200,
      headers: sseHeaders({
        "x-inference-session-id": sessionId,
        ...(runId === null ? {} : { "x-inference-run-id": runId }),
      }),
    });
  } catch (error) {
    if (error instanceof InferenceNotConfiguredError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "inference request failed", detail: message }, { status: 502 });
  }
}
