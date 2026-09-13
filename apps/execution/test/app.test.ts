/**
 * Tests for the HTTP surface.
 *
 * Every test supplies fake repositories, so the suite never touches a database —
 * which is the property the composition root exists to enable. The assertions are
 * on behaviour that would otherwise be easy to get wrong: tenant scoping, the
 * error envelope, and the refusal to serve live mode behind a dev authenticator.
 */
import { describe, expect, it } from "vitest";
import type { SqlRunner } from "@ethonline2026/timeseries";
import { buildApp } from "../src/app.js";
import { HeaderAuthenticator, assertDeployable } from "../src/http.js";
import { loadExecutionEnv } from "../src/env.js";
import type { ExecutionRuntime } from "../src/runtime.js";

const USER = "did:privy:user-1";

class NullRunner implements SqlRunner {
  async query(): Promise<{ rows: Record<string, unknown>[] }> {
    return { rows: [] };
  }
  async transaction<T>(fn: (tx: SqlRunner) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

/** A runtime whose repositories record what they were asked for. */
function fakeRuntime(overrides: Record<string, unknown> = {}): {
  runtime: ExecutionRuntime;
  seen: string[];
} {
  const seen: string[] = [];
  const runner = new NullRunner();

  const runtime = {
    env: loadExecutionEnv({}),
    runner,
    sessions: {
      list: async (userId: string) => {
        seen.push(`sessions.list:${userId}`);
        return [];
      },
      get: async () => null,
      open: async (input: { sessionId: string }) => ({ sessionId: input.sessionId }),
      close: async () => true,
    },
    strategies: {
      list: async (userId: string) => {
        seen.push(`strategies.list:${userId}`);
        return [];
      },
      get: async () => null,
      create: async () => ({ strategyId: "s1" }),
    },
    history: {
      getRun: async () => null,
      getRunEvents: async (userId: string) => {
        seen.push(`history.getRunEvents:${userId}`);
        return [];
      },
    },
    ...overrides,
  } as unknown as ExecutionRuntime;

  return { runtime, seen };
}

function app(overrides: Record<string, unknown> = {}): ReturnType<typeof buildApp> {
  const { runtime } = fakeRuntime(overrides);
  return buildApp({ runtime, authenticator: new HeaderAuthenticator() });
}

describe("health", () => {
  it("reports ok when the database answers", async () => {
    const response = await app().inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ok", mode: "dry" });
  });

  it("degrades rather than failing when the database is unreachable", async () => {
    // A health check that 500s cannot be used by a load balancer to drain.
    const broken = {
      query: async () => {
        throw new Error("connection refused");
      },
      transaction: async <T>(fn: (tx: SqlRunner) => Promise<T>) => fn(new NullRunner()),
    };
    const response = await app({ runner: broken }).inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "degraded", database: "unavailable" });
  });
});

describe("authentication", () => {
  it("refuses a request with no identity", async () => {
    const response = await app().inject({ method: "GET", url: "/sessions" });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("UNAUTHORIZED");
  });

  it("scopes every read to the authenticated user, never the request", async () => {
    // The whole security model in one assertion: the id comes from the token, so
    // a query parameter cannot address another user's data.
    const { runtime, seen } = fakeRuntime();
    const instance = buildApp({ runtime, authenticator: new HeaderAuthenticator() });
    await instance.inject({
      method: "GET",
      url: `/sessions?userId=someone-else`,
      headers: { "x-user-id": USER },
    });
    expect(seen).toContain(`sessions.list:${USER}`);
    expect(seen).not.toContain("sessions.list:someone-else");
  });
});

describe("refusing to serve funds behind a spoofable identity", () => {
  it("will not start in live mode with the development authenticator", () => {
    expect(() => assertDeployable("live", new HeaderAuthenticator())).toThrow(/Privy/);
  });

  it("starts in dry mode, because dry cannot broadcast", () => {
    expect(() => assertDeployable("dry", new HeaderAuthenticator())).not.toThrow();
  });
});

describe("not-yet-implemented routes", () => {
  it("says so explicitly rather than faking a submission", async () => {
    // Signing and broadcasting need a configured signer. A route that pretended to submit would be
    // worse than one that admits it is not ready: the caller would act on a result that does not exist.
    for (const url of ["/intents/abc/sign", "/intents/abc/submit"]) {
      const response = await app().inject({ method: "POST", url, headers: { "x-user-id": USER } });
      expect(response.statusCode).toBe(503);
      expect(response.json().error.code).toBe("UNAVAILABLE");
    }
  });

  it("requires the run to exist before simulating it", async () => {
    // Planning legs against a run that is not there would produce a plan nobody can act on, so the
    // missing run is reported rather than the legs being planned into the void.
    const response = await app().inject({
      method: "POST",
      url: "/runs/abc/simulate",
      headers: { "x-user-id": USER },
      payload: { legs: [] },
    });

    expect(response.statusCode).toBe(404);
  });
});

describe("error envelope", () => {
  it("returns 404 for a missing resource", async () => {
    const response = await app().inject({
      method: "GET",
      url: "/sessions/does-not-exist",
      headers: { "x-user-id": USER },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error).toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects a missing required field with the field named", async () => {
    const response = await app().inject({
      method: "POST",
      url: "/strategies",
      headers: { "x-user-id": USER },
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.details.field).toBe("name");
  });
});

describe("the run-events polling fallback", () => {
  it("passes no `since` when absent, so a client gets the whole trace", async () => {
    const { runtime } = fakeRuntime();
    const instance = buildApp({ runtime, authenticator: new HeaderAuthenticator() });
    const response = await instance.inject({
      method: "GET",
      url: "/runs/r1/events",
      headers: { "x-user-id": USER },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ count: 0, events: [] });
  });

  it("rejects a malformed `since` rather than silently ignoring it", async () => {
    // Silently ignoring it would replay the entire trace on every reconnect.
    const response = await app().inject({
      method: "GET",
      url: "/runs/r1/events?since=not-a-date",
      headers: { "x-user-id": USER },
    });
    expect(response.statusCode).toBe(400);
  });
});
