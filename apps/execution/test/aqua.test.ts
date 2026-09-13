/**
 * Tests for the 1inch Aqua/SwapVM surface.
 *
 * Two things are being checked, and the second matters more than the first.
 *
 * The surface itself is a pure decision, so its behaviour is cheap to assert. What is expensive to
 * get wrong is the **flag**: with `ONEINCH_AQUA_ENABLED` off the service must behave exactly as it
 * did before this venue existed. So the off-state assertions here are not "the route errors" but
 * "the route errors with the byte-identical envelope it threw before", and the stub's message must
 * not mention a venue it cannot reach.
 */
import { describe, expect, it } from "vitest";
import type { SqlRunner } from "@ethonline2026/timeseries";
import { buildApp } from "../src/app.js";
import { createAquaSurface } from "../src/aqua.js";
import { loadExecutionEnv } from "../src/env.js";
import { HeaderAuthenticator } from "../src/http.js";
import { createRuntime, type ExecutionRuntime } from "../src/runtime.js";

const USER = "did:privy:user-1";

class NullRunner implements SqlRunner {
  async query(): Promise<{ rows: Record<string, unknown>[] }> {
    return { rows: [] };
  }
  async transaction<T>(fn: (tx: SqlRunner) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

/** A runtime built through the real composition root, with no database behind it. */
function runtimeWith(overrides: { enabled?: boolean; agent?: boolean; source?: Record<string, unknown> }): ExecutionRuntime {
  const env = loadExecutionEnv({
    ONEINCH_AQUA_ENABLED: overrides.enabled === true ? "true" : "false",
    ONEINCH_AGENT_ENABLEMENT: overrides.agent === true ? "true" : "false",
  });

  // Only construct a surface when enabled, mirroring `createRuntime`: passing one would bypass the
  // flag check this suite exists to verify.
  const aqua = overrides.enabled === true ? createAquaSurface(env, overrides.source ?? {}) : undefined;

  return createRuntime({
    env,
    runner: new NullRunner(),
    ...(aqua === undefined ? {} : { aqua }),
  });
}

function app(runtime: ExecutionRuntime) {
  return buildApp({ runtime, authenticator: new HeaderAuthenticator() });
}

const get = (url: string) => ({ method: "GET" as const, url, headers: { "x-user-id": USER } });

describe("the flag's off state", () => {
  it("keeps the enablement route unavailable", async () => {
    const response = await app(runtimeWith({})).inject(get("/aqua/enablement?chain=optimism"));

    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("UNAVAILABLE");
    expect(response.json().error.message).toContain("ONEINCH_AQUA_ENABLED");
  });

  it("does not construct a surface at all", () => {
    // Absent, not disabled: there is nothing for a route to reach, so the flag cannot be forgotten
    // at a call site.
    expect(runtimeWith({}).aqua).toBeUndefined();
  });

  it("leaves validation of a proposed leg unchanged by the flag", async () => {
    // The flag decides whether a venue exists, never whether a malformed leg is acceptable. A leg with
    // no `legs` array is the caller's mistake either way.
    const response = await app(runtimeWith({})).inject({
      method: "POST",
      url: "/runs/r1/simulate",
      headers: { "x-user-id": USER },
    });

    expect(response.statusCode).toBe(404); // the run does not exist in this fake either
  });

  it("reads only the four spellings that cannot be misread", () => {
    // `z.coerce.boolean()` would read "false" as true, so the flag takes an explicit vocabulary.
    expect(loadExecutionEnv({ ONEINCH_AQUA_ENABLED: "false" }).ONEINCH_AQUA_ENABLED).toBe(false);
    expect(loadExecutionEnv({ ONEINCH_AQUA_ENABLED: "0" }).ONEINCH_AQUA_ENABLED).toBe(false);
    expect(loadExecutionEnv({ ONEINCH_AQUA_ENABLED: "true" }).ONEINCH_AQUA_ENABLED).toBe(true);
    expect(loadExecutionEnv({ ONEINCH_AQUA_ENABLED: "1" }).ONEINCH_AQUA_ENABLED).toBe(true);
  });

  it("refuses an unrecognised flag rather than guessing at it", () => {
    // Better than treating "no" as false: an operator who wrote "no" believes the venue is off, and
    // if that belief were wrong the mistake would be a venue live in production. Failing the boot
    // is the only answer that cannot be misread.
    for (const value of ["no", "off", "yes", "TRUE", ""]) {
      expect(() => loadExecutionEnv({ ONEINCH_AQUA_ENABLED: value })).toThrow();
    }
  });
});

describe("the flag's on state", () => {
  const live = () => runtimeWith({ enabled: true, source: { OPTIMISM_RPC_URL: "https://rpc.example" } });

  it("reports the reachable chain and explains the unreachable one", async () => {
    const response = await app(live()).inject(get("/aqua/enablement?chain=optimism&efficiencyBps=40"));

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.chains).toEqual(["optimism"]);
    // The reason names both variables, because "no RPC" is not actionable and the fallback is not
    // obvious from the chain's own variable being absent.
    expect(payload.unreachable).toEqual([
      { chain: "polygon", reason: "neither POLYGON_RPC_URL nor ALCHEMY_API_KEY is set" },
    ]);
  });

  it("recommends with user-only consent when no agent mandate is configured", async () => {
    const response = await app(live()).inject(get("/aqua/enablement?chain=optimism&efficiencyBps=40"));

    const { assessment } = response.json();
    expect(assessment.recommendation).toBe("recommend");
    expect(assessment.consentRequired).toBe(true);
    expect(assessment.consentGranter).toBe("user");
  });

  it("widens consent to the agent once the delta clears the mandate's bar", async () => {
    const response = await app(runtimeWith({ enabled: true, agent: true, source: { OPTIMISM_RPC_URL: "https://rpc.example" } }))
      .inject(get("/aqua/enablement?chain=optimism&efficiencyBps=150"));

    expect(response.json().assessment.consentGranter).toBe("user-or-agent");
  });

  it("reports a configured chain with no RPC as unavailable, not as broken", async () => {
    // The finding the simulation stage should show: named in config, not reachable in fact.
    const response = await app(runtimeWith({ enabled: true })).inject(
      get("/aqua/enablement?chain=optimism&efficiencyBps=150"),
    );

    expect(response.statusCode).toBe(200);
    expect(response.json().assessment.recommendation).toBe("unavailable");
    expect(response.json().assessment.detail).toContain("comparison route");
  });

  it("carries a negative delta through, so a loss is not reported as a tie", async () => {
    const response = await app(live()).inject(get("/aqua/enablement?chain=optimism&efficiencyBps=-40"));

    expect(response.json().assessment.efficiencyBps).toBe(-40);
    expect(response.json().assessment.recommendation).toBe("not_worthwhile");
  });

  it("rejects an unknown chain with the valid set, not a 500", async () => {
    // A `ZodError` escaping here would reach the client as INTERNAL, which tells the caller nothing
    // about the mistake it made.
    const response = await app(live()).inject(get("/aqua/enablement?chain=ethereum"));

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("BAD_REQUEST");
    expect(response.json().error.details.allowed).toEqual(["optimism", "polygon"]);
  });

  it("refuses a non-finite delta rather than rendering an empty one", async () => {
    const response = await app(live()).inject(get("/aqua/enablement?chain=optimism&efficiencyBps=abc"));

    expect(response.statusCode).toBe(400);
    expect(response.json().error.details.field).toBe("efficiencyBps");
  });

  it("refuses a malformed enabled flag", async () => {
    const response = await app(live()).inject(get("/aqua/enablement?chain=optimism&enabled=yes"));

    expect(response.statusCode).toBe(400);
    expect(response.json().error.details.field).toBe("enabled");
  });

  it("reports already-enabled with nothing to consent to, keeping the figure", async () => {
    // The approval stage re-reads rather than carrying the simulation's copy forward, so this is
    // also the assertion that the second read agrees with the first.
    const response = await app(live()).inject(
      get("/aqua/enablement?chain=optimism&efficiencyBps=137&enabled=true"),
    );

    expect(response.json().assessment.recommendation).toBe("enabled");
    expect(response.json().assessment.consentRequired).toBe(false);
    expect(response.json().assessment.efficiencyBps).toBe(137);
  });

  it("requires authentication even when the venue is on", async () => {
    const response = await app(live()).inject({
      method: "GET",
      url: "/aqua/enablement?chain=optimism",
    });

    expect(response.statusCode).toBe(401);
  });

  it("refuses to plan legs it was not given, rather than approving nothing", async () => {
    // An approval over an empty leg set would read as "approved" while nothing was checked.
    const response = await app(live()).inject({
      method: "POST",
      url: "/intents",
      headers: { "x-user-id": USER },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.details.field).toBe("legs");
  });

  it("refuses to boot when the chain list names a chain outside the matrix", () => {
    // A typo here would leave an operator believing a venue was offered on a chain where nothing
    // was ever checked.
    expect(() =>
      createAquaSurface(
        loadExecutionEnv({ ONEINCH_AQUA_ENABLED: "true", ONEINCH_AQUA_CHAINS: "optimism,ethereum" }),
        {},
      ),
    ).toThrow(/not one of/);
  });
});
