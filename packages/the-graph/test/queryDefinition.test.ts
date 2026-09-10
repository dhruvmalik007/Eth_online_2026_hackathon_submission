import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  EveryVariableDeclaredError,
  QueryDefinitionError,
  defineQuery,
  validateDefinition,
} from '../src/query/QueryDefinition.js';

const varsSchema = z.object({ pool: z.string().min(1), hours: z.number().int().positive() });
const responseSchema = z.object({ liquidityPool: z.unknown().nullable() });

describe('defineQuery', () => {
  it('accepts a well-formed definition and preserves identity', () => {
    const def = defineQuery({
      id: 'test.funding',
      operationName: 'Funding',
      sdl: `query Funding($pool: Bytes!, $hours: Int!) { liquidityPool(id: $pool) { id } }`,
      variables: varsSchema,
      response: responseSchema,
    });
    expect(def.id).toBe('test.funding');
    expect(def.operationName).toBe('Funding');
  });

  it('rejects an empty id', () => {
    expect(() =>
      defineQuery({
        id: '  ',
        operationName: 'F',
        sdl: `query F { __typename }`,
        variables: varsSchema,
        response: responseSchema,
      }),
    ).toThrow(QueryDefinitionError);
  });

  it('rejects SDL that does not parse', () => {
    expect(() =>
      defineQuery({
        id: 'test.bad',
        operationName: 'Bad',
        sdl: `query Bad($x: { not graphql }`,
        variables: varsSchema,
        response: responseSchema,
      }),
    ).toThrow(/SDL does not parse/);
  });

  it('rejects operationName mismatch', () => {
    expect(() =>
      defineQuery({
        id: 'test.mismatch',
        operationName: 'Wanted',
        sdl: `query Actual { __typename }`,
        variables: varsSchema,
        response: responseSchema,
      }),
    ).toThrow(/does not match operationName/);
  });

  it('rejects value interpolation (\\${) in SDL', () => {
    // Template literal containing a JS interpolation marker inside SDL text:
    // even though this fragment happens to be invalid GraphQL, the marker
    // check must fire before/regardless of semantic validity — but parse
    // runs first, so craft SDL that parses AND contains the marker inside
    // a string-literal argument (the only syntactically legal spot).
    const def = () =>
      validateDefinition({
        id: 'test.interp',
        operationName: 'I',
        sdl: `query I($skip: Int!) { pools(skip: $skip) { id } _note(x: "\${first}") }`,
        variables: varsSchema,
        response: responseSchema,
      });
    expect(def).toThrow(/interpolation is banned/);
  });

  it('rejects SDL variables missing from the variables schema', () => {
    expect(() =>
      validateDefinition({
        id: 'test.undeclared',
        operationName: 'U',
        sdl: `query U($pool: Bytes!, $ghost: Int!) { liquidityPool(id: $pool) { id } }`,
        variables: varsSchema,
        response: responseSchema,
      }),
    ).toThrow(EveryVariableDeclaredError);
  });

  it('accepts variables used but not declared at the operation root only if schema-declared', () => {
    // SDL uses $hours inside a directive-free position; declared properly.
    const def = defineQuery({
      id: 'test.used',
      operationName: 'Used',
      sdl: `query Used($pool: Bytes!, $hours: Int!) { liquidityPool(id: $pool, hours: $hours) { id } }`,
      variables: varsSchema,
      response: responseSchema,
    });
    expect(def.sdl).toContain('$hours');
  });
});
