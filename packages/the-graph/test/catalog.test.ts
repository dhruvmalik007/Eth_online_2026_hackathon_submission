import { describe, expect, it } from 'vitest';
import { parse } from 'graphql';
import {
  dexProbe,
  dexUniswapV3Pools,
  dexV4HookedPools,
  dexV4PoolDayData,
  dexV4PoolHourData,
  dexV4PoolManager,
  dexV4PoolState,
  dexV4Position,
  dexV4RecentSwaps,
  dexV4TokenData,
  dexV4TokenHourData,
  dexV4TopPools,
  fnoDeltas,
  fnoFdvTokens,
  fnoFunding,
  fnoOpenPositions,
  fnoProtocolSnapshot,
  indexerMeta,
  lendingAaveV3PoolMetrics,
  lendingAaveV3Reserves,
  lendingProbe,
  predictionPolymarketProbe,
} from '../src/queries/index.js';

const ALL_QUERIES = [
  fnoProtocolSnapshot,
  fnoFunding,
  fnoOpenPositions,
  fnoFdvTokens,
  fnoDeltas,
  indexerMeta,
  lendingAaveV3Reserves,
  lendingAaveV3PoolMetrics,
  lendingProbe,
  dexUniswapV3Pools,
  dexProbe,
  dexV4PoolManager,
  dexV4PoolState,
  dexV4TopPools,
  dexV4HookedPools,
  dexV4PoolHourData,
  dexV4PoolDayData,
  dexV4TokenHourData,
  dexV4RecentSwaps,
  dexV4TokenData,
  dexV4Position,
  predictionPolymarketProbe,
] as const;

describe('query catalog integrity', () => {
  it('has globally unique query ids', () => {
    const ids = ALL_QUERIES.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has unique operation names matching the SDL declaration', () => {
    const names = ALL_QUERIES.map((q) => q.operationName);
    expect(new Set(names).size).toBe(names.length);
    for (const q of ALL_QUERIES) {
      const doc = parse(q.sdl);
      const op = doc.definitions[0];
      expect(op?.kind).toBe('OperationDefinition');
      if (op?.kind === 'OperationDefinition') {
        expect(op.name?.value).toBe(q.operationName);
      }
    }
  });

  it('declares every SDL variable in the variables schema', () => {
    for (const q of ALL_QUERIES) {
      const doc = parse(q.sdl);
      const op = doc.definitions[0];
      if (op?.kind !== 'OperationDefinition') continue;
      const sdlVars = (op.variableDefinitions ?? []).map((v) => v.variable.name.value).sort();
      const schemaVars = Object.keys(q.variables.shape).sort();
      expect(schemaVars, `variables schema of ${q.id}`).toEqual(sdlVars);
    }
  });

  it('paginates only on unbounded list queries (v4 series are bounded windows)', () => {
    const paginated = ALL_QUERIES.filter((q) => 'pagination' in q);
    expect(paginated.map((q) => q.id).sort()).toEqual([
      'the-graph.fno.fdvTokens',
      'the-graph.fno.openPositions',
    ].sort());
  });

  it('v4 poolId variables are validated bytes32-shaped strings', () => {
    // dexV4PoolState variables schema must reject non-hash pool ids
    const schema = dexV4PoolState.variables;
    expect(schema.safeParse({ pool: '0x1234' }).success).toBe(false);
    expect(schema.safeParse({ pool: '0x' + 'a'.repeat(64) }).success).toBe(true);
  });
});
