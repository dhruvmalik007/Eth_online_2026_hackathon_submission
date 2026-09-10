import { loadEnv } from '../../config/env.js';
import { structuredLlmForRole } from '../../config/modelRegistry.js';
import { TimesFM3Client, FetchTimesFM3Http, type TimesFM3Http } from '../../services/timesfm3/index.js';
import { TimeseriesClient, PgSqlRunner, type SqlRunner } from '@ethonline2026/timeseries';
import type { StructuredLlm } from './ruleParser.js';

/**
 * Composition root for the v0.1 agent: wires the model registry (LLM roles),
 * the TimesFM-3 service client, and the TimescaleDB runner into the graph
 * dependencies. The only place concrete adapters meet.
 */

export function buildV01Deps(overrides: {
  parserLlm?: StructuredLlm;
  synthesisLlm?: StructuredLlm;
  timesfm3Http?: TimesFM3Http;
  tsdbRunner?: SqlRunner;
} = {}) {
  const env = loadEnv();

  const timesfm3 = new TimesFM3Client(
    overrides.timesfm3Http ?? new FetchTimesFM3Http(env.TIMESFM3_SERVICE_URL),
  );
  const tsdb = new TimeseriesClient(
    overrides.tsdbRunner ??
      new PgSqlRunner({
        host: env.TIMESERIES_DB_HOST,
        port: env.TIMESERIES_DB_PORT,
        database: env.TIMESERIES_DB_NAME,
        user: env.TIMESERIES_DB_USER,
        password: env.TIMESERIES_DB_PASSWORD || undefined,
      }),
  );

  return {
    parserLlm: overrides.parserLlm ?? structuredLlmForRole('parser'),
    synthesisLlm: overrides.synthesisLlm ?? structuredLlmForRole('synthesis'),
    timesfm3,
    tsdb,
  };
}
