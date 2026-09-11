import { describe, expect, it } from 'vitest';
import { RiskHistoryRepository } from '../src/riskHistory.js';
import type {
  ChainRiskHistoryRow,
  MarketMakerMetricsRow,
  ProtocolGovernanceHistoryRow,
  SecurityIncidentRow,
} from '../src/types.js';
import { RoutingFakeRunner } from './helpers.js';

/**
 * A chain observation with valid defaults.
 *
 * @param overrides - Fields to replace for a specific case.
 * @returns A complete row.
 */
function chainRow(overrides: Partial<ChainRiskHistoryRow> = {}): ChainRiskHistoryRow {
  return {
    ts: new Date('2026-09-11T00:00:00Z'),
    chainSlug: 'base',
    stage: 'stage-1',
    stateValidation: 'fraud-proofs',
    dataAvailability: 'onchain',
    exitWindow: 'none',
    sequencerFailure: 'self-sequence',
    proposerFailure: 'self-propose',
    challengePeriodDays: 5,
    exitWindowDays: null,
    sequencerDelayHours: 12,
    valueSecuredUsd: 14_570_000_000,
    compositeScore: 0.7,
    raw: { stateValidation: 'Fraud proofs (1R, ZK)' },
    ...overrides,
  };
}

/**
 * A governance observation with valid defaults.
 *
 * @param overrides - Fields to replace for a specific case.
 * @returns A complete row.
 */
function governanceRow(
  overrides: Partial<ProtocolGovernanceHistoryRow> = {},
): ProtocolGovernanceHistoryRow {
  return {
    observedAt: new Date('2026-09-11T00:00:00Z'),
    protocolSlug: 'aave',
    proposalCount: 30,
    openCount: 29,
    recentCount: 30,
    riskProposalCount: 9,
    activityScore: 1.0,
    participationScore: 0.0,
    riskActivityScore: 0.3,
    compositeScore: 0.433,
    raw: {},
    ...overrides,
  };
}

/**
 * A market-maker observation with valid defaults.
 *
 * @param overrides - Fields to replace for a specific case.
 * @returns A complete row.
 */
function makerRow(overrides: Partial<MarketMakerMetricsRow> = {}): MarketMakerMetricsRow {
  return {
    ts: new Date('2026-09-11T00:00:00Z'),
    marketMaker: 'flowdesk',
    grade: 'AA',
    compositeScore: 9.4,
    rank: 1,
    depthUsd: 296_530,
    spreadPct: 0.31,
    volumeUsd: 1_780_000,
    tradingKpis: 10.0,
    trust: 8.5,
    coverageCapabilities: 8.75,
    uptime: 9.3,
    integrationLevel: null,
    activeEngagements: 11,
    fdvUsd: 48_830_000,
    raw: {},
    ...overrides,
  };
}

/**
 * A security incident with valid defaults.
 *
 * @param overrides - Fields to replace for a specific case.
 * @returns A complete row.
 */
function incidentRow(overrides: Partial<SecurityIncidentRow> = {}): SecurityIncidentRow {
  return {
    occurredAt: new Date('2026-09-11T00:00:00Z'),
    incidentId: 'inc-1',
    subject: 'aave',
    subjectKind: 'protocol',
    incidentKind: 'exploit',
    severity: 'high',
    amountUsd: 1_000_000,
    summary: 'A probe incident',
    sourceUrl: 'https://example.test/inc-1',
    raw: {},
    ...overrides,
  };
}

describe('RiskHistoryRepository writes', () => {
  it('inserts chain risk rows with an idempotent conflict clause', async () => {
    const runner = new RoutingFakeRunner().on('INSERT INTO chain_risk_history', [{ chain_slug: 'base' }]);
    const result = await new RiskHistoryRepository(runner).recordChainRisk([chainRow()]);

    expect(result.inserted).toBe(1);
    const query = runner.find('INSERT INTO chain_risk_history');
    // Idempotency is what makes a 6-hourly re-run safe rather than a source of
    // duplicate history.
    expect(query?.text).toContain('ON CONFLICT (chain_slug, ts) DO NOTHING');
    expect(query?.values).toHaveLength(14);
    // The raw jsonb keeps the verbatim source beside the classification.
    expect(query?.values[13]).toContain('Fraud proofs');
  });

  it('inserts governance rows', async () => {
    const runner = new RoutingFakeRunner().on('INSERT INTO protocol_governance_history', [
      { protocol_slug: 'aave' },
    ]);
    const result = await new RiskHistoryRepository(runner).recordGovernance([governanceRow()]);

    expect(result.inserted).toBe(1);
    expect(runner.find('INSERT INTO protocol_governance_history')?.values).toHaveLength(11);
  });

  it('inserts market-maker rows with a nullable integration level', async () => {
    const runner = new RoutingFakeRunner().on('INSERT INTO market_maker_metrics', [
      { market_maker: 'flowdesk' },
    ]);
    const result = await new RiskHistoryRepository(runner).recordMarketMakers([makerRow()]);

    expect(result.inserted).toBe(1);
    const query = runner.find('INSERT INTO market_maker_metrics');
    expect(query?.values).toHaveLength(16);
    // Rank 13 in the tuple is integration_level, which the leaderboard renders
    // empty. It must round-trip as null, not as a fabricated zero.
    expect(query?.values[12]).toBeNull();
  });

  it('inserts incident rows', async () => {
    const runner = new RoutingFakeRunner().on('INSERT INTO security_incidents', [{ subject: 'aave' }]);
    const result = await new RiskHistoryRepository(runner).recordIncidents([incidentRow()]);

    expect(result.inserted).toBe(1);
    expect(runner.find('INSERT INTO security_incidents')?.values).toHaveLength(10);
  });

  it('no-ops on an empty batch without touching the database', async () => {
    const runner = new RoutingFakeRunner();
    const result = await new RiskHistoryRepository(runner).recordChainRisk([]);
    expect(result.inserted).toBe(0);
    // A sweep that collected nothing must not issue a malformed empty INSERT.
    expect(runner.queries).toHaveLength(0);
  });

  it('reports only the rows actually inserted, so a re-run is visibly a no-op', async () => {
    // A conflict returns no row, so a repeated observation reports 0 inserted.
    const runner = new RoutingFakeRunner().on('INSERT INTO chain_risk_history', []);
    const result = await new RiskHistoryRepository(runner).recordChainRisk([chainRow()]);
    expect(result.inserted).toBe(0);
  });

  it('rejects a malformed row before it reaches the database', async () => {
    const runner = new RoutingFakeRunner();
    // composite_score outside 0-1 fails validation, so the write never runs.
    await expect(
      new RiskHistoryRepository(runner).recordChainRisk([chainRow({ compositeScore: 5 })]),
    ).rejects.toThrow();
    expect(runner.queries).toHaveLength(0);
  });
});

describe('RiskHistoryRepository reads', () => {
  const range = { from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-09-30T00:00:00Z') };

  it('reads a chain composite series in chronological order', async () => {
    const runner = new RoutingFakeRunner().on('FROM chain_risk_history', [
      { ts: new Date('2026-09-01T00:00:00Z'), composite_score: '0.70' },
      { ts: new Date('2026-09-02T00:00:00Z'), composite_score: '0.74' },
    ]);
    const series = await new RiskHistoryRepository(runner).chainCompositeSeries('base', range);

    expect(series).toHaveLength(2);
    expect(series[0]?.value).toBeCloseTo(0.7);
    expect(series[1]?.value).toBeCloseTo(0.74);
    // Ascending order is required: a covariate must align index-for-index with
    // the target series, so newest-first would silently reverse it.
    expect(runner.find('FROM chain_risk_history')?.text).toContain('ORDER BY ts ASC');
  });

  it('skips rows with a non-numeric score rather than emitting NaN', async () => {
    const runner = new RoutingFakeRunner().on('FROM chain_risk_history', [
      { ts: new Date('2026-09-01T00:00:00Z'), composite_score: null },
      { ts: new Date('2026-09-02T00:00:00Z'), composite_score: '0.74' },
    ]);
    const series = await new RiskHistoryRepository(runner).chainCompositeSeries('base', range);
    expect(series).toHaveLength(1);
  });

  it('reads a governance composite series', async () => {
    const runner = new RoutingFakeRunner().on('FROM protocol_governance_history', [
      { observed_at: new Date('2026-09-01T00:00:00Z'), composite_score: '0.42' },
    ]);
    const series = await new RiskHistoryRepository(runner).governanceCompositeSeries('aave', range);
    expect(series[0]?.value).toBeCloseTo(0.42);
  });

  it('reads a market-maker depth series, excluding unreported depth', async () => {
    const runner = new RoutingFakeRunner().on('FROM market_maker_metrics', [
      { ts: new Date('2026-09-01T00:00:00Z'), depth_usd: '296530' },
    ]);
    const series = await new RiskHistoryRepository(runner).marketMakerDepthSeries('flowdesk', range);
    expect(series[0]?.value).toBeCloseTo(296_530);
    // Depth is only published for highlighted makers, so the query must exclude
    // rows where it was never reported rather than treating them as zero.
    expect(runner.find('FROM market_maker_metrics')?.text).toContain('depth_usd IS NOT NULL');
  });

  it('counts incidents in a window', async () => {
    const runner = new RoutingFakeRunner().on('FROM security_incidents', [{ n: '3' }]);
    expect(await new RiskHistoryRepository(runner).incidentCount('aave', range)).toBe(3);
  });

  it('reports per-table row counts', async () => {
    const runner = new RoutingFakeRunner().on('FROM chain_risk_history', [
      { table_name: 'chain_risk_history', n: '12' },
      { table_name: 'market_maker_metrics', n: '22' },
    ]);
    const counts = await new RiskHistoryRepository(runner).counts();
    expect(counts['chain_risk_history']).toBe(12);
    expect(counts['market_maker_metrics']).toBe(22);
  });
});
