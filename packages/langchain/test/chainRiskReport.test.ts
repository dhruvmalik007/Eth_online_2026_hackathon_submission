import { describe, expect, it } from "vitest";
import { createChainRiskReportTool, type ChainRiskReader } from "../src/tools/risk/ChainRiskReportTool.js";
import {
  LEVEL_THRESHOLDS,
  buildFactors,
  deriveLevel,
  explainFactor,
  type ChainRiskInput,
} from "../src/tools/risk/riskReport.js";

/** A published reading, shaped as the pipeline writes it. */
function reading(over: Partial<ChainRiskInput> = {}): ChainRiskInput {
  return {
    chainSlug: "optimism",
    stage: "Stage 1",
    compositeScore: 0.15,
    exitWindowDays: 3,
    sequencerDelayHours: 1,
    valueSecuredUsd: 2_400_000_000,
    observedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function readerOf(value: ChainRiskInput | null): ChainRiskReader {
  return { latest: async () => value };
}

describe("deriveLevel", () => {
  it("treats Stage 0 as high regardless of the composite score", () => {
    // A judgement rather than a threshold, and stated as one: operators can still change state with no
    // exit window, and no average compensates for that on a position you intend to hold.
    const { level, rationale } = deriveLevel(reading({ stage: "Stage 0", compositeScore: 0.01 }));

    expect(level).toBe("high");
    expect(rationale).toContain("judgement rather than a threshold");
  });

  it.each([
    [0.05, "low"],
    [0.25, "moderate"],
    [0.45, "elevated"],
    [0.75, "high"],
  ])("maps a composite of %f to %s", (compositeScore, expected) => {
    expect(deriveLevel(reading({ compositeScore })).level).toBe(expected);
  });

  it("raises a comfortable composite when the exit window is long", () => {
    // The metric that decides whether a held position can actually be left, so it is allowed to
    // disagree with the average — which is precisely how a single dimension gets hidden.
    const { level, rationale } = deriveLevel(reading({ compositeScore: 0.05, exitWindowDays: 30 }));

    expect(level).toBe("elevated");
    expect(rationale).toContain("exit window of 30 days");
    expect(rationale).toContain("cannot leave on your own timetable");
  });

  it("raises when the sequencer delay is long", () => {
    const { level, rationale } = deriveLevel(reading({ compositeScore: 0.05, sequencerDelayHours: 72 }));

    expect(level).toBe("elevated");
    expect(rationale).toContain("72-hour sequencer delay");
  });

  it("names the thresholds it used, so a disagreement is with a number", () => {
    expect(LEVEL_THRESHOLDS.exitWindowDays).toBe(7);
    expect(LEVEL_THRESHOLDS.sequencerDelayHours).toBe(24);
  });

  it("does not raise on a window exactly at the ceiling", () => {
    // Inclusive ceilings, so the boundary is a decision rather than an off-by-one.
    expect(deriveLevel(reading({ compositeScore: 0.05, exitWindowDays: 7 })).level).toBe("low");
  });
});

describe("explainFactor", () => {
  it("says an absent input is absent, not zero", () => {
    const reading = explainFactor("alpha", null);

    expect(reading).toContain("absent input is not a zero one");
  });

  it("reads a negative alpha as a position held for exposure rather than income", () => {
    expect(explainFactor("alpha", -0.01)).toContain("held for exposure, not for income");
  });

  it("states the alpha as a rate above the risk-free rate", () => {
    expect(explainFactor("alpha", 0.018)).toContain("1.80% a year above the risk-free rate");
  });

  it("describes beta by magnitude rather than by sign alone", () => {
    expect(explainFactor("beta", 0.5)).toContain("50% as much as the underlying");
    expect(explainFactor("beta", 0.02)).toContain("direction-neutral");
    expect(explainFactor("beta", -0.8)).toContain("opposite direction");
  });

  it("explains negative gamma as impermanent loss, and that it is not linear", () => {
    // The factor most often omitted, and the one a fixed-income holder most needs: being told alpha
    // and beta alone is being told the favourable half.
    const reading = explainFactor("gamma", -0.25);

    expect(reading).toContain("impermanent loss");
    expect(reading).toContain("rather than in proportion");
    expect(reading).toContain("more than twice a half-sized one");
  });

  it("reads a flat gamma as what a fixed-rate position looks like", () => {
    expect(explainFactor("gamma", 0)).toContain("fixed-rate position");
  });
});

describe("buildFactors", () => {
  it("keeps every factor present, with null where nothing was supplied", () => {
    // Omitting a factor from the report would let a reader assume it was fine; a null with a sentence
    // is a statement that it was not measured.
    const factors = buildFactors({ beta: 0.5 });

    expect(factors.map((factor) => factor.id)).toEqual(["alpha", "beta", "gamma"]);
    expect(factors[0]?.value).toBeNull();
    expect(factors[0]?.reading).toContain("absent input is not a zero one");
    expect(factors[1]?.value).toBe(0.5);
  });

  it("carries a meaning independent of the value, so the factor is legible when null", () => {
    for (const factor of buildFactors({})) {
      expect(factor.meaning.length).toBeGreaterThan(20);
    }
  });
});

describe("risk_chain_report tool", () => {
  it("reports an unconfigured store rather than producing a report", async () => {
    const { riskReportTool } = createChainRiskReportTool({});

    const result = JSON.parse(String(await riskReportTool.invoke({ chain: "optimism" })));

    expect(result.status).toBe("risk_snapshots_unavailable");
    expect(result.detail).toContain("RISK_GCS_BUCKET");
  });

  it("reports an absent snapshot as an absence, explicitly not as a clean reading", async () => {
    // The most expensive thing an agent could be told is an all-clear that nothing observed.
    const { riskReportTool } = createChainRiskReportTool({ reader: readerOf(null) });

    const result = JSON.parse(String(await riskReportTool.invoke({ chain: "optimism" })));

    expect(result.status).toBe("no_snapshot");
    expect(result.detail).toContain("not a clean reading");
  });

  it("reports a failed read rather than smoothing it over", async () => {
    const failing: ChainRiskReader = {
      latest: async () => {
        throw new Error("object store timed out");
      },
    };
    const { riskReportTool } = createChainRiskReportTool({ reader: failing });

    const result = JSON.parse(String(await riskReportTool.invoke({ chain: "optimism" })));

    expect(result.status).toBe("risk_read_failed");
    expect(result.detail).toContain("object store timed out");
  });

  it("produces a legible report from a real reading", async () => {
    const { riskReportTool } = createChainRiskReportTool({ reader: readerOf(reading()) });

    const result = JSON.parse(String(await riskReportTool.invoke({ chain: "optimism", beta: 0.5, gamma: -0.2 })));

    expect(result.chain).toBe("optimism");
    expect(result.conclusion.level).toBe("low");
    expect(result.conclusion.rationale).toContain("composite score 0.15");
    expect(result.provenance.source).toBe("risk-analysis-data-pipeline");
    // Units travel with the numbers: 168 is alarming or unremarkable depending on whether it is hours.
    expect(result.metrics).toContainEqual(expect.objectContaining({ id: "l2.exit_window_days", unit: "days" }));
    expect(result.metrics).toContainEqual(expect.objectContaining({ id: "l2.sequencer_delay_hours", unit: "hours" }));
  });

  it("returns the plain sentences as their own field, so a summary need not re-derive them", async () => {
    const { riskReportTool } = createChainRiskReportTool({ reader: readerOf(reading()) });

    const result = JSON.parse(String(await riskReportTool.invoke({ chain: "optimism", gamma: -0.3 })));

    expect(result.plainLanguage.gamma).toContain("impermanent loss");
    expect(result.plainLanguage.alpha).toContain("absent input is not a zero one");
  });

  it("tells the model the level is checkable rather than authoritative", async () => {
    const { riskReportTool } = createChainRiskReportTool({ reader: readerOf(reading()) });

    const result = JSON.parse(String(await riskReportTool.invoke({ chain: "optimism" })));

    expect(result.note).toContain("can be checked rather than trusted");
  });

  it("requires a chain, at the schema rather than in the handler", async () => {
    // Asserted because it is where the requirement lives: a validation the schema performs cannot be
    // bypassed by a caller, whereas a guard in the handler only fires for callers who reach it.
    const { riskReportTool } = createChainRiskReportTool({ reader: readerOf(reading()) });

    await expect(riskReportTool.invoke({} as never)).rejects.toThrow(/did not match expected schema/);
  });
});
