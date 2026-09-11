import { describe, expect, it } from 'vitest';
import type {
  CalibrationSummary,
  ForecastRepository,
  ForecastRun,
  PerformanceRepository,
  RetrievalHit,
  VectorRepository,
} from '@ethonline2026/timeseries';
import { validateRetrievalEvidence } from '../../src/graph/v01/guardrails.js';
import { runV01, type V01Deps, type V01Input } from '../../src/graph/v01/v01Graph.js';
import type { TimesFM3Client, TimesFMForecast } from '../../src/services/timesfm3/index.js';
import type { TimeseriesClient } from '@ethonline2026/timeseries';

/**
 * Tests for the node-3/node-4 data path that joins TimesFM-3, the ledger and
 * the vector store: does a forecast get persisted with all nine quantiles,
 * does its run id reach agent state, and does ungrounded retrieval get
 * dropped before it can reach the prompt?
 */

// ── fixtures ────────────────────────────────────────────────────────────────

const NINE = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];

function forecastFor(steps: number): TimesFMForecast {
  return {
    target: 'series',
    horizon: steps,
    steps: Array.from({ length: steps }, (_, i) => ({
      index: i,
      q10: 0.04,
      q50: 0.042,
      q90: 0.045,
      quantiles: NINE.map((level) => 0.042 + (level - 0.5) * 0.01),
    })),
    model: 'timesfm-3.0',
    latencyMs: 100,
    flags: { quantileMonotonic: true, scaleSuspicious: false },
  };
}

function fakeTimesfm(): TimesFM3Client {
  return {
    predict: async ({ horizon }: { horizon: number }) => forecastFor(horizon),
    predictProtocol: async () => {
      throw new Error('not used');
    },
  } as unknown as TimesFM3Client;
}

/** 12-hourly history so node 3's minimum-history gate passes. */
function fakeTsdb(): TimeseriesClient {
  const values = Array.from({ length: 12 }, (_, i) => 0.04 + i * 0.0001);
  const timestamps = values.map((_, i) => new Date(Date.UTC(2026, 8, 1, i)));
  return {
    getMetricWindow: async () => ({ poolId: '0xpool', metric: 'apy', timestamps, values }),
  } as unknown as TimeseriesClient;
}

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
  violations: [],
  alpha: [{ id: 'a1', protocol: 'aave-v3', projectionId: 'proj-0xpool-apy', thesis: 'stable' }],
  feasibility: [{ protocol: 'aave-v3', risk: { trendSlope: 0.0002 }, feasible: true }],
});

const DECISIONS_JSON = JSON.stringify([
  {
    action: 'HOLD',
    protocol: 'aave-v3',
    amountPercentage: 100,
    rationale: 'quantile band stable',
    parameters: {},
    citations: ['proj-0xpool-apy'],
  },
]);

const RULES_JSON = `[{"protocol":"aave-v3","sector":"lending","kind":"ltv","boundary":{"ltvMax":0.8},"statement":"max LTV 0.80","source":"docs/aave-v3.md"}]`;

function baseDeps(overrides: Partial<V01Deps> = {}): V01Deps {
  return {
    parserLlm: fakeLlm([RULES_JSON]),
    synthesisLlm: fakeLlm([SYNTHESIS_JSON, DECISIONS_JSON]),
    timesfm3: fakeTimesfm(),
    tsdb: fakeTsdb(),
    ...overrides,
  };
}

// `horizonDays` is required by the inferred input type (the schema supplies a
// default); the graph itself resolves the horizon from deps, so 30 is used.
const INPUT: V01Input = {
  mandate: 'maximize stable yield',
  protocols: ['aave-v3'],
  poolIds: ['0xpool'],
  horizonDays: 30,
};

// ── retrieval guard ─────────────────────────────────────────────────────────

describe('validateRetrievalEvidence', () => {
  const grounded = {
    id: '33333333-3333-4333-8333-333333333333',
    poolId: '0xpool',
    kind: 'metric_window',
    tsStart: '2026-09-01T00:00:00.000Z',
    tsEnd: '2026-09-02T00:00:00.000Z',
    score: 0.91,
    sourceIds: ['metric:0xpool:apy:2026-09-01T00:00:00.000Z'],
    content: 'metric_window pool=0xpool metric=apy samples=24',
  };

  it('admits a chunk whose source ids resolve', () => {
    const { admitted, rejected } = validateRetrievalEvidence([grounded]);
    expect(admitted).toHaveLength(1);
    expect(rejected).toHaveLength(0);
  });

  it('rejects a chunk with no source ids', () => {
    const { admitted, rejected } = validateRetrievalEvidence([{ ...grounded, sourceIds: [] }]);
    expect(admitted).toHaveLength(0);
    expect(rejected[0]).toMatch(/schema invalid/);
  });

  it('rejects a chunk whose source ids are not row ids', () => {
    // A plausible-looking id that names no namespace cannot be resolved.
    const { admitted, rejected } = validateRetrievalEvidence([
      { ...grounded, sourceIds: ['see-the-docs'] },
    ]);
    expect(admitted).toHaveLength(0);
    expect(rejected[0]).toMatch(/unresolvable source id/);
  });

  it('rejects whitespace-only source ids', () => {
    const { admitted } = validateRetrievalEvidence([{ ...grounded, sourceIds: ['   '] }]);
    expect(admitted).toHaveLength(0);
  });

  it('rejects whitespace-only content', () => {
    // Passes the schema's min(1) length check, so the explicit content test
    // is what catches it.
    const { admitted, rejected } = validateRetrievalEvidence([{ ...grounded, content: '   ' }]);
    expect(admitted).toHaveLength(0);
    expect(rejected[0]).toMatch(/empty content/);
  });

  it('rejects a non-finite score', () => {
    const { admitted } = validateRetrievalEvidence([{ ...grounded, score: Number.NaN }]);
    expect(admitted).toHaveLength(0);
  });

  it('keeps the good chunks when some are ungrounded', () => {
    const { admitted, rejected } = validateRetrievalEvidence([
      grounded,
      { ...grounded, id: 'bad', sourceIds: ['nonsense'] },
    ]);
    expect(admitted).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });

  it('admits every id namespace the serializer emits', () => {
    const namespaces = [
      'metric:0xpool:apy:2026-09-01T00:00:00.000Z',
      'forecast:11111111-1111-4111-8111-111111111111:1',
      'decision:22222222-2222-4222-8222-222222222222',
      'yield:0xpool:2026-09-01T00:00:00.000Z',
      'calibration:0xpool:apy',
    ];
    const { admitted } = validateRetrievalEvidence([{ ...grounded, sourceIds: namespaces }]);
    expect(admitted).toHaveLength(1);
  });
});

// ── persistence + retrieval wiring ──────────────────────────────────────────

describe('runV01 — ledger persistence', () => {
  it('persists a run with all nine quantiles and surfaces the run id', async () => {
    const saved: ForecastRun[] = [];
    const forecastRepo = {
      saveRun: async (run: ForecastRun) => {
        saved.push(run);
        return run.steps.length;
      },
    } as unknown as ForecastRepository;

    const state = await runV01(baseDeps({ forecastRepo }), INPUT);

    expect(saved).toHaveLength(1);
    const run = saved[0]!;
    expect(run.poolId).toBe('0xpool');
    expect(run.metric).toBe('apy');
    expect(run.steps).toHaveLength(30);
    // Every persisted level is present and monotonic — the DB CHECK mirrors this.
    expect(run.steps[0]!.quantiles.q10).toBeLessThan(run.steps[0]!.quantiles.q90);
    expect(Object.keys(run.steps[0]!.quantiles)).toHaveLength(9);

    expect(state.forecastRunId).toBe(run.runId);
    expect(state.yieldProjections[0]!.forecastRunId).toBe(run.runId);
    expect(state.audit.some((a) => a.detail.includes('ledger=run'))).toBe(true);
  });

  it('targets the horizon from the issue time so steps line up with realized rows', async () => {
    const saved: ForecastRun[] = [];
    const forecastRepo = {
      saveRun: async (run: ForecastRun) => {
        saved.push(run);
        return run.steps.length;
      },
    } as unknown as ForecastRepository;

    await runV01(baseDeps({ forecastRepo }), INPUT);
    const run = saved[0]!;
    const gap = run.steps[0]!.targetTs.getTime() - run.issuedAt.getTime();
    expect(gap).toBe(86_400_000); // first step is one day out
    expect(run.steps[1]!.horizonStep).toBe(2);
  });

  it('still reasons when the ledger writes fail, recording the reason', async () => {
    const forecastRepo = {
      saveRun: async () => {
        throw new Error('relation "ts_forecasts" does not exist');
      },
    } as unknown as ForecastRepository;

    const state = await runV01(baseDeps({ forecastRepo }), INPUT);

    expect(state.yieldProjections).toHaveLength(1);
    expect(state.forecastRunId).toBeNull();
    expect(state.yieldProjections[0]!.forecastRunId).toBeUndefined();
    expect(state.audit.some((a) => a.detail.includes('not persisted'))).toBe(true);
    // The cycle still completed.
    expect(state.readjustmentDecisions).toHaveLength(1);
  });

  it('omits the run id entirely when no ledger is configured', async () => {
    const state = await runV01(baseDeps(), INPUT);
    expect(state.forecastRunId).toBeNull();
    expect(state.audit.some((a) => a.detail.includes('forecast ledger not configured'))).toBe(true);
  });
});

describe('runV01 — retrieval context', () => {
  const hit = (over: Partial<RetrievalHit> = {}): RetrievalHit => ({
    id: '33333333-3333-4333-8333-333333333333',
    poolId: '0xpool',
    kind: 'metric_window',
    tsStart: new Date('2026-09-01T00:00:00.000Z'),
    tsEnd: new Date('2026-09-02T00:00:00.000Z'),
    sourceIds: ['metric:0xpool:apy:2026-09-01T00:00:00.000Z'],
    content: 'metric_window pool=0xpool metric=apy samples=24',
    score: 0.91,
    ...over,
  });

  it('admits grounded hits into state', async () => {
    const vectorRepo = {
      searchTemporal: async () => [hit()],
    } as unknown as VectorRepository;

    const state = await runV01(baseDeps({ vectorRepo }), INPUT);

    expect(state.evidence).toHaveLength(1);
    expect(state.evidence[0]!.sourceIds).toEqual(['metric:0xpool:apy:2026-09-01T00:00:00.000Z']);
  });

  it('drops ungrounded hits before they reach the prompt', async () => {
    const vectorRepo = {
      searchTemporal: async () => [hit(), hit({ id: 'bad', sourceIds: ['not-a-row-id'] })],
    } as unknown as VectorRepository;

    const state = await runV01(baseDeps({ vectorRepo }), INPUT);

    expect(state.evidence).toHaveLength(1);
    expect(state.evidence[0]!.id).not.toBe('bad');
    expect(state.audit.some((a) => a.detail.includes('rejected 1'))).toBe(true);
  });

  it('degrades to no evidence when the vector layer is unavailable', async () => {
    const vectorRepo = {
      searchTemporal: async () => {
        throw new Error('the `vector` extension is not installed');
      },
    } as unknown as VectorRepository;

    const state = await runV01(baseDeps({ vectorRepo }), INPUT);

    expect(state.evidence).toHaveLength(0);
    expect(state.audit.some((a) => a.detail.includes('vector retrieval unavailable'))).toBe(true);
    expect(state.readjustmentDecisions).toHaveLength(1);
  });

  it('carries SQL calibration into state when it exists', async () => {
    const summary: CalibrationSummary = {
      poolId: '0xpool',
      metric: 'apy',
      samples: 120,
      coverage: 0.81,
      meanPinballLoss: 0.0012,
      meanAbsoluteError: 0.0048,
      meanAbsolutePercentageError: 0.11,
    };
    const performanceRepo = {
      getCalibrationSummary: async () => [summary],
    } as unknown as PerformanceRepository;

    const state = await runV01(baseDeps({ performanceRepo }), INPUT);

    expect(state.calibration?.coverage).toBe(0.81);
    expect(state.calibration?.samples).toBe(120);
    expect(state.audit.some((a) => a.detail.includes('calibration for 0xpool/apy'))).toBe(true);
  });

  it('leaves calibration null when no forecast has matured yet', async () => {
    const performanceRepo = {
      getCalibrationSummary: async () => [],
    } as unknown as PerformanceRepository;

    const state = await runV01(baseDeps({ performanceRepo }), INPUT);
    expect(state.calibration).toBeNull();
  });
});
