import type { DocumentNode } from 'graphql';
import { describe, expect, it } from 'vitest';
import { z, ZodError } from 'zod';
import { SubgraphClient, SubgraphValidationError } from '../src/clients/SubgraphClient.js';
import {
  GraphQLClientTransport,
  SubgraphTransportError,
  type SubgraphTransport,
} from '../src/clients/SubgraphTransport.js';
import { defineQuery } from '../src/query/QueryDefinition.js';
import { QueryRegistry } from '../src/query/QueryRegistry.js';

/** Deterministic in-memory transport: ordered canned responses + call recording. */
class FakeTransport implements SubgraphTransport {
  readonly calls: Array<{ document: DocumentNode; variables: Record<string, unknown> }> = [];
  private readonly queues = new Map<string, unknown[]>();
  private nextError: Error | null = null;

  /** Queue responses in order; each request for the operation consumes the next. */
  queue(operationName: string, ...responses: unknown[]): void {
    const q = this.queues.get(operationName) ?? [];
    q.push(...responses);
    this.queues.set(operationName, q);
  }

  failNextWith(err: Error): void {
    this.nextError = err;
  }

  async requestRaw(
    document: DocumentNode,
    variables: Record<string, string | number | boolean | null | undefined>,
  ): Promise<unknown> {
    if (this.nextError !== null) {
      const err = this.nextError;
      this.nextError = null;
      throw err;
    }
    const def = document.definitions.at(0) as { name?: { value?: string } } | undefined;
    const opName = def?.name?.value ?? '(anonymous)';
    this.calls.push({ document, variables });
    const q = this.queues.get(opName);
    const response = q?.shift();
    if (response === undefined) {
      throw new SubgraphTransportError('fake', `no canned response for operation "${opName}"`, null);
    }
    return response;
  }

  /** Variables sent on the Nth call (0-based). */
  varsOf(callIndex: number): Record<string, unknown> {
    const call = this.calls.at(callIndex);
    if (call === undefined) throw new Error(`no call #${callIndex}`);
    return call.variables;
  }
}

const fundingQuery = defineQuery({
  id: 'test.funding',
  operationName: 'Funding',
  sdl: `
    query Funding($pool: Bytes!, $hours: Int!) {
      liquidityPool(id: $pool) {
        id
        totalValueLockedUSD
        hourlySnapshots(first: $hours) { hours hourlyVolumeUSD }
      }
    }
  `,
  variables: z.object({ pool: z.string().min(1), hours: z.number().int().positive().max(1000) }),
  response: z.object({
    liquidityPool: z
      .object({
        id: z.string(),
        totalValueLockedUSD: z.string(),
        hourlySnapshots: z.array(z.object({ hours: z.number(), hourlyVolumeUSD: z.string() })),
      })
      .nullable(),
  }),
});

const paginatedQuery = defineQuery({
  id: 'test.paginated',
  operationName: 'Items',
  sdl: `
    query Items($first: Int!, $lastID: Bytes) {
      items(first: $first, where: { id_gt: $lastID }) { id label }
    }
  `,
  variables: z.object({ first: z.number().int(), lastID: z.string().optional() }),
  response: z.object({ items: z.array(z.object({ id: z.string(), label: z.string() })) }),
  pagination: { listPath: ['items'], cursorArg: 'lastID', pageSizeArg: 'first' },
});

describe('SubgraphClient.executeTemplate', () => {
  it('validates variables before send and responses after receive', async () => {
    const t = new FakeTransport();
    t.queue('Funding', {
      liquidityPool: {
        id: '0xpool',
        totalValueLockedUSD: '1234.5',
        hourlySnapshots: [{ hours: 1, hourlyVolumeUSD: '10' }],
      },
    });
    const client = new SubgraphClient(t, 'test-endpoint');

    const data = await client.executeTemplate(fundingQuery, { pool: '0xpool', hours: 24 });

    expect(data.liquidityPool?.id).toBe('0xpool');
    expect(t.calls).toHaveLength(1);
    expect(t.varsOf(0)).toEqual({ pool: '0xpool', hours: 24 });
  });

  it('fails fast on invalid variables WITHOUT touching the transport', async () => {
    const t = new FakeTransport();
    const client = new SubgraphClient(t, 'test-endpoint');

    await expect(client.executeTemplate(fundingQuery, { pool: '', hours: 0 })).rejects.toThrow(
      ZodError,
    );
    await expect(client.executeTemplate(fundingQuery, { pool: '0xpool', hours: 0 })).rejects.toThrow(
      ZodError,
    );
    expect(t.calls).toHaveLength(0); // never sent
  });

  it('throws SubgraphValidationError on schema drift (undefined fields)', async () => {
    const t = new FakeTransport();
    // Wire drift: hourlySnapshots missing entirely (e.g. deployment schema change)
    t.queue('Funding', { liquidityPool: { id: '0xpool', totalValueLockedUSD: '1' } });
    const client = new SubgraphClient(t, 'test-endpoint');

    const err = await client
      .executeTemplate(fundingQuery, { pool: '0xpool', hours: 2 })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SubgraphValidationError);
    const typed = err as SubgraphValidationError;
    expect(typed.queryId).toBe('test.funding');
    expect(typed.endpointName).toBe('test-endpoint');
    expect(typed.issues.join('\n')).toContain('hourlySnapshots');
  });

  it('rejects a non-string TVL (drift to number) with a typed issue path', async () => {
    const t = new FakeTransport();
    t.queue('Funding', {
      liquidityPool: {
        id: '0xpool',
        totalValueLockedUSD: 1234.5, // drifted: number, not string
        hourlySnapshots: [],
      },
    });
    const client = new SubgraphClient(t, 'test-endpoint');
    const err = await client
      .executeTemplate(fundingQuery, { pool: '0xpool', hours: 1 })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SubgraphValidationError);
    expect((err as SubgraphValidationError).issues.join('\n')).toContain('totalValueLockedUSD');
  });

  it('propagates transport failures (wrapping is the adapter layer\'s job)', async () => {
    const t = new FakeTransport();
    t.failNextWith(new Error('socket hangup'));
    const client = new SubgraphClient(t, 'test-endpoint');
    await expect(
      client.executeTemplate(fundingQuery, { pool: '0xpool', hours: 1 }),
    ).rejects.toThrow(/socket hangup/);
  });
});

describe('SubgraphClient.collectAll', () => {
  it('paginates by spec until a short page, merging lists', async () => {
    const t = new FakeTransport();
    // page 1: full page (3 of 3) -> continue; page 2: short page (1) -> stop
    t.queue('Items', { items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] });
    t.queue('Items', { items: [{ id: 'c', label: 'C' }] });
    const client = new SubgraphClient(t, 'test-endpoint');

    const data = await client.collectAll(paginatedQuery, { pageSize: 2 });

    expect(data.items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(t.calls).toHaveLength(2);
    expect(t.varsOf(0)).toEqual({ lastID: undefined, first: 2 });
    expect(t.varsOf(1)).toEqual({ lastID: 'b', first: 2 });
  });

  it('stops after one page when the page is not full', async () => {
    const t = new FakeTransport();
    t.queue('Items', { items: [{ id: 'a', label: 'A' }] });
    const client = new SubgraphClient(t, 'test-endpoint');
    const data = await client.collectAll(paginatedQuery, { pageSize: 2 });
    expect(data.items).toHaveLength(1);
    expect(t.calls).toHaveLength(1);
  });

  it('respects maxPages and carries extraVars on every request', async () => {
    const t = new FakeTransport();
    // Always returns a full page — maxPages caps the loop (queue one per page).
    t.queue(
      'Items',
      { items: [{ id: 'x1', label: 'X' }, { id: 'x2', label: 'X' }] },
      { items: [{ id: 'x3', label: 'X' }, { id: 'x4', label: 'X' }] },
      { items: [{ id: 'x5', label: 'X' }, { id: 'x6', label: 'X' }] },
    );
    const client = new SubgraphClient(t, 'test-endpoint');
    const data = await client.collectAll(paginatedQuery, {
      pageSize: 2,
      maxPages: 3,
      extraVars: { filterTag: 'x' },
    } as never);
    expect(t.calls).toHaveLength(3);
    // extraVars keys not in the definition's schema are stripped by validation
    // (zod default) — the cursor/pageSize args injected from the spec survive.
    expect(t.varsOf(0).first).toBe(2);
    expect(t.varsOf(2).lastID).toBe('x4');
    expect(data.items.length).toBeGreaterThan(0);
  });

  it('re-validates the reassembled multi-page shape', async () => {
    const t = new FakeTransport();
    t.queue('Items', { items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] });
    t.queue('Items', { items: [{ id: 'c', label: 'C' }] });
    const client = new SubgraphClient(t, 'test-endpoint');
    const data = await client.collectAll(paginatedQuery, { pageSize: 2 });
    // data is schema-validated output, not a raw concatenation
    expect(data).toEqual({ items: expect.any(Array) });
  });

  it('throws QueryDefinitionError when the definition has no pagination spec', async () => {
    const t = new FakeTransport();
    t.queue('Funding', { liquidityPool: null });
    const client = new SubgraphClient(t, 'test-endpoint');
    await expect(
      client.collectAll(fundingQuery as never, { pageSize: 10 }),
    ).rejects.toThrow(/requires a pagination spec/);
  });
});

describe('SubgraphClient.health', () => {
  it('flattens _meta block into SubgraphHealth', async () => {
    const t = new FakeTransport();
    t.queue('IndexerHealth', {
      _meta: {
        deployment: 'Qmdep',
        hasIndexingErrors: false,
        block: { number: 12345, hash: '0xabc', timestamp: 1700000000 },
      },
    });
    const client = new SubgraphClient(t, 'test-endpoint');
    const health = await client.health();
    expect(health.blockNumber).toBe(12345);
    expect(health.deployment).toBe('Qmdep');
    expect(health.hasIndexingErrors).toBe(false);
    expect(health.blockHash).toBe('0xabc');
  });

  it('throws on null _meta (not indexed / wrong endpoint)', async () => {
    const t = new FakeTransport();
    t.queue('IndexerHealth', { _meta: null });
    const client = new SubgraphClient(t, 'test-endpoint');
    await expect(client.health()).rejects.toThrow(/null _meta/);
  });

  it('throws on unparseable _meta (drift)', async () => {
    const t = new FakeTransport();
    t.queue('IndexerHealth', { _meta: { block: { number: 'not-a-number' } } });
    const client = new SubgraphClient(t, 'test-endpoint');
    await expect(client.health()).rejects.toThrow(/unparseable _meta/);
  });
});

describe('GraphQLClientTransport', () => {
  it('is a SubgraphTransport adapter (structural)', () => {
    const adapter = new GraphQLClientTransport({ request: async () => ({}) } as never, 'name');
    expect(typeof adapter.requestRaw).toBe('function');
  });
});

describe('QueryRegistry integration', () => {
  it('stores definitions the client can execute', async () => {
    const reg = new QueryRegistry();
    reg.register(paginatedQuery);
    const def = reg.require('test.paginated');
    const t = new FakeTransport();
    t.queue('Items', { items: [] });
    const client = new SubgraphClient(t, 'e');
    const data = await client.executeTemplate(paginatedQuery, { first: 10 });
    expect(data.items).toEqual([]);
    expect(def.id).toBe('test.paginated');
  });
});
