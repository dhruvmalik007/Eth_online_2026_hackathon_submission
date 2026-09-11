import { describe, expect, it } from 'vitest';
import {
  formatNumber,
  hashChunk,
  serializeDecision,
  serializeForecastRun,
  serializeMetricWindow,
  serializePerformanceSlice,
} from '../src/serializer.js';
import type { DecisionRecord, ForecastRun, MetricName } from '../src/types.js';
import type { ForecastQuantiles } from '../src/types.js';

const quantiles = (q50: number): ForecastQuantiles => ({
  q10: q50 - 0.02, q20: q50 - 0.015, q30: q50 - 0.01, q40: q50 - 0.005,
  q50, q60: q50 + 0.005, q70: q50 + 0.01, q80: q50 + 0.015, q90: q50 + 0.02,
});

const metric = (over: Partial<{ poolId: string; metric: MetricName }> = {}) =>
  serializeMetricWindow({
    poolId: over.poolId ?? '0xpool',
    metric: over.metric ?? 'apy',
    points: [
      { ts: new Date('2026-09-09T00:00:00Z'), value: 0.04 },
      { ts: new Date('2026-09-09T01:00:00Z'), value: 0.05 },
    ],
  });

describe('serializeMetricWindow', () => {
  it('emits one citation-tagged line per observation', () => {
    const chunk = metric();
    expect(chunk.kind).toBe('metric_window');
    expect(chunk.sourceIds).toEqual([
      'metric:0xpool:apy:2026-09-09T00:00:00.000Z',
      'metric:0xpool:apy:2026-09-09T01:00:00.000Z',
    ]);
    expect(chunk.content).toContain('[metric:0xpool:apy:2026-09-09T00:00:00.000Z] apy=0.040000');
    expect(chunk.content).toContain('samples=2');
  });

  it('orders points chronologically regardless of input order', () => {
    const chunk = serializeMetricWindow({
      poolId: '0xpool',
      metric: 'tvl',
      points: [
        { ts: new Date('2026-09-09T02:00:00Z'), value: 3 },
        { ts: new Date('2026-09-09T00:00:00Z'), value: 1 },
      ],
    });
    expect(chunk.sourceIds[0]).toContain('T00:00:00');
    expect(chunk.tsStart.toISOString()).toBe('2026-09-09T00:00:00.000Z');
    expect(chunk.tsEnd.toISOString()).toBe('2026-09-09T02:00:00.000Z');
  });

  it('is byte-stable for identical input', () => {
    expect(metric().content).toBe(metric().content);
    expect(hashChunk(metric())).toBe(hashChunk(metric()));
  });

  it('refuses an empty window', () => {
    expect(() => serializeMetricWindow({ poolId: 'p', metric: 'apy', points: [] })).toThrow();
  });
});

describe('serializeForecastRun', () => {
  const run: ForecastRun = {
    runId: '11111111-1111-4111-8111-111111111111',
    poolId: '0xpool',
    metric: 'apy',
    issuedAt: new Date('2026-09-10T00:00:00Z'),
    modelVersion: 'timesfm-3.0',
    contextHash: 'ctx',
    steps: [
      { targetTs: new Date('2026-09-11T00:00:00Z'), horizonStep: 1, point: 0.04, quantiles: quantiles(0.04) },
      { targetTs: new Date('2026-09-12T00:00:00Z'), horizonStep: 2, point: 0.041, quantiles: quantiles(0.041) },
    ],
  };

  it('cites every horizon step', () => {
    const chunk = serializeForecastRun(run);
    expect(chunk.kind).toBe('forecast_run');
    expect(chunk.sourceIds).toEqual([
      'forecast:11111111-1111-4111-8111-111111111111:1',
      'forecast:11111111-1111-4111-8111-111111111111:2',
    ]);
  });

  it('includes all nine quantiles so retrieval carries the full risk picture', () => {
    const chunk = serializeForecastRun(run);
    const line = chunk.content.split('\n').find((l) => l.startsWith('[forecast:'))!;
    for (const column of ['q10', 'q20', 'q30', 'q40', 'q50', 'q60', 'q70', 'q80', 'q90']) {
      expect(line).toContain(`${column}=`);
    }
  });
});

describe('serializeDecision', () => {
  const decision: DecisionRecord = {
    decisionId: '22222222-2222-4222-8222-222222222222',
    decidedAt: new Date('2026-09-10T12:00:00Z'),
    poolId: '0xpool',
    action: 'SUPPLY_CAPITAL',
    sizeUsd: 25_000,
    confidence: 0.72,
    citedForecastIds: ['11111111-1111-4111-8111-111111111111'],
    citedMetricIds: ['metric:0xpool:apy:x'],
    rationale: 'Clears the hurdle.',
    stateSnapshot: {},
    modelVersions: { llm: 'gemini-2.5-flash-lite' },
  };

  it('cites itself and the forecasts it relied on', () => {
    const chunk = serializeDecision(decision);
    expect(chunk.sourceIds).toEqual([
      'decision:22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',
    ]);
    expect(chunk.content).toContain('cited_metric=metric:0xpool:apy:x');
  });
});

describe('serializePerformanceSlice', () => {
  it('renders realized yield and calibration figures with citations', () => {
    const chunk = serializePerformanceSlice({
      poolId: '0xpool',
      realized: [
        {
          poolId: '0xpool',
          bucketStart: new Date('2026-09-01T00:00:00Z'),
          avgApy: 0.042, minApy: 0.038, maxApy: 0.05, avgTvl: 48_000_000, samples: 24,
        },
      ],
      calibration: [
        {
          poolId: '0xpool', metric: 'apy', samples: 120, coverage: 0.81,
          meanPinballLoss: 0.0012, meanAbsoluteError: 0.0048, meanAbsolutePercentageError: 0.11,
        },
      ],
    });
    expect(chunk?.kind).toBe('performance_slice');
    expect(chunk?.content).toContain('[yield:0xpool:2026-09-01T00:00:00.000Z]');
    expect(chunk?.content).toContain('[calibration:0xpool:apy]');
    expect(chunk?.content).toContain('coverage=0.810000');
  });

  it('returns null when there is no realized history to embed', () => {
    expect(serializePerformanceSlice({ poolId: 'p', realized: [], calibration: [] })).toBeNull();
  });
});

describe('formatNumber', () => {
  it('pins precision so re-serialization is stable', () => {
    expect(formatNumber(0.1 + 0.2)).toBe('0.300000');
    expect(formatNumber(1234.5, 2)).toBe('1234.50');
  });

  it('renders non-finite values as null rather than NaN', () => {
    expect(formatNumber(Number.NaN)).toBe('null');
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe('null');
  });
});
