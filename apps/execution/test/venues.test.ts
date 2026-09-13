/**
 * The venue registry and the approval gate, reached through the routes.
 *
 * The layer's own unit tests pin the dispatch rules. What is checked here is what those cannot:
 *
 * 1. That `apps/execution` actually **uses** the registry, so a leg the agent proposed is planned by a
 *    venue rather than by a placeholder.
 * 2. That **approval** is what permits execution and that a **risk verdict never is** — two separate
 *    decisions by two separate actors, and the split most easily undone by a later edit.
 */
import { describe, expect, it } from "vitest";
import type { ExecutionRepository, SqlRunner } from "@ethonline2026/timeseries";
import type { IntentLeg } from "@ethonline2026/execution-domain";
import type { LegExecutor } from "@ethonline2026/order-execution-layer";
import { buildApp } from "../src/app.js";
import type { ApprovalLimits, MandateSource } from "../src/approval.js";
import { loadExecutionEnv } from "../src/env.js";
import { HeaderAuthenticator } from "../src/http.js";
import type { RiskLevel, RiskReport, RiskReportSource } from "../src/risk.js";
import { createRuntime, type ExecutionRuntime, type RuntimeOverrides } from "../src/runtime.js";
import type { VenuePlan } from "../src/venues.js";

const USER = "did:privy:user-1";
const APPROVER = "did:privy:treasury-1";

const RUN = {
  runId: "r1",
  userId: USER,
  strategyId: "s1",
  status: "planned",
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

class NullRunner implements SqlRunner {
  async query(): Promise<{ rows: Record<string, unknown>[] }> {
    return { rows: [] };
  }
  async transaction<T>(fn: (tx: SqlRunner) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

const swapLeg: IntentLeg = {
  id: "leg-1",
  kind: "swap",
  protocol: "1inch",
  chain: "optimism",
  amountUsd: 1000,
  token: "USDC",
  sourceChain: "optimism",
  intent: "Swap 1000 USDC into the stablecoin leg.",
  resolvable: true,
};

const lendLeg: IntentLeg = { ...swapLeg, id: "leg-2", kind: "lend", protocol: "morpho" };

function executor(id: "1inch", kinds: readonly IntentLeg["kind"][]): LegExecutor<IntentLeg, VenuePlan> {
  return {
    id,
    supports: (leg) => kinds.includes(leg.kind),
    plan: async (leg) => ({ ok: true, quote: { calls: [], note: `${id} planned a ${leg.kind}` } }),
  };
}

function runtimeWith(
  candidates: RuntimeOverrides["venueCandidates"],
  options: {
    readonly risk?: RiskReportSource;
    readonly limits?: ApprovalLimits;
    readonly mandates?: MandateSource;
  } = {},
): ExecutionRuntime {
  return createRuntime({
    env: loadExecutionEnv({}),
    runner: new NullRunner(),
    venueCandidates: candidates,
    // Only `getRun` is reached, and it must return a run so the route proceeds past the 404.
    history: {
      getRun: async () => RUN,
      getRunEvents: async () => [],
    } as unknown as ExecutionRepository,
    ...(options.risk === undefined ? {} : { riskReports: options.risk }),
    ...(options.limits === undefined ? {} : { approvalLimits: options.limits }),
    ...(options.mandates === undefined ? {} : { mandates: options.mandates }),
  });
}

/**
 * A verdict *as the agent would produce it* — a level, a rationale, and the metrics it cited.
 *
 * Note what this fixture cannot express: there is no threshold, because this service does not score.
 * The level is simply whatever the agent concluded.
 */
function verdictSource(level: RiskLevel): RiskReportSource {
  const report: RiskReport = {
    chain: "optimism",
    metrics: [
      { id: "l2.exitWindowHours", label: "Exit window", value: 168, unit: "hours", source: "defillama" },
      { id: "l2.sequencerDependency", label: "Sequencer dependency", value: "single", source: "l2beat" },
    ],
    conclusion: {
      level,
      rationale: "Infrastructure dependency is concentrated in one sequencer and the exit window is long.",
    },
    provenance: {
      source: "risk-analysis-data-pipeline",
      asOf: "2026-01-01T00:00:00.000Z",
      inferredBy: "v01",
    },
  };
  return { latest: async () => report };
}

/** No verdict has been produced yet. */
const noVerdicts: RiskReportSource = { latest: async () => undefined };

function app(runtime: ExecutionRuntime) {
  return buildApp({ runtime, authenticator: new HeaderAuthenticator() });
}

const simulate = (legs: readonly IntentLeg[]) => ({
  method: "POST" as const,
  url: "/runs/r1/simulate",
  headers: { "x-user-id": USER },
  payload: { legs },
});

const intent = (legs: readonly IntentLeg[], extra: Record<string, unknown> = {}) => ({
  method: "POST" as const,
  url: "/intents",
  headers: { "x-user-id": USER },
  payload: { legs, ...extra },
});

describe("the simulate stage reaches the registry", () => {
  it("reports which venue planned each leg", async () => {
    const runtime = runtimeWith([{ id: "1inch", enabled: true, executor: executor("1inch", ["swap"]) }]);

    const response = await app(runtime).inject(simulate([swapLeg]));

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.stage).toBe("simulation");
    expect(payload.venues).toEqual(["1inch"]);
    expect(payload.planned[0]).toMatchObject({ legId: "leg-1", source: "1inch", ok: true });
    expect(payload.planned[0].plan.note).toContain("1inch planned a swap");
  });

  it("reports an unclaimed leg rather than failing the whole plan", async () => {
    // The property that makes a multi-venue rebalance plannable: one leg with nowhere to go must not
    // hide the legs that have somewhere.
    const runtime = runtimeWith([{ id: "1inch", enabled: true, executor: executor("1inch", ["swap"]) }]);

    const planned = (await app(runtime).inject(simulate([swapLeg, lendLeg]))).json().planned;

    expect(planned).toHaveLength(2);
    expect(planned[0].ok).toBe(true);
    expect(planned[1].ok).toBe(false);
    expect(planned[1].source).toBeNull();
    expect(planned[1].reason).toBe("unsupported_pair");
    expect(planned[1].detail).toContain("1inch");
  });

  it("explains an unconfigured deployment as such", async () => {
    // "No venue adapters are registered" and "no venue claims this leg" are different problems.
    const response = await app(runtimeWith([])).inject(simulate([swapLeg]));

    expect(response.json().planned[0].detail).toContain("No venue adapters are registered");
  });

  it("keeps a disabled venue out of the registry and says why", async () => {
    const runtime = runtimeWith([
      { id: "1inch", enabled: false, reason: "ONEINCH_AQUA_ENABLED is false." },
    ]);

    expect(runtime.venues.registry.ids).toEqual([]);
    expect(runtime.venues.status[0]).toMatchObject({ registered: false });
    expect(runtime.venues.status[0]?.detail).toContain("ONEINCH_AQUA_ENABLED");
  });
});

describe("approval is what permits execution", () => {
  it("requires an approver before an intent is approved", async () => {
    // Required by default, and the default is the control: a default that permits eventually permits
    // something nobody chose.
    const runtime = runtimeWith([{ id: "1inch", enabled: true, executor: executor("1inch", ["swap"]) }]);

    const payload = (await app(runtime).inject(intent([swapLeg]))).json();

    expect(payload.approved).toBe(false);
    expect(payload.approval).toMatchObject({ required: true, state: "pending" });
    expect(payload.approval.reason).toContain("required by default");
    // Every leg has a venue — the objection is authorisation, not routing.
    expect(payload.totals.blocked).toBe(0);
  });

  it("approves once an accountable principal has decided", async () => {
    const runtime = runtimeWith([{ id: "1inch", enabled: true, executor: executor("1inch", ["swap"]) }]);

    const payload = (await app(runtime).inject(intent([swapLeg], { approvedBy: APPROVER }))).json();

    expect(payload.approved).toBe(true);
    expect(payload.approval.state).toBe("approved");
  });

  it("still refuses an intent with a leg that has nowhere to go", async () => {
    // Two questions, both of which must be yes. Approving an unroutable leg approves a plan that
    // silently omits it.
    const runtime = runtimeWith([{ id: "1inch", enabled: true, executor: executor("1inch", ["swap"]) }]);

    const payload = (await app(runtime).inject(intent([swapLeg, lendLeg], { approvedBy: APPROVER }))).json();

    expect(payload.approved).toBe(false);
    expect(payload.totals).toEqual({ legs: 2, runnable: 1, blocked: 1 });
  });

  it("forces approval when a leg exceeds the agent's mandate, even with the default switched off", async () => {
    // A mandate that configuration could waive is not a mandate.
    const runtime = runtimeWith(
      [{ id: "1inch", enabled: true, executor: executor("1inch", ["swap"]) }],
      { limits: { requiredByDefault: false, maxSpendUsdPerIntent: 500 } },
    );

    const payload = (await app(runtime).inject(intent([swapLeg]))).json(); // 1000 against a 500 mandate

    expect(payload.approval.required).toBe(true);
    expect(payload.approval.overLimit).toEqual([{ legId: "leg-1", amountUsd: 1000 }]);
    expect(payload.approval.reason).toContain("per intent");
  });

  it("does not require approval when the mandate is off and the notional is within it", async () => {
    const runtime = runtimeWith(
      [{ id: "1inch", enabled: true, executor: executor("1inch", ["swap"]) }],
      { limits: { requiredByDefault: false, maxSpendUsdPerIntent: 10_000 } },
    );

    const payload = (await app(runtime).inject(intent([swapLeg]))).json();

    expect(payload.approval.required).toBe(false);
    expect(payload.approval.state).toBe("not-required");
    expect(payload.approved).toBe(true);
  });
});

describe("risk is presented, never enforced", () => {
  it("shows a high verdict and lets the approval stand", async () => {
    // The correction this feature was rewritten for. Gating execution on an inference would put a
    // scoring bug in the path of funds and would remove the accountable principal exactly where one
    // is required.
    const runtime = runtimeWith(
      [{ id: "1inch", enabled: true, executor: executor("1inch", ["swap"]) }],
      { risk: verdictSource("high") },
    );

    const payload = (await app(runtime).inject(intent([swapLeg], { approvedBy: APPROVER }))).json();

    expect(payload.risk.optimism).toMatchObject({ level: "high", headline: "Risk: high" });
    expect(payload.risk.optimism.detail).toContain("concentrated");
    expect(payload.risk.optimism.metrics).toHaveLength(2);
    expect(payload.approved).toBe(true); // shown, not enforced
  });

  it("renders an absent verdict as unreported rather than as low", async () => {
    // Distinct from every level, including `low`: an absent inference is not a quiet one.
    const runtime = runtimeWith(
      [{ id: "1inch", enabled: true, executor: executor("1inch", ["swap"]) }],
      { risk: noVerdicts },
    );

    const payload = (await app(runtime).inject(intent([swapLeg], { approvedBy: APPROVER }))).json();

    expect(payload.risk.optimism.level).toBe("unreported");
    expect(payload.risk.optimism.detail).toContain("not about the chain");
  });

  it("attaches risk beside the plan rather than inside a leg", async () => {
    // Cost is computed here and risk is inferred elsewhere. A leg carrying its own copy could disagree
    // with its neighbour on the same chain.
    const runtime = runtimeWith(
      [{ id: "1inch", enabled: true, executor: executor("1inch", ["swap"]) }],
      { risk: verdictSource("moderate") },
    );

    const payload = (await app(runtime).inject(simulate([swapLeg]))).json();

    expect(payload.planned[0]).not.toHaveProperty("risk");
    expect(payload.risk.optimism).toMatchObject({ level: "moderate", headline: "Risk: moderate" });
  });
});

describe("agent mandates", () => {
  /** A mandate store that behaves like the table, including the absence case. */
  function mandateStore(initial: { agent: string; maxSpendUsd: number; approvalRequired: boolean }[] = []) {
    const rows = new Map(initial.map((row) => [row.agent, row]));
    return {
      rows,
      source: {
        get: async (_userId: string, agent: string) => rows.get(agent) ?? null,
        set: async (input: { agent: string; mandate: { maxSpendUsd: number; approvalRequired: boolean } }) => {
          rows.set(input.agent, { agent: input.agent, ...input.mandate });
          return input.mandate;
        },
      },
    };
  }

  it("reports absence distinctly from the effective limit", async () => {
    // A form showing only the effective value renders the deployment default as though someone had
    // chosen it.
    const runtime = runtimeWith([], { mandates: mandateStore().source });

    const payload = (
      await app(runtime).inject({ method: "GET", url: "/mandates/v01", headers: { "x-user-id": USER } })
    ).json();

    expect(payload.stored).toBeNull();
    expect(payload.effective).toEqual({ maxSpendUsd: 250_000, approvalRequired: true });
    expect(payload.source).toBe("deployment default");
  });

  it("applies a stored mandate in place of the default", async () => {
    const store = mandateStore([{ agent: "v01", maxSpendUsd: 400, approvalRequired: false }]);
    const runtime = runtimeWith([{ id: "1inch", enabled: true, executor: executor("1inch", ["swap"]) }], {
      mandates: store.source,
    });

    // 1000 USD against a stored 400 mandate: over it, so approval is forced even though the stored
    // mandate switches the default off.
    const payload = (await app(runtime).inject(intent([swapLeg]))).json();

    expect(payload.approval.limitUsd).toBe(400);
    expect(payload.approval.required).toBe(true);
  });

  it("saves a limit through the settings route", async () => {
    const store = mandateStore();
    const runtime = runtimeWith([], { mandates: store.source });

    const response = await app(runtime).inject({
      method: "PUT",
      url: "/mandates/v01",
      headers: { "x-user-id": USER },
      payload: { maxSpendUsd: 12_345, approvalRequired: true },
    });

    expect(response.statusCode).toBe(200);
    expect(store.rows.get("v01")).toMatchObject({ maxSpendUsd: 12_345 });
  });

  it("refuses to save a limit it cannot keep", async () => {
    // A form reporting success against no store is worse than one that says it is not configured.
    const runtime = runtimeWith([]);

    const response = await app(runtime).inject({
      method: "PUT",
      url: "/mandates/v01",
      headers: { "x-user-id": USER },
      payload: { maxSpendUsd: 100 },
    });

    expect(response.statusCode).toBe(503);
  });

  it("rejects a non-positive limit at the route, before it reaches a store", async () => {
    const runtime = runtimeWith([], { mandates: mandateStore().source });

    const response = await app(runtime).inject({
      method: "PUT",
      url: "/mandates/v01",
      headers: { "x-user-id": USER },
      payload: { maxSpendUsd: 0 },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.details.field).toBe("maxSpendUsd");
  });
});
