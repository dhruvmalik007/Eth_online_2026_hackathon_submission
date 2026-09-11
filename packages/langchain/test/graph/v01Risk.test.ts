/**
 * Tests for the risk-context guardrails and the derivation wrapper.
 *
 * The guardrails exist because a risk payload is the one class of number the
 * synthesis model is handed rather than asked to produce. If a fabricated
 * parameter could enter state, the citation check downstream would be verifying
 * claims against invented evidence — so these tests pin both halves: that a real
 * derivation passes, and that each way of being fabricated fails.
 */

import { describe, expect, it } from 'vitest';
import { rate } from '@ethonline2026/risk-analysis-data-pipeline';
import {
  RiskContextSchema,
  unresolvedRiskCitations,
  validateRiskContext,
  type RiskContext,
} from '../../src/index.js';
import { buildRiskContext, riskContextId } from '../../src/graph/v01/riskContext.js';
import { chainFixture, fakeRiskReader, protocolFixture } from '../helpers/riskFixtures.js';

/** A context that satisfies every check, used as the control. */
function validContext(overrides: Partial<RiskContext> = {}): RiskContext {
  return RiskContextSchema.parse({
    id: 'risk-base',
    chain: 'base',
    chainName: 'Base Chain',
    protocol: 'aave',
    marketMakers: [],
    adjustment: {
      volatility: 0.52,
      riskFreeRate: 0.06,
      collateralHaircut: 0.8,
      pdLoad: 1.1,
      liquidityScore: 0.5,
    },
    volatilitySource: 'fallback',
    factors: [{ name: 'chainComposite', value: 0.7, explanation: 'weighted chain safety' }],
    unresolved: [],
    ...overrides,
  });
}

describe('validateRiskContext', () => {
  it('admits a well-formed derivation', () => {
    const { admitted, rejected } = validateRiskContext(validContext());

    expect(rejected).toEqual([]);
    expect(admitted).not.toBeNull();
    expect(admitted?.id).toBe('risk-base');
  });

  it('rejects a payload that fails the schema', () => {
    const { admitted, rejected } = validateRiskContext({ id: 'risk-base' });

    expect(admitted).toBeNull();
    expect(rejected.length).toBeGreaterThan(0);
  });

  it('rejects a collateral haircut above 1, which the derivation cannot produce', () => {
    // A haircut is a multiplier in (0, 1]. A value above 1 would *increase*
    // recoverable collateral, so it cannot have come from the derivation.
    const bad = validContext();
    const { admitted, rejected } = validateRiskContext({
      ...bad,
      adjustment: { ...bad.adjustment, collateralHaircut: 1.4 },
    });

    expect(admitted).toBeNull();
    expect(rejected.join(' ')).toContain('collateralHaircut=1.4');
  });

  it('rejects a haircut of exactly 0, which would erase the collateral entirely', () => {
    const bad = validContext();
    const { admitted } = validateRiskContext({
      ...bad,
      adjustment: { ...bad.adjustment, collateralHaircut: 0 },
    });

    expect(admitted).toBeNull();
  });

  it('rejects a probability-of-default load below 1', () => {
    // pdLoad only ever increases a structural PD; below 1 would mean chain risk
    // reduced it, which is the opposite of the documented rule.
    const bad = validContext();
    const { admitted } = validateRiskContext({
      ...bad,
      adjustment: { ...bad.adjustment, pdLoad: 0.9 },
    });

    expect(admitted).toBeNull();
  });

  it('rejects a liquidity score outside 0..1', () => {
    const bad = validContext();
    const { admitted } = validateRiskContext({
      ...bad,
      adjustment: { ...bad.adjustment, liquidityScore: 1.2 },
    });

    expect(admitted).toBeNull();
  });

  it('rejects a non-finite parameter at the schema', () => {
    // Finiteness is the schema's job, not the range check's: `z.number()` refuses
    // NaN and Infinity outright, so this never reaches the range comparison.
    const bad = validContext();
    const { admitted, rejected } = validateRiskContext({
      ...bad,
      adjustment: { ...bad.adjustment, volatility: Number.POSITIVE_INFINITY },
    });

    expect(admitted).toBeNull();
    expect(rejected.join(' ')).toContain('volatility');
  });

  it('rejects a zero volatility, which would make the pricing math degenerate', () => {
    // A measured volatility of exactly zero means the series never moved, which
    // is a broken measurement rather than a real observation. Black-Scholes
    // divides by it, so it is refused at the boundary.
    const bad = validContext();
    const { admitted } = validateRiskContext({
      ...bad,
      adjustment: { ...bad.adjustment, volatility: 0 },
    });

    expect(admitted).toBeNull();
  });

  it('rejects an adjustment carrying no factors', () => {
    // Factors are the inputs behind each parameter. An adjustment with none did
    // not come from the derivation, whatever its numbers look like.
    const { admitted, rejected } = validateRiskContext(validContext({ factors: [] }));

    expect(admitted).toBeNull();
    expect(rejected.join(' ')).toContain('no factors');
  });
});

describe('unresolvedRiskCitations', () => {
  it('resolves a citation matching the context in state', () => {
    expect(unresolvedRiskCitations(['risk-base'], validContext())).toEqual([]);
  });

  it('names a citation with no matching context', () => {
    expect(unresolvedRiskCitations(['risk-arbitrum'], validContext())).toEqual(['risk-arbitrum']);
  });

  it('treats any risk citation as unresolved when no context was derived', () => {
    // Without a derived context there is nothing a risk citation could point at,
    // so admitting one would let a model cite a profile that does not exist.
    expect(unresolvedRiskCitations(['risk-base'], null)).toEqual(['risk-base']);
  });

  it('ignores non-risk citations, which the other guards own', () => {
    expect(unresolvedRiskCitations(['proj-1', 'c-aave-v3-ltv'], validContext())).toEqual([]);
  });
});

describe('buildRiskContext', () => {
  it('derives the parameters and stamps the citation id', async () => {
    const context = await buildRiskContext({
      chain: chainFixture('base'),
      protocols: ['aave'],
      readers: fakeRiskReader(),
    });

    expect(context.id).toBe(riskContextId('base'));
    expect(context.chain).toBe('base');
    expect(context.protocol).toBe('aave');
    for (const value of Object.values(context.adjustment)) {
      expect(Number.isFinite(value)).toBe(true);
    }
    // Every parameter is explained, so a caller can say what produced it.
    expect(context.factors.length).toBeGreaterThan(0);
  });

  it('reports volatilitySource=fallback when no volatility is measured', async () => {
    const context = await buildRiskContext({
      chain: chainFixture('base'),
      protocols: ['aave'],
      readers: fakeRiskReader(),
    });

    expect(context.volatilitySource).toBe('fallback');
  });

  it('reports volatilitySource=realized when a measurement is supplied', async () => {
    const context = await buildRiskContext({
      chain: chainFixture('base'),
      protocols: ['aave'],
      readers: fakeRiskReader(),
      realizedVolatility: rate(0.9),
    });

    expect(context.volatilitySource).toBe('realized');
  });

  it('skips a protocol with no snapshot and names it as unresolved', async () => {
    // The first protocol that resolves supplies the governance term, and the rest
    // are named — "no data" must not read as "no governance risk".
    const context = await buildRiskContext({
      chain: chainFixture('base'),
      protocols: ['ghost-protocol', 'aave'],
      readers: fakeRiskReader(),
    });

    expect(context.protocol).toBe('aave');
    expect(context.unresolved).toEqual(['ghost-protocol']);
  });

  it('names every protocol as unresolved when none resolves', async () => {
    const context = await buildRiskContext({
      chain: chainFixture('base'),
      protocols: ['ghost-one', 'ghost-two'],
      readers: fakeRiskReader(),
    });

    expect(context.protocol).toBeNull();
    expect(context.unresolved).toEqual(['ghost-one', 'ghost-two']);
  });

  it('includes only the market makers that resolved', async () => {
    const context = await buildRiskContext({
      chain: chainFixture('base'),
      protocols: ['aave'],
      marketMakers: ['flowdesk', 'ghost-maker'],
      readers: fakeRiskReader(),
    });

    expect(context.marketMakers).toEqual(['flowdesk']);
    expect(context.unresolved).toContain('ghost-maker');
  });

  it('produces a context the guardrail admits', async () => {
    // The two halves of this file must agree: whatever the builder emits has to
    // survive the check that gates it into state.
    const context = await buildRiskContext({
      chain: chainFixture('base'),
      protocols: ['aave'],
      readers: fakeRiskReader(),
    });

    const { admitted, rejected } = validateRiskContext(context);
    expect(rejected).toEqual([]);
    expect(admitted?.id).toBe(context.id);
  });

  it('derives different parameters for chains with different regimes', async () => {
    // A safer chain must not produce the same haircut as a riskier one, or the
    // derivation is decorative.
    const [safe, risky] = await Promise.all([
      buildRiskContext({ chain: chainFixture('safe', 0.95), protocols: [], readers: fakeRiskReader() }),
      buildRiskContext({ chain: chainFixture('risky', 0.2), protocols: [], readers: fakeRiskReader() }),
    ]);

    expect(safe.adjustment.collateralHaircut).toBeGreaterThan(risky.adjustment.collateralHaircut);
    expect(risky.adjustment.pdLoad).toBeGreaterThan(safe.adjustment.pdLoad);
  });
});

describe('riskFixtures', () => {
  it('carries the risk-relevant proposal the tools count', () => {
    // Guards the fixture itself: a rename here would silently make the counting
    // assertions vacuous.
    expect(protocolFixture('aave').proposals[0]?.title).toContain('liquidation');
  });
});
