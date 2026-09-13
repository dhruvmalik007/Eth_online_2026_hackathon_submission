import {
  FetchTimesFM3Http,
  type TimesFM3ToolDeps,
  type TimeseriesToolDeps,
  type UniswapV4ClientOptions,
} from "@ethonline2026/langchain-agent";
import {
  LocalDirStore,
  RiskProfileRepository,
  type RiskProfileReader,
} from "@ethonline2026/risk-analysis-data-pipeline";
import {
  DecisionRepository,
  ForecastRepository,
  PerformanceRepository,
  PgSqlRunner,
  TimeseriesClient,
  VectorRepository,
  VertexEmbeddingService,
  type EmbeddingService,
} from "@ethonline2026/timeseries";
import type { InferenceEnv } from "../env.js";
import type { ToolDeps } from "./buildTools.js";

/**
 * Builds the dependencies the tool groups need, from the environment.
 *
 * The contract with `buildTools` is that **an absent dependency is `undefined`**, which omits the group
 * and reports the setting that would include it. So this module never substitutes a placeholder: a
 * half-configured group is reported, not faked.
 *
 * A dependency that is *present but broken* is a different thing and is deliberately not swallowed —
 * a malformed `TIMESERIES_DATABASE_URL` should stop the boot rather than quietly reduce the agent's
 * reach, because the alternative is an agent that answers a portfolio question with no position data
 * and sounds confident doing it.
 *
 * Not every setting can produce its dependency on its own. `RISK_GCS_BUCKET` is the case in point: the
 * `@google-cloud/storage` handle is owned by `risk-analysis-data-pipeline`, not by this service, so a
 * GCS-backed reader arrives through {@link ToolDepOverrides.riskReader}. `RISK_LOCAL_DIR` needs no
 * credentials and is the path a local run should use.
 */
export interface ToolDepOverrides {
  /** A reader whose store the caller owns — how a GCS-backed profile reaches the agent. */
  readonly riskReader?: RiskProfileReader;
  /** A runner the caller has already validated, e.g. one shared with the read models. */
  readonly runner?: PgSqlRunner;
  /** An embedding service the caller owns, e.g. a local or stubbed one. */
  readonly embeddings?: EmbeddingService;
}

function riskReader(env: InferenceEnv, overrides: ToolDepOverrides): RiskProfileReader | undefined {
  if (overrides.riskReader !== undefined) return overrides.riskReader;
  if (env.RISK_LOCAL_DIR === undefined) return undefined;
  return new RiskProfileRepository(new LocalDirStore(env.RISK_LOCAL_DIR));
}

function embeddingService(
  env: InferenceEnv,
  overrides: ToolDepOverrides,
): EmbeddingService | undefined {
  if (overrides.embeddings !== undefined) return overrides.embeddings;
  if (env.GOOGLE_CLOUD_PROJECT === undefined) return undefined;
  // Construction is lazy — `GoogleAuth` does not fetch a token until the first call — so this does not
  // make the boot depend on the network.
  return new VertexEmbeddingService({
    project: env.GOOGLE_CLOUD_PROJECT,
    model: env.VERTEX_EMBEDDING_MODEL,
    ...(env.GOOGLE_CLOUD_LOCATION === undefined ? {} : { location: env.GOOGLE_CLOUD_LOCATION }),
  });
}

/**
 * The vector store is part of this bundle, so the bundle needs an embedding service as well as a
 * database. Supplying only one of the two leaves the group omitted rather than half-built — a
 * `timeseries` group whose `vectors` member threw on every call would be worse than an absent one.
 */
function timeseriesDeps(
  runner: PgSqlRunner | undefined,
  embeddings: EmbeddingService | undefined,
): TimeseriesToolDeps | undefined {
  if (runner === undefined || embeddings === undefined) return undefined;
  return {
    forecasts: new ForecastRepository(runner),
    performance: new PerformanceRepository(runner),
    vectors: new VectorRepository(runner, embeddings),
    decisions: new DecisionRepository(runner),
  };
}

/**
 * TimesFM-3 needs **both** its own service and TimescaleDB: the service forecasts, but the window it
 * forecasts comes from `pool_metrics_hourly`. With one and not the other there is nothing to predict
 * from, so the pair is treated as a single dependency rather than two.
 */
function timesfm3Deps(
  env: InferenceEnv,
  runner: PgSqlRunner | undefined,
): TimesFM3ToolDeps | undefined {
  if (env.TIMESFM3_SERVICE_URL === undefined || runner === undefined) return undefined;
  return {
    http: new FetchTimesFM3Http(env.TIMESFM3_SERVICE_URL),
    tsdb: new TimeseriesClient(runner),
  };
}

function uniswapV4Options(env: InferenceEnv): UniswapV4ClientOptions | undefined {
  if (env.GATEWAY_API_KEY === undefined) return undefined;
  return {
    gatewayApiKey: env.GATEWAY_API_KEY,
    ...(env.UNISWAP_V4_SUBGRAPH_ID === undefined ? {} : { subgraphId: env.UNISWAP_V4_SUBGRAPH_ID }),
    // The Sepolia perp endpoint is a separate subgraph, so it is passed as the studio override rather
    // than folded into the id — the client resolves one or the other, not both.
    ...(env.STUDIO_PERP_SEPOLIA_ENDPOINT === undefined
      ? {}
      : { studioEndpoint: env.STUDIO_PERP_SEPOLIA_ENDPOINT }),
  };
}

export function createToolDeps(env: InferenceEnv, overrides: ToolDepOverrides = {}): ToolDeps {
  // Guarded on the parsed value before handing over: `PgSqlRunner.fromEnv()` reads the process
  // environment itself and validates it, so calling it when the URL is absent would turn a documented
  // omission into a boot failure.
  const runner =
    overrides.runner ??
    (env.TIMESERIES_DATABASE_URL === undefined ? undefined : PgSqlRunner.fromEnv());

  const risk = riskReader(env, overrides);
  const embeddings = embeddingService(env, overrides);
  const timeseries = timeseriesDeps(runner, embeddings);
  const timesfm3 = timesfm3Deps(env, runner);
  const uniswapV4 = uniswapV4Options(env);

  return {
    ...(risk === undefined ? {} : { risk }),
    ...(timeseries === undefined ? {} : { timeseries }),
    ...(timesfm3 === undefined ? {} : { timesfm3 }),
    ...(uniswapV4 === undefined ? {} : { uniswapV4 }),
  };
}
