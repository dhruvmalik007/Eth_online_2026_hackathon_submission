/**
 * Tests for the Merton PD tool's risk-parameter wiring.
 *
 * The behavioural contract has two halves and both matter:
 *
 *  - **Default-preserving.** Without a chain, an injected reader, or a snapshot,
 *    the tool must compute exactly what it did before a risk layer existed. A
 *    regression here would silently change every historical PD.
 *  - **Derived.** With a chain and a snapshot, the three invented parameters are
 *    replaced, each applied to the term it actually governs.
 *
 * The subgraph is faked at the extractor boundary, so these run offline and
 * assert arithmetic rather than network behaviour.
 */

import { describe, expect, it, vi } from 'vitest';
import type { SubgraphClient } from '@ethonline2026/graph-fno-indexer';
import type { RiskProfileReader } from '@ethonline2026/risk-analysis-data-pipeline';
import { MertonPDTool } from '../../src/tools/risk/MertonPDTool.js';
import { chainFixture, fakeRiskReader } from '../helpers/riskFixtures.js';

/**
 * A subgraph stub whose `openPositions` yields fixed rows.
 *
 * `FnoDataExtractor` wraps the client's `collectAll` and unwraps the
 * `positions` key, so the fake returns the *page* shape the client produces
 * rather than the bare array — which is what the extractor actually reads.
 */
function fakeClient(
  positions: readonly { balanceUSD: string; collateralBalanceUSD: string }[],
): SubgraphClient {
  return {
    execute: vi.fn(),
    executeTemplate: vi.fn(async () => ({ positions })),
    collectAll: vi.fn(async () => ({ positions })),
  } as unknown as SubgraphClient;
}

/** Two positions whose collateral ratios differ, so the proxy is non-zero. */
const POSITIONS = [
  { balanceUSD: '1000', collateralBalanceUSD: '1500' },
  { balanceUSD: '1000', collateralBalanceUSD: '1300' },
];

function ok(result: Awaited<ReturnType<MertonPDTool['computeMertonPD']>>): {
  readonly probabilityOfDefault: number;
  readonly assetValue: number;
  readonly assetVolatility: number;
  readonly riskInputs: {
    readonly riskFreeRate: number;
    readonly volatilitySource: string;
    readonly riskFreeRateSource: string;
    readonly collateralHaircutApplied: number;
    readonly pdLoadApplied: number;
    readonly chain: string | null;
  };
} {
  if (!result.success || result.data === undefined) {
    throw new Error(`expected success, got ${result.error ?? 'no data'}`);
  }
  return result.data;
}

describe('MertonPDTool without risk data', () => {
  it('uses the documented defaults when no chain is named', async () => {
    const tool = new MertonPDTool(fakeClient(POSITIONS));
    const data = ok(await tool.computeMertonPD({ poolId: '0xpool', includePositions: true }));

    expect(data.riskInputs.riskFreeRate).toBe(0.05);
    expect(data.riskInputs.riskFreeRateSource).toBe('default');
    expect(data.riskInputs.collateralHaircutApplied).toBe(1);
    expect(data.riskInputs.pdLoadApplied).toBe(1);
    expect(data.riskInputs.volatilitySource).toBe('collateral-ratio-proxy');
    expect(data.riskInputs.chain).toBeNull();
  });

  it('uses the defaults when a chain is named but no reader is attached', async () => {
    // The reader is optional, so naming a chain cannot by itself change the
    // numbers — otherwise the tool would fail or drift for callers that never
    // configured risk data.
    const tool = new MertonPDTool(fakeClient(POSITIONS));
    const data = ok(
      await tool.computeMertonPD({ poolId: '0xpool', includePositions: true, chain: 'base' }),
    );

    expect(data.riskInputs.riskFreeRateSource).toBe('default');
    expect(data.riskInputs.chain).toBeNull();
  });

  it('uses the defaults when the chain has no snapshot', async () => {
    const tool = new MertonPDTool(fakeClient(POSITIONS), fakeRiskReader());
    const data = ok(
      await tool.computeMertonPD({
        poolId: '0xpool',
        includePositions: true,
        chain: 'not-collected',
      }),
    );

    expect(data.riskInputs.riskFreeRateSource).toBe('default');
    expect(data.riskInputs.chain).toBeNull();
  });

  it('applies no haircut, so the asset value is the raw collateral', async () => {
    const tool = new MertonPDTool(fakeClient(POSITIONS));
    const data = ok(await tool.computeMertonPD({ poolId: '0xpool', includePositions: true }));

    // 1500 + 1300 with a 1.0 haircut.
    expect(data.assetValue).toBeCloseTo(2800, 6);
  });

  it('fails cleanly when no pool has positions', async () => {
    const tool = new MertonPDTool(fakeClient([]));
    const result = await tool.computeMertonPD({ poolId: '0xpool', includePositions: true });

    expect(result.success).toBe(false);
    expect(result.error).toContain('No positions');
  });

  it('fails cleanly when no subgraph client is set', async () => {
    const tool = new MertonPDTool();
    const result = await tool.computeMertonPD({ poolId: '0xpool', includePositions: true });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Subgraph client not set');
  });
});

describe('MertonPDTool with derived risk data', () => {
  it('replaces the invented parameters and names their provenance', async () => {
    const tool = new MertonPDTool(fakeClient(POSITIONS), fakeRiskReader());
    const data = ok(
      await tool.computeMertonPD({ poolId: '0xpool', includePositions: true, chain: 'base' }),
    );

    expect(data.riskInputs.chain).toBe('base');
    expect(data.riskInputs.riskFreeRateSource).toBe('derived');
    expect(data.riskInputs.volatilitySource).toBe('derived');
    // A haircut is only meaningful when it actually reduces recoverable value.
    expect(data.riskInputs.collateralHaircutApplied).toBeLessThan(1);
    expect(data.riskInputs.pdLoadApplied).toBeGreaterThanOrEqual(1);
  });

  it('applies the haircut to the asset value', async () => {
    const tool = new MertonPDTool(fakeClient(POSITIONS), fakeRiskReader());
    const data = ok(
      await tool.computeMertonPD({ poolId: '0xpool', includePositions: true, chain: 'base' }),
    );

    expect(data.assetValue).toBeCloseTo(2800 * data.riskInputs.collateralHaircutApplied, 6);
    expect(data.assetValue).toBeLessThan(2800);
  });

  it('raises the risk-free rate above the base by the chain premium', async () => {
    // The derivation adds a chain premium, so a real chain's rate must exceed the
    // bare 5% base — otherwise the premium term is inert.
    const tool = new MertonPDTool(fakeClient(POSITIONS), fakeRiskReader());
    const data = ok(
      await tool.computeMertonPD({ poolId: '0xpool', includePositions: true, chain: 'base' }),
    );

    expect(data.riskInputs.riskFreeRate).toBeGreaterThan(0.05);
  });

  it('produces a lower PD for a safer chain than for a riskier one', async () => {
    // The end-to-end point of the wiring: a chain's risk regime must move the
    // answer. If it did not, applying the adjustment would be decorative.
    const safe = new MertonPDTool(
      fakeClient(POSITIONS),
      fakeRiskReader({ chains: [chainFixture('safe', 0.95)] }),
    );
    const risky = new MertonPDTool(
      fakeClient(POSITIONS),
      fakeRiskReader({ chains: [chainFixture('risky', 0.2)] }),
    );

    const safeData = ok(
      await safe.computeMertonPD({ poolId: '0xpool', includePositions: true, chain: 'safe' }),
    );
    const riskyData = ok(
      await risky.computeMertonPD({ poolId: '0xpool', includePositions: true, chain: 'risky' }),
    );

    expect(riskyData.probabilityOfDefault).toBeGreaterThan(safeData.probabilityOfDefault);
    expect(riskyData.assetValue).toBeLessThan(safeData.assetValue);
  });

  it('keeps the probability of default within 0..1', async () => {
    // pdLoad multiplies the structural PD, so the result must be clamped rather
    // than allowed to exceed a probability.
    const tool = new MertonPDTool(fakeClient(POSITIONS), fakeRiskReader());
    const data = ok(
      await tool.computeMertonPD({ poolId: '0xpool', includePositions: true, chain: 'base' }),
    );

    expect(data.probabilityOfDefault).toBeGreaterThanOrEqual(0);
    expect(data.probabilityOfDefault).toBeLessThanOrEqual(1);
  });

  it('falls back to the defaults when the snapshot read throws', async () => {
    // An unavailable store must not fail a PD that is otherwise computable.
    const broken: RiskProfileReader = {
      ...fakeRiskReader(),
      async chain(): Promise<never> {
        throw new Error('bucket access denied');
      },
    };

    const tool = new MertonPDTool(fakeClient(POSITIONS), broken);
    const data = ok(
      await tool.computeMertonPD({ poolId: '0xpool', includePositions: true, chain: 'base' }),
    );

    expect(data.riskInputs.riskFreeRateSource).toBe('default');
    expect(data.riskInputs.chain).toBeNull();
  });
});
