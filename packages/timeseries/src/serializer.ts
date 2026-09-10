import { createHash } from 'node:crypto';
import {
  FORECAST_QUANTILE_COLUMNS,
  type CalibrationSummary,
  type DecisionRecord,
  type EmbeddingKind,
  type ForecastRun,
  type MetricName,
  type RealizedYieldRow,
} from './types.js';

/**
 * Deterministic, citation-tagged serialization.
 *
 * This module is the trust boundary of the vector store: it renders text for
 * embedding from *database rows only*, and every line it emits carries the id
 * of the row it came from. Two consequences matter:
 *
 *  - An embedding can never be produced from model prose, so a hallucination
 *    cannot become a retrievable "fact" (no vector-store poisoning loop).
 *  - Retrieval results carry `sourceIds`, so the agent's citation guard can
 *    verify each retrieved chunk traces back to real rows.
 *
 * Output is byte-stable for identical input (fixed precision, ISO timestamps),
 * which is what makes the content hash a valid idempotency key.
 */

export interface SerializedChunk {
  readonly kind: EmbeddingKind;
  readonly poolId: string;
  readonly tsStart: Date;
  readonly tsEnd: Date;
  readonly sourceIds: readonly string[];
  readonly content: string;
}

/** Fixed-precision formatting keeps re-serialization byte-identical. */
export function formatNumber(value: number, digits = 6): string {
  if (!Number.isFinite(value)) return 'null';
  return value.toFixed(digits);
}

function iso(date: Date): string {
  return date.toISOString();
}

export function metricPointId(poolId: string, metric: MetricName, ts: Date): string {
  return `metric:${poolId}:${metric}:${iso(ts)}`;
}

export function forecastStepId(runId: string, horizonStep: number): string {
  return `forecast:${runId}:${horizonStep}`;
}

/** sha256 over the canonical chunk identity — the idempotency key. */
export function hashChunk(chunk: Omit<SerializedChunk, 'content'> & { readonly content: string }): string {
  const canonical = [
    chunk.kind,
    chunk.poolId,
    iso(chunk.tsStart),
    iso(chunk.tsEnd),
    [...chunk.sourceIds].join(','),
    chunk.content,
  ].join('|');
  return createHash('sha256').update(canonical).digest('hex');
}

export interface MetricPoint {
  readonly ts: Date;
  readonly value: number;
}

/**
 * Render a metric window as one chunk. Each observation is its own cited
 * line, so retrieval can point at the exact rows behind a claim.
 */
export function serializeMetricWindow(input: {
  readonly poolId: string;
  readonly metric: MetricName;
  readonly points: readonly MetricPoint[];
}): SerializedChunk {
  if (input.points.length === 0) {
    throw new Error('serializeMetricWindow: at least one point is required');
  }
  const sorted = [...input.points].sort((a, b) => a.ts.getTime() - b.ts.getTime());
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const values = sorted.map((p) => p.value);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;

  const lines = [
    `metric_window pool=${input.poolId} metric=${input.metric} ` +
      `window=${iso(first.ts)}..${iso(last.ts)} samples=${sorted.length}`,
    `summary mean=${formatNumber(mean)} min=${formatNumber(Math.min(...values))} ` +
      `max=${formatNumber(Math.max(...values))} first=${formatNumber(values[0]!)} ` +
      `last=${formatNumber(values[values.length - 1]!)}`,
  ];
  for (const point of sorted) {
    lines.push(`[${metricPointId(input.poolId, input.metric, point.ts)}] ${input.metric}=${formatNumber(point.value)}`);
  }

  return {
    kind: 'metric_window',
    poolId: input.poolId,
    tsStart: first.ts,
    tsEnd: last.ts,
    sourceIds: sorted.map((p) => metricPointId(input.poolId, input.metric, p.ts)),
    content: lines.join('\n'),
  };
}

/** Render a persisted forecast run, citing every horizon step. */
export function serializeForecastRun(run: ForecastRun): SerializedChunk {
  const ordered = [...run.steps].sort((a, b) => a.horizonStep - b.horizonStep);
  const first = ordered[0]!;
  const last = ordered[ordered.length - 1]!;

  const lines = [
    `forecast_run run=${run.runId} pool=${run.poolId} metric=${run.metric} ` +
      `issued=${iso(run.issuedAt)} model=${run.modelVersion} steps=${ordered.length}`,
  ];
  for (const step of ordered) {
    const quantiles = FORECAST_QUANTILE_COLUMNS.map(
      (column) => `${column}=${formatNumber(step.quantiles[column])}`,
    ).join(' ');
    lines.push(
      `[${forecastStepId(run.runId, step.horizonStep)}] target=${iso(step.targetTs)} ` +
        `${quantiles} point=${formatNumber(step.point)}`,
    );
  }

  return {
    kind: 'forecast_run',
    poolId: run.poolId,
    tsStart: first.targetTs.getTime() <= run.issuedAt.getTime() ? run.issuedAt : first.targetTs,
    tsEnd: last.targetTs,
    sourceIds: ordered.map((s) => forecastStepId(run.runId, s.horizonStep)),
    content: lines.join('\n'),
  };
}

/** Render a decision, citing itself and the forecasts it was grounded in. */
export function serializeDecision(decision: DecisionRecord): SerializedChunk {
  const lines = [
    `decision id=${decision.decisionId} pool=${decision.poolId} action=${decision.action} ` +
      `size_usd=${formatNumber(decision.sizeUsd, 2)} confidence=${formatNumber(decision.confidence)}`,
    `[decision:${decision.decisionId}] decided_at=${iso(decision.decidedAt)} ` +
      `rationale=${decision.rationale}`,
  ];
  for (const forecastId of decision.citedForecastIds) {
    lines.push(`[decision:${decision.decisionId}] cited_forecast=${forecastId}`);
  }
  for (const metricId of decision.citedMetricIds) {
    lines.push(`[decision:${decision.decisionId}] cited_metric=${metricId}`);
  }

  return {
    kind: 'decision',
    poolId: decision.poolId,
    tsStart: decision.decidedAt,
    tsEnd: decision.decidedAt,
    sourceIds: [`decision:${decision.decisionId}`, ...decision.citedForecastIds],
    content: lines.join('\n'),
  };
}

/**
 * Render a realized-performance slice: what the market actually did and how
 * well the forecasts predicted it. Every figure originates in a SQL view.
 */
export function serializePerformanceSlice(input: {
  readonly poolId: string;
  readonly realized: readonly RealizedYieldRow[];
  readonly calibration: readonly CalibrationSummary[];
}): SerializedChunk | null {
  if (input.realized.length === 0) return null;
  const ordered = [...input.realized].sort(
    (a, b) => a.bucketStart.getTime() - b.bucketStart.getTime(),
  );
  const first = ordered[0]!;
  const last = ordered[ordered.length - 1]!;

  const lines = [
    `performance_slice pool=${input.poolId} ` +
      `window=${iso(first.bucketStart)}..${iso(last.bucketStart)} buckets=${ordered.length}`,
  ];
  for (const row of ordered) {
    lines.push(
      `[yield:${input.poolId}:${iso(row.bucketStart)}] avg_apy=${formatNumber(row.avgApy)} ` +
        `min=${formatNumber(row.minApy)} max=${formatNumber(row.maxApy)} ` +
        `avg_tvl=${row.avgTvl === null ? 'null' : formatNumber(row.avgTvl, 2)} samples=${row.samples}`,
    );
  }
  for (const summary of input.calibration) {
    lines.push(
      `[calibration:${input.poolId}:${summary.metric}] samples=${summary.samples} ` +
        `coverage=${formatNumber(summary.coverage)} ` +
        `mean_pinball_loss=${formatNumber(summary.meanPinballLoss)} ` +
        `mean_abs_error=${formatNumber(summary.meanAbsoluteError)} ` +
        `mape=${summary.meanAbsolutePercentageError === null ? 'null' : formatNumber(summary.meanAbsolutePercentageError)}`,
    );
  }

  return {
    kind: 'performance_slice',
    poolId: input.poolId,
    tsStart: first.bucketStart,
    tsEnd: last.bucketStart,
    sourceIds: [
      ...ordered.map((r) => `yield:${input.poolId}:${iso(r.bucketStart)}`),
      ...input.calibration.map((c) => `calibration:${input.poolId}:${c.metric}`),
    ],
    content: lines.join('\n'),
  };
}
