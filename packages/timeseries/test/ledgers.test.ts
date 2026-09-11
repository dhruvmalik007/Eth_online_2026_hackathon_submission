import { describe, expect, it } from 'vitest';
import { DecisionRepository } from '../src/decisions.js';
import { ForecastRepository, ForecastValidationError } from '../src/forecasts.js';
import type { ForecastRun, ForecastQuantiles } from '../src/types.js';
import { RoutingFakeRunner } from './helpers.js';

const quantiles = (q50: number): ForecastQuantiles => ({
  q10: q50 - 0.02, q20: q50 - 0.015, q30: q50 - 0.01, q40: q50 - 0.005,
  q50, q60: q50 + 0.005, q70: q50 + 0.01, q80: q50 + 0.015, q90: q50 + 0.02,
});

const run = (over: Partial<ForecastRun> = {}): ForecastRun => ({
  runId: '11111111-1111-4111-8111-111111111111',
  poolId: '0xpool',
  metric: 'apy',
  issuedAt: new Date('2026-09-10T00:00:00Z'),
  modelVersion: 'timesfm-3.0',
  contextHash: 'ctx-abc',
  latencyMs: 153,
  steps: [
    { targetTs: new Date('2026-09-11T00:00:00Z'), horizonStep: 1, point: 0.04, quantiles: quantiles(0.04) },
    { targetTs: new Date('2026-09-12T00:00:00Z'), horizonStep: 2, point: 0.041, quantiles: quantiles(0.041) },
  ],
  ...over,
});

const wireRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  run_id: '11111111-1111-4111-8111-111111111111',
  issued_at: new Date('2026-09-10T00:00:00Z'),
  target_ts: new Date('2026-09-11T00:00:00Z'),
  pool_id: '0xpool',
  metric: 'apy',
  horizon_step: 1,
  point: '0.04',
  q10: '0.02', q20: '0.025', q30: '0.03', q40: '0.035', q50: '0.04',
  q60: '0.045', q70: '0.05', q80: '0.055', q90: '0.06',
  model_version: 'timesfm-3.0',
  context_hash: 'ctx-abc',
  latency_ms: '153',
  ...over,
});

describe('ForecastRepository.saveRun', () => {
  it('writes all nine quantiles per step', async () => {
    const r = new RoutingFakeRunner();
    const written = await new ForecastRepository(r).saveRun(run());
    expect(written).toBe(2);
    const q = r.find('INSERT INTO ts_forecasts');
    expect(q?.text).toContain('ON CONFLICT (run_id, issued_at, horizon_step)');
    expect(q?.text).toContain('q10, q20, q30, q40, q50, q60, q70, q80, q90');
    expect(q?.values).toHaveLength(38); // 19 columns × 2 steps
  });

  it('rejects a non-monotonic run before it reaches the database', async () => {
    const broken = run({
      steps: [
        {
          targetTs: new Date('2026-09-11T00:00:00Z'),
          horizonStep: 1,
          point: 0.04,
          // q90 below q50 — incoherent quantiles must never be persisted.
          quantiles: { ...quantiles(0.04), q90: 0.01 },
        },
      ],
    });
    const r = new RoutingFakeRunner();
    await expect(new ForecastRepository(r).saveRun(broken)).rejects.toThrowError(ForecastValidationError);
    expect(r.queries).toHaveLength(0);
  });
});

describe('ForecastRepository.getLatest', () => {
  it('rebuilds the quantile vector from wire rows', async () => {
    const r = new RoutingFakeRunner().on('FROM ts_forecasts_latest', [wireRow()]);
    const latest = await new ForecastRepository(r).getLatest('0xpool', 'apy');
    expect(latest?.runId).toBe('11111111-1111-4111-8111-111111111111');
    expect(latest?.steps).toHaveLength(1);
    expect(latest?.steps[0]!.quantiles).toEqual(quantiles(0.04));
    expect(latest?.steps[0]!.point).toBe(0.04);
  });

  it('returns null when nothing has been stored', async () => {
    const r = new RoutingFakeRunner().on('FROM ts_forecasts_latest', []);
    expect(await new ForecastRepository(r).getLatest('0xpool', 'apy')).toBeNull();
  });
});

describe('ForecastRepository.listRuns / getRun', () => {
  it('summarises one row per run', async () => {
    const r = new RoutingFakeRunner().on('GROUP BY run_id, pool_id, metric', [
      {
        run_id: '11111111-1111-4111-8111-111111111111',
        pool_id: '0xpool',
        metric: 'apy',
        issued_at: new Date('2026-09-10T00:00:00Z'),
        model_version: 'timesfm-3.0',
        context_hash: 'ctx-abc',
        step_count: 30,
      },
    ]);
    const runs = await new ForecastRepository(r).listRuns('0xpool', {
      from: new Date('2026-09-01T00:00:00Z'),
      to: new Date('2026-09-30T00:00:00Z'),
    });
    expect(runs).toHaveLength(1);
    expect(runs[0]!.stepCount).toBe(30);
    expect(runs[0]!.metric).toBe('apy');
  });

  it('skips rows whose metric is not in the catalog', async () => {
    const r = new RoutingFakeRunner().on('GROUP BY run_id, pool_id, metric', [
      { run_id: 'x', pool_id: '0xpool', metric: 'nonsense', issued_at: new Date(), step_count: 1 },
    ]);
    expect(
      await new ForecastRepository(r).listRuns('0xpool', { from: new Date(0), to: new Date() }),
    ).toHaveLength(0);
  });

  it('replays every step of a stored run', async () => {
    const r = new RoutingFakeRunner().on('WHERE run_id = $1', [
      wireRow({ horizon_step: 1 }),
      wireRow({ horizon_step: 2, target_ts: new Date('2026-09-12T00:00:00Z') }),
    ]);
    const stored = await new ForecastRepository(r).getRun('11111111-1111-4111-8111-111111111111');
    expect(stored?.steps).toHaveLength(2);
    expect(stored?.steps[1]!.horizonStep).toBe(2);
  });
});

describe('DecisionRepository', () => {
  const decision = {
    decisionId: '22222222-2222-4222-8222-222222222222',
    decidedAt: new Date('2026-09-10T12:00:00Z'),
    poolId: '0xpool',
    action: 'SUPPLY_CAPITAL' as const,
    sizeUsd: 25_000,
    confidence: 0.72,
    citedForecastIds: ['11111111-1111-4111-8111-111111111111'],
    citedMetricIds: ['metric:0xpool:apy:2026-09-10T00:00:00.000Z'],
    rationale: 'Median path clears the lockup-adjusted hurdle.',
    stateSnapshot: { replanNeeded: 'false' },
    modelVersions: { llm: 'gemini-2.5-flash-lite', timesfm: 'timesfm-3.0' },
  };

  it('records the citation trail the evaluation loop later reads', async () => {
    const r = new RoutingFakeRunner();
    await new DecisionRepository(r).record(decision);
    const q = r.find('INSERT INTO ts_decisions');
    expect(q?.text).toContain('$7::uuid[]');
    expect(q?.text).toContain('$10::jsonb');
    expect(q?.values[6]).toEqual(['11111111-1111-4111-8111-111111111111']);
    expect(q?.values[8]).toContain('hurdle');
  });

  it('parses arrays and jsonb back into a typed decision', async () => {
    const r = new RoutingFakeRunner().on('FROM ts_decisions', [
      {
        decision_id: decision.decisionId,
        decided_at: decision.decidedAt,
        pool_id: '0xpool',
        action: 'SUPPLY_CAPITAL',
        size_usd: '25000',
        confidence: '0.72',
        cited_forecast_ids: ['11111111-1111-4111-8111-111111111111'],
        cited_metric_ids: ['metric:0xpool:apy:x'],
        rationale: 'ok',
        state_snapshot: { replanNeeded: 'false' },
        model_versions: { llm: 'gemini-2.5-flash-lite' },
      },
    ]);
    const history = await new DecisionRepository(r).getHistory('0xpool', {
      from: new Date('2026-09-01T00:00:00Z'),
      to: new Date('2026-09-30T00:00:00Z'),
    });
    expect(history).toHaveLength(1);
    expect(history[0]!.sizeUsd).toBe(25_000);
    expect(history[0]!.citedForecastIds).toHaveLength(1);
    expect(history[0]!.modelVersions['llm']).toBe('gemini-2.5-flash-lite');
  });

  it('drops an unrecognised action rather than storing a bad enum', async () => {
    const r = new RoutingFakeRunner().on('FROM ts_decisions', [
      { decision_id: 'd', decided_at: new Date(), pool_id: 'p', action: 'TELEPORT', rationale: 'x' },
    ]);
    expect(
      await new DecisionRepository(r).getHistory('0xpool', { from: new Date(0), to: new Date() }),
    ).toHaveLength(0);
  });
});
