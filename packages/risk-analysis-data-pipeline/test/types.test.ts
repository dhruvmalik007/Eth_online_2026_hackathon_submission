/**
 * Type-level tests for the package's public contract.
 *
 * These assert on *types*, not values: `expectTypeOf` is resolved by TypeScript,
 * so a mismatch is a compile error rather than a failing assertion. That matters
 * because the typecheck gate is where they bite — there is no runtime path that
 * could let a drifted signature through.
 *
 * The runtime assertions are deliberately trivial; the value here is entirely in
 * the compile-time checks around them.
 */

import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  bps,
  days,
  pct,
  rate,
  usd,
  type Bps,
  type ChainRiskProfile,
  type CovariateMatrix,
  type CovariateSource,
  type Days,
  type DecimalRate,
  type Loaded,
  type Pct,
  type RiskProfileReader,
  type Usd,
} from '../src/index.js';

describe('branded units', () => {
  it('marks each unit with its own nominal type', () => {
    // Every unit is `number` at runtime, so `expectTypeOf` is the only way to
    // assert the distinction exists at all.
    expectTypeOf(usd(1)).toEqualTypeOf<Usd>();
    expectTypeOf(pct(1)).toEqualTypeOf<Pct>();
    expectTypeOf(rate(1)).toEqualTypeOf<DecimalRate>();
    expectTypeOf(bps(1)).toEqualTypeOf<Bps>();
    expectTypeOf(days(1)).toEqualTypeOf<Days>();
  });

  it('does not accept a Usd where a Pct is expected', () => {
    // The bug this prevents: a percent-vs-decimal mix-up is invisible to the
    // compiler when both sides are plain `number`. Branding turns it into a
    // type error.
    expectTypeOf<Usd>().not.toEqualTypeOf<Pct>();
    expectTypeOf<Usd>().not.toExtend<Pct>();
    expectTypeOf<DecimalRate>().not.toExtend<Pct>();
    expectTypeOf<Bps>().not.toExtend<DecimalRate>();
  });

  it('keeps a branded unit assignable to number, so arithmetic still works', () => {
    // Branding must not be so strict that ordinary arithmetic needs a cast.
    expectTypeOf<Usd>().toExtend<number>();
    expectTypeOf<Pct>().toExtend<number>();
  });

  it('encodes the documented conversions in their signatures', () => {
    // `pctToRate` is the only sanctioned Pct -> DecimalRate path, so its input
    // and output types are part of the contract, not an implementation detail.
    expectTypeOf(pct(4)).toExtend<Pct>();
    expectTypeOf(rate(0.04)).toExtend<DecimalRate>();
  });
});

describe('reader ports', () => {
  it('composes the four narrow readers', () => {
    // The composite must remain assignable from any narrow port's perspective:
    // a consumer that only needs chains must be able to accept a full reader
    // without depending on the rest (ISP).
    expectTypeOf<RiskProfileReader>().toHaveProperty('chain');
    expectTypeOf<RiskProfileReader>().toHaveProperty('protocol');
    expectTypeOf<RiskProfileReader>().toHaveProperty('marketMaker');
    expectTypeOf<RiskProfileReader>().toHaveProperty('manifest');
  });

  it('carries the record under a value key, alongside its source key', () => {
    // Every read carries the key it came from, so provenance cannot be dropped
    // by a caller that forgets to ask for it.
    expectTypeOf<Loaded<ChainRiskProfile>>().toHaveProperty('key');
    expectTypeOf<Loaded<ChainRiskProfile>['value']>().toEqualTypeOf<ChainRiskProfile>();
  });

  it('resolves absent records as null rather than undefined', () => {
    // `null` is a value the caller must handle; `undefined` can be swallowed by
    // optional chaining, which is how a missing snapshot becomes a silent gap.
    expectTypeOf<Awaited<ReturnType<RiskProfileReader['chain']>>>().toEqualTypeOf<
      Loaded<ChainRiskProfile> | null
    >();
  });
});

describe('covariate matrix', () => {
  it('types rows as a matrix, not a flat list', () => {
    // The shape is the contract: `[numCovariates][contextLength]`. A flat array
    // would compile here and fail at the service with an HTTP 500.
    expectTypeOf<CovariateMatrix['rows']>().toEqualTypeOf<
      readonly (readonly number[])[]
    >();
  });

  it('makes the context length part of the matrix rather than a caller guess', () => {
    expectTypeOf<CovariateMatrix['contextLength']>().toEqualTypeOf<number>();
  });

  it('requires covariate points to carry a timestamp', () => {
    // Alignment is meaningless without times, so a bare number series cannot be
    // passed where a covariate source is expected.
    expectTypeOf<CovariateSource['points']>().toEqualTypeOf<
      readonly { readonly ts: Date; readonly value: number }[]
    >();
  });

  it('exposes coverage so filled values are visible in the type', () => {
    expectTypeOf<CovariateMatrix['coverage']>().toHaveProperty('length');
  });
});

describe('runtime sanity', () => {
  it('leaves branded values untouched at runtime', () => {
    // Branding is erased, so these are plain numbers and add without a cast —
    // asserted here so a future change that starts wrapping them is caught.
    const total: number = usd(1_000_000) + pct(4) + rate(0.04) + bps(400) + days(30);
    expect(total).toBeCloseTo(1_000_434.04, 6);
  });
});
