"use client";

import * as React from "react";

import {
  type CacheManifestResponse,
  type ForecastResponse,
  type HealthResponse,
  type MetricsResponse,
  type ModelStatusResponse,
  type PerformanceResponse,
  type PoolsResponse,
  type SearchResponse,
} from "./api.js";
import {
  AgentResult,
  CacheResult,
  ForecastResult,
  HealthResult,
  JsonResult,
  MetricsResult,
  PerformanceResult,
  PoolsResult,
  SearchResult,
  StatusResult,
} from "./results.js";

/**
 * Which renderer a settled command hands its payload to.
 *
 * The shell owns the session and the machine; this owns the mapping from a command to the shape it
 * returns. Keeping it separate means a new command is added in two obvious places — here and the
 * call table — rather than inside the shell's render path, and the `default` arm keeps an
 * unrecognised payload renderable instead of blank.
 */
export function Results({ command, data }: { command: string; data: unknown }): React.JSX.Element {
  switch (command) {
    case "pools":
      return <PoolsResult data={data as PoolsResponse} />;
    case "forecast": {
      // `forecast` is the one command that composes two reads: the band and the observations it
      // continues from.
      const bundle = data as { forecast: ForecastResponse; metrics: MetricsResponse };
      return <ForecastResult forecast={bundle.forecast} metrics={bundle.metrics} />;
    }
    case "metrics":
      return <MetricsResult data={data as MetricsResponse} />;
    case "performance":
      return <PerformanceResult data={data as PerformanceResponse} />;
    case "status":
      return <StatusResult data={data as ModelStatusResponse} />;
    case "health":
      return <HealthResult data={data as HealthResponse} />;
    case "cache":
      return <CacheResult data={data as CacheManifestResponse} />;
    case "search":
      return <SearchResult data={data as SearchResponse} />;
    case "ask":
      return <AgentResult data={data as Record<string, unknown>} />;
    default:
      return <JsonResult data={data} />;
  }
}
