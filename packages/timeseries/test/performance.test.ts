import { describe, expect, it } from 'vitest';
import { PerformanceRepository } from '../src/performance.js';
import { RoutingFakeRunner } from './helpers.js';

const range = { from: new Date('2026-08-01T00:00:00Z'), to: new Date('2026-09-30T00:00:00Z') };

describe('PerformanceRepository.getCalibration', () => {
  it('maps per-step calibration rows including pinball loss and coverage', async () => {
    const r = new RoutingFakeRunner().on('FROM v_forecast_calibration', [
      {
        run_id: '11111111-1111-4111-8111-111111111111',
        pool_id: '0xpool',
        metric: 'apy',
        target_ts: new Date('2026-09-11T00:00:00Z'),
        horizon_step: 1,
        forecast_q10: '0.03',
        forecast_q50: '0.04',
        forecast_q90: '0.05',
        actual: '0.045',
        signed_error: '0.005',
        absolute_error: '0.005',
        pinball_loss: '0.0025',
        covered: true,
        model_version: 'timesfm-3.0',
      },
    ]);
    const rows = await new PerformanceRepository(r).getCalibration('0xpool', range);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actual).toBe(0.045);
    expect(rows[0]!.pinballLoss).toBe(0.0025);
    expect(rows[0]!.covered).toBe(true);
  });

  it('applies the metric filter as a parameter, not interpolation', async () => {
    const r = new RoutingFakeRunner().on('FROM v_forecast_calibration', []);
    await new PerformanceRepository(r).getCalibration('0xpool', range, { metric: 'apy', limit: 10 });
    const q = r.find('FROM v_forecast_calibration');
    expect(q?.text).toContain('($4::text IS NULL OR metric = $4)');
    expect(q?.values).toContain('apy');
  });

  it('clamps the limit so a caller cannot ask for the whole table', async () => {
    const r = new RoutingFakeRunner().on('FROM v_forecast_calibration', []);
    await new PerformanceRepository(r).getCalibration('0xpool', range, { limit: 999_999 });
    expect(r.find('FROM v_forecast_calibration')?.values[4]).toBe(5000);
  });
});

describe('PerformanceRepository.getCalibrationSummary', () => {
  it('reads coverage and error aggregates computed in SQL', async () => {
    const r = new RoutingFakeRunner().on('GROUP BY pool_id, metric', [
      {
        pool_id: '0xpool',
        metric: 'apy',
        samples: '120',
        coverage: '0.81',
        mean_pinball_loss: '0.0012',
        mean_absolute_error: '0.0048',
        mape: '0.11',
      },
    ]);
    const summaries = await new PerformanceRepository(r).getCalibrationSummary('0xpool', range);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.coverage).toBe(0.81);
    expect(summaries[0]!.meanAbsolutePercentageError).toBe(0.11);
  });

  it('keeps a null MAPE null instead of coercing it to zero', async () => {
    const r = new RoutingFakeRunner().on('GROUP BY pool_id, metric', [
      { pool_id: '0xpool', metric: 'apy', samples: 1, coverage: 1, mean_pinball_loss: 0, mean_absolute_error: 0, mape: null },
    ]);
    const summaries = await new PerformanceRepository(r).getCalibrationSummary('0xpool', range);
    expect(summaries[0]!.meanAbsolutePercentageError).toBeNull();
  });
});

describe('PerformanceRepository.getRealizedYield', () => {
  it('maps daily buckets', async () => {
    const r = new RoutingFakeRunner().on('FROM v_realized_yield', [
      {
        pool_id: '0xpool',
        bucket_start: new Date('2026-09-01T00:00:00Z'),
        avg_apy: '0.042',
        min_apy: '0.038',
        max_apy: '0.05',
        avg_tvl: '48000000',
        samples: 24,
      },
    ]);
    const rows = await new PerformanceRepository(r).getRealizedYield('0xpool', range);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.avgApy).toBe(0.042);
    expect(rows[0]!.samples).toBe(24);
  });
});

describe('PerformanceRepository.getDecisionOutcomes', () => {
  it('maps the scored decision history', async () => {
    const r = new RoutingFakeRunner().on('FROM v_decision_outcomes', [
      {
        decision_id: '22222222-2222-4222-8222-222222222222',
        pool_id: '0xpool',
        action: 'SUPPLY_CAPITAL',
        size_usd: '25000',
        decided_at: new Date('2026-09-01T12:00:00Z'),
        horizon_end: new Date('2026-09-02T12:00:00Z'),
        realized_apy: '0.051',
        baseline_apy: '0.042',
        outcome_score: '0.009',
      },
    ]);
    const rows = await new PerformanceRepository(r).getDecisionOutcomes('0xpool', range);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.outcomeScore).toBe(0.009);
    expect(rows[0]!.horizonEnd.toISOString()).toBe('2026-09-02T12:00:00.000Z');
  });

  it('tolerates an unscored decision (no realized window yet)', async () => {
    const r = new RoutingFakeRunner().on('FROM v_decision_outcomes', [
      {
        decision_id: 'd',
        pool_id: '0xpool',
        action: 'HOLD',
        size_usd: '0',
        decided_at: new Date('2026-09-29T12:00:00Z'),
        horizon_end: new Date('2026-09-30T12:00:00Z'),
        realized_apy: null,
        baseline_apy: null,
        outcome_score: null,
      },
    ]);
    const rows = await new PerformanceRepository(r).getDecisionOutcomes('0xpool', range);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.outcomeScore).toBeNull();
  });
});
