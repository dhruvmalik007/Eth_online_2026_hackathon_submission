import { z } from 'zod';
import {
  MetricNameSchema,
  type MetricName,
} from '@ethonline2026/timeseries';
import { runV01 } from '@ethonline2026/langchain-agent';
import {
  countRiskRelevantProposals,
  deriveRiskAdjustment,
  rate,
  type Loaded,
  type Manifest,
  type RiskProfileReader,
  type SourceState,
} from '@ethonline2026/risk-analysis-data-pipeline';
import { HttpError, errorResponse, json, numberParam, readBody, stringParam, toHttpError } from './http.js';
import type { IndexerRuntime } from './runtime.js';

/**
 * Route handlers.
 *
 * Each one takes the runtime as a parameter rather than reaching for a
 * singleton, so the whole surface is exercisable offline with injected fakes.
 * The files under `api/` are thin adapters that call these.
 *
 * Handlers return a `Response` and translate every dependency failure through
 * `toHttpError`, so a browser always receives a typed code it can render.
 */

const DAY_MS = 86_400_000;

/** Absolute window, plus the `{start,end}` shape the bucket builder expects. */
function rangeFrom(params: URLSearchParams): {
  readonly from: Date;
  readonly to: Date;
  readonly buckets: { readonly start: Date; readonly end: Date };
} {
  const days = numberParam(params, 'days', { min: 1, max: 720, fallback: 90 }) ?? 90;
  const to = new Date();
  const from = new Date(to.getTime() - days * DAY_MS);
  return { from, to, buckets: { start: from, end: to } };
}

// ── GET /api/health ─────────────────────────────────────────────────────────

export async function handleHealth(runtime: IndexerRuntime): Promise<Response> {
  let dbReachable = false;
  let dbError: string | undefined;
  try {
    dbReachable = await runtime.metrics.ping();
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  const capabilities = dbReachable ? await runtime.capabilities() : null;
  const timesfm3 = await runtime.probeTimesfm3(runtime.env.TIMESFM3_SERVICE_URL);

  // Risk snapshot availability. Resolved *and read*: constructing a store handle
  // succeeds even when the bucket does not exist or the credentials are wrong, so
  // only a real read distinguishes "configured" from "actually usable". The
  // manifest is the cheapest such read — one small object.
  let riskStore: 'unconfigured' | 'ready' | 'unavailable' = 'unconfigured';
  let riskError: string | undefined;
  try {
    const reader = await runtime.riskReader();
    if (reader === undefined) {
      riskStore = 'unconfigured';
    } else {
      await reader.manifest();
      riskStore = 'ready';
    }
  } catch (err) {
    riskStore = 'unavailable';
    riskError = err instanceof Error ? err.message : String(err);
  }

  const degraded: string[] = [];
  if (!dbReachable) degraded.push('timescaledb');
  if (!timesfm3.reachable) degraded.push('timesfm3');
  if (capabilities !== null && !capabilities.vectorEnabled) degraded.push('vector');
  if (runtime.vectors === undefined) degraded.push('retrieval');
  if (riskStore !== 'ready') degraded.push('risk');

  return json({
    service: 'agentic-ems-indexer',
    status: degraded.length === 0 ? 'ok' : 'degraded',
    degraded,
    database: {
      reachable: dbReachable,
      ...(dbError === undefined ? {} : { error: dbError }),
      poolMax: runtime.env.TIMESERIES_DB_MAX_CONNECTIONS,
      viaDsn: runtime.env.TIMESERIES_DATABASE_URL !== undefined,
    },
    timescaledb: capabilities,
    timesfm3: {
      url: runtime.env.TIMESFM3_SERVICE_URL,
      ...timesfm3,
    },
    retrieval: runtime.vectors === undefined ? 'unconfigured' : 'enabled',
    risk: {
      store: riskStore,
      ...(riskError === undefined ? {} : { error: riskError }),
      bucket: runtime.env.RISK_GCS_BUCKET ?? null,
      prefix: runtime.env.RISK_GCS_PREFIX,
      localDir: runtime.env.RISK_LOCAL_DIR ?? null,
    },
    models: {
      vertexProject: runtime.env.GOOGLE_CLOUD_PROJECT ?? null,
      location: runtime.env.GOOGLE_CLOUD_LOCATION,
      embeddingModel: runtime.env.VERTEX_EMBEDDING_MODEL,
      timesfm3Model: 'timesfm-3.0',
    },
  });
}

// ── GET /api/metrics ────────────────────────────────────────────────────────

export async function handleMetrics(request: Request, runtime: IndexerRuntime): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams;
    const poolId = stringParam(params, 'poolId', { required: true })!;
    const metricRaw = stringParam(params, 'metric') ?? 'apy';
    const metric = MetricNameSchema.safeParse(metricRaw);
    if (!metric.success) {
      throw new HttpError(
        'BAD_REQUEST',
        `Unknown metric '${metricRaw}'.`,
        ['expected one of: apy, volume, tvl, utilization'],
      );
    }
    const interval = stringParam(params, 'bucket') ?? '1 day';
    const range = rangeFrom(params);

    const [series, coverage] = await Promise.all([
      runtime.metrics.getMetricWindowBucketed(poolId, metric.data, interval, range.buckets),
      runtime.metrics.getCoverage(),
    ]);

    return json({
      poolId,
      metric: metric.data,
      interval,
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      points: series.map((p) => ({
        bucketStart: p.bucketStart.toISOString(),
        avg: p.values['avg'] ?? null,
        min: p.values['min'] ?? null,
        max: p.values['max'] ?? null,
        samples: p.values['samples'] ?? 0,
      })),
      coverage,
      empty: series.length === 0,
    });
  } catch (error) {
    return errorResponse(toHttpError(error, 'metrics'));
  }
}

// ── GET|POST /api/forecast ──────────────────────────────────────────────────

const ForecastBodySchema = z.object({
  poolId: z.string().min(1),
  metric: MetricNameSchema.default('apy'),
  horizon: z.number().int().positive().max(365).default(30),
  windowDays: z.number().int().positive().max(365).default(90),
  /** Read the stored path instead of calling the model. */
  stored: z.boolean().default(false),
  /** Use the service's protocol shortcut (fetches its own DeFiLlama data). */
  protocolSlug: z.string().min(1).optional(),
});

export async function handleForecast(request: Request, runtime: IndexerRuntime): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams;
    const body =
      request.method === 'POST'
        ? await readBody(request, ForecastBodySchema)
        : ForecastBodySchema.parse({
            poolId: stringParam(params, 'poolId', { required: true }),
            metric: stringParam(params, 'metric') ?? 'apy',
            horizon: numberParam(params, 'horizon', { min: 1, max: 365, fallback: 30 }),
            windowDays: numberParam(params, 'windowDays', { min: 1, max: 365, fallback: 90 }),
            stored: params.get('stored') === 'true',
            ...(params.get('protocolSlug') === null ? {} : { protocolSlug: params.get('protocolSlug') }),
          });

    // Read-back path: never spend GPU time to answer "what did we forecast?".
    if (body.stored) {
      const stored = await runtime.forecasts.getLatest(body.poolId, body.metric);
      if (stored === null) {
        return json({
          poolId: body.poolId,
          metric: body.metric,
          stored: true,
          status: 'no_forecast_stored',
        });
      }
      return json({
        poolId: body.poolId,
        metric: body.metric,
        stored: true,
        runId: stored.runId,
        issuedAt: stored.issuedAt.toISOString(),
        modelVersion: stored.modelVersion,
        steps: stored.steps.map((s) => ({
          targetTs: s.targetTs.toISOString(),
          horizonStep: s.horizonStep,
          point: s.point,
          quantiles: s.quantiles,
        })),
      });
    }

    if (body.protocolSlug !== undefined) {
      const result = await runtime.timesfm3.predictProtocol({
        protocolSlug: body.protocolSlug,
        horizon: body.horizon,
        metric: body.metric === 'utilization' ? 'apy' : body.metric,
      });
      return json({
        poolId: body.poolId,
        protocolSlug: result.protocolSlug,
        metric: result.metric,
        source: 'predict_protocol',
        model: result.forecast.model,
        latencyMs: result.forecast.latencyMs,
        flags: result.forecast.flags,
        steps: result.forecast.steps.map((s) => ({
          index: s.index,
          q10: s.q10,
          q50: s.q50,
          q90: s.q90,
        })),
      });
    }

    const since = new Date(Date.now() - body.windowDays * DAY_MS);
    const window = await runtime.metrics.getMetricWindow(body.poolId, body.metric, since);
    if (window.values.length < 8) {
      return json({
        poolId: body.poolId,
        metric: body.metric,
        status: 'insufficient_history',
        points: window.values.length,
        detail: 'At least 8 observations are required before forecasting.',
      });
    }

    const forecast = await runtime.timesfm3.predict({
      series: [...window.values],
      horizon: body.horizon,
      returnQuantiles: true,
    });

    return json({
      poolId: body.poolId,
      metric: body.metric,
      source: 'predict',
      model: forecast.model,
      latencyMs: forecast.latencyMs,
      flags: forecast.flags,
      historyPoints: window.values.length,
      steps: forecast.steps.map((s) => ({
        index: s.index,
        q10: s.q10,
        q50: s.q50,
        q90: s.q90,
      })),
      reading:
        'q10–q90 is the modelled uncertainty band. A step whose band is wide relative to ' +
        'its median carries little information — check /api/health for forecast reliability.',
    });
  } catch (error) {
    return errorResponse(toHttpError(error, 'forecast'));
  }
}

// ── GET /api/performance ────────────────────────────────────────────────────

export async function handlePerformance(
  request: Request,
  runtime: IndexerRuntime,
): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams;
    const poolId = stringParam(params, 'poolId', { required: true })!;
    const range = rangeFrom(params);

    const [realized, calibration, outcomes] = await Promise.all([
      runtime.performance.getRealizedYield(poolId, range),
      runtime.performance.getCalibrationSummary(poolId, range),
      runtime.performance.getDecisionOutcomes(poolId, range),
    ]);

    return json({
      poolId,
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      realizedYield: realized.map((r) => ({
        bucketStart: r.bucketStart.toISOString(),
        avgApy: r.avgApy,
        minApy: r.minApy,
        maxApy: r.maxApy,
        avgTvl: r.avgTvl,
        samples: r.samples,
      })),
      calibration,
      decisionOutcomes: outcomes,
      empty: realized.length === 0 && calibration.length === 0,
      reading:
        'All figures are computed in SQL. coverage is the share of actuals inside the ' +
        'q10–q90 band; outcomeScore is realized − baseline for a past decision.',
    });
  } catch (error) {
    return errorResponse(toHttpError(error, 'performance'));
  }
}

// ── POST /api/search ────────────────────────────────────────────────────────

const SearchBodySchema = z.object({
  query: z.string().min(1).max(2000),
  poolId: z.string().min(1).optional(),
  days: z.number().int().positive().max(720).optional(),
  k: z.number().int().positive().max(50).optional(),
  kinds: z
    .array(z.enum(['metric_window', 'forecast_run', 'decision', 'performance_slice']))
    .optional(),
});

export async function handleSearch(request: Request, runtime: IndexerRuntime): Promise<Response> {
  try {
    if (runtime.vectors === undefined) {
      throw new HttpError(
        'VECTOR_UNAVAILABLE',
        'Retrieval is not configured. Set GOOGLE_CLOUD_PROJECT to enable embeddings.',
      );
    }
    const body = await readBody(request, SearchBodySchema);
    const to = new Date();
    const hits = await runtime.vectors.searchTemporal({
      query: body.query,
      ...(body.poolId === undefined ? {} : { poolId: body.poolId }),
      ...(body.days === undefined ? {} : { from: new Date(to.getTime() - body.days * DAY_MS) }),
      to,
      ...(body.k === undefined ? {} : { k: body.k }),
      ...(body.kinds === undefined ? {} : { kinds: body.kinds }),
    });

    return json({
      query: body.query,
      hits: hits.map((hit) => ({
        id: hit.id,
        poolId: hit.poolId,
        kind: hit.kind,
        window: { start: hit.tsStart.toISOString(), end: hit.tsEnd.toISOString() },
        score: hit.score,
        sourceIds: hit.sourceIds,
        content: hit.content,
      })),
      empty: hits.length === 0,
      reading:
        'Every hit was rendered only from stored rows, so each line is traceable. ' +
        'sourceIds name those rows — treat content without them as absent.',
    });
  } catch (error) {
    return errorResponse(toHttpError(error, 'search'));
  }
}

// ── POST /api/agent ─────────────────────────────────────────────────────────

const AgentBodySchema = z.object({
  query: z.string().min(1).max(4000),
  mode: z.enum(['v01', 'deep']).default('v01'),
  poolIds: z.array(z.string().min(1)).min(1).default(['0xpool']),
  protocols: z.array(z.string().min(1)).min(1).default(['aave-v3']),
  horizonDays: z.number().int().positive().max(365).default(30),
  /**
   * The chain the mandate targets. Given, the v0.1 graph derives chain-level risk
   * and offers it to synthesis; omitted, the run proceeds without a risk context
   * rather than substituting a default.
   */
  chain: z.string().min(1).optional(),
  /** v01 only: skip LLM nodes and return the deterministic skeleton. */
  dry: z.boolean().default(false),
});

export async function handleAgent(request: Request, runtime: IndexerRuntime): Promise<Response> {
  const startedAt = Date.now();
  try {
    const body = await readBody(request, AgentBodySchema);

    if (body.dry) {
      // Deterministic-only path: exercises data access and the ledger without
      // any model spend. Useful for smoke-testing a fresh deployment.
      const coverage = await runtime.metrics.getCoverage();
      const windows = await Promise.all(
        body.poolIds.map((poolId) =>
          runtime.metrics.getMetricWindow(
            poolId,
            'apy',
            new Date(Date.now() - body.horizonDays * DAY_MS),
          ),
        ),
      );
      return json({
        mode: 'dry',
        query: body.query,
        coverage,
        pools: windows.map((w) => ({ poolId: w.poolId, points: w.values.length })),
        elapsedMs: Date.now() - startedAt,
      });
    }

    if (body.mode === 'deep') {
      const agent = await runtime.deepAgent();
      const result = await agent.invoke(body.query);
      return json({
        mode: 'deep',
        query: body.query,
        result,
        elapsedMs: Date.now() - startedAt,
      });
    }

    const state = await runV01(runtime.v01, {
      mandate: body.query,
      protocols: body.protocols,
      poolIds: body.poolIds,
      horizonDays: body.horizonDays,
      ...(body.chain === undefined ? {} : { chain: body.chain }),
    });

    return json({
      mode: 'v01',
      query: body.query,
      synthesis: state.synthesisPayload ?? null,
      decisions: state.readjustmentDecisions,
      riskAssessment: state.riskAssessment,
      riskProfile: state.riskProfile,
      constraints: state.protocolConstraints,
      projections: state.yieldProjections,
      forecastRunId: state.forecastRunId,
      evidence: state.evidence,
      calibration: state.calibration,
      audit: state.audit,
      synthesisRuns: state.synthesisRuns,
      elapsedMs: Date.now() - startedAt,
    });
  } catch (error) {
    return errorResponse(toHttpError(error, 'agent'));
  }
}

export type { MetricName };

// ── Risk snapshots (macro, governance, market makers) ───────────────────────
//
// Three routes over the snapshots the risk-data pipeline publishes. They are
// read-only and cheap: no model call, no GPU, just validated snapshot reads. The
// agent uses them to condition its parameters on macro and governance risk, and
// the frontend uses them to explain *why* a parameter moved.
//
// All three share one property: when no store is configured they answer 503 with
// a typed code rather than failing, matching how retrieval degrades when no
// Vertex project is set.

/**
 * Resolve the risk reader or fail with a typed, actionable code.
 *
 * @param runtime - The indexer runtime.
 * @returns The configured reader.
 * @throws {HttpError} `RISK_UNAVAILABLE` when no snapshot store is configured.
 */
async function requireRiskReader(runtime: IndexerRuntime): Promise<RiskProfileReader> {
  const reader = await runtime.riskReader();
  if (reader === undefined) {
    throw new HttpError(
      'RISK_UNAVAILABLE',
      'Risk snapshots are not configured. Set RISK_GCS_BUCKET (or RISK_LOCAL_DIR).',
    );
  }
  return reader;
}

/**
 * Summarise manifest freshness for a response.
 *
 * Freshness travels with the data on purpose: a stale risk profile is far more
 * useful than none, provided the staleness is visible. What is forbidden is
 * presenting an old snapshot as current.
 *
 * @param manifest - The loaded manifest, when one exists.
 * @returns The generated-at instant, per-source state, and staleness flag.
 */
function riskFreshness(manifest: Loaded<Manifest> | null): {
  readonly generatedAt: string | null;
  readonly sources: readonly { readonly id: string; readonly state: SourceState }[];
  readonly stale: boolean;
} {
  if (manifest === null) {
    return { generatedAt: null, sources: [], stale: true };
  }
  // `sources` is keyed by source id rather than an array — the manifest is a map
  // so a consumer can look up one source without scanning.
  const sources = Object.entries(manifest.value.sources).map(([id, source]) => ({
    id,
    state: source.state,
  }));
  // The collector runs every six hours; anything older than two cycles means at
  // least one sweep was missed, which the caller should know about.
  const ageMs = Date.now() - new Date(manifest.value.generatedAt).getTime();
  return {
    generatedAt: manifest.value.generatedAt,
    sources,
    stale: ageMs > 12 * 3_600_000,
  };
}

// ── GET /api/risk/chains ────────────────────────────────────────────────────

/**
 * List every collected chain risk profile.
 *
 * @param runtime - The indexer runtime.
 * @returns The chain profiles with their five L2Beat dimensions, scores and
 *   provenance, plus manifest freshness.
 */
export async function handleRiskChains(runtime: IndexerRuntime): Promise<Response> {
  try {
    const reader = await requireRiskReader(runtime);
    const slugs = await reader.chainSlugs();
    const loaded = await Promise.all(slugs.map((slug) => reader.chain(slug)));
    const chains = loaded.filter((entry) => entry !== null);
    const manifest = await reader.manifest();

    return json({
      count: chains.length,
      chains: chains.map(({ value: chain }) => ({
        slug: chain.slug,
        name: chain.name,
        stage: chain.stage,
        l2beatUrl: chain.l2beatUrl,
        valueSecuredUsd: chain.valueSecuredUsd,
        riskScores: chain.riskScores,
        dimensions: chain.dimensions,
        provenance: chain.provenance,
      })),
      freshness: riskFreshness(manifest),
      empty: chains.length === 0,
      reading:
        'riskScores are deterministic, 0–1 and higher-is-safer; they are derived from ' +
        'the raw dimension strings, which are carried verbatim so a classifier change ' +
        'stays auditable. Compare `stage` before comparing chains: a Stage 2 chain is ' +
        'not comparable to a Stage 0 one on score alone.',
    });
  } catch (error) {
    return errorResponse(toHttpError(error, 'risk/chains'));
  }
}

// ── GET /api/risk/protocols ─────────────────────────────────────────────────

/**
 * List every collected protocol governance profile.
 *
 * @param runtime - The indexer runtime.
 * @returns The governance profiles with proposal counts, scores, the forum URL
 *   the data came from, and manifest freshness.
 */
export async function handleRiskProtocols(runtime: IndexerRuntime): Promise<Response> {
  try {
    const reader = await requireRiskReader(runtime);
    const slugs = await reader.protocolSlugs();
    const loaded = await Promise.all(slugs.map((slug) => reader.protocol(slug)));
    const protocols = loaded.filter((entry) => entry !== null);
    const manifest = await reader.manifest();

    return json({
      count: protocols.length,
      protocols: protocols.map(({ value: protocol }) => ({
        slug: protocol.slug,
        name: protocol.name,
        forumUrl: protocol.governance.forumUrl,
        platform: protocol.governance.platform,
        governanceScores: protocol.governanceScores,
        proposalCount: protocol.proposals.length,
        openProposals: protocol.proposals.filter((p) => p.status === 'open').length,
        // Uses the same predicate the history writer stores, so the API figure
        // and the time series cannot disagree.
        riskRelevantProposals: countRiskRelevantProposals(protocol.proposals),
        provenance: protocol.provenance,
      })),
      freshness: riskFreshness(manifest),
      empty: protocols.length === 0,
      reading:
        'governanceScores are 0–1 and higher-is-safer. `openProposals` counts proposals ' +
        'still in a discussion or vote stage; `riskRelevantProposals` are those the ' +
        'classifier placed in the risk stage, which are the ones that can move collateral ' +
        'or liquidation parameters.',
    });
  } catch (error) {
    return errorResponse(toHttpError(error, 'risk/protocols'));
  }
}

// ── GET /api/risk/adjustment ────────────────────────────────────────────────

/**
 * Derive the Black-Scholes/Merton parameters for a chain, and optionally a
 * protocol and set of market makers.
 *
 * This is the route the risk layer consumes: it turns collected risk into the
 * five parameters the pricing math needs — a volatility multiplier, a rate
 * premium, a collateral haircut, a probability-of-default load and a liquidity
 * score — and returns each factor with the inputs that produced it, so a caller
 * can explain the number rather than assert it.
 *
 * @param request - Carries `chain` (required), and optionally `protocol`,
 *   `marketMakers` (comma-separated), `volatility` and `baseRate`.
 * @param runtime - The indexer runtime.
 * @returns The derived adjustment plus its factors and inputs.
 */
export async function handleRiskAdjustment(
  request: Request,
  runtime: IndexerRuntime,
): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams;
    const chainSlug = stringParam(params, 'chain', { required: true })!;
    const protocolSlug = stringParam(params, 'protocol');
    const marketMakerList = stringParam(params, 'marketMakers');
    const volatilityParam = numberParam(params, 'volatility', { min: 0 });
    // 5% is the documented default the Merton tool used before this route
    // existed, kept so an absent parameter is behaviour-preserving.
    const baseRate = numberParam(params, 'baseRate', { min: 0, max: 1, fallback: 0.05 }) ?? 0.05;

    const reader = await requireRiskReader(runtime);

    const chain = await reader.chain(chainSlug);
    if (chain === null) {
      throw new HttpError('NOT_FOUND', `No risk snapshot for chain '${chainSlug}'.`);
    }

    const governance =
      protocolSlug === undefined ? null : ((await reader.protocol(protocolSlug))?.value ?? null);

    const marketMakerSlugs = (marketMakerList ?? '')
      .split(',')
      .map((slug) => slug.trim())
      .filter((slug) => slug.length > 0);
    // Each slug is paired with its result as it resolves, so naming the
    // unresolved ones does not depend on index alignment surviving a filter.
    const marketMakerResults = await Promise.all(
      marketMakerSlugs.map(async (slug) => ({ slug, entry: await reader.marketMaker(slug) })),
    );
    const marketMakers = marketMakerResults
      .map((result) => result.entry)
      .filter((entry) => entry !== null)
      .map((entry) => entry.value);

    const adjustment = deriveRiskAdjustment({
      chainScores: chain.value.riskScores,
      ...(governance === null ? {} : { governance }),
      ...(marketMakers.length === 0 ? {} : { marketMakers }),
      realizedVolatility: volatilityParam === undefined ? null : rate(volatilityParam),
      baseRiskFreeRate: rate(baseRate),
    });

    return json({
      subject: {
        chain: chain.value.slug,
        chainName: chain.value.name,
        protocol: governance?.slug ?? null,
        marketMakers: marketMakers.map((m) => m.slug),
      },
      adjustment,
      inputs: {
        chainComposite: chain.value.riskScores.composite,
        protocolComposite: governance?.governanceScores.composite ?? null,
        baseRate,
        realizedVolatility: volatilityParam ?? null,
      },
      // Named so a consumer can tell "measured" from "documented fallback"
      // without inspecting the numbers.
      volatilitySource: adjustment.volatilitySource,
      unresolved: {
        protocols: protocolSlug !== undefined && governance === null ? [protocolSlug] : [],
        marketMakers: marketMakerResults
          .filter((result) => result.entry === null)
          .map((result) => result.slug),
      },
      reading:
        'Every factor is deterministic and carries its inputs, so a parameter can be ' +
        'explained rather than asserted. volatilitySource="fallback" means no realized ' +
        'volatility was supplied and the documented constant was used.',
    });
  } catch (error) {
    return errorResponse(toHttpError(error, 'risk/adjustment'));
  }
}
