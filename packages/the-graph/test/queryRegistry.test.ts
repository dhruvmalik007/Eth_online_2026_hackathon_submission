import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineQuery } from '../src/query/QueryDefinition.js';
import { QueryRegistry } from '../src/query/QueryRegistry.js';
import {
  ZodBigNumberString,
  ZodBytes32,
  ZodNonNegativeBigNumberString,
  ZodRayRate,
} from '../src/query/scalars.js';

function ZodNonNegativeSafe(s: string) {
  return ZodNonNegativeBigNumberString.safeParse(s);
}

const defA = defineQuery({
  id: 'test.a',
  operationName: 'A',
  sdl: `query A($first: Int!) { items(first: $first) { id } }`,
  variables: z.object({ first: z.number().int() }),
  response: z.object({ items: z.array(z.object({ id: z.string() })) }),
  pagination: { listPath: ['items'], cursorArg: 'lastID', pageSizeArg: 'first' },
});

const defB = defineQuery({
  id: 'test.b',
  operationName: 'B',
  sdl: `query B { __typename }`,
  variables: z.object({}).strict(),
  response: z.object({ __typename: z.string() }),
});

describe('scalars', () => {
  it('accepts decimal strings and rejects numbers/negatives where forbidden', () => {
    expect(ZodBigNumberString.parse('1234.5678')).toBe('1234.5678');
    expect(ZodBigNumberString.safeParse(1234).success).toBe(false);
    expect(ZodRayRate.parse('0.000000000001')).toBe('0.000000000001');
    expect(ZodNonNegativeSafe('0').success).toBe(true);
    expect(ZodNonNegativeSafe('-1.5').success).toBe(false);
  });

  it('validates bytes32 and address shapes', () => {
    expect(ZodBytes32.safeParse('0x' + 'a'.repeat(64)).success).toBe(true);
    expect(ZodBytes32.safeParse('0x' + 'a'.repeat(63)).success).toBe(false);
  });
});

describe('QueryRegistry', () => {
  it('registers, lists and requires by id', () => {
    const reg = new QueryRegistry();
    reg.register(defA);
    reg.register(defB);
    expect(reg.size).toBe(2);
    expect(reg.ids()).toEqual(['test.a', 'test.b']);
    expect(reg.require('test.a')).toBe(defA);
    expect(reg.get('nope')).toBeUndefined();
  });

  it('fails fast on duplicate ids', () => {
    const reg = new QueryRegistry();
    reg.register(defA);
    expect(() => reg.register(defA)).toThrow(/duplicate query id/);
  });

  it('throws a helpful error on unknown require', () => {
    const reg = new QueryRegistry();
    reg.register(defB);
    expect(() => reg.require('test.a')).toThrow(/unknown query id "test.a".*test\.b/s);
  });
});
