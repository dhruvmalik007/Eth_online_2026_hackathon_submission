import { mkdirSync, writeFileSync } from 'node:fs';
import {
  DecisionRepository,
  ForecastRepository,
  PgSqlRunner,
  PerformanceRepository,
  TimeseriesClient,
  VectorRepository,
  VertexEmbeddingService,
  probeCapabilities,
  type CapabilityReport,
  type EmbeddingService,
  type SqlRunner,
} from '@ethonline2026/timeseries';
import {
  DeepGraphAgent,
  FetchTimesFM3Http,
  TimesFM3Client,
  buildV01Deps,
  loadEnv,
  type Env,
  type TimesFM3Http,
  type V01Deps,
} from '@ethonline2026/langchain-agent';
import {
  createRiskProfileReader,
  type RiskProfileReader,
} from '@ethonline2026/risk-analysis-data-pipeline';

/**
 * Composition root for the serverless surface.
 *
 * Vercel instances freeze between requests and thaw on the next one, so the
 * expensive objects are cached on `globalThis` rather than rebuilt: the pg
 * pool (which the timeseries runner itself caches by connection key), the
 * repositories over it, and the deep agent. A cold start pays for them once;
 * every warm invocation reuses them.
 *
 * The concrete adapters are assembled here and nowhere else, so the route
 * handlers depend on interfaces and the tests can inject fakes.
 */

/** Reachability result for the inference service. */
export interface ServiceProbe {
  readonly reachable: boolean;
  readonly status?: number;
  readonly error?: string;
}

/** Port for the health probe, so tests never touch the network. */
export type ServiceProbeFn = (baseUrl: string) => Promise<ServiceProbe>;

export interface IndexerRuntime {
  readonly env: Env;
  readonly runner: SqlRunner;
  readonly metrics: TimeseriesClient;
  readonly forecasts: ForecastRepository;
  readonly performance: PerformanceRepository;
  readonly decisions: DecisionRepository;
  /** Absent when no Vertex project is configured (retrieval degrades). */
  readonly vectors?: VectorRepository;
  readonly timesfm3: TimesFM3Client;
  readonly v01: V01Deps;
  /** Health probe for the TimesFM-3 service. */
  readonly probeTimesfm3: ServiceProbeFn;
  /**
   * What the connected server offers. Cached per runtime instance (not
   * process-wide, so a test's fake server cannot leak into the next test);
   * resolves to null when the database cannot be reached.
   */
  capabilities(): Promise<CapabilityReport | null>;
  /** Lazily created — the deep agent is expensive and may be unused. */
  deepAgent(): Promise<DeepGraphAgent>;
  /**
   * Risk snapshot reader, or `undefined` when no store is configured.
   *
   * Lazy and async because resolving it may load the GCS SDK, which should not
   * happen on a cold start that never touches a risk route. Resolved once and
   * cached, so the SDK load is paid at most once per instance.
   */
  riskReader(): Promise<RiskProfileReader | undefined>;
}

export interface RuntimeOverrides {
  readonly env?: Env;
  readonly runner?: SqlRunner;
  readonly embeddingService?: EmbeddingService;
  readonly timesfm3Http?: TimesFM3Http;
  readonly probeTimesfm3?: ServiceProbeFn;
  readonly disableRetrieval?: boolean;
  readonly disableDeepAgent?: boolean;
  /** Inject a fake reader so risk routes are testable without a bucket. */
  readonly riskReader?: RiskProfileReader;
}

const SERVICE_ACCOUNT_ENV = 'GOOGLE_SERVICE_ACCOUNT_KEY';
const SERVICE_ACCOUNT_PATH = '/tmp/indexer-gac.json';

let credentialsPrepared = false;

/**
 * Vercel has no persistent filesystem and no `gcloud` session, so Application
 * Default Credentials must be supplied as a service-account JSON in an env
 * var. Materialize it to /tmp (the one writable path) and point ADC at it.
 *
 * Runs once per instance; a locally-authenticated `vercel dev` needs nothing.
 */
export function prepareVertexCredentials(env: NodeJS.ProcessEnv = process.env): boolean {
  if (credentialsPrepared) return process.env['GOOGLE_APPLICATION_CREDENTIALS'] !== undefined;
  credentialsPrepared = true;

  const raw = env[SERVICE_ACCOUNT_ENV];
  if (raw === undefined || raw.trim().length === 0) {
    return env['GOOGLE_APPLICATION_CREDENTIALS'] !== undefined;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') {
      throw new Error('not a JSON object');
    }
    mkdirSync('/tmp', { recursive: true });
    writeFileSync(SERVICE_ACCOUNT_PATH, raw, { mode: 0o600 });
    env['GOOGLE_APPLICATION_CREDENTIALS'] = SERVICE_ACCOUNT_PATH;
    console.log('[indexer] materialized Vertex service account to', SERVICE_ACCOUNT_PATH);
    return true;
  } catch (err) {
    // A malformed key must not crash every route; the LLM calls will fail with
    // their own auth error, which is more informative.
    console.error(
      `[indexer] ${SERVICE_ACCOUNT_ENV} is not valid JSON — Vertex auth will rely on ADC:`,
      err instanceof Error ? err.message : String(err),
    );
    return false;
  }
}

/** Build a fresh runtime. Prefer `getRuntime()` in routes (caches per instance). */
export function createRuntime(overrides: RuntimeOverrides = {}): IndexerRuntime {
  prepareVertexCredentials();
  const env = overrides.env ?? loadEnv();

  const runner = overrides.runner ?? PgSqlRunner.fromEnv();

  const embeddingService =
    overrides.embeddingService ??
    (env.GOOGLE_CLOUD_PROJECT !== undefined && env.GOOGLE_CLOUD_PROJECT.length > 0
      ? new VertexEmbeddingService({
          project: env.GOOGLE_CLOUD_PROJECT,
          location: env.GOOGLE_CLOUD_LOCATION,
          model: env.VERTEX_EMBEDDING_MODEL,
        })
      : undefined);

  const vectors =
    overrides.disableRetrieval === true || embeddingService === undefined
      ? undefined
      : new VectorRepository(runner, embeddingService);

  const timesfm3 =
    overrides.timesfm3Http === undefined
      ? new TimesFM3Client(new FetchTimesFM3Http(env.TIMESFM3_SERVICE_URL))
      : new TimesFM3Client(overrides.timesfm3Http);

  // Resolved once, before the graph is built, so the HTTP routes and the v0.1
  // graph share a single resolution rather than each opening the store. An
  // injected reader wins outright, so a test never resolves a store.
  let riskReaderResolved: Promise<RiskProfileReader | undefined> | null = null;
  const resolveRiskReader = (): Promise<RiskProfileReader | undefined> => {
    if (overrides.riskReader !== undefined) {
      return Promise.resolve<RiskProfileReader | undefined>(overrides.riskReader);
    }
    // A missing bucket is not an error — risk routes report "unconfigured",
    // matching how retrieval degrades when no Vertex project is set.
    riskReaderResolved ??= createRiskProfileReader({
      ...(env.RISK_GCS_BUCKET === undefined ? {} : { gcsBucket: env.RISK_GCS_BUCKET }),
      gcsPrefix: env.RISK_GCS_PREFIX,
      ...(env.RISK_LOCAL_DIR === undefined ? {} : { localDir: env.RISK_LOCAL_DIR }),
    });
    return riskReaderResolved;
  };

  // The v0.1 graph shares this runner and gains retrieval only when the vector
  // layer is actually configured.
  const v01 = buildV01Deps({
    tsdbRunner: runner,
    ...(overrides.timesfm3Http === undefined ? {} : { timesfm3Http: overrides.timesfm3Http }),
    ...(embeddingService === undefined ? { disableRetrieval: true } : { embeddingService }),
    resolveRiskReader,
  });

  let agent: DeepGraphAgent | null = null;
  let agentReady: Promise<DeepGraphAgent> | null = null;
  let capabilityCache: CapabilityReport | null | undefined;

  return {
    env,
    runner,
    metrics: new TimeseriesClient(runner),
    forecasts: new ForecastRepository(runner),
    performance: new PerformanceRepository(runner),
    decisions: new DecisionRepository(runner),
    ...(vectors === undefined ? {} : { vectors }),
    timesfm3,
    v01,
    probeTimesfm3: overrides.probeTimesfm3 ?? ((url: string) => probeTimesfm3(url)),
    async capabilities(): Promise<CapabilityReport | null> {
      if (capabilityCache !== undefined) return capabilityCache;
      try {
        capabilityCache = await probeCapabilities(runner);
      } catch {
        // A failed probe means "unknown", which /api/health reports alongside
        // the database being unreachable rather than as its own error.
        capabilityCache = null;
      }
      return capabilityCache;
    },
    async deepAgent(): Promise<DeepGraphAgent> {
      if (overrides.disableDeepAgent === true) {
        throw new Error('deep agent is disabled for this runtime');
      }
      agent ??= new DeepGraphAgent({});
      agentReady ??= agent.initialize().then(() => agent!);
      return agentReady;
    },
    async riskReader(): Promise<RiskProfileReader | undefined> {
      return resolveRiskReader();
    },
  };
}

// ── per-instance cache ──────────────────────────────────────────────────────

interface RuntimeRegistry {
  __agenticEmsIndexerRuntime?: IndexerRuntime;
}

const scope = globalThis as unknown as RuntimeRegistry;

/** The warm-instance runtime. Built on first use, reused thereafter. */
export function getRuntime(overrides: RuntimeOverrides = {}): IndexerRuntime {
  scope.__agenticEmsIndexerRuntime ??= createRuntime(overrides);
  return scope.__agenticEmsIndexerRuntime;
}

/** Probe the TimesFM-3 service without spending GPU time on a forecast. */
export async function probeTimesfm3(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ServiceProbe> {
  try {
    // Any HTTP status — including 404 — proves the service answered. Only a
    // transport failure means it is actually unreachable.
    const res = await fetchImpl(baseUrl, { method: 'GET' });
    return { reachable: true, status: res.status };
  } catch (err) {
    return { reachable: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export { SERVICE_ACCOUNT_ENV, SERVICE_ACCOUNT_PATH };
