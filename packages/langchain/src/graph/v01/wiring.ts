import { loadEnv } from '../../config/env.js';
import { structuredLlmForRole } from '../../config/modelRegistry.js';
import { TimesFM3Client, FetchTimesFM3Http, type TimesFM3Http } from '../../services/timesfm3/index.js';
import {
  DecisionRepository,
  ForecastRepository,
  PerformanceRepository,
  PgSqlRunner,
  TimeseriesClient,
  VectorRepository,
  VertexEmbeddingService,
  resolveConnectionSpec,
  type EmbeddingService,
  type SqlRunner,
  type TimeseriesEnv,
} from '@ethonline2026/timeseries';
import type { StructuredLlm } from './ruleParser.js';
import {
  createRiskProfileReader,
  type RiskProfileReader,
} from '@ethonline2026/risk-analysis-data-pipeline';

/**
 * Composition root for the v0.1 agent: wires the model registry (LLM roles),
 * the TimesFM-3 service client, and the TimescaleDB repositories into the
 * graph dependencies. The only place concrete adapters meet.
 *
 * The vector store needs Vertex credentials, so it is attached only when a
 * project is configured — otherwise the agent runs without retrieval rather
 * than failing at startup.
 */

/** TimescaleDB connection env, derived from the langchain env surface. */
function timeseriesEnv(env: ReturnType<typeof loadEnv>): TimeseriesEnv {
  return {
    TIMESERIES_DATABASE_URL: env.TIMESERIES_DATABASE_URL,
    TIMESERIES_DB_HOST: env.TIMESERIES_DB_HOST,
    TIMESERIES_DB_PORT: env.TIMESERIES_DB_PORT,
    TIMESERIES_DB_NAME: env.TIMESERIES_DB_NAME,
    TIMESERIES_DB_USER: env.TIMESERIES_DB_USER,
    TIMESERIES_DB_PASSWORD: env.TIMESERIES_DB_PASSWORD,
    TIMESERIES_DB_MAX_CONNECTIONS: env.TIMESERIES_DB_MAX_CONNECTIONS,
  };
}

export function buildV01Deps(overrides: {
  parserLlm?: StructuredLlm;
  synthesisLlm?: StructuredLlm;
  timesfm3Http?: TimesFM3Http;
  tsdbRunner?: SqlRunner;
  embeddingService?: EmbeddingService;
  /** Force the vector layer off even when credentials exist. */
  disableRetrieval?: boolean;
  /** Inject a risk reader so the graph is testable without a snapshot store. */
  riskReader?: RiskProfileReader;
  /**
   * Supply the lazy risk-reader resolver directly. Used by a host that already
   * caches its own (the serverless runtime does), so the graph and the HTTP
   * routes share one resolution rather than each opening the store.
   */
  resolveRiskReader?: () => Promise<RiskProfileReader | undefined>;
} = {}) {
  const env = loadEnv();
  const runner =
    overrides.tsdbRunner ?? new PgSqlRunner(resolveConnectionSpec(timeseriesEnv(env)));

  const embeddingService =
    overrides.embeddingService ??
    (env.GOOGLE_CLOUD_PROJECT !== undefined && env.GOOGLE_CLOUD_PROJECT.length > 0
      ? new VertexEmbeddingService({
          project: env.GOOGLE_CLOUD_PROJECT,
          location: env.GOOGLE_CLOUD_LOCATION,
          model: env.VERTEX_EMBEDDING_MODEL,
        })
      : undefined);

  const vectorRepo =
    overrides.disableRetrieval === true || embeddingService === undefined
      ? undefined
      : new VectorRepository(runner, embeddingService);

  // Risk snapshots are read from GCS, whose SDK the risk package imports lazily.
  // Resolution is deferred to first use (an unconfigured environment never loads
  // the SDK at all) and memoized, so a graph cycle pays for it once. A host that
  // already caches its own resolver supplies it instead.
  let riskReaderPromise: Promise<RiskProfileReader | undefined> | null = null;
  const resolveRiskReader =
    overrides.resolveRiskReader ??
    ((): Promise<RiskProfileReader | undefined> => {
      if (overrides.riskReader !== undefined) {
        return Promise.resolve<RiskProfileReader | undefined>(overrides.riskReader);
      }
      riskReaderPromise ??= createRiskProfileReader({
        ...(env.RISK_GCS_BUCKET === undefined ? {} : { gcsBucket: env.RISK_GCS_BUCKET }),
        gcsPrefix: env.RISK_GCS_PREFIX,
        ...(env.RISK_LOCAL_DIR === undefined ? {} : { localDir: env.RISK_LOCAL_DIR }),
      });
      return riskReaderPromise;
    });

  return {
    parserLlm: overrides.parserLlm ?? structuredLlmForRole('parser'),
    synthesisLlm: overrides.synthesisLlm ?? structuredLlmForRole('synthesis'),
    timesfm3: new TimesFM3Client(
      overrides.timesfm3Http ?? new FetchTimesFM3Http(env.TIMESFM3_SERVICE_URL),
    ),
    tsdb: new TimeseriesClient(runner),
    forecastRepo: new ForecastRepository(runner),
    performanceRepo: new PerformanceRepository(runner),
    decisionRepo: new DecisionRepository(runner),
    ...(vectorRepo === undefined ? {} : { vectorRepo }),
    resolveRiskReader,
  };
}
