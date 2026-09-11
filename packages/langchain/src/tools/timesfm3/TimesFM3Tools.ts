import { tool } from '@langchain/core/tools';
import * as z from 'zod';
import {
  TimesFM3Client,
  backtestForecast,
  type TimesFM3Http,
  type TimesFMForecast,
} from '../../services/timesfm3/index.js';
import { perStepChangeCovariate } from '../../services/timesfm3/covariates.js';
import type { TimeseriesClient, MetricWindow } from '@ethonline2026/timeseries';

/**
 * TimesFM-3 tools — thin adapters over the deployed inference service and
 * the TimescaleDB window client. All numeric work happens in the service /
 * pure modules; the tools validate, call once, and shape JSON.
 */

export interface TimesFM3ToolDeps {
  readonly http: TimesFM3Http;
  readonly tsdb: TimeseriesClient;
}

export function createTimesFM3Tools(deps: TimesFM3ToolDeps) {
  const client = new TimesFM3Client(deps.http);

  /** Pull the Category-B matrix for one pool and forecast the target series. */
  async function forecastPool(input: {
    poolId: string;
    horizon: number;
    target: MetricWindow['metric'];
    windowDays: number;
  }): Promise<TimesFMForecast> {
    const since = new Date(Date.now() - input.windowDays * 86_400_000);
    const window = await deps.tsdb.getMetricWindow(input.poolId, input.target, since);
    if (window.values.length < 8) {
      throw new Error(
        `insufficient history for ${input.poolId}/${input.target}: ${window.values.length} points (need >= 8)`,
      );
    }
    // Past covariate: realized per-step volatility of the same window,
    // aligned to the series length (a short covariate makes the service 500).
    const diffs = perStepChangeCovariate(window.values);
    return client.predict({
      series: [...window.values],
      horizon: input.horizon,
      pastCovariates: [diffs],
      returnQuantiles: true,
    });
  }

  const timesfm3ForecastTool = tool(
    async (input: unknown) => {
      const { poolId, horizon = 30, target = 'apy', windowDays = 90 } = input as {
        poolId?: string;
        horizon?: number;
        target?: string;
        windowDays?: number;
      };
      if (!poolId) return JSON.stringify({ error: 'poolId is required' });
      try {
        const forecast = await forecastPool({
          poolId,
          horizon,
          target: (target as MetricWindow['metric']) ?? 'apy',
          windowDays,
        });
        return JSON.stringify(
          {
            poolId,
            target: forecast.target,
            horizon: forecast.horizon,
            model: forecast.model,
            latencyMs: forecast.latencyMs,
            flags: forecast.flags,
            steps: forecast.steps,
            provenance: { model: forecast.model, inputsHash: `${poolId}:${target}:${windowDays}d` },
          },
          null,
          2,
        );
      } catch (error) {
        return JSON.stringify({ error: (error as Error).message });
      }
    },
    {
      name: 'timesfm3_forecast',
      description:
        'TimesFM-3 probabilistic forecast for a pool metric (apy/volume/tvl/utilization) over a 14–30 day horizon. Returns q10/q50/q90 steps with guardrail flags. Deterministic — never invent numbers.',
      schema: z.object({
        poolId: z.string().describe('Pool identifier as stored in TimescaleDB'),
        horizon: z.number().int().positive().max(365).optional().describe('Forecast horizon steps (default 30)'),
        target: z.enum(['apy', 'volume', 'tvl', 'utilization']).optional().describe('Metric to forecast (default apy)'),
        windowDays: z.number().int().positive().max(365).optional().describe('Historical window in days (default 90)'),
      }),
    },
  );

  const timesfm3BacktestTool = tool(
    async (input: unknown) => {
      const { poolId, horizon = 30, windowDays = 90 } = input as {
        poolId?: string;
        horizon?: number;
        windowDays?: number;
      };
      if (!poolId) return JSON.stringify({ error: 'poolId is required' });
      try {
        const since = new Date(Date.now() - (windowDays + horizon) * 86_400_000);
        const window = await deps.tsdb.getMetricWindow(poolId, 'apy', since);
        // Split: train prefix → forecast; realized tail → score.
        const split = Math.max(window.values.length - horizon, 8);
        const train = window.values.slice(0, split);
        const realized = window.values.slice(split);
        if (train.length < 8 || realized.length === 0) {
          return JSON.stringify({ error: `insufficient history for ${poolId} backtest` });
        }
        const forecast = await client.predict({ series: train, horizon: realized.length });
        const score = backtestForecast({ steps: forecast.steps, realized });
        return JSON.stringify(
          {
            poolId,
            windowDays,
            horizonSteps: realized.length,
            ...score,
            verdict:
              score.hitRate >= 0.7 && score.mape <= 0.25
                ? 'acceptable — proposal may proceed to HITL'
                : 'rejected — forecast quality below gate',
          },
          null,
          2,
        );
      } catch (error) {
        return JSON.stringify({ error: (error as Error).message });
      }
    },
    {
      name: 'timesfm3_backtest',
      description:
        'Backtest TimesFM-3 forecasts against realized pool history: q10–q90 hit-rate, median MAPE, strategy PnL vs buy-and-hold. A proposal needs an acceptable score before HITL approval.',
      schema: z.object({
        poolId: z.string().describe('Pool identifier as stored in TimescaleDB'),
        horizon: z.number().int().positive().max(365).optional().describe('Scored horizon steps (default 30)'),
        windowDays: z.number().int().positive().max(720).optional().describe('History window in days (default 90)'),
      }),
    },
  );

  return { timesfm3ForecastTool, timesfm3BacktestTool, forecastPool };
}
