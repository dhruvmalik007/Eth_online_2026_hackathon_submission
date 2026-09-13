/**
 * The HTTP surface.
 *
 * Thin adapters only: every route authenticates, parses, delegates to the
 * runtime, and returns. All state lives in `Orchestrator`, `SessionManager` and
 * the stores, which is why the whole surface is exercisable offline with an
 * injected runtime and a fake authenticator.
 *
 * Route map (all under `/v1`, all `cache-control: no-store`):
 *   POST /v1/sessions                                  → create a session
 *   GET  /v1/sessions/:id                              → session + its intents
 *   POST /v1/sessions/:id/turns                        → SSE: run one agent turn
 *   GET  /v1/runs/:id/events?sinceSeq=                 → replay a run's journal
 *   POST /v1/sessions/:id/intents/:intentId/approve    → resolve a HITL approval
 *   GET  /health                                       → per-dependency reachability
 */
import { canTransition } from "@ethonline2026/execution-domain";
import type { SigningIntent } from "@ethonline2026/custody";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ApprovalOutcome } from "../approvals/ApprovalQueue.js";
import {
  HttpError,
  optionalBool,
  optionalInt,
  optionalString,
  requireString,
  type Authenticator,
} from "../http.js";
import { resolveAgentMode } from "../orchestrator/modes.js";
import { stringList } from "../http.js";
import {
  InvalidMandateIdError,
  MandateNotFoundError,
  loadMandate,
} from "../mandate/registry.js";
import { PoolResolutionError, resolveMandate, type YieldsFeed } from "../mandate/resolve.js";

/**
 * Resolve the pools the agent will be told about — the step that was missing entirely.
 *
 * Explicit `pools`/`protocols` win: an operator who names pools means it, and replacing them with a
 * resolved set would make the request mean something other than what it said.
 *
 * Otherwise a `mandateId` is resolved against the live yields feed. Before this existed the browser
 * sent only a `query`, so `pools` was empty on **every** run: `v01` refuses to start without a protocol
 * and a pool, and the agent therefore had no pool context for LangSmith to show. That is the whole of
 * the "no pool addresses in the trace" symptom.
 */
async function turnScope(
  body: Record<string, unknown>,
  feed: YieldsFeed,
): Promise<{ pools: string[]; protocols: string[] }> {
  const pools = stringList(body, "pools");
  const protocols = stringList(body, "protocols");
  if (pools.length > 0 || protocols.length > 0) return { pools, protocols };

  const mandateId = optionalString(body, "mandateId");
  if (mandateId === undefined) return { pools: [], protocols: [] };

  try {
    const resolved = await resolveMandate(loadMandate(mandateId), feed);
    return { pools: [...resolved.pools], protocols: [...resolved.protocols] };
  } catch (error) {
    // A mandate matching no pool is wrong *input*, not a failing service — and the message already
    // names the filter to relax, so it is passed through rather than wrapped in something vaguer.
    if (
      error instanceof PoolResolutionError ||
      error instanceof MandateNotFoundError ||
      error instanceof InvalidMandateIdError
    ) {
      throw new HttpError("BAD_REQUEST", error.message);
    }
    throw error;
  }
}
import type { InferenceRuntime } from "../runtime.js";
import { createEventStream } from "./stream.js";

const APPROVAL_OUTCOMES: readonly ApprovalOutcome[] = ["approved", "rejected", "expired"];

export function registerRoutes(
  app: FastifyInstance,
  runtime: InferenceRuntime,
  authenticator: Authenticator,
): void {
  app.get("/health", async () => healthReport(runtime));

  app.post("/v1/sessions", async (request, reply) => {
    const userId = await authenticate(authenticator, request);
    const body = bodyOf(request);
    const agent = resolveAgentMode(body, "v01");
    const threadId = optionalString(body, "threadId");
    const session = await runtime.sessions.open({
      userId,
      agent,
      ...(threadId === undefined ? {} : { threadId }),
    });
    reply.code(201);
    return { session };
  });

  app.get("/v1/sessions/:id", async (request) => {
    const userId = await authenticate(authenticator, request);
    const id = requireString(paramsOf(request), "id");
    const session = await runtime.sessions.get(userId, id);
    // Pending intents for this session. The intent carries no session of its own
    // (custody is app-agnostic), so the join is via the run that owns it — which
    // is also what enforces tenancy here.
    const approvals: SigningIntent[] = [];
    for (const entry of runtime.approvals.pending()) {
      const run = await runtime.runs.get(userId, entry.runId);
      if (run?.sessionId === id) approvals.push(entry.intent);
    }
    return { session, approvals };
  });

  /**
   * Run one agent turn and stream its events.
   *
   * `follow: true` keeps the connection open past the turn so the client also
   * receives the later `approval.resolved` event; the default closes when the turn
   * completes, which is what a one-shot consumer (CLI, test) wants.
   */
  app.post("/v1/sessions/:id/turns", async (request, reply) => {
    const userId = await authenticate(authenticator, request);
    const id = requireString(paramsOf(request), "id");
    const body = bodyOf(request);

    const controller = new AbortController();
    reply.raw.on("close", () => {
      if (!reply.raw.writableEnded) controller.abort();
    });

    const follow = optionalBool(body, "follow", false);
    const scope = await turnScope(body, runtime.yieldsFeed);
    const handle = await runtime.orchestrator.beginTurn({
      userId,
      sessionId: id,
      query: requireString(body, "query"),
      mode: resolveAgentMode(body),
      pools: scope.pools,
      protocols: scope.protocols,
      horizonDays: optionalInt(body, "horizonDays", 30, 365),
      dry: optionalBool(
        body,
        "dry",
        runtime.env.INFERENCE_MODE === "dry" || runtime.env.AGENT_IMPL === "mock",
      ),
    });

    reply.header("content-type", "text/event-stream; charset=utf-8");
    reply.header("cache-control", "no-store");
    reply.header("x-inference-run-id", handle.runId);
    return reply.send(
      createEventStream(handle.emitter, {
        heartbeatMs: runtime.env.INFERENCE_SSE_HEARTBEAT_MS,
        signal: controller.signal,
        ...(follow ? {} : { closeOn: ["run.completed"] as const }),
        // Finish the trace while the response is still open. Cloud Run throttles
        // CPU as soon as it closes, so a batch flushed afterwards is dropped and
        // the dashboard silently stays empty.
        beforeEnd: async () => {
          await runtime.orchestrator.drainTrace(handle.runId);
          await runtime.tracing.flush();
        },
      }),
    );
  });

  app.get("/v1/runs/:id/events", async (request) => {
    const userId = await authenticate(authenticator, request);
    const id = requireString(paramsOf(request), "id");
    const run = await runtime.runs.get(userId, id);
    if (run === null) throw new HttpError("NOT_FOUND", `No run ${id} for this identity.`);
    const sinceSeq = optionalInt(
      request.query as Record<string, unknown>,
      "sinceSeq",
      0,
      Number.MAX_SAFE_INTEGER,
    );
    const events = await runtime.journal.read(id, sinceSeq);
    return { runId: id, sinceSeq, count: events.length, state: run.state, events };
  });

  /**
   * Resolve a pending approval.
   *
   * An `approved` outcome requires the device-produced signature — there is no
   * path by which the service approves on the user's behalf. A rejection is a
   * distinct outcome that returns the run to `draft`, not an error.
   */
  app.post("/v1/sessions/:id/intents/:intentId/approve", async (request) => {
    const userId = await authenticate(authenticator, request);
    const params = paramsOf(request);
    const id = requireString(params, "id");
    const intentId = requireString(params, "intentId");
    const body = bodyOf(request);

    const outcome = requireString(body, "outcome");
    if (!(APPROVAL_OUTCOMES as readonly string[]).includes(outcome)) {
      throw new HttpError("BAD_REQUEST", "`outcome` must be one of: approved, rejected, expired.", {
        field: "outcome",
      });
    }
    const suppliedSignature = optionalString(body, "signature");
    const txHash = optionalString(body, "txHash");

    const pending = runtime.approvals.get(intentId);
    if (pending === null) {
      throw new HttpError("NOT_FOUND", `No approval request ${intentId}.`);
    }

    // Establish the signature BEFORE consuming the approval, so a failure to sign
    // leaves the intent open rather than burning it. Two ways an approval can be
    // authorised, and only these two:
    //   1. the caller supplies a signature produced elsewhere (a browser WebHID
    //      Ledger, an external wallet) — verified against the intent's payload;
    //   2. this deployment holds the custodian (Privy server wallet), so it signs.
    // In `dry` mode neither is possible, so an `approved` outcome is refused
    // rather than recorded as if something had been authorised.
    let signatureValid = false;
    let signature: string | null = suppliedSignature ?? null;

    if (outcome === "approved") {
      if (signature !== null) {
        signatureValid = await runtime.custody.verify(pending.intent, signature);
        if (runtime.custody.mode === "live" && !signatureValid) {
          throw new HttpError(
            "BAD_REQUEST",
            "The supplied signature does not authorise this intent (it does not recover to the configured owner).",
          );
        }
      } else if (runtime.custody.mode === "live") {
        const signed = await runtime.custody.sign(pending.intent);
        signature = signed.signature;
        signatureValid = await runtime.custody.verify(pending.intent, signed.signature);
        if (!signatureValid) {
          throw new HttpError("INTERNAL", "The custodian produced a signature that does not verify.");
        }
      } else {
        throw new HttpError(
          "BAD_REQUEST",
          "Approval requires a signature: this deployment has no signer (CUSTODY_SIGNER=dry).",
        );
      }
    }

    const resolved = runtime.approvals.resolve({
      intentId,
      outcome: outcome as ApprovalOutcome,
      ...(signature === null ? {} : { signature }),
    });
    await runtime.custody.record(resolved.intent, resolved.outcome ?? "expired");

    const runId = resolved.runId;
    const run = await runtime.runs.get(userId, runId);
    if (run === null) throw new HttpError("NOT_FOUND", `No run ${runId} for this identity.`);

    const emitter = runtime.hub.get(runId);
    emitter?.emit({
      type: "approval.resolved",
      intentId,
      outcome: resolved.outcome ?? "expired",
      txHash: txHash ?? null,
    });

    const target = outcome === "approved" ? "signed" : "draft";
    if (canTransition(run.state, target)) {
      await runtime.runs.advance(userId, runId, target);
    }
    // Record the decision on the run's trace before the stream ends — it is the
    // most valuable metric on the dashboard and it lands after the model work.
    await runtime.orchestrator.recordApproval(runId, intentId, resolved.outcome ?? "expired");
    // The turn is over either way; a following client replays from the journal.
    runtime.hub.close(runId);

    return {
      approval: {
        intentId,
        sessionId: id,
        outcome: resolved.outcome,
        resolvedAt: resolved.resolvedAt,
        signatureValid,
        /** Present when this deployment signed (a custodian) — the client broadcasts. */
        signature,
      },
      run: { runId, state: target },
    };
  });
}

async function authenticate(
  authenticator: Authenticator,
  request: FastifyRequest,
): Promise<string> {
  return await authenticator.authenticate(request);
}

function bodyOf(request: FastifyRequest): Record<string, unknown> {
  const body = request.body;
  return body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

function paramsOf(request: FastifyRequest): Record<string, unknown> {
  return (request.params ?? {}) as Record<string, unknown>;
}

async function healthReport(runtime: InferenceRuntime): Promise<Record<string, unknown>> {
  const degraded: string[] = [];

  let sandboxOk = false;
  try {
    sandboxOk = await runtime.sandbox.healthy();
  } catch {
    sandboxOk = false;
  }
  if (!sandboxOk) degraded.push("sandbox");

  let forecastOk = false;
  try {
    forecastOk = await runtime.forecasts.healthy();
  } catch {
    forecastOk = false;
  }
  // TimesFM-3 is expected to be unconfigured in dry mode, so only a live
  // deployment treats it as a degradation.
  if (!forecastOk && runtime.env.INFERENCE_MODE === "live") degraded.push("timesfm3");

  // Custody is a real dependency once a signer is configured: a live signer with
  // an unreachable chain cannot build a proposal, so it must not report "ok".
  let custodyOk = true;
  try {
    custodyOk = await runtime.custody.healthy();
  } catch {
    custodyOk = false;
  }
  if (!custodyOk && runtime.custody.mode === "live") degraded.push("custody");

  return {
    service: "@ethonline2026/inferrence",
    status: degraded.length === 0 ? "ok" : "degraded",
    mode: runtime.env.INFERENCE_MODE,
    persistence: runtime.env.INFERENCE_PERSISTENCE,
    agentImpl: runtime.env.AGENT_IMPL,
    // What the agent was actually given, per mode. `agentImpl` alone says which implementation is
    // running but not whether it can see anything — and an agent with no data tools produces a
    // confident report from nothing, which is the failure this block exists to make visible.
    agent: {
      impl: runtime.env.AGENT_IMPL,
      model: runtime.env.VERTEX_AI_MODEL,
      modes: [...runtime.tools.entries()].map(([mode, built]) => ({
        mode,
        tools: built.tools.length,
        registered: built.registered,
        omitted: built.omitted,
      })),
    },
    // Whether traces are actually being emitted, answerable from a curl.
    //
    // The key itself is never reported, only whether one is present, so this is safe to log or paste
    // into a ticket. `enabled: true` with `keyPresent: false` is the state that shows an empty dashboard
    // while claiming tracing is on — the reason this block exists.
    tracing: {
      enabled: runtime.env.LANGSMITH_TRACING,
      keyPresent:
        runtime.env.LANGSMITH_API_KEY !== undefined && runtime.env.LANGSMITH_API_KEY.length > 0,
      endpoint: runtime.env.LANGSMITH_ENDPOINT ?? "https://api.smith.langchain.com",
      project: runtime.env.LANGSMITH_PROJECT,
      ...(runtime.env.LANGSMITH_PROJECT_ID === undefined
        ? {}
        : { projectId: runtime.env.LANGSMITH_PROJECT_ID }),
      ...(runtime.env.LANGSMITH_TRACING &&
      (runtime.env.LANGSMITH_API_KEY === undefined || runtime.env.LANGSMITH_API_KEY.length === 0)
        ? { warning: "enabled with no API key, so nothing is traced — set LANGSMITH_API_KEY" }
        : {}),
    },
    degraded,
    dependencies: {
      database: {
        kind: runtime.env.INFERENCE_PERSISTENCE === "memory" ? "in-memory" : "timescaledb",
        configured: runtime.env.TIMESERIES_DATABASE_URL !== undefined,
      },
      sandbox: {
        provider: runtime.sandbox.name,
        status: sandboxOk ? "ok" : "unavailable",
        ...(runtime.env.SANDBOX_SERVICE_URL === undefined
          ? {}
          : { serviceUrl: runtime.env.SANDBOX_SERVICE_URL }),
      },
      timesfm3: {
        configured: runtime.env.TIMESFM3_SERVICE_URL !== undefined,
        status: forecastOk ? "ok" : "unavailable",
      },
      vertex: {
        project: runtime.models.project,
        location: runtime.models.location,
      },
      custody: {
        mode: runtime.custody.mode,
        chain: runtime.custody.mode === "live" ? runtime.env.CUSTODY_SAFE_CHAIN : null,
        rpcHost: runtime.custody.rpcHost,
        healthy: custodyOk,
      },
      tracing: {
        enabled: runtime.tracing.enabled,
        project: runtime.env.LANGSMITH_PROJECT,
      },
    },
    models: runtime.models.describe(),
    runs: {
      active: runtime.orchestrator.activeRuns,
      capacity: runtime.orchestrator.capacity,
      openStreams: runtime.hub.openRuns,
    },
    startedAt: runtime.startedAt,
  };
}
