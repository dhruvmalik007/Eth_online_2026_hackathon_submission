/**
 * The lineage: durability, the nullable session link, and branded ids.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  RiskThresholdSchema,
  RunIdSchema,
  RunSchema,
  SessionSchema,
  StrategyIdSchema,
  StrategySchema,
} from "../src/index.js";
import type { RunId, StrategyId } from "../src/index.js";

const at = new Date("2026-09-12T03:00:00.000Z");

function strategyFixture() {
  return {
    strategyId: randomUUID(),
    userId: "did:privy:abc123",
    name: "Stablecoin carry",
    mandate: {},
    riskThresholds: [{ metric: "apy", comparison: "below", value: 0.04 }],
    status: "active",
    createdAt: at,
    updatedAt: at,
  };
}

function runFixture() {
  return {
    runId: randomUUID(),
    strategyId: randomUUID(),
    userId: "did:privy:abc123",
    sessionId: null,
    parentRunId: null,
    trigger: "schedule",
    triggerDetail: null,
    mode: "dry",
    startedAt: at,
    finishedAt: null,
  };
}

describe("a strategy is durable and user-owned", () => {
  it("parses with no session reference at all", () => {
    const strategy = StrategySchema.parse(strategyFixture());
    // The durable parent is the user, not a session — a strategy outlives the
    // interaction that created it.
    expect("sessionId" in strategy).toBe(false);
    expect(strategy.userId).toBe("did:privy:abc123");
  });

  it("requires its risk thresholds, since they are what trigger a rebalance", () => {
    expect(StrategySchema.parse(strategyFixture()).riskThresholds).toHaveLength(1);
    expect(StrategySchema.safeParse({ ...strategyFixture(), riskThresholds: undefined }).success).toBe(
      false,
    );
  });

  it("defaults a threshold's hold time to zero", () => {
    const threshold = RiskThresholdSchema.parse({
      metric: "tvl",
      comparison: "below",
      value: 1_000_000,
    });
    expect(threshold.forMinutes).toBe(0);
  });
});

describe("a run is event-triggered", () => {
  it("exists with no session — the 3am rebalance", () => {
    const run = RunSchema.parse(runFixture());
    expect(run.sessionId).toBeNull();
  });

  it("records why a risk-triggered run happened", () => {
    const run = RunSchema.parse({
      ...runFixture(),
      trigger: "risk_breach",
      triggerDetail: {
        metric: "apy",
        comparison: "below",
        threshold: 0.04,
        observed: 0.021,
        reportedAt: "2026-09-12T03:00:00.000Z",
        source: "risk-engine",
      },
    });
    // The dashboard's "why did this run?" answer.
    expect(run.triggerDetail?.observed).toBe(0.021);
    expect(run.triggerDetail?.threshold).toBe(0.04);
  });

  it("refuses a trigger it does not understand", () => {
    expect(RunSchema.safeParse({ ...runFixture(), trigger: "vibes" }).success).toBe(false);
  });
});

describe("sessions are interaction contexts", () => {
  it("carries the thread that makes the agent resumable", () => {
    const session = SessionSchema.parse({
      sessionId: randomUUID(),
      userId: "did:privy:abc123",
      agent: "v01",
      status: "open",
      threadId: "desk-2026-09-12",
      mandateSnapshot: {},
      startedAt: at,
      lastActiveAt: at,
      closedAt: null,
    });
    expect(session.threadId).toBe("desk-2026-09-12");
    expect(session.closedAt).toBeNull();
  });
});

describe("branded identifiers", () => {
  it("validates the uuid shape at runtime", () => {
    expect(RunIdSchema.safeParse("not-a-uuid").success).toBe(false);
    expect(RunIdSchema.safeParse(randomUUID()).success).toBe(true);
  });

  it("stops a run id standing in for a strategy id", () => {
    const runId: RunId = RunIdSchema.parse(randomUUID());
    // @ts-expect-error — branded ids make this the compile error it should be;
    // both are UUIDs, so without the brand the mix-up would be silent.
    const wrong: StrategyId = runId;
    expect(wrong).toBe(runId);
    expect(StrategyIdSchema.safeParse(runId).success).toBe(true);
  });
});
