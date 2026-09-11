/**
 * Temporal mapping tests.
 *
 * The mappings are pure, so they are asserted against the same real
 * Python-emitted fixtures the contract test uses. That keeps the two write paths
 * — snapshot and history — provably reading the same source records, rather than
 * a history row drifting from the snapshot it claims to summarise.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ChainRiskProfileSchema,
  MarketMakerProfileSchema,
  ProtocolGovernanceProfileSchema,
} from '../src/types.js';
import {
  chainRowFromProfile,
  governanceRowFromProfile,
  marketMakerRowFromProfile,
  writeRiskHistory,
  riskHistoryRepository,
} from '../src/temporal.js';
import { RiskHistoryRepository } from '@ethonline2026/timeseries';
import type { SqlRunner } from '@ethonline2026/timeseries';

const CONTRACT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'contract');
const OBSERVED_AT = new Date('2026-09-11T00:00:00Z');

/**
 * Read and validate a contract fixture.
 *
 * @param name - The fixture file name.
 * @returns The parsed document.
 */
function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(CONTRACT_DIR, name), 'utf8'));
}

/**
 * A runner that records statements and returns a fixed insert count.
 *
 * @param inserted - How many rows each insert should report as written.
 * @returns A recording runner.
 */
function recordingRunner(inserted: number): SqlRunner & { readonly statements: string[] } {
  const statements: string[] = [];
  return {
    statements,
    query: async (text: string): Promise<{ rows: Record<string, unknown>[] }> => {
      statements.push(text);
      // A row is returned per inserted row; the repository counts them.
      return { rows: Array.from({ length: inserted }, () => ({ ok: 'probe' })) };
    },
    transaction: async <T,>(fn: (tx: SqlRunner) => Promise<T>): Promise<T> => fn({
      query: async (): Promise<{ rows: Record<string, unknown>[] }> => ({ rows: [] }),
      transaction: () => Promise.reject(new Error('nested')),
    }),
  };
}

describe('chainRowFromProfile', () => {
  it('maps a real chain profile to a history row', () => {
    const profile = ChainRiskProfileSchema.parse(fixture('chain-risk-profile.json'));
    const row = chainRowFromProfile(profile, OBSERVED_AT);

    expect(row.chainSlug).toBe('base');
    expect(row.ts).toEqual(OBSERVED_AT);
    expect(row.stage).toBe('stage-1');
    expect(row.stateValidation).toBe('fraud-proofs');
    expect(row.compositeScore).toBeCloseTo(0.7, 10);
    expect(row.valueSecuredUsd).toBeCloseTo(14_570_000_000);
  });

  it('retains the verbatim dimension strings for audit', () => {
    const profile = ChainRiskProfileSchema.parse(fixture('chain-risk-profile.json'));
    const row = chainRowFromProfile(profile, OBSERVED_AT);
    // The classification is what code branches on; the raw text is what a human
    // checks it against. Losing either makes the row unverifiable.
    expect(row.raw['stateValidation']).toBe('Fraud proofs (1R, ZK)');
    expect(row.raw['sequencerFailure']).toBe('Self sequence');
  });

  it('reports an unstated duration as null, not zero', () => {
    const profile = ChainRiskProfileSchema.parse(fixture('chain-risk-profile.json'));
    const row = chainRowFromProfile(profile, OBSERVED_AT);
    // The Base page states no exit-window duration. Zero would assert a
    // measurement the source never made.
    expect(row.exitWindowDays).toBeNull();
  });
});

describe('governanceRowFromProfile', () => {
  it('maps a real governance profile to a history row', () => {
    const profile = ProtocolGovernanceProfileSchema.parse(
      fixture('protocol-governance-profile.json'),
    );
    const row = governanceRowFromProfile(profile, OBSERVED_AT);

    expect(row.protocolSlug).toBe('aave');
    expect(row.proposalCount).toBe(profile.proposals.length);
    expect(row.compositeScore).toBeCloseTo(profile.governanceScores.composite, 10);
  });

  it('separates total, open and recent counts', () => {
    const profile = ProtocolGovernanceProfileSchema.parse(
      fixture('protocol-governance-profile.json'),
    );
    const row = governanceRowFromProfile(profile, OBSERVED_AT);
    // Three different readings of the same set: history, current workload,
    // liveness. Collapsing them would lose two of the three.
    expect(row.openCount).toBeLessThanOrEqual(row.proposalCount);
    expect(row.recentCount).toBeGreaterThan(0);
    expect(row.recentCount).toBeLessThanOrEqual(row.proposalCount);
  });

  it('counts risk-relevant proposals from the titles', () => {
    const profile = ProtocolGovernanceProfileSchema.parse(
      fixture('protocol-governance-profile.json'),
    );
    const row = governanceRowFromProfile(profile, OBSERVED_AT);
    // The Aave fixture carries ARFC and Risk Stewards topics about caps, IRMs
    // and collateral, so a zero here means the classifier stopped matching.
    expect(row.riskProposalCount).toBeGreaterThan(0);
    expect(row.riskProposalCount).toBeLessThanOrEqual(row.proposalCount);
  });
});

describe('marketMakerRowFromProfile', () => {
  it('maps a real profile and preserves a null integration level', () => {
    const profile = MarketMakerProfileSchema.parse(fixture('market-maker-profile.json'));
    const row = marketMakerRowFromProfile(profile, OBSERVED_AT);

    expect(row.marketMaker).toBe(profile.slug);
    expect(row.grade).toBe(profile.grade);
    expect(row.compositeScore).toBeCloseTo(profile.compositeScore, 10);
    // The leaderboard renders this column empty; null is the honest value.
    expect(row.integrationLevel).toBeNull();
  });

  it('reports unpublished hero metrics as null', () => {
    const profile = MarketMakerProfileSchema.parse(fixture('market-maker-profile.json'));
    const row = marketMakerRowFromProfile({ ...profile, metrics: null }, OBSERVED_AT);

    // Depth/spread/volume appear only for highlighted makers. A profile without
    // them must write nulls rather than zeros, which would read as "no depth".
    expect(row.depthUsd).toBeNull();
    expect(row.spreadPct).toBeNull();
    expect(row.volumeUsd).toBeNull();
  });
});

describe('writeRiskHistory', () => {
  it('writes each family and reports the rows inserted', async () => {
    const chain = ChainRiskProfileSchema.parse(fixture('chain-risk-profile.json'));
    const governance = ProtocolGovernanceProfileSchema.parse(
      fixture('protocol-governance-profile.json'),
    );
    const maker = MarketMakerProfileSchema.parse(fixture('market-maker-profile.json'));

    const runner = recordingRunner(1);
    const { report, errors } = await writeRiskHistory(riskHistoryRepository(runner), {
      observedAt: OBSERVED_AT,
      chains: [chain],
      protocols: [governance],
      marketMakers: [maker],
    });

    expect(errors).toEqual([]);
    expect(report.chainRiskHistory).toBe(1);
    expect(report.protocolGovernanceHistory).toBe(1);
    expect(report.marketMakerMetrics).toBe(1);
    expect(runner.statements.some((s) => s.includes('chain_risk_history'))).toBe(true);
    expect(runner.statements.some((s) => s.includes('market_maker_metrics'))).toBe(true);
  });

  it('skips a family that has no records without issuing a statement', async () => {
    const chain = ChainRiskProfileSchema.parse(fixture('chain-risk-profile.json'));
    const runner = recordingRunner(1);
    await writeRiskHistory(riskHistoryRepository(runner), { observedAt: OBSERVED_AT, chains: [chain] });

    // An empty family must not produce a malformed zero-tuple INSERT.
    expect(runner.statements.some((s) => s.includes('protocol_governance_history'))).toBe(false);
  });

  it('contains a per-table failure instead of abandoning the whole write', async () => {
    const chain = ChainRiskProfileSchema.parse(fixture('chain-risk-profile.json'));
    const maker = MarketMakerProfileSchema.parse(fixture('market-maker-profile.json'));

    let call = 0;
    const runner: SqlRunner = {
      query: async (text: string): Promise<{ rows: Record<string, unknown>[] }> => {
        call += 1;
        // Fail the first table, succeed the second.
        if (call === 1) throw new Error('simulated chain write failure');
        expect(text).toContain('market_maker_metrics');
        return { rows: [{ ok: 'probe' }] };
      },
      transaction: async <T,>(fn: (tx: SqlRunner) => Promise<T>): Promise<T> =>
        fn({ query: async () => ({ rows: [] }), transaction: () => Promise.reject(new Error('nested')) }),
    };

    const { report, errors } = await writeRiskHistory(riskHistoryRepository(runner), {
      observedAt: OBSERVED_AT,
      chains: [chain],
      marketMakers: [maker],
    });

    // The chain series is short and says so; the market-maker series still lands.
    // Losing one covariate must not cost the others.
    expect(report.chainRiskHistory).toBe(0);
    expect(report.marketMakerMetrics).toBe(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('chain_risk_history');
  });

  it('reports a no-op re-run as zero inserted', async () => {
    const chain = ChainRiskProfileSchema.parse(fixture('chain-risk-profile.json'));
    // A conflict clause returns no row, so a repeated observation is visibly a
    // no-op rather than an apparent success.
    const { report } = await writeRiskHistory(riskHistoryRepository(recordingRunner(0)), {
      observedAt: OBSERVED_AT,
      chains: [chain],
    });
    expect(report.chainRiskHistory).toBe(0);
  });
});

describe('riskHistoryRepository', () => {
  it('binds a repository to the injected runner', async () => {
    const runner = recordingRunner(1);
    const repository = riskHistoryRepository(runner);
    expect(repository).toBeInstanceOf(RiskHistoryRepository);
    const result = await repository.recordChainRisk([]);
    expect(result.inserted).toBe(0);
  });
});
