import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { loadEnv } from '@ethonline2026/langchain-agent';
import {
  ChainRiskProfileSchema,
  ManifestSchema,
  MarketMakerProfileSchema,
  ProtocolGovernanceProfileSchema,
  type ChainRiskProfile,
  type Manifest,
  type MarketMakerProfile,
  type ProtocolGovernanceProfile,
  type RiskProfileReader,
} from '@ethonline2026/risk-analysis-data-pipeline';
import type {
  CapabilityReport,
  CalibrationSummary,
  DecisionRecord,
  ForecastRun,
  MetricWindow,
  RealizedYieldRow,
  RetrievalHit,
} from '@ethonline2026/timeseries';
import { HttpError, errorResponse, json, numberParam, readBody, stringParam } from '../api/_lib/http.js';
import {
  handleAgent,
  handleForecast,
  handleHealth,
  handleMetrics,
  handlePerformance,
  handleRiskAdjustment,
  handleRiskChains,
  handleRiskProtocols,
  handleSearch,
} from '../api/_lib/handlers.js';
import type { IndexerRuntime, ServiceProbeFn } from '../api/_lib/runtime.js';

/**
 * Offline tests for the serverless surface. Every handler takes its runtime as
 * a parameter, so these exercise validation, shaping and degradation paths
 * without a database, a model or the network.
 */

const DAY = 86_400_000;

const capabilities: CapabilityReport = {
  installed: { timescaledb: '2.30.0', vector: '0.8.6' },
  available: { timescaledb: '2.30.0', vector: '0.8.6', vectorscale: '0.9.0' },
  postgresVersion: '18.6',
  timescaleVersion: '2.30.0',
  vectorEnabled: true,
  vectorscaleEnabled: true,
};

function metricWindow(points: number): MetricWindow {
  return {
    poolId: '0xpool',
    metric: 'apy',
    timestamps: Array.from({ length: points }, (_, i) => new Date(Date.UTC(2026, 8, 1, i))),
    values: Array.from({ length: points }, (_, i) => 0.04 + i * 0.0001),
  };
}

interface RuntimeOptions {
  readonly pingFails?: boolean;
  readonly vectorEnabled?: boolean;
  readonly timesfmReachable?: boolean;
  readonly historyPoints?: number;
  /** Omit to exercise the "risk snapshots unconfigured" path. */
  readonly riskReader?: RiskProfileReader;
}

function fakeRuntime(options: RuntimeOptions = {}): IndexerRuntime {
  const probe: ServiceProbeFn = async () => ({ reachable: options.timesfmReachable ?? true, status: 404 });

  return {
    // Built from the real loader so the fake satisfies the same contract the
    // routes rely on (defaults included) rather than a hand-kept subset.
    env: {
      ...loadEnv(),
      GOOGLE_CLOUD_PROJECT: 'proj',
      GOOGLE_CLOUD_LOCATION: 'us-central1',
      VERTEX_EMBEDDING_MODEL: 'text-embedding-005',
      TIMESFM3_SERVICE_URL: 'https://timesfm.example',
      TIMESERIES_DATABASE_URL: 'postgres://u:p@host:5432/tsdb',
      TIMESERIES_DB_MAX_CONNECTIONS: 5,
    },
    runner: {} as IndexerRuntime['runner'],
    metrics: {
      ping: async () => {
        if (options.pingFails === true) throw new Error('connection refused');
        return true;
      },
      getCoverage: async () => ({
        poolCount: 2,
        rowCount: 96,
        earliest: new Date('2026-09-01T00:00:00Z'),
        latest: new Date('2026-09-02T00:00:00Z'),
      }),
      getMetricWindow: async () => metricWindow(options.historyPoints ?? 48),
      getMetricWindowBucketed: async () => [
        { bucketStart: new Date('2026-09-01T00:00:00Z'), values: { avg: 0.04, min: 0.03, max: 0.05, samples: 24 } },
        { bucketStart: new Date('2026-09-02T00:00:00Z'), values: { avg: 0.041, min: 0.032, max: 0.051, samples: 24 } },
      ],
    } as unknown as IndexerRuntime['metrics'],
    forecasts: {
      getLatest: async () => null,
    } as unknown as IndexerRuntime['forecasts'],
    performance: {
      getRealizedYield: async (): Promise<RealizedYieldRow[]> => [
        {
          poolId: '0xpool',
          bucketStart: new Date('2026-09-01T00:00:00Z'),
          avgApy: 0.042,
          minApy: 0.038,
          maxApy: 0.05,
          avgTvl: 48_000_000,
          samples: 24,
        },
      ],
      getCalibrationSummary: async (): Promise<CalibrationSummary[]> => [
        {
          poolId: '0xpool',
          metric: 'apy',
          samples: 120,
          coverage: 0.81,
          meanPinballLoss: 0.0012,
          meanAbsoluteError: 0.0048,
          meanAbsolutePercentageError: 0.11,
        },
      ],
      getDecisionOutcomes: async () => [
        {
          decisionId: 'd1',
          poolId: '0xpool',
          action: 'SUPPLY_CAPITAL',
          sizeUsd: 25_000,
          decidedAt: new Date('2026-09-01T00:00:00Z'),
          horizonEnd: new Date('2026-09-02T00:00:00Z'),
          realizedApy: 0.05,
          baselineApy: 0.042,
          outcomeScore: 0.008,
        },
      ],
      getCalibration: async () => [],
    } as unknown as IndexerRuntime['performance'],
    decisions: {
      getHistory: async (): Promise<DecisionRecord[]> => [],
    } as unknown as IndexerRuntime['decisions'],
    ...(options.vectorEnabled === false
      ? {}
      : {
          vectors: {
            assertAvailable: async (): Promise<CapabilityReport> => ({
              installed: { vector: '0.8.6' },
              available: {},
              postgresVersion: '17.6',
              timescaleVersion: null,
              vectorEnabled: true,
              vectorscaleEnabled: false,
            }),
            searchTemporal: async (): Promise<RetrievalHit[]> => [
              {
                id: '33333333-3333-4333-8333-333333333333',
                poolId: '0xpool',
                kind: 'metric_window',
                tsStart: new Date('2026-09-01T00:00:00Z'),
                tsEnd: new Date('2026-09-02T00:00:00Z'),
                sourceIds: ['metric:0xpool:apy:2026-09-01T00:00:00.000Z'],
                content: 'metric_window pool=0xpool metric=apy samples=24',
                score: 0.91,
              },
            ],
          } as unknown as NonNullable<IndexerRuntime['vectors']>,
        }),
    timesfm3: {
      predict: async () => ({
        target: 'series',
        horizon: 3,
        steps: Array.from({ length: 3 }, (_, i) => ({
          index: i, q10: 0.03, q50: 0.04, q90: 0.05, quantiles: Array.from({ length: 9 }, () => 0.04),
        })),
        model: 'timesfm-3.0',
        latencyMs: 153,
        flags: { quantileMonotonic: true, scaleSuspicious: false },
      }),
      predictProtocol: async () => ({
        protocolSlug: 'aave',
        metric: 'apy',
        forecast: {
          target: 'apy',
          horizon: 3,
          steps: [{ index: 0, q10: 0.03, q50: 0.04, q90: 0.05, quantiles: Array.from({ length: 9 }, () => 0.04) }],
          model: 'timesfm-3.0',
          latencyMs: 200,
          flags: { quantileMonotonic: true, scaleSuspicious: false },
        },
      }),
    } as unknown as IndexerRuntime['timesfm3'],
    v01: {} as IndexerRuntime['v01'],
    probeTimesfm3: probe,
    capabilities: async () => (options.vectorEnabled === false ? { ...capabilities, vectorEnabled: false } : capabilities),
    deepAgent: async () => {
      throw new Error('deep agent disabled in tests');
    },
    // Absent by default, so the risk routes exercise their "unconfigured" path
    // unless a test opts in.
    riskReader: async () => options.riskReader,
  };
}

function get(path: string): Request {
  return new Request(`https://indexer.test${path}`);
}

// ── risk fixtures ───────────────────────────────────────────────────────────
//
// Built through the real schemas rather than cast into shape, so a fixture that
// drifts from the published contract fails here rather than silently passing.

/** A chain risk profile matching the pipeline's published contract. */
function chainFixture(slug = 'base', composite = 0.7): ChainRiskProfile {
  return ChainRiskProfileSchema.parse({
    schemaVersion: '0.1.0',
    slug,
    name: `${slug} chain`,
    l2beatUrl: `https://l2beat.com/layer2s/projects/${slug}`,
    stage: 'stage-1',
    dimensions: {
      stateValidation: { raw: 'Fraud proofs (1R, ZK)', category: 'fraud-proofs', challengePeriodDays: null },
      dataAvailability: { raw: 'Onchain', category: 'onchain' },
      exitWindow: { raw: 'None', category: 'none', days: null },
      sequencerFailure: { raw: 'Self sequence', category: 'self-sequence', delayHours: null },
      proposerFailure: { raw: 'Self propose', category: 'self-propose' },
    },
    valueSecuredUsd: 14_570_000_000,
    riskScores: {
      stateValidation: 0.7,
      dataAvailability: 1.0,
      exit: 0.1,
      sequencer: 0.8,
      proposer: 1.0,
      composite,
    },
    provenance: {
      source: 'l2beat.com',
      sourceUrl: `https://l2beat.com/layer2s/projects/${slug}`,
      fetchedAt: '2026-09-11T00:00:00Z',
      state: 'fresh',
    },
  });
}

/** A governance profile with one risk-stage and one open proposal. */
function protocolFixture(slug = 'aave'): ProtocolGovernanceProfile {
  return ProtocolGovernanceProfileSchema.parse({
    schemaVersion: '0.1.0',
    slug,
    name: slug,
    category: 'lending',
    governance: {
      forumUrl: `https://governance.${slug}.com`,
      platform: 'discourse',
      jsonApi: `https://governance.${slug}.com/latest.json`,
      reachable: true,
    },
    proposals: [
      {
        id: 1,
        title: '[ARFC] Raise the liquidation threshold',
        slug: 'raise-the-liquidation-threshold',
        // `arfc` is the real process stage; risk-relevance is decided by the
        // title, not the stage, since the stage describes process rather than
        // subject.
        stage: 'arfc',
        status: 'open',
        createdAt: '2026-09-01T00:00:00Z',
        lastPostedAt: '2026-09-09T00:00:00Z',
        postsCount: 13,
        replyCount: 12,
        views: 900,
        likeCount: 40,
        url: `https://governance.${slug}.com/t/1`,
        excerpt: null,
      },
    ],
    governanceScores: { activity: 0.8, participation: 0.6, riskActivity: 0.9, composite: 0.75 },
    provenance: {
      source: 'discourse',
      sourceUrl: `https://governance.${slug}.com`,
      fetchedAt: '2026-09-11T00:00:00Z',
      state: 'fresh',
    },
  });
}

/** A market-maker profile carrying the hero-card depth metrics. */
function marketMakerFixture(slug = 'flowdesk'): MarketMakerProfile {
  return MarketMakerProfileSchema.parse({
    schemaVersion: '0.1.0',
    slug,
    name: slug,
    rank: 1,
    grade: 'AA',
    compositeScore: 9.4,
    subScores: {
      tradingKpis: 9.1,
      trust: 8.9,
      coverageCapabilities: 9.0,
      uptime: 9.5,
      integrationLevel: 8.1,
    },
    metrics: {
      depthUsd: 10_000_000,
      depthRank: 1,
      spreadPct: 8.5,
      spreadRank: 3,
      volumeUsd: 8_750_000,
      volumeRank: 2,
    },
    activeEngagements: 12,
    fdvUsd: null,
    window: '30d',
    provider: 'defillama',
    provenance: {
      source: 'defillama.com',
      sourceUrl: 'https://defillama.com/market-makers',
      fetchedAt: '2026-09-11T00:00:00Z',
      state: 'fresh',
    },
  });
}

/** A manifest with a single fresh source. */
function manifestFixture(generatedAt = new Date().toISOString()): Manifest {
  return ManifestSchema.parse({
    schemaVersion: '0.1.0',
    generatedAt,
    cadenceHours: 6,
    sources: {
      l2beat: {
        state: 'fresh',
        fetchedAt: generatedAt,
        latencyMs: 4200,
        records: 12,
        contentHash: null,
        error: null,
      },
    },
    temporal: {
      chainRiskHistory: 12,
      protocolGovernanceHistory: 8,
      marketMakerMetrics: 22,
      embeddings: 43,
    },
    notes: [],
  });
}

/**
 * A reader over in-memory fixtures.
 *
 * Absent entries resolve to `null`, which is how a real store reports a missing
 * snapshot, so the routes' not-found and unresolved paths are exercisable.
 */
function fakeRiskReader(options: {
  readonly chains?: readonly ChainRiskProfile[];
  readonly protocols?: readonly ProtocolGovernanceProfile[];
  readonly marketMakers?: readonly MarketMakerProfile[];
  readonly manifest?: Manifest | null;
  readonly throws?: Error;
} = {}): RiskProfileReader {
  const chains = options.chains ?? [chainFixture()];
  const protocols = options.protocols ?? [protocolFixture()];
  const marketMakers = options.marketMakers ?? [marketMakerFixture()];
  const manifest = options.manifest === undefined ? manifestFixture() : options.manifest;

  const find = <T>(items: readonly (T & { slug: string })[], slug: string): T | null =>
    items.find((item) => item.slug === slug) ?? null;

  // A configured-but-broken store fails on every read, which is how a bad bucket
  // or expired credential presents itself.
  const guard = (): void => {
    if (options.throws !== undefined) throw options.throws;
  };

  return {
    async chain(slug) {
      guard();
      const value = find(chains, slug);
      return value === null ? null : { key: `chains/${slug}.json`, value };
    },
    async chainSlugs() {
      guard();
      return chains.map((c) => c.slug);
    },
    async protocol(slug) {
      guard();
      const value = find(protocols, slug);
      return value === null ? null : { key: `protocols/${slug}.json`, value };
    },
    async protocolSlugs() {
      guard();
      return protocols.map((p) => p.slug);
    },
    async marketMaker(slug) {
      guard();
      const value = find(marketMakers, slug);
      return value === null ? null : { key: `market-makers/${slug}.json`, value };
    },
    async marketMakerDetail() {
      guard();
      return null;
    },
    async marketMakerSummary() {
      guard();
      return null;
    },
    async marketMakerSlugs() {
      guard();
      return marketMakers.map((m) => m.slug);
    },
    async manifest() {
      guard();
      return manifest === null ? null : { key: 'manifest.json', value: manifest };
    },
  };
}

function post(path: string, body: unknown): Request {
  return new Request(`https://indexer.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function body(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

// ── http helpers ────────────────────────────────────────────────────────────

describe('http helpers', () => {
  it('sets no-store on every JSON response', async () => {
    const res = json({ ok: true });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('maps typed codes onto statuses', async () => {
    const res = errorResponse(new HttpError('VECTOR_UNAVAILABLE', 'no pgvector'));
    expect(res.status).toBe(503);
    expect((await body(res)).error).toMatchObject({ code: 'VECTOR_UNAVAILABLE' });
  });

  it('hides unexpected errors behind a generic code', async () => {
    const res = errorResponse(new Error('password=hunter2 in connection string'));
    expect(res.status).toBe(500);
    const payload = await body(res);
    expect(payload.error).toMatchObject({ code: 'INTERNAL_ERROR' });
    // The raw message must not leak to the caller.
    expect(JSON.stringify(payload)).not.toContain('hunter2');
  });

  it('requires, trims and rejects empty params', () => {
    const params = new URLSearchParams('a=%20x%20');
    expect(stringParam(params, 'a')).toBe('x');
    expect(() => stringParam(params, 'missing', { required: true })).toThrow(HttpError);
  });

  it('bounds numeric params', () => {
    const params = new URLSearchParams('n=5&big=9999&bad=abc');
    expect(numberParam(params, 'n', { min: 1, max: 10 })).toBe(5);
    expect(numberParam(params, 'absent', { fallback: 7 })).toBe(7);
    expect(() => numberParam(params, 'big', { max: 10 })).toThrow(/<= 10/);
    expect(() => numberParam(params, 'bad')).toThrow(/must be a number/);
  });

  it('reports body validation issues as 400s with detail', async () => {
    const schema = z.object({ name: z.string().min(1) });
    await expect(readBody(post('/x', { name: '' }), schema)).rejects.toThrow(HttpError);
    await expect(readBody(post('/x', {}), schema)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('rejects malformed JSON and empty bodies', async () => {
    const schema = z.object({});
    const badJson = new Request('https://x.test', { method: 'POST', body: '{oops' });
    await expect(readBody(badJson, schema)).rejects.toThrow(/valid JSON/);
    const empty = new Request('https://x.test', { method: 'POST', body: '' });
    await expect(readBody(empty, schema)).rejects.toThrow(/required/);
  });
});

// ── health ──────────────────────────────────────────────────────────────────

describe('GET /api/health', () => {
  it('reports ok when every dependency answers', async () => {
    // The risk store is part of "every dependency" — an unconfigured one is
    // reported as degraded, because the agent then runs without risk
    // conditioning. So this case supplies a reader to be genuinely all-green.
    const res = await handleHealth(fakeRuntime({ riskReader: fakeRiskReader() }));
    const payload = await body(res);
    expect(res.status).toBe(200);
    expect(payload['status']).toBe('ok');
    expect(payload['degraded']).toEqual([]);
    expect(payload['database']).toMatchObject({ reachable: true });
    expect(payload['timescaledb']).toMatchObject({ vectorEnabled: true });
  });

  it('degrades rather than failing when the database is down', async () => {
    const res = await handleHealth(fakeRuntime({ pingFails: true }));
    const payload = await body(res);
    // A health check that threw would be useless precisely when it is needed.
    expect(res.status).toBe(200);
    expect(payload['status']).toBe('degraded');
    expect(payload['degraded']).toContain('timescaledb');
    expect(payload['timescaledb']).toBeNull();
    expect(payload['database']).toMatchObject({ reachable: false });
  });

  it('flags a missing vector layer and unconfigured retrieval', async () => {
    const payload = await body(await handleHealth(fakeRuntime({ vectorEnabled: false })));
    expect(payload['degraded']).toContain('vector');
  });

  it('flags an unreachable TimesFM-3 service', async () => {
    const payload = await body(await handleHealth(fakeRuntime({ timesfmReachable: false })));
    expect(payload['degraded']).toContain('timesfm3');
  });
});

// ── metrics ─────────────────────────────────────────────────────────────────

describe('GET /api/metrics', () => {
  it('shapes bucketed points and reports coverage', async () => {
    const res = await handleMetrics(get('/api/metrics?poolId=0xpool&metric=apy&bucket=12 hours'), fakeRuntime());
    const payload = await body(res);
    expect(res.status).toBe(200);
    expect(payload['interval']).toBe('12 hours');
    expect(payload['points']).toHaveLength(2);
    expect(payload['coverage']).toMatchObject({ poolCount: 2 });
    expect(payload['empty']).toBe(false);
  });

  it('requires poolId', async () => {
    const res = await handleMetrics(get('/api/metrics'), fakeRuntime());
    expect(res.status).toBe(400);
    expect((await body(res)).error).toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('rejects an unknown metric with the allowed values', async () => {
    const res = await handleMetrics(get('/api/metrics?poolId=0xpool&metric=nonsense'), fakeRuntime());
    expect(res.status).toBe(400);
    const payload = await body(res);
    expect(JSON.stringify(payload)).toContain('utilization');
  });

  it('surfaces a database failure as a typed code', async () => {
    const runtime = fakeRuntime();
    Object.assign(runtime.metrics, {
      getMetricWindowBucketed: async () => {
        throw Object.assign(new Error('TimescaleDB query failed: relation does not exist'), {
          name: 'TimeseriesRunnerError',
        });
      },
    });
    const res = await handleMetrics(get('/api/metrics?poolId=0xpool'), runtime);
    expect(res.status).toBe(503);
    expect((await body(res)).error).toMatchObject({ code: 'DATABASE_UNAVAILABLE' });
  });
});

// ── forecast ────────────────────────────────────────────────────────────────

describe('POST /api/forecast', () => {
  it('returns quantile steps for a pool with enough history', async () => {
    const res = await handleForecast(post('/api/forecast', { poolId: '0xpool', horizon: 3 }), fakeRuntime());
    const payload = await body(res);
    expect(res.status).toBe(200);
    expect(payload['source']).toBe('predict');
    expect(payload['steps']).toHaveLength(3);
    expect(payload['flags']).toMatchObject({ quantileMonotonic: true });
  });

  it('reports insufficient history instead of calling the model', async () => {
    const res = await handleForecast(
      post('/api/forecast', { poolId: '0xpool' }),
      fakeRuntime({ historyPoints: 4 }),
    );
    const payload = await body(res);
    expect(res.status).toBe(200);
    expect(payload['status']).toBe('insufficient_history');
    expect(payload['points']).toBe(4);
  });

  it('reads the stored path without spending GPU time when stored=true', async () => {
    const runtime = fakeRuntime();
    const run: Partial<ForecastRun> = {
      runId: '11111111-1111-4111-8111-111111111111',
      issuedAt: new Date('2026-09-10T00:00:00Z'),
      modelVersion: 'timesfm-3.0',
      steps: [],
    };
    Object.assign(runtime.forecasts, {
      getLatest: async () => ({
        ...run,
        poolId: '0xpool',
        metric: 'apy',
        contextHash: 'ctx',
      }),
    });
    const res = await handleForecast(post('/api/forecast', { poolId: '0xpool', stored: true }), runtime);
    const payload = await body(res);
    expect(payload['stored']).toBe(true);
    expect(payload['runId']).toBe('11111111-1111-4111-8111-111111111111');
    expect(payload['modelVersion']).toBe('timesfm-3.0');
  });

  it('reports an empty ledger as a status, not an error', async () => {
    const payload = await body(
      await handleForecast(post('/api/forecast', { poolId: '0xpool', stored: true }), fakeRuntime()),
    );
    expect(payload['status']).toBe('no_forecast_stored');
  });

  it('uses the protocol shortcut when a slug is supplied', async () => {
    const payload = await body(
      await handleForecast(post('/api/forecast', { poolId: '0xpool', protocolSlug: 'aave' }), fakeRuntime()),
    );
    expect(payload['source']).toBe('predict_protocol');
    expect(payload['protocolSlug']).toBe('aave');
  });

  it('maps a model failure to MODEL_UNAVAILABLE', async () => {
    const runtime = fakeRuntime();
    Object.assign(runtime.timesfm3, {
      predict: async () => {
        throw Object.assign(new Error('timesfm3 unavailable'), { name: 'TimesFM3HttpError' });
      },
    });
    const res = await handleForecast(post('/api/forecast', { poolId: '0xpool' }), runtime);
    expect(res.status).toBe(503);
    expect((await body(res)).error).toMatchObject({ code: 'MODEL_UNAVAILABLE' });
  });
});

// ── performance ─────────────────────────────────────────────────────────────

describe('GET /api/performance', () => {
  it('returns realized yield, calibration and decision outcomes', async () => {
    const res = await handlePerformance(get('/api/performance?poolId=0xpool'), fakeRuntime());
    const payload = await body(res);
    expect(res.status).toBe(200);
    expect(payload['realizedYield']).toHaveLength(1);
    expect(payload['calibration']).toHaveLength(1);
    expect(payload['decisionOutcomes']).toHaveLength(1);
    expect(payload['empty']).toBe(false);
  });

  it('requires poolId', async () => {
    expect((await handlePerformance(get('/api/performance'), fakeRuntime())).status).toBe(400);
  });
});

// ── search ──────────────────────────────────────────────────────────────────

describe('POST /api/search', () => {
  it('returns grounded hits with their source ids', async () => {
    const res = await handleSearch(post('/api/search', { query: 'apy stability' }), fakeRuntime());
    const payload = await body(res);
    expect(res.status).toBe(200);
    const hits = payload['hits'] as Array<Record<string, unknown>>;
    expect(hits).toHaveLength(1);
    expect(hits[0]!['sourceIds']).toEqual(['metric:0xpool:apy:2026-09-01T00:00:00.000Z']);
  });

  it('reports VECTOR_UNAVAILABLE when retrieval is unconfigured', async () => {
    const res = await handleSearch(post('/api/search', { query: 'x' }), fakeRuntime({ vectorEnabled: false }));
    expect(res.status).toBe(503);
    expect((await body(res)).error).toMatchObject({ code: 'VECTOR_UNAVAILABLE' });
  });

  it('requires a query', async () => {
    expect((await handleSearch(post('/api/search', {}), fakeRuntime())).status).toBe(400);
  });

  it('scopes the search window when days is given', async () => {
    let captured: { from?: Date } = {};
    const runtime = fakeRuntime();
    Object.assign(runtime.vectors!, {
      searchTemporal: async (input: { from?: Date }) => {
        captured = input;
        return [];
      },
    });
    await handleSearch(post('/api/search', { query: 'x', days: 30 }), runtime);
    expect(captured.from).toBeInstanceOf(Date);
    expect(Date.now() - captured.from!.getTime()).toBeGreaterThan(29 * DAY);
  });
});

// ── agent ───────────────────────────────────────────────────────────────────

describe('POST /api/agent', () => {
  it('runs the deterministic path without any model call when dry=true', async () => {
    const res = await handleAgent(
      post('/api/agent', { query: 'find yield', poolIds: ['0xpool'], dry: true }),
      fakeRuntime({ historyPoints: 48 }),
    );
    const payload = await body(res);
    expect(res.status).toBe(200);
    expect(payload['mode']).toBe('dry');
    expect(payload['coverage']).toMatchObject({ poolCount: 2 });
    expect((payload['pools'] as unknown[])[0]).toMatchObject({ poolId: '0xpool', points: 48 });
  });

  it('rejects an empty pool list', async () => {
    const res = await handleAgent(post('/api/agent', { query: 'x', poolIds: [] }), fakeRuntime());
    expect(res.status).toBe(400);
  });

  it('requires a query', async () => {
    expect((await handleAgent(post('/api/agent', {}), fakeRuntime())).status).toBe(400);
  });

  it('defaults to mode v01', async () => {
    // The v01 dependency bundle is a stub here, so the failure proves the
    // request reached the graph path rather than the dry one.
    const res = await handleAgent(
      post('/api/agent', { query: 'x' }),
      fakeRuntime(),
    );
    const payload = await body(res);
    expect(payload['error']).toBeDefined();
    expect(payload).not.toMatchObject({ mode: 'dry' });
  });
});

// ── risk routes ─────────────────────────────────────────────────────────────

describe('GET /api/risk/chains', () => {
  it('lists chain profiles with their dimensions and scores', async () => {
    const res = await handleRiskChains(fakeRuntime({ riskReader: fakeRiskReader() }));
    const payload = await body(res);

    expect(res.status).toBe(200);
    expect(payload['count']).toBe(1);
    const chains = payload['chains'] as Array<Record<string, unknown>>;
    expect(chains[0]).toMatchObject({ slug: 'base', stage: 'stage-1' });
    // The raw dimension strings travel with the score so a classifier change
    // stays auditable against what L2Beat published.
    expect((chains[0]!['dimensions'] as Record<string, Record<string, unknown>>)['exitWindow']).toMatchObject(
      { raw: 'None', category: 'none' },
    );
  });

  it('reports 503 RISK_UNAVAILABLE when no store is configured', async () => {
    // Degrading is deliberate: the rest of the service works without risk data,
    // so this is a typed 503 rather than an error thrown at startup.
    const res = await handleRiskChains(fakeRuntime());
    const payload = await body(res);

    expect(res.status).toBe(503);
    expect((payload['error'] as Record<string, unknown>)['code']).toBe('RISK_UNAVAILABLE');
  });

  it('surfaces manifest freshness alongside the profiles', async () => {
    const res = await handleRiskChains(fakeRuntime({ riskReader: fakeRiskReader() }));
    const payload = await body(res);
    const freshness = payload['freshness'] as Record<string, unknown>;

    expect(freshness['stale']).toBe(false);
    expect(freshness['sources']).toEqual([{ id: 'l2beat', state: 'fresh' }]);
  });

  it('marks a manifest older than two cadence cycles as stale', async () => {
    const old = new Date(Date.now() - 13 * 3_600_000).toISOString();
    const res = await handleRiskChains(
      fakeRuntime({ riskReader: fakeRiskReader({ manifest: manifestFixture(old) }) }),
    );
    const payload = await body(res);

    expect((payload['freshness'] as Record<string, unknown>)['stale']).toBe(true);
  });

  it('treats a missing manifest as stale rather than absent', async () => {
    const res = await handleRiskChains(
      fakeRuntime({ riskReader: fakeRiskReader({ manifest: null }) }),
    );
    const payload = await body(res);

    expect((payload['freshness'] as Record<string, unknown>)).toMatchObject({
      generatedAt: null,
      stale: true,
    });
  });

  it('reports an empty store without failing', async () => {
    const res = await handleRiskChains(
      fakeRuntime({ riskReader: fakeRiskReader({ chains: [] }) }),
    );
    const payload = await body(res);

    expect(res.status).toBe(200);
    expect(payload['count']).toBe(0);
    expect(payload['empty']).toBe(true);
  });
});

describe('GET /api/risk/protocols', () => {
  it('lists governance profiles with forum provenance', async () => {
    const res = await handleRiskProtocols(fakeRuntime({ riskReader: fakeRiskReader() }));
    const payload = await body(res);

    expect(res.status).toBe(200);
    const protocols = payload['protocols'] as Array<Record<string, unknown>>;
    expect(protocols[0]).toMatchObject({
      slug: 'aave',
      forumUrl: 'https://governance.aave.com',
      platform: 'discourse',
    });
    expect(protocols[0]!['proposalCount']).toBe(1);
  });

  it('counts open and risk-relevant proposals separately', async () => {
    // The two counts answer different questions — workload versus what can move
    // collateral parameters — so they are not collapsed into one number.
    const res = await handleRiskProtocols(fakeRuntime({ riskReader: fakeRiskReader() }));
    const payload = await body(res);
    const protocols = payload['protocols'] as Array<Record<string, unknown>>;

    expect(protocols[0]!['openProposals']).toBe(1);
    expect(protocols[0]!['riskRelevantProposals']).toBe(1);
  });

  it('reports 503 RISK_UNAVAILABLE when no store is configured', async () => {
    const res = await handleRiskProtocols(fakeRuntime());
    const payload = await body(res);

    expect(res.status).toBe(503);
    expect((payload['error'] as Record<string, unknown>)['code']).toBe('RISK_UNAVAILABLE');
  });
});

describe('GET /api/risk/adjustment', () => {
  it('derives the Merton/Black-Scholes parameters for a chain', async () => {
    const res = await handleRiskAdjustment(
      get('/api/risk/adjustment?chain=base'),
      fakeRuntime({ riskReader: fakeRiskReader() }),
    );
    const payload = await body(res);

    expect(res.status).toBe(200);
    const adjustment = payload['adjustment'] as Record<string, unknown>;
    // Every parameter the pricing math consumes is present and finite.
    for (const key of ['volatility', 'riskFreeRate', 'collateralHaircut', 'pdLoad', 'liquidityScore']) {
      expect(Number.isFinite(adjustment[key])).toBe(true);
    }
    expect(Array.isArray(adjustment['factors'])).toBe(true);
  });

  it('reports volatilitySource=fallback when no volatility is supplied', async () => {
    // The distinction matters: a fallback constant is a documented assumption,
    // not a measurement, and a consumer must be able to tell them apart.
    const res = await handleRiskAdjustment(
      get('/api/risk/adjustment?chain=base'),
      fakeRuntime({ riskReader: fakeRiskReader() }),
    );
    const payload = await body(res);

    expect(payload['volatilitySource']).toBe('fallback');
    expect((payload['inputs'] as Record<string, unknown>)['realizedVolatility']).toBeNull();
  });

  it('uses a supplied volatility and reports it as realized', async () => {
    const res = await handleRiskAdjustment(
      get('/api/risk/adjustment?chain=base&volatility=0.8'),
      fakeRuntime({ riskReader: fakeRiskReader() }),
    );
    const payload = await body(res);

    expect(payload['volatilitySource']).toBe('realized');
    expect((payload['inputs'] as Record<string, unknown>)['realizedVolatility']).toBe(0.8);
  });

  it('defaults the base rate to 0.05, preserving prior behaviour', async () => {
    const res = await handleRiskAdjustment(
      get('/api/risk/adjustment?chain=base'),
      fakeRuntime({ riskReader: fakeRiskReader() }),
    );
    const payload = await body(res);

    expect((payload['inputs'] as Record<string, unknown>)['baseRate']).toBe(0.05);
  });

  it('names a chain with no snapshot as 404 rather than inventing one', async () => {
    const res = await handleRiskAdjustment(
      get('/api/risk/adjustment?chain=does-not-exist'),
      fakeRuntime({ riskReader: fakeRiskReader() }),
    );
    const payload = await body(res);

    expect(res.status).toBe(404);
    expect((payload['error'] as Record<string, unknown>)['code']).toBe('NOT_FOUND');
  });

  it('requires the chain parameter', async () => {
    const res = await handleRiskAdjustment(
      get('/api/risk/adjustment'),
      fakeRuntime({ riskReader: fakeRiskReader() }),
    );

    expect(res.status).toBe(400);
  });

  it('records an unresolved protocol rather than failing the derivation', async () => {
    // A missing governance snapshot should cost the governance term, not the
    // whole answer — and the gap is named so it is not mistaken for a zero.
    const res = await handleRiskAdjustment(
      get('/api/risk/adjustment?chain=base&protocol=nonexistent'),
      fakeRuntime({ riskReader: fakeRiskReader() }),
    );
    const payload = await body(res);

    expect(res.status).toBe(200);
    expect((payload['unresolved'] as Record<string, unknown>)['protocols']).toEqual(['nonexistent']);
  });

  it('records unresolved market makers by slug, not by position', async () => {
    const res = await handleRiskAdjustment(
      get('/api/risk/adjustment?chain=base&marketMakers=flowdesk,ghost-maker'),
      fakeRuntime({ riskReader: fakeRiskReader() }),
    );
    const payload = await body(res);

    expect(res.status).toBe(200);
    expect((payload['unresolved'] as Record<string, unknown>)['marketMakers']).toEqual(['ghost-maker']);
    // The resolved one still contributed to the liquidity score.
    expect((payload['subject'] as Record<string, unknown>)['marketMakers']).toEqual(['flowdesk']);
  });

  it('rejects a non-numeric volatility', async () => {
    const res = await handleRiskAdjustment(
      get('/api/risk/adjustment?chain=base&volatility=abc'),
      fakeRuntime({ riskReader: fakeRiskReader() }),
    );

    expect(res.status).toBe(400);
  });

  it('reports 503 RISK_UNAVAILABLE when no store is configured', async () => {
    const res = await handleRiskAdjustment(get('/api/risk/adjustment?chain=base'), fakeRuntime());
    const payload = await body(res);

    expect(res.status).toBe(503);
    expect((payload['error'] as Record<string, unknown>)['code']).toBe('RISK_UNAVAILABLE');
  });
});

describe('GET /api/health with risk configured', () => {
  it('reports the risk store as ready when one resolves', async () => {
    const res = await handleHealth(fakeRuntime({ riskReader: fakeRiskReader() }));
    const payload = await body(res);
    const risk = payload['risk'] as Record<string, unknown>;

    expect(risk['store']).toBe('ready');
    expect(payload['degraded']).not.toContain('risk');
  });

  it('degrades with a named reason when no store is configured', async () => {
    const res = await handleHealth(fakeRuntime());
    const payload = await body(res);
    const risk = payload['risk'] as Record<string, unknown>;

    expect(risk['store']).toBe('unconfigured');
    expect(payload['degraded']).toContain('risk');
  });

  it('distinguishes an unreadable store from an unconfigured one', async () => {
    // "No bucket named" and "bucket named but broken" need different remedies,
    // so they must not collapse into one state.
    const res = await handleHealth(
      fakeRuntime({ riskReader: fakeRiskReader({ throws: new Error('bucket access denied') }) }),
    );
    const payload = await body(res);
    const risk = payload['risk'] as Record<string, unknown>;

    expect(risk['store']).toBe('unavailable');
    expect(risk['error']).toBe('bucket access denied');
  });
});
