import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import type { InferenceEvent } from "../src/events/contract.js";
import { HeaderAuthenticator } from "../src/http.js";
import type { InferenceRuntime } from "../src/runtime.js";
import { makeRuntime, USER } from "./helpers.js";

function parseSse(body: string): InferenceEvent[] {
  return body
    .split("\n\n")
    .map((frame) => frame.trim())
    .filter((frame) => frame.length > 0 && !frame.startsWith(":"))
    .map((frame) => {
      const data = frame.split("\n").find((line) => line.startsWith("data: "));
      if (data === undefined) throw new Error(`frame has no data line: ${frame.slice(0, 40)}`);
      return JSON.parse(data.slice("data: ".length)) as InferenceEvent;
    });
}

interface Harness {
  readonly app: FastifyInstance;
  readonly runtime: InferenceRuntime;
}

const open: FastifyInstance[] = [];

async function harness(): Promise<Harness> {
  const runtime = makeRuntime();
  const app = buildApp({ runtime, authenticator: new HeaderAuthenticator() });
  await app.ready();
  open.push(app);
  return { app, runtime };
}

afterEach(async () => {
  await Promise.all(open.splice(0).map((app) => app.close()));
});

const auth = { "x-user-id": USER };

async function createSession(app: FastifyInstance): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/sessions",
    headers: auth,
    payload: { agent: "v01" },
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { session: { sessionId: string } }).session.sessionId;
}

describe("HTTP surface", () => {
  it("reports dependency reachability on /health", async () => {
    const { app } = await harness();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string; mode: string; dependencies: { sandbox: { provider: string } } };
    expect(body.mode).toBe("dry");
    expect(body.dependencies.sandbox.provider).toBe("local");
    expect(body.status).toBe("ok");

    // The block that makes "can the agent see pool data?" answerable from outside the process. In a
    // stock deployment the dependency-bearing groups are omitted, and each omission names the setting
    // that would include it — so a silent no-tools agent becomes a diagnosable state.
    const { agent } = res.json() as {
      agent: {
        impl: string;
        modes: { mode: string; tools: number; omitted: { id: string; reason: string }[] }[];
      };
    };
    expect(agent.modes.map((entry) => entry.mode)).toEqual(["v01", "deep"]);
    const v01 = agent.modes.find((entry) => entry.mode === "v01");
    expect(v01?.tools).toBeGreaterThan(0);
    expect(v01?.omitted.find((o) => o.id === "risk")?.reason).toContain("RISK_GCS_BUCKET");
  });

  it("rejects an unauthenticated request", async () => {
    const { app } = await harness();
    const res = await app.inject({ method: "POST", url: "/v1/sessions", payload: {} });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe("UNAUTHORIZED");
  });

  it("creates and reads back a session", async () => {
    const { app } = await harness();
    const sessionId = await createSession(app);
    const res = await app.inject({ method: "GET", url: `/v1/sessions/${sessionId}`, headers: auth });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { session: { sessionId: string } }).session.sessionId).toBe(sessionId);
  });

  it("streams a turn as ordered SSE frames and exposes the run id", async () => {
    const { app } = await harness();
    const sessionId = await createSession(app);

    const res = await app.inject({
      method: "POST",
      url: `/v1/sessions/${sessionId}/turns`,
      headers: auth,
      payload: { query: "rebalance into the best 30d yield", mode: "v01", dry: true },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    const runId = res.headers["x-inference-run-id"];
    expect(typeof runId).toBe("string");

    const events = parseSse(res.body);
    expect(events.length).toBeGreaterThan(5);
    expect(events[0]?.type).toBe("session.started");
    expect(events.at(-1)?.type).toBe("run.completed");
    expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index + 1));
  });

  it("replays a run's journal from a given seq", async () => {
    const { app } = await harness();
    const sessionId = await createSession(app);
    const turn = await app.inject({
      method: "POST",
      url: `/v1/sessions/${sessionId}/turns`,
      headers: auth,
      payload: { query: "q", mode: "v01", dry: true },
    });
    const runId = String(turn.headers["x-inference-run-id"]);

    const all = await app.inject({
      method: "GET",
      url: `/v1/runs/${runId}/events?sinceSeq=0`,
      headers: auth,
    });
    expect(all.statusCode).toBe(200);
    const body = all.json() as { count: number; events: InferenceEvent[]; state: string };
    expect(body.count).toBeGreaterThan(5);
    expect(body.state).toBe("awaiting_user");

    const tail = await app.inject({
      method: "GET",
      url: `/v1/runs/${runId}/events?sinceSeq=${body.events.length - 1}`,
      headers: auth,
    });
    expect((tail.json() as { count: number }).count).toBe(1);
  });

  it("requires a device signature to approve an intent", async () => {
    const { app } = await harness();
    const sessionId = await createSession(app);
    const turn = await app.inject({
      method: "POST",
      url: `/v1/sessions/${sessionId}/turns`,
      headers: auth,
      payload: { query: "q", mode: "v01", dry: true },
    });
    const runId = String(turn.headers["x-inference-run-id"]);

    const replay = await app.inject({
      method: "GET",
      url: `/v1/runs/${runId}/events`,
      headers: auth,
    });
    const events = (replay.json() as { events: InferenceEvent[] }).events;
    const requested = events.find((event) => event.type === "approval.requested");
    if (requested?.type !== "approval.requested") throw new Error("no intent was proposed");
    const intentId = requested.intent.intentId;

    const unsigned = await app.inject({
      method: "POST",
      url: `/v1/sessions/${sessionId}/intents/${intentId}/approve`,
      headers: auth,
      payload: { outcome: "approved" },
    });
    expect(unsigned.statusCode).toBe(400);

    const signed = await app.inject({
      method: "POST",
      url: `/v1/sessions/${sessionId}/intents/${intentId}/approve`,
      headers: auth,
      payload: { outcome: "approved", signature: "0x" + "ab".repeat(65) },
    });
    expect(signed.statusCode).toBe(200);
    expect((signed.json() as { run: { state: string } }).run.state).toBe("signed");
  });

  it("returns a run to draft when the user rejects on the device", async () => {
    const { app } = await harness();
    const sessionId = await createSession(app);
    const turn = await app.inject({
      method: "POST",
      url: `/v1/sessions/${sessionId}/turns`,
      headers: auth,
      payload: { query: "q", mode: "v01", dry: true },
    });
    const runId = String(turn.headers["x-inference-run-id"]);
    const replay = await app.inject({
      method: "GET",
      url: `/v1/runs/${runId}/events`,
      headers: auth,
    });
    const events = (replay.json() as { events: InferenceEvent[] }).events;
    const requested = events.find((event) => event.type === "approval.requested");
    if (requested?.type !== "approval.requested") throw new Error("no intent was proposed");

    const rejected = await app.inject({
      method: "POST",
      url: `/v1/sessions/${sessionId}/intents/${requested.intent.intentId}/approve`,
      headers: auth,
      payload: { outcome: "rejected" },
    });
    expect(rejected.statusCode).toBe(200);
    expect((rejected.json() as { run: { state: string } }).run.state).toBe("draft");
  });

  it("validates the body before starting a run", async () => {
    const { app } = await harness();
    const sessionId = await createSession(app);
    const res = await app.inject({
      method: "POST",
      url: `/v1/sessions/${sessionId}/turns`,
      headers: auth,
      payload: { mode: "v01" },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe("BAD_REQUEST");
  });

  it("404s an unknown run for this identity", async () => {
    const { app } = await harness();
    const res = await app.inject({ method: "GET", url: "/v1/runs/run_missing/events", headers: auth });
    expect(res.statusCode).toBe(404);
  });
});
