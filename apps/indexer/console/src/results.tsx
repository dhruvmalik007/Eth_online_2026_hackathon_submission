import {
  Badge,
  CodeBlock,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  ForecastChart,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatTile,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  type ForecastPoint,
} from "@ethonline2026/ux-workflow";
import { ChevronRight } from "lucide-react";
import * as React from "react";

import type {
  CacheManifestResponse,
  ForecastResponse,
  HealthResponse,
  MetricsResponse,
  ModelStatusResponse,
  PerformanceResponse,
  PoolsResponse,
  SearchResponse,
} from "./api";

/** Percentage from a 0–1 fraction, at the precision the number actually carries. */
function pct(value: number | null | undefined, digits = 2): string {
  return value === null || value === undefined
    ? "—"
    : `${(value * 100).toFixed(digits)}%`;
}

function num(value: number | null | undefined, digits = 0): string {
  return value === null || value === undefined
    ? "—"
    : value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

/** Absolute time, short. The exact instant is in the JSON disclosure, not in the row. */
function when(iso: string | null | undefined): string {
  if (iso === null || iso === undefined) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** How long ago, in the unit a reader thinks in. This is what makes recency scannable. */
export function ago(iso: string | null | undefined): string {
  if (iso === null || iso === undefined) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "—";
  const hours = ms / 3_600_000;
  if (hours < 1) return `${Math.max(0, Math.round(ms / 60_000))}m ago`;
  if (hours < 48) return `${hours.toFixed(1)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * An instant as the API writes it, matched so the surrounding sentence is left untouched.
 */
const ISO_INSTANT = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;

/**
 * The reading line the API returns with most payloads.
 *
 * The sentence is rendered verbatim. The server wrote it against the data it just computed, and a
 * client-side rewrite would be a second, worse explanation of the same numbers.
 *
 * The one thing formatted is an embedded ISO instant. `2026-09-13T09:02:15.814Z` is a machine value
 * that also happens to be an unbreakable token wide enough to push a narrow viewport sideways, and
 * shortening it to a date changes none of the numbers the sentence is actually about.
 */
export function Reading({
  children,
}: {
  children?: string;
}): React.JSX.Element | null {
  if (children === undefined || children.length === 0) return null;
  return (
    <p className="mt-3 max-w-[75ch] text-[13px] leading-relaxed text-fg-dim">
      {children.replace(ISO_INSTANT, (instant) => when(instant))}
    </p>
  );
}

/** The raw payload, one click away. Every result carries it, because the console is for testing. */
export function Raw({ data }: { data: unknown }): React.JSX.Element {
  return (
    <Collapsible className="mt-3">
      <CollapsibleTrigger className="group flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint transition-colors hover:text-amber focus-visible:text-amber focus-visible:outline-none">
        <ChevronRight className="size-3 transition-transform group-data-[state=open]:rotate-90" />
        json
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
        <div className="mt-2 border border-edge bg-panel">
          <CodeBlock language="json" code={JSON.stringify(data, null, 2)} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** A number and its label, without the hero-metric scaffold around it. */
function Field({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "up" | "down" | "dim";
}): React.JSX.Element {
  const color =
    tone === "up"
      ? "text-up"
      : tone === "down"
        ? "text-down"
        : tone === "dim"
          ? "text-fg-faint"
          : "text-fg";
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
        {label}
      </dt>
      <dd className={`mt-1 truncate font-mono text-[13px] tnum ${color}`}>
        {value}
      </dd>
    </div>
  );
}

function Fields({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4 lg:grid-cols-6">
      {children}
    </dl>
  );
}

// ── pools ───────────────────────────────────────────────────────────────────

/**
 * The universe, and the reason this console exists.
 *
 * Every other view needs a pool, and until `GET /api/pools` existed the only way to supply one was to
 * already know its address. The picker is therefore not a convenience here — it is the feature.
 */
export function PoolsResult({
  data,
}: {
  data: PoolsResponse;
}): React.JSX.Element {
  const [network, setNetwork] = React.useState<string>("all");
  const [protocol, setProtocol] = React.useState<string>("all");

  // Filtered in place rather than by re-asking the server. The list is already bounded at the 200 most
  // recent, and the facet values come from this same response — so a round trip would return a subset
  // of what is already in hand, with a loading state attached to it.
  const rows = data.pools.filter(
    (p) =>
      (network === "all" || p.network === network) &&
      (protocol === "all" || p.protocol === protocol),
  );
  const apply = (nextNetwork: string, nextProtocol: string): void => {
    setNetwork(nextNetwork);
    setProtocol(nextProtocol);
  };

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
            network
          </span>
          <Select value={network} onValueChange={(v) => apply(v, protocol)}>
            <SelectTrigger className="h-8 w-[160px] font-mono text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">all networks</SelectItem>
              {data.facets.networks.map((n) => (
                <SelectItem key={n} value={n}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
            protocol
          </span>
          <Select value={protocol} onValueChange={(v) => apply(network, v)}>
            <SelectTrigger className="h-8 w-[160px] font-mono text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">all protocols</SelectItem>
              {data.facets.protocols.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <p className="ml-auto font-mono text-[11px] text-fg-faint">
          {rows.length}
          {rows.length === data.count ? "" : ` of ${data.count}`}{" "}
          {data.count === 1 ? "pool" : "pools"} · newest{" "}
          {ago(data.latestObservationAt)}
        </p>
      </div>

      {data.empty ? (
        <p className="mt-4 max-w-[70ch] text-[13px] leading-relaxed text-fg-dim">
          Nothing is indexed yet, so there is nothing to forecast. Ingest a
          pool, then run <span className="font-mono text-fg">pools</span> again.
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-4 max-w-[70ch] text-[13px] leading-relaxed text-fg-dim">
          No indexed pool matches that filter — the filter is excluding
          everything, not the data being thin. Clear one of the two to see the{" "}
          {data.count} that are indexed.
        </p>
      ) : (
        // No pool-id column, deliberately. The thesis of this console is that nobody has to know an
        // address: the id lives in the picker and in the JSON beneath the card. A 36-character hex
        // string in the table is noise, and under auto table layout its `max-width` was ignored
        // anyway, which is why it crowded the column beside it.
        <div className="mt-4 border border-edge">
          <Table>
            <TableHeader>
              <TableRow className="border-edge hover:bg-transparent">
                <TableHead className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
                  protocol
                </TableHead>
                <TableHead className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
                  network
                </TableHead>
                <TableHead className="text-right font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
                  obs
                </TableHead>
                <TableHead className="hidden text-right font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint md:table-cell">
                  first seen
                </TableHead>
                <TableHead className="pr-4 text-right font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
                  last seen
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((pool) => (
                <TableRow key={pool.poolId} className="border-edge">
                  <TableCell className="text-[13px]">{pool.protocol}</TableCell>
                  <TableCell className="text-[13px] text-fg-dim">
                    {pool.network}
                  </TableCell>
                  <TableCell className="text-right font-mono text-[12px] tnum text-fg-dim">
                    {num(pool.observations)}
                  </TableCell>
                  <TableCell className="hidden text-right font-mono text-[12px] text-fg-dim md:table-cell">
                    {when(pool.firstSeen)}
                  </TableCell>
                  <TableCell className="pr-4 text-right font-mono text-[12px] tnum text-fg">
                    {ago(pool.lastSeen)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Reading>{data.reading}</Reading>
    </div>
  );
}

// ── forecast ────────────────────────────────────────────────────────────────

/**
 * The forecast, plotted against the history it was conditioned on.
 *
 * Two endpoints, one view, because a projection with no observed run-up is not a forecast — it is a
 * number. `steps` carries an index and no timestamp, so the horizon is projected from the observed
 * bucket spacing; that derivation is the only arithmetic this console does, and it is labelled.
 */
export function ForecastResult({
  forecast,
  metrics,
}: {
  forecast: ForecastResponse;
  metrics: MetricsResponse;
}): React.JSX.Element {
  const observed = metrics.points.filter((p) => p.avg !== null);
  const history: ForecastPoint[] = observed.map((p) => ({
    timestamp: Date.parse(p.bucketStart),
    value: p.avg as number,
  }));

  const gaps: number[] = [];
  for (let i = 1; i < observed.length; i += 1) {
    const a = observed[i - 1];
    const b = observed[i];
    if (a !== undefined && b !== undefined)
      gaps.push(Date.parse(b.bucketStart) - Date.parse(a.bucketStart));
  }
  gaps.sort((x, y) => x - y);
  const step =
    gaps.length > 0
      ? (gaps[Math.floor(gaps.length / 2)] as number)
      : 86_400_000;
  const last = observed.at(-1);

  const projected: ForecastPoint[] =
    last === undefined
      ? []
      : forecast.steps.map((s) => ({
          timestamp: Date.parse(last.bucketStart) + (s.index + 1) * step,
          value: s.q50,
          quantile10: s.q10,
          quantile50: s.q50,
          quantile90: s.q90,
        }));

  const bandWidth =
    forecast.steps.length > 0
      ? forecast.steps.reduce(
          (acc, s) => acc + (s.q90 - s.q10) / (s.q50 === 0 ? 1 : s.q50),
          0,
        ) / forecast.steps.length
      : 0;

  return (
    <div>
      <Fields>
        <Field label="model" value={forecast.model} />
        <Field label="horizon" value={`${forecast.steps.length} steps`} />
        <Field label="history" value={`${forecast.historyPoints} pts`} />
        <Field label="latency" value={`${num(forecast.latencyMs)}ms`} />
        <Field
          label="band / median"
          value={`${bandWidth.toFixed(2)}×`}
          tone={bandWidth > 1 ? "down" : undefined}
        />
        <Field
          label="quantiles"
          value={forecast.flags.quantileMonotonic ? "ordered" : "crossing"}
          tone={forecast.flags.quantileMonotonic ? "up" : "down"}
        />
      </Fields>

      {forecast.flags.scaleSuspicious ? (
        <p className="mt-4 border border-down/40 bg-down/5 px-3 py-2 text-[12px] leading-relaxed text-fg">
          The service flagged this prediction's scale as suspicious. Treat the
          magnitudes as unreliable and the shape as the only usable part.
        </p>
      ) : null}

      {projected.length === 0 || history.length === 0 ? (
        <p className="mt-4 max-w-[70ch] text-[13px] leading-relaxed text-fg-dim">
          Nothing to plot: the forecast returned {forecast.steps.length} steps
          and the metric ledger returned {observed.length} observations. A
          projection with no observed run-up is a number, not a chart.
        </p>
      ) : (
        <div className="mt-5 border border-edge bg-panel p-3">
          <ForecastChart
            height={280}
            showQuantiles
            targets={[
              {
                id: "apy",
                label: `${forecast.metric} — observed then projected`,
                historical: history,
                forecast: projected,
              },
            ]}
            {...(forecast.metric.includes("%") ? { unit: "%" } : {})}
          />
          <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
            horizon projected from the observed {step / 3_600_000}h bucket
            spacing · {when(last?.bucketStart)}
          </p>
        </div>
      )}
      <Reading>{forecast.reading}</Reading>
    </div>
  );
}

// ── metrics ─────────────────────────────────────────────────────────────────

export function MetricsResult({
  data,
}: {
  data: MetricsResponse;
}): React.JSX.Element {
  const c = data.coverage;
  return (
    <div>
      <Fields>
        <Field label="metric" value={data.metric} />
        <Field label="interval" value={data.interval} />
        <Field label="points" value={num(data.points.length)} />
        <Field label="pools covered" value={num(c.poolCount)} />
        <Field label="rows" value={num(c.rowCount)} />
        <Field label="latest" value={ago(c.latest)} />
      </Fields>

      {data.empty ? (
        <p className="mt-4 text-[13px] text-fg-dim">
          No observations in this range.
        </p>
      ) : (
        <div className="mt-4 border border-edge">
          <Table>
            <TableHeader>
              <TableRow className="border-edge hover:bg-transparent">
                <TableHead className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
                  bucket
                </TableHead>
                <TableHead className="text-right font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
                  avg
                </TableHead>
                <TableHead className="text-right font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
                  min
                </TableHead>
                <TableHead className="text-right font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
                  max
                </TableHead>
                <TableHead className="text-right font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
                  samples
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.points
                .slice(-14)
                .reverse()
                .map((p) => (
                  <TableRow key={p.bucketStart} className="border-edge">
                    <TableCell className="font-mono text-[12px] text-fg-dim">
                      {new Date(p.bucketStart)
                        .toISOString()
                        .slice(0, 16)
                        .replace("T", " ")}
                    </TableCell>
                    <TableCell className="text-right font-mono text-[12px] tnum text-fg">
                      {pct(p.avg, 4)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-[12px] tnum text-fg-dim">
                      {pct(p.min, 4)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-[12px] tnum text-fg-dim">
                      {pct(p.max, 4)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-[12px] tnum text-fg-faint">
                      {num(p.samples)}
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
          {data.points.length > 14 ? (
            <p className="border-t border-edge px-4 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
              showing the 14 most recent of {data.points.length} · all of them
              are in the json
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ── performance ─────────────────────────────────────────────────────────────

export function PerformanceResult({
  data,
}: {
  data: PerformanceResponse;
}): React.JSX.Element {
  const rows = data.realizedYield.filter((r) => r.avgApy !== null);
  const latest = rows.at(-1);
  const first = rows.at(0);
  const change =
    latest?.avgApy !== undefined &&
    first?.avgApy !== undefined &&
    first.avgApy !== 0
      ? (latest.avgApy as number) / (first.avgApy as number) - 1
      : null;

  return (
    <div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label="latest realized apy" value={pct(latest?.avgApy, 4)} />
        <StatTile label="observations" value={num(rows.length)} />
        <StatTile
          label="over the window"
          value={
            change === null
              ? "—"
              : `${change >= 0 ? "+" : ""}${(change * 100).toFixed(1)}%`
          }
        />
      </div>
      <Reading>{data.reading}</Reading>

      {data.empty ? (
        <p className="mt-4 text-[13px] text-fg-dim">
          No realized outcomes recorded for this pool yet.
        </p>
      ) : (
        <div className="mt-4 border border-edge">
          <Table>
            <TableHeader>
              <TableRow className="border-edge hover:bg-transparent">
                <TableHead className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
                  bucket
                </TableHead>
                <TableHead className="text-right font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
                  avg apy
                </TableHead>
                <TableHead className="text-right font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
                  tvl
                </TableHead>
                <TableHead className="text-right font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
                  samples
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows
                .slice(-10)
                .reverse()
                .map((r) => (
                  <TableRow key={r.bucketStart} className="border-edge">
                    <TableCell className="font-mono text-[12px] text-fg-dim">
                      {new Date(r.bucketStart).toISOString().slice(0, 10)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-[12px] tnum text-fg">
                      {pct(r.avgApy, 4)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-[12px] tnum text-fg-dim">
                      ${num(r.avgTvl)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-[12px] tnum text-fg-faint">
                      {num(r.samples)}
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ── model status ────────────────────────────────────────────────────────────

/**
 * Recorded availability.
 *
 * The window's own start is the headline, not the uptime: nothing recorded a probe before this table
 * existed, so a reader has to be able to tell "quiet" from "unobserved" without being told twice.
 */
export function StatusResult({
  data,
}: {
  data: ModelStatusResponse;
}): React.JSX.Element {
  return (
    <div>
      <Fields>
        <Field label="window" value={`${data.window.requestedHours}h`} />
        <Field label="recording for" value={`${data.window.recordedHours}h`} />
        <Field label="since" value={when(data.window.recordedSince)} />
        <Field label="dependencies" value={num(data.services.length)} />
      </Fields>

      {data.services.length === 0 ? (
        <p className="mt-4 max-w-[70ch] text-[13px] leading-relaxed text-fg-dim">
          No probe falls inside this window. That is{" "}
          <span className="text-fg">unobserved</span>, not healthy — nothing was
          measured, so nothing can be claimed.
        </p>
      ) : (
        <div className="mt-4 border border-edge">
          <Table>
            <TableHeader>
              <TableRow className="border-edge hover:bg-transparent">
                <TableHead className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
                  dependency
                </TableHead>
                <TableHead className="text-right font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
                  uptime
                </TableHead>
                <TableHead className="text-right font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
                  p50
                </TableHead>
                <TableHead className="text-right font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
                  p95
                </TableHead>
                <TableHead className="text-right font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
                  samples
                </TableHead>
                <TableHead className="text-right font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
                  last
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.services.map((s) => (
                <TableRow key={s.service} className="border-edge">
                  <TableCell className="font-mono text-[12px] text-fg">
                    {s.service}
                  </TableCell>
                  <TableCell
                    className={`text-right font-mono text-[12px] tnum ${s.uptimePct === 1 ? "text-fg" : "text-down"}`}
                  >
                    {s.uptimePct === null
                      ? "—"
                      : `${(s.uptimePct * 100).toFixed(0)}%`}
                  </TableCell>
                  <TableCell className="text-right font-mono text-[12px] tnum text-fg-dim">
                    {s.p50LatencyMs === null ? "—" : `${num(s.p50LatencyMs)}ms`}
                  </TableCell>
                  <TableCell className="text-right font-mono text-[12px] tnum text-fg-dim">
                    {s.p95LatencyMs === null ? "—" : `${num(s.p95LatencyMs)}ms`}
                  </TableCell>
                  <TableCell className="text-right font-mono text-[12px] tnum text-fg-faint">
                    {num(s.samples)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-[12px] text-fg-dim">
                    {ago(s.lastProbedAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Reading>{data.reading}</Reading>
    </div>
  );
}

// ── health ──────────────────────────────────────────────────────────────────

export function HealthResult({
  data,
}: {
  data: HealthResponse;
}): React.JSX.Element {
  return (
    <div>
      <Fields>
        <Field
          label="status"
          value={data.status}
          tone={data.status === "ok" ? "up" : "down"}
        />
        <Field
          label="database"
          value={data.database.reachable ? "reachable" : "unreachable"}
          tone={data.database.reachable ? "up" : "down"}
        />
        <Field
          label="timesfm-3"
          value={
            data.timesfm3.reachable
              ? `${data.timesfm3.status ?? "ok"}`
              : "unreachable"
          }
          tone={data.timesfm3.reachable ? "up" : "down"}
        />
        <Field
          label="retrieval"
          value={data.retrieval}
          tone={data.retrieval === "enabled" ? "up" : "dim"}
        />
        <Field
          label="risk store"
          value={data.risk.store}
          tone={data.risk.store === "ready" ? "up" : "dim"}
        />
        <Field
          label="vector"
          value={
            data.timescaledb?.vectorEnabled === true ? "enabled" : "absent"
          }
          tone={data.timescaledb?.vectorEnabled === true ? "up" : "down"}
        />
      </Fields>

      {data.degraded.length > 0 ? (
        <p className="mt-4 border border-down/40 bg-down/5 px-3 py-2 text-[12px] leading-relaxed text-fg">
          Degraded:{" "}
          <span className="font-mono">{data.degraded.join(", ")}</span>.
          Everything else answered.
        </p>
      ) : (
        <p className="mt-4 border border-up/30 bg-up/5 px-3 py-2 text-[12px] text-fg">
          Every dependency answered.
        </p>
      )}

      {data.timesfm3.error !== undefined ? (
        <p className="mt-2 max-w-[75ch] text-[12px] leading-relaxed text-fg-dim">
          {data.timesfm3.error}
        </p>
      ) : null}
    </div>
  );
}

// ── cache ───────────────────────────────────────────────────────────────────

/**
 * The cache index.
 *
 * `changedAt` beside `fetchedAt` is the whole point: a refresh that ran and found nothing new is a
 * different fact from a refresh that never ran, and only the pair distinguishes them.
 */
export function CacheResult({
  data,
}: {
  data: CacheManifestResponse;
}): React.JSX.Element {
  return (
    <div>
      <Fields>
        <Field
          label="cached"
          value={data.cached ? "yes" : "no"}
          tone={data.cached ? "up" : "dim"}
        />
        <Field label="written" value={ago(data.generatedAt)} />
        <Field label="entries" value={num(data.entries.length)} />
        <Field
          label="failures"
          value={num(data.failures.length)}
          tone={data.failures.length > 0 ? "down" : "up"}
        />
      </Fields>

      {data.entries.length > 0 ? (
        <div className="mt-4 border border-edge">
          <Table>
            <TableHeader>
              <TableRow className="border-edge hover:bg-transparent">
                <TableHead className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
                  key
                </TableHead>
                <TableHead className="text-right font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
                  fetched
                </TableHead>
                <TableHead className="text-right font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
                  changed
                </TableHead>
                <TableHead className="text-right font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
                  bytes
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.entries.map((e) => (
                <TableRow key={e.key} className="border-edge">
                  <TableCell className="font-mono text-[12px] text-fg">
                    {e.key}
                  </TableCell>
                  <TableCell className="text-right font-mono text-[12px] text-fg-dim">
                    {ago(e.fetchedAt)}
                  </TableCell>
                  <TableCell
                    className={`text-right font-mono text-[12px] ${e.changedAt === e.fetchedAt ? "text-amber" : "text-fg-dim"}`}
                  >
                    {ago(e.changedAt)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-[12px] tnum text-fg-faint">
                    {num(e.bytes)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}

      {data.failures.length > 0 ? (
        <div className="mt-4 border border-down/40">
          <p className="border-b border-down/40 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-down">
            not cached
          </p>
          {data.failures.map((f) => (
            <div
              key={f.key}
              className="flex flex-wrap items-baseline gap-x-3 px-3 py-2 text-[12px]"
            >
              <span className="font-mono text-fg">{f.key}</span>
              <span className="text-fg-dim">{f.error}</span>
            </div>
          ))}
        </div>
      ) : null}
      <Reading>{data.reading}</Reading>
    </div>
  );
}

// ── search ──────────────────────────────────────────────────────────────────

export function SearchResult({
  data,
}: {
  data: SearchResponse;
}): React.JSX.Element {
  const hits = data.hits ?? data.results ?? [];
  if (hits.length === 0) {
    return (
      <p className="max-w-[70ch] text-[13px] leading-relaxed text-fg-dim">
        No stored evidence matched. Retrieval searches the indexed embeddings,
        not pool names — a query for a protocol will only match if that protocol
        was written into the corpus.
      </p>
    );
  }
  return (
    <div>
      <p className="font-mono text-[11px] text-fg-faint">
        {hits.length} matches · nearest first
      </p>
      <ul className="mt-3 divide-y divide-edge border-y border-edge">
        {hits.map((hit, i) => (
          <li key={i} className="flex items-baseline gap-4 py-3">
            <span className="w-14 shrink-0 text-right font-mono text-[12px] tnum text-amber">
              {hit.score === undefined ? "—" : hit.score.toFixed(3)}
            </span>
            <span className="min-w-0 flex-1 text-[13px] leading-relaxed text-fg-dim">
              {hit.content ?? hit.literal ?? JSON.stringify(hit)}
            </span>
          </li>
        ))}
      </ul>
      <Reading>{data.reading}</Reading>
    </div>
  );
}

// ── agent ───────────────────────────────────────────────────────────────────

/**
 * The v0.1 cycle's answer.
 *
 * Rendered from whatever the graph returned rather than from an assumed shape: the payload is wide and
 * changes as the graph does, so the surface shows the audit trail, the decisions and the synthesis it
 * recognises, and hands the rest to the JSON disclosure rather than inventing fields.
 */
export function AgentResult({
  data,
}: {
  data: Record<string, unknown>;
}): React.JSX.Element {
  const audit = Array.isArray(data["audit"])
    ? (data["audit"] as Record<string, unknown>[])
    : [];
  const decisions = Array.isArray(data["readjustmentDecisions"])
    ? (data["readjustmentDecisions"] as Record<string, unknown>[])
    : [];
  const synthesis = data["synthesisPayload"] as
    Record<string, unknown> | undefined;

  return (
    <div>
      <Fields>
        <Field
          label="cycles"
          value={num(
            typeof data["cycles"] === "number" ? data["cycles"] : null,
          )}
        />
        <Field label="decisions" value={num(decisions.length)} />
        <Field label="steps run" value={num(audit.length)} />
        <Field
          label="run id"
          value={
            typeof data["runId"] === "string"
              ? (data["runId"] as string).slice(0, 12)
              : "—"
          }
        />
      </Fields>

      {decisions.length > 0 ? (
        <div className="mt-4 border border-edge">
          <Table>
            <TableHeader>
              <TableRow className="border-edge hover:bg-transparent">
                <TableHead className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
                  action
                </TableHead>
                <TableHead className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
                  protocol
                </TableHead>
                <TableHead className="text-right font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
                  amount
                </TableHead>
                <TableHead className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
                  rationale
                </TableHead>
                <TableHead className="text-right font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
                  cites
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {decisions.map((d, i) => {
                const citations = Array.isArray(d["citations"])
                  ? (d["citations"] as unknown[])
                  : [];
                return (
                  <TableRow key={i} className="border-edge">
                    <TableCell className="font-mono text-[12px] text-fg">
                      {String(d["action"] ?? "—")}
                      {d["ungrounded"] === true ? (
                        <Badge
                          variant="destructive"
                          className="ml-2 align-middle font-mono text-[9px]"
                        >
                          ungrounded
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="font-mono text-[12px] text-fg-dim">
                      {String(d["protocol"] ?? "—")}
                    </TableCell>
                    <TableCell className="text-right font-mono text-[12px] tnum text-fg-dim">
                      {String(d["amountPercentage"] ?? "—")}%
                    </TableCell>
                    <TableCell className="max-w-[42ch] text-[12px] leading-relaxed text-fg-dim">
                      {String(d["rationale"] ?? "")}
                    </TableCell>
                    <TableCell
                      className={`text-right font-mono text-[12px] tnum ${citations.length === 0 ? "text-down" : "text-fg-faint"}`}
                    >
                      {citations.length}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : null}

      {synthesis !== undefined ? (
        <div className="mt-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
            synthesis
          </p>
          <pre className="mt-2 max-h-[240px] overflow-auto border border-edge bg-panel p-3 font-mono text-[11px] leading-relaxed text-fg-dim">
            {JSON.stringify(synthesis, null, 2)}
          </pre>
        </div>
      ) : null}

      {audit.length > 0 ? (
        <ol className="mt-4 border-t border-edge">
          {audit.map((step, i) => (
            <li
              key={i}
              className="flex items-baseline gap-4 border-b border-edge py-2"
            >
              <span className="w-28 shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
                {String(step["node"] ?? "—")}
              </span>
              <span className="min-w-0 flex-1 text-[12px] leading-relaxed text-fg-dim">
                {String(step["detail"] ?? "")}
              </span>
              <span className="shrink-0 font-mono text-[11px] text-fg-faint">
                {when(
                  typeof step["at"] === "string"
                    ? (step["at"] as string)
                    : null,
                )}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

/** Anything without a renderer still has to be readable. */
export function JsonResult({ data }: { data: unknown }): React.JSX.Element {
  return (
    <div className="border border-edge bg-panel">
      <CodeBlock language="json" code={JSON.stringify(data, null, 2)} />
    </div>
  );
}
