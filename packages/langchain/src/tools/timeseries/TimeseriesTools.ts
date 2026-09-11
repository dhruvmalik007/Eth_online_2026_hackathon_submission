import { tool } from '@langchain/core/tools';
import * as z from 'zod';
import type {
  DecisionRepository,
  ForecastRepository,
  PerformanceRepository,
  VectorRepository,
} from '@ethonline2026/timeseries';

/**
 * TimescaleDB tools — thin adapters over the timeseries repositories.
 *
 * These expose the forecast ledger, the SQL-computed evaluation layer, and the
 * temporal vector index to the tool-calling agents (deepagents harness). They
 * own no logic: each validates its input, calls one repository method, and
 * shapes JSON. Every figure they return came from a stored row or a SQL view,
 * so a downstream citation cannot point at a number the agent invented.
 */

export interface TimeseriesToolDeps {
  readonly forecasts: ForecastRepository;
  readonly performance: PerformanceRepository;
  readonly vectors: VectorRepository;
  readonly decisions?: DecisionRepository;
}

const DEFAULT_WINDOW_DAYS = 90;

function window(days: number = DEFAULT_WINDOW_DAYS): { readonly from: Date; readonly to: Date } {
  const to = new Date();
  return { from: new Date(to.getTime() - days * 86_400_000), to };
}

export function createTimeseriesTools(deps: TimeseriesToolDeps) {
  /** How accurate have this pool's forecasts actually been? */
  const forecastAccuracyTool = tool(
    async (input: unknown) => {
      const { poolId, days = 90, metric = 'apy' } = input as {
        poolId?: string;
        days?: number;
        metric?: string;
      };
      if (!poolId) return JSON.stringify({ error: 'poolId is required' });
      try {
        const range = window(days);
        const [calibration, summary] = await Promise.all([
          deps.performance.getCalibrationSummary(poolId, range),
          deps.performance.getCalibration(poolId, range, { metric, limit: 50 }),
        ]);
        if (calibration.length === 0 && summary.length === 0) {
          return JSON.stringify({
            poolId,
            status: 'insufficient_history',
            detail: 'No scored forecast steps yet — a forecast must first mature past its target timestamp.',
          });
        }
        return JSON.stringify(
          {
            poolId,
            windowDays: days,
            reliability: summary,
            recentScoredSteps: calibration.slice(0, 20),
            reading:
              'coverage is the share of actuals that landed inside the q10–q90 band; ' +
              'pinball loss is the proper scoring rule (lower is better). ' +
              'Quote these figures as-is — do not recompute them.',
          },
          null,
          2,
        );
      } catch (error) {
        return JSON.stringify({ error: (error as Error).message });
      }
    },
    {
      name: 'tsdb_forecast_accuracy',
      description:
        'SQL-computed reliability of past TimesFM-3 forecasts for a pool: empirical q10–q90 coverage, mean pinball loss, MAE and MAPE, plus recent scored steps joined to realized metrics. Use this to judge how much to trust a new forecast. Never invent these numbers.',
      schema: z.object({
        poolId: z.string().describe('Pool identifier as stored in TimescaleDB'),
        days: z.number().int().positive().max(720).optional().describe('Lookback window in days (default 90)'),
        metric: z.string().optional().describe('Metric to sample scored steps for (default apy)'),
      }),
    },
  );

  /** What yield actually materialized, and how did past decisions score? */
  const yieldPerformanceTool = tool(
    async (input: unknown) => {
      const { poolId, days = 90 } = input as { poolId?: string; days?: number };
      if (!poolId) return JSON.stringify({ error: 'poolId is required' });
      try {
        const range = window(days);
        const [realized, outcomes] = await Promise.all([
          deps.performance.getRealizedYield(poolId, range),
          deps.performance.getDecisionOutcomes(poolId, range),
        ]);
        return JSON.stringify(
          {
            poolId,
            windowDays: days,
            realizedYield: realized,
            decisionOutcomes: outcomes,
            reading:
              'realizedYield is the APY that actually occurred per daily bucket; ' +
              'decisionOutcomes scores each recorded decision against the yield that followed it ' +
              '(outcomeScore = realized − baseline, positive means the call beat holding).',
          },
          null,
          2,
        );
      } catch (error) {
        return JSON.stringify({ error: (error as Error).message });
      }
    },
    {
      name: 'tsdb_yield_performance',
      description:
        'Time-stamped yield performance for a pool: realized APY per daily bucket plus every past decision scored against what the market actually did. This is the backtest substrate — consult it before proposing a trade.',
      schema: z.object({
        poolId: z.string().describe('Pool identifier as stored in TimescaleDB'),
        days: z.number().int().positive().max(720).optional().describe('Lookback window in days (default 90)'),
      }),
    },
  );

  /** Semantic search over the pool's history. */
  const tsdbSearchTool = tool(
    async (input: unknown) => {
      const { query, poolId, days, k = 6 } = input as {
        query?: string;
        poolId?: string;
        days?: number;
        k?: number;
      };
      if (!query) return JSON.stringify({ error: 'query is required' });
      try {
        const to = new Date();
        const hits = await deps.vectors.searchTemporal({
          query,
          ...(poolId === undefined ? {} : { poolId }),
          ...(days === undefined ? {} : { from: new Date(to.getTime() - days * 86_400_000) }),
          to,
          k,
        });
        if (hits.length === 0) {
          return JSON.stringify({
            query,
            status: 'no_matches',
            detail: 'Nothing indexed for that scope. Backfill embeddings before relying on retrieval.',
          });
        }
        return JSON.stringify(
          {
            query,
            hits: hits.map((hit) => ({
              kind: hit.kind,
              poolId: hit.poolId,
              window: { start: hit.tsStart.toISOString(), end: hit.tsEnd.toISOString() },
              score: hit.score,
              // The row ids behind the chunk — cite these, not the prose.
              sourceIds: hit.sourceIds,
              content: hit.content,
            })),
            reading:
              'Each hit was rendered only from stored rows, so every line is traceable. ' +
              'Cite sourceIds when using a chunk; anything not listed here is not evidence.',
          },
          null,
          2,
        );
      } catch (error) {
        return JSON.stringify({ error: (error as Error).message });
      }
    },
    {
      name: 'tsdb_search',
      description:
        'Temporal-vector search over a pool\'s stored history: metric windows, past forecast runs, prior decisions and realized performance. Returns grounded chunks with the row ids they came from. Use it to compare the current situation against similar past conditions.',
      schema: z.object({
        query: z.string().describe('Natural-language description of the history you need'),
        poolId: z.string().optional().describe('Restrict to one pool (recommended when the question names one)'),
        days: z.number().int().positive().max(720).optional().describe('Only search chunks ending within this many days'),
        k: z.number().int().positive().max(50).optional().describe('Number of chunks to return (default 6)'),
      }),
    },
  );

  /** Read back the stored forecast for a pool (cache + audit). */
  const storedForecastTool = tool(
    async (input: unknown) => {
      const { poolId, metric = 'apy', runId } = input as {
        poolId?: string;
        metric?: string;
        runId?: string;
      };
      if (!poolId && !runId) {
        return JSON.stringify({ error: 'poolId or runId is required' });
      }
      try {
        if (runId !== undefined) {
          const run = await deps.forecasts.getRun(runId);
          if (run === null) return JSON.stringify({ runId, status: 'not_found' });
          return JSON.stringify(run, null, 2);
        }
        if (metric !== 'apy' && metric !== 'volume' && metric !== 'tvl' && metric !== 'utilization') {
          return JSON.stringify({ error: `unknown metric '${metric}'` });
        }
        const latest = await deps.forecasts.getLatest(poolId!, metric);
        if (latest === null) {
          return JSON.stringify({ poolId, metric, status: 'no_forecast_stored' });
        }
        return JSON.stringify(latest, null, 2);
      } catch (error) {
        return JSON.stringify({ error: (error as Error).message });
      }
    },
    {
      name: 'tsdb_stored_forecast',
      description:
        'Read a previously persisted TimesFM-3 forecast — the latest for a pool+metric, or a specific run by id. Returns every horizon step with its full nine-quantile vector. Use the run id to cite stored forecasts exactly.',
      schema: z.object({
        poolId: z.string().optional().describe('Pool identifier (required unless runId is given)'),
        metric: z
          .enum(['apy', 'volume', 'tvl', 'utilization'])
          .optional()
          .describe('Metric to read the latest forecast for (default apy)'),
        runId: z.string().optional().describe('Read a specific forecast run by its id'),
      }),
    },
  );

  /** The agent's own decision history, with citations. */
  const decisionHistoryTool = tool(
    async (input: unknown) => {
      const { poolId, days = 90 } = input as { poolId?: string; days?: number };
      if (!poolId) return JSON.stringify({ error: 'poolId is required' });
      if (deps.decisions === undefined) {
        return JSON.stringify({ error: 'decision ledger is not configured' });
      }
      try {
        const history = await deps.decisions.getHistory(poolId, window(days));
        return JSON.stringify(
          {
            poolId,
            windowDays: days,
            decisions: history,
            reading:
              'citedForecastIds point at rows in the forecast ledger — follow them to audit a past call.',
          },
          null,
          2,
        );
      } catch (error) {
        return JSON.stringify({ error: (error as Error).message });
      }
    },
    {
      name: 'tsdb_decision_history',
      description:
        'The recorded decision history for a pool, including each decision\'s rationale, size, confidence and the forecast ids it cited. Use it to stay consistent with (or deliberately depart from) prior calls.',
      schema: z.object({
        poolId: z.string().describe('Pool identifier as stored in TimescaleDB'),
        days: z.number().int().positive().max(720).optional().describe('Lookback window in days (default 90)'),
      }),
    },
  );

  return {
    forecastAccuracyTool,
    yieldPerformanceTool,
    tsdbSearchTool,
    storedForecastTool,
    decisionHistoryTool,
  };
}
