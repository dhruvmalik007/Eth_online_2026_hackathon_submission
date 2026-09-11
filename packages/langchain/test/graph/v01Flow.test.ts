import { describe, expect, it } from 'vitest';
import type { TimeseriesClient, MetricWindow } from '@ethonline2026/timeseries';
import type { TimesFM3Client, TimesFMForecast } from '../../src/services/timesfm3/index.js';
import { runV01, type V01Deps } from '../../src/graph/v01/v01Graph.js';

/**
 * Offline graph-flow test: canned TimescaleDB windows, canned TimesFM-3
 * forecasts, and a scripted LLM (canned responses that round-trip valid
 * JSON, then a hallucinated response to exercise the citation guardrail).
 */

const HIST = [0.04, 0.041, 0.039, 0.042, 0.04, 0.043, 0.041, 0.044, 0.042, 0.045];

function fakeTsdb(): TimeseriesClient {
  const window: MetricWindow = {
    poolId: '0xpool',
    metric: 'apy',
    timestamps: HIST.map((_, i) => new Date(Date.UTC(2026, 5, i + 1))),
    values: HIST,
  };
  return {
    getMetricWindow: async () => window,
    getMultiSeriesWindow: async () => [window],
    upsertPoolMetrics: async () => 0,
    saveForecast: async () => 1,
    saveBacktestRun: async () => 1,
  } as unknown as TimeseriesClient;
}

function forecastFor(steps: number): TimesFMForecast {
  // Nine monotonic levels per step, mirroring the deployed service's
  // quantile matrix (the ledger persists all of them).
  const nineQuantiles = (q50: number): number[] =>
    [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map((level) => q50 + (level - 0.5) * 0.01);
  const mk = (i: number) => ({
    index: i,
    q10: 0.04,
    q50: 0.042,
    q90: 0.045,
    quantiles: nineQuantiles(0.042),
  });
  return {
    target: 'series',
    horizon: steps,
    steps: Array.from({ length: steps }, (_, i) => mk(i)),
    model: 'timesfm-3.0',
    latencyMs: 100,
    flags: { quantileMonotonic: true, scaleSuspicious: false },
  };
}

function fakeTimesfm(): TimesFM3Client {
  return {
    predict: async ({ horizon }: { horizon: number }) => forecastFor(horizon),
    predictProtocol: async () => {
      throw new Error('not used in v01 test');
    },
  } as unknown as TimesFM3Client;
}

/** Scripted LLM: returns queued responses in order. */
function fakeLlm(responses: string[]) {
  let i = 0;
  return {
    invoke: async () => {
      const r = responses[i];
      i += 1;
      if (r === undefined) throw new Error('no scripted LLM response left');
      return r;
    },
  };
}

const SYNTHESIS_JSON = JSON.stringify({
  violations: [
    { id: 'v1', protocol: 'aave-v3', constraintId: 'c-aave-v3-0-ltv', projectionId: 'proj-0xpool-apy', statement: 'no violation; LTV unused in APY path' },
  ],
  alpha: [
    { id: 'a1', protocol: 'aave-v3', projectionId: 'proj-0xpool-apy', thesis: 'APY band stable at 4.2%±0.05' },
  ],
  feasibility: [{ protocol: 'aave-v3', risk: { trendSlope: 0.0002 }, feasible: true }],
});

const DECISIONS_JSON = JSON.stringify([
  {
    action: 'HOLD', protocol: 'aave-v3', amountPercentage: 100,
    rationale: 'quantile band stable; no alpha above threshold',
    parameters: {}, citations: ['proj-0xpool-apy', 'c-aave-v3-0-ltv'],
  },
]);

function makeDeps(overrides?: Partial<V01Deps>): V01Deps {
  return {
    parserLlm: fakeLlm([`[{"protocol":"aave-v3","sector":"lending","kind":"ltv","boundary":{"ltvMax":0.8},"statement":"max LTV 0.80","source":"docs/protocols/aave-v3.md"}]`]),
    synthesisLlm: fakeLlm([SYNTHESIS_JSON, DECISIONS_JSON]),
    timesfm3: fakeTimesfm(),
    tsdb: fakeTsdb(),
    ...overrides,
  };
}

describe('V01 graph flow (offline)', () => {
  it('runs the 5-node cycle end-to-end with grounded decisions', async () => {
    const state = await runV01(makeDeps(), {
      mandate: 'Assess the APY path and propose a reallocation',
      protocols: ['aave-v3'],
      poolIds: ['0xpool'],
      horizonDays: 5,
    });

    expect(state.rawProtocolRules.length).toBeGreaterThan(0);
    expect(state.protocolConstraints).toHaveLength(1);
    expect(state.yieldProjections).toHaveLength(1);
    expect(state.yieldProjections[0]!.id).toBe('proj-0xpool-apy');
    expect(state.synthesisPayload).toBeDefined();
    expect(state.readjustmentDecisions[0]!.action).toBe('HOLD');
    expect(state.riskAssessment.replanNeeded).toBe(false);
    // audit trail covers all five nodes
    const nodes = state.audit.map((a) => a.node);
    for (const n of ['ingestion', 'ruleParsing', 'yieldPrediction', 'synthesis', 'readjustment']) {
      expect(nodes).toContain(n);
    }
  });

  it('routes to insufficient-history skip when the tsdb window is empty', async () => {
    const emptyTsdb = {
      getMetricWindow: async () => ({ poolId: '0xpool', metric: 'apy' as const, timestamps: [], values: [] }),
      getMultiSeriesWindow: async () => [],
      upsertPoolMetrics: async () => 0,
      saveForecast: async () => 1,
      saveBacktestRun: async () => 1,
    } as unknown as TimeseriesClient;
    const state = await runV01(
      makeDeps({ tsdb: emptyTsdb }),
      { mandate: 'm', protocols: ['aave-v3'], poolIds: ['0xpool'], horizonDays: 5 },
    );
    expect(state.yieldProjections).toHaveLength(0);
    expect(state.audit.some((a) => a.detail.includes('insufficient history'))).toBe(true);
  });

  it('forces a bounded re-plan when guardrails breach, then ends', async () => {
    // Scripted synthesis whose feasibility cites nothing → citation guard
    // breaches → re-plan once (replanCount 1), second round cites properly.
    const badSynthesis = JSON.stringify({
      violations: [{ id: 'v1', protocol: 'aave-v3', constraintId: 'rules/9', projectionId: 'proj-0xpool-apy', statement: 'x' }],
      alpha: [],
      feasibility: [{ protocol: 'aave-v3', risk: {}, feasible: false }],
    });
    const state = await runV01(
      makeDeps({ synthesisLlm: fakeLlm([badSynthesis, SYNTHESIS_JSON, DECISIONS_JSON, SYNTHESIS_JSON, DECISIONS_JSON]) }),
      {
        mandate: 'm',
        protocols: ['aave-v3'],
        poolIds: ['0xpool'],
        horizonDays: 5,
      },
    );
    expect(state.synthesisRuns).toBe(2); // 1 initial + 1 bounded re-plan
    // Round 2's risk assessment is clean (grounded synthesis) — the final
    // state carries the re-computed gate, while the audit shows both rounds.
    expect(state.riskAssessment.replanNeeded).toBe(false);
    // Round 2 produced grounded decisions → readjustment ran twice
    expect(state.audit.filter((a) => a.node === 'readjustment')).toHaveLength(2);
  });
});
