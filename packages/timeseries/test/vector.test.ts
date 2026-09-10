import { describe, expect, it } from 'vitest';
import { VectorRepository } from '../src/vector.js';
import { VectorUnavailableError } from '../src/types.js';
import { serializeMetricWindow } from '../src/serializer.js';
import { FakeEmbeddingService, RoutingFakeRunner } from './helpers.js';

/** A server where the vector layer is installed and present. */
function vectorServer(): RoutingFakeRunner {
  return new RoutingFakeRunner()
    .on('FROM pg_extension', [{ extname: 'vector', extversion: '0.8.6' }])
    .on('to_regclass', [{ reg: 'ts_embeddings' }]);
}

/** A server without pgvector. */
function plainServer(): RoutingFakeRunner {
  return new RoutingFakeRunner()
    .on('FROM pg_extension', [])
    .on('to_regclass', [{ reg: null }]);
}

const chunk = serializeMetricWindow({
  poolId: '0xpool',
  metric: 'apy',
  points: [
    { ts: new Date('2026-09-09T00:00:00Z'), value: 0.04 },
    { ts: new Date('2026-09-09T01:00:00Z'), value: 0.05 },
  ],
});

describe('VectorRepository availability gate', () => {
  it('raises a typed error naming the missing extension', async () => {
    const repo = new VectorRepository(plainServer(), new FakeEmbeddingService());
    await expect(repo.assertAvailable()).rejects.toThrowError(VectorUnavailableError);
  });

  it('raises when the extension exists but the table was never migrated', async () => {
    const runner = new RoutingFakeRunner()
      .on('FROM pg_extension', [{ extname: 'vector', extversion: '0.8.6' }])
      .on('to_regclass', [{ reg: null }]);
    const repo = new VectorRepository(runner, new FakeEmbeddingService());
    await expect(repo.assertAvailable()).rejects.toThrowError(/run migrate/);
  });

  it('does not attempt to embed when the layer is unavailable', async () => {
    const embeddings = new FakeEmbeddingService();
    const repo = new VectorRepository(plainServer(), embeddings);
    await expect(repo.upsertBatch([chunk])).rejects.toThrowError(VectorUnavailableError);
    expect(embeddings.embeddedCount).toBe(0);
  });
});

describe('VectorRepository.upsertBatch', () => {
  it('embeds once per chunk and writes one tuple each', async () => {
    const r = vectorServer().on('INSERT INTO ts_embeddings', [{ id: 'row-1' }]);
    const embeddings = new FakeEmbeddingService();
    const result = await new VectorRepository(r, embeddings).upsertBatch([chunk]);

    expect(result).toEqual({ embedded: 1, inserted: 1, skipped: 0 });
    const q = r.find('INSERT INTO ts_embeddings');
    expect(q?.text).toContain('ON CONFLICT (content_hash, ts_start) DO NOTHING');
    expect(q?.text).toContain('$8::vector');
    expect(q?.values).toHaveLength(10);
  });

  it('serializes the vector as a pgvector literal', async () => {
    const r = vectorServer().on('INSERT INTO ts_embeddings', [{ id: 'row-1' }]);
    await new VectorRepository(r, new FakeEmbeddingService()).upsertBatch([chunk]);
    const literal = r.find('INSERT INTO ts_embeddings')?.values[7];
    expect(String(literal).startsWith('[')).toBe(true);
    expect(String(literal).endsWith(']')).toBe(true);
    expect(String(literal).split(',').length).toBe(768);
  });

  it('reports a re-run as skipped rather than duplicated', async () => {
    // ON CONFLICT DO NOTHING returns no row for content already stored.
    const r = vectorServer().on('INSERT INTO ts_embeddings', []);
    const result = await new VectorRepository(r, new FakeEmbeddingService()).upsertBatch([chunk]);
    expect(result).toEqual({ embedded: 1, inserted: 0, skipped: 1 });
  });

  it('no-ops on an empty batch without embedding', async () => {
    const embeddings = new FakeEmbeddingService();
    const result = await new VectorRepository(vectorServer(), embeddings).upsertBatch([]);
    expect(result).toEqual({ embedded: 0, inserted: 0, skipped: 0 });
    expect(embeddings.embeddedCount).toBe(0);
  });

  it('fails loudly if the embedding service returns the wrong cardinality', async () => {
    const broken = {
      model: 'broken',
      dimension: 768,
      embed: async (): Promise<readonly (readonly number[])[]> => [],
    };
    const repo = new VectorRepository(vectorServer(), broken);
    await expect(repo.upsertBatch([chunk])).rejects.toThrowError(/0 vectors for 1 chunks/);
  });
});

describe('VectorRepository.searchTemporal', () => {
  const hit = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: '33333333-3333-4333-8333-333333333333',
    pool_id: '0xpool',
    kind: 'metric_window',
    ts_start: new Date('2026-09-09T00:00:00Z'),
    ts_end: new Date('2026-09-09T01:00:00Z'),
    source_ids: ['metric:0xpool:apy:2026-09-09T00:00:00.000Z'],
    content: 'metric_window pool=0xpool',
    score: '0.91',
    ...over,
  });

  it('embeds the query with the query task hint and pushes filters server-side', async () => {
    const r = vectorServer().on('FROM ts_embeddings', [hit()]);
    const embeddings = new FakeEmbeddingService();
    const results = await new VectorRepository(r, embeddings).searchTemporal({
      query: 'how stable is this pool?',
      poolId: '0xpool',
      kinds: ['metric_window'],
      from: new Date('2026-09-01T00:00:00Z'),
      to: new Date('2026-09-30T00:00:00Z'),
      k: 3,
    });

    expect(embeddings.calls).toHaveLength(1);
    expect(embeddings.calls[0]!.task).toBe('query');

    const q = r.find('FROM ts_embeddings');
    expect(q?.text).toContain('pool_id = $2');
    expect(q?.text).toContain('ts_end >= $3');
    expect(q?.text).toContain('ts_start <= $4');
    expect(q?.text).toContain('kind = ANY($5::text[])');
    // Over-fetch then re-rank, because ANN before a selective filter starves results.
    expect(q?.values[5]).toBe(15);
    expect(results).toHaveLength(1);
    expect(results[0]!.score).toBe(0.91);
  });

  it('re-ranks by score and trims to k', async () => {
    const rows = Array.from({ length: 6 }, (_, i) =>
      hit({ id: `id-${i}`, score: String(i / 10) }),
    );
    const r = vectorServer().on('FROM ts_embeddings', rows);
    const results = await new VectorRepository(r, new FakeEmbeddingService()).searchTemporal({
      query: 'q',
      k: 2,
    });
    expect(results).toHaveLength(2);
    expect(results[0]!.score).toBe(0.5);
    expect(results[1]!.score).toBe(0.4);
  });

  it('carries source ids so the citation guard can verify each hit', async () => {
    const r = vectorServer().on('FROM ts_embeddings', [hit()]);
    const results = await new VectorRepository(r, new FakeEmbeddingService()).searchTemporal({
      query: 'q',
    });
    expect(results[0]!.sourceIds).toEqual(['metric:0xpool:apy:2026-09-09T00:00:00.000Z']);
  });

  it('skips malformed rows instead of surfacing partial evidence', async () => {
    const r = vectorServer().on('FROM ts_embeddings', [
      hit({ kind: 'not-a-kind' }),
      hit({ id: 'good', score: '0.2' }),
    ]);
    const results = await new VectorRepository(r, new FakeEmbeddingService()).searchTemporal({
      query: 'q',
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe('good');
  });

  it('passes nulls when no scope is given (unfiltered search is explicit)', async () => {
    const r = vectorServer().on('FROM ts_embeddings', []);
    await new VectorRepository(r, new FakeEmbeddingService()).searchTemporal({ query: 'q' });
    const q = r.find('FROM ts_embeddings');
    expect(q?.values[1]).toBeNull();
    expect(q?.values[4]).toBeNull();
  });
});

describe('VectorRepository.count', () => {
  it('scopes the count to a pool when asked', async () => {
    const r = vectorServer().on('SELECT count(*)', [{ n: '12' }]);
    expect(await new VectorRepository(r, new FakeEmbeddingService()).count('0xpool')).toBe(12);
    expect(r.find('FROM ts_embeddings')?.values[0]).toBe('0xpool');
  });
});
