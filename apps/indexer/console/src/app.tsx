import {
  Badge,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ethonline2026/ux-workflow";
import { ArrowUp, Square } from "lucide-react";
import * as React from "react";

import {
  ApiCallError,
  api,
  type CacheManifestResponse,
  type ModelStatusResponse,
  type PoolSummary,
} from "./api";
import {
  AgentResult,
  CacheResult,
  ForecastResult,
  HealthResult,
  JsonResult,
  MetricsResult,
  PerformanceResult,
  PoolsResult,
  Raw,
  SearchResult,
  StatusResult,
  ago,
} from "./results";

/**
 * The console is one session log.
 *
 * Running the agent, browsing pools, calling any endpoint and checking a dependency are the same act
 * here: a command that appends a structured result. That is a deliberate structure rather than a
 * layout choice — the incumbent was fixed panels with a form on top, and it could not say anything
 * until you already knew a pool address. A log always has somewhere to put an answer, including the
 * answer "this deployment has nothing indexed yet".
 */

type CommandId =
  | "ask"
  | "pools"
  | "forecast"
  | "metrics"
  | "performance"
  | "search"
  | "status"
  | "health"
  | "cache";

interface CommandSpec {
  readonly id: CommandId;
  readonly hint: string;
  /** Which guided input the composer reveals, so a pool never has to be typed from memory. */
  readonly needs?: "pool" | "text";
}

const COMMANDS: readonly CommandSpec[] = [
  { id: "ask", hint: "run the v0.1 agent cycle on a question", needs: "text" },
  {
    id: "forecast",
    hint: "TimesFM-3 quantile forecast for a pool",
    needs: "pool",
  },
  { id: "pools", hint: "what this deployment has indexed" },
  { id: "metrics", hint: "hourly metric ledger for a pool", needs: "pool" },
  { id: "performance", hint: "realized yield, computed in SQL", needs: "pool" },
  { id: "search", hint: "nearest stored evidence", needs: "text" },
  { id: "status", hint: "recorded uptime and latency per dependency" },
  { id: "health", hint: "live dependency check" },
  { id: "cache", hint: "what the refresh job has stored" },
];

interface Entry {
  readonly id: string;
  readonly command: CommandId;
  readonly args: string;
  readonly ms?: number;
  readonly state: "running" | "ok" | "error";
  readonly data?: unknown;
  readonly error?: { readonly code: string; readonly message: string };
}

const nf = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

/** The strip. Recorded availability, not a live probe — the probe would cost a GPU wake per render. */
function DependencyStrip({
  status,
  cache,
  onRun,
}: {
  status: ModelStatusResponse | null;
  cache: CacheManifestResponse | null;
  onRun: (command: CommandId) => void;
}): React.JSX.Element {
  const services = status?.services ?? [];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {services.length === 0 ? (
        <button
          type="button"
          onClick={() => onRun("status")}
          className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint transition-colors hover:text-amber"
        >
          no probes recorded
        </button>
      ) : (
        services.map((s) => {
          const up = s.lastReachable === true;
          return (
            <button
              key={s.service}
              type="button"
              onClick={() => onRun("status")}
              title={`${s.service} — ${s.samples} sample(s), ${s.uptimePct === null ? "no uptime" : `${(s.uptimePct * 100).toFixed(0)}% reachable`}`}
              className="group flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-dim transition-colors hover:text-fg"
            >
              <span
                aria-hidden
                className={`size-1.5 rounded-full ${up ? "bg-up animate-pulse-subtle" : "bg-down"}`}
              />
              <span>{s.service}</span>
              {s.p50LatencyMs !== null ? (
                <span className="text-fg-faint tnum">
                  {nf.format(s.p50LatencyMs)}ms
                </span>
              ) : null}
            </button>
          );
        })
      )}
      <button
        type="button"
        onClick={() => onRun("cache")}
        className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint transition-colors hover:text-amber"
        title={cache?.reading ?? "no cache manifest"}
      >
        {cache?.cached === true
          ? `cached ${ago(cache.generatedAt)}`
          : "cache empty"}
      </button>
    </div>
  );
}

export function App(): React.JSX.Element {
  const [entries, setEntries] = React.useState<readonly Entry[]>([]);
  const [query, setQuery] = React.useState("");
  const [command, setCommand] = React.useState<CommandId>("ask");
  const [poolId, setPoolId] = React.useState<string>("");
  const [horizon, setHorizon] = React.useState(30);
  const [pools, setPools] = React.useState<readonly PoolSummary[]>([]);
  const [status, setStatus] = React.useState<ModelStatusResponse | null>(null);
  const [cache, setCache] = React.useState<CacheManifestResponse | null>(null);
  const [menuOpen, setMenuOpen] = React.useState(false);

  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const endRef = React.useRef<HTMLDivElement>(null);

  const spec = COMMANDS.find((c) => c.id === command) ?? COMMANDS[0]!;
  const selected = pools.find((p) => p.poolId === poolId);

  const push = React.useCallback(
    (entry: Entry) => setEntries((prev) => [...prev, entry]),
    [],
  );
  const settle = React.useCallback(
    (id: string, patch: Partial<Entry>) =>
      setEntries((prev) =>
        prev.map((e) => (e.id === id ? { ...e, ...patch } : e)),
      ),
    [],
  );

  const run = React.useCallback(
    async (
      id: CommandId,
      opts?: { query?: string; pool?: string; silent?: boolean },
    ) => {
      const subject =
        opts?.pool !== undefined && opts.pool.length > 0
          ? opts.pool
          : undefined;
      const pool = pools.find((p) => p.poolId === subject);
      const label =
        opts?.query !== undefined && opts.query.length > 0
          ? opts.query
          : pool !== undefined
            ? `${pool.protocol} · ${pool.network}`
            : selected !== undefined
              ? `${selected.protocol} · ${selected.network}`
              : "";
      const target = subject ?? poolId;

      const entryId = `${id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      if (opts?.silent !== true) {
        push({ id: entryId, command: id, args: label, state: "running" });
      }
      const startedAt = performance.now();

      try {
        let data: unknown;
        if (id === "pools") {
          data = await api.pools();
          setPools((data as { pools: readonly PoolSummary[] }).pools);
        } else if (id === "forecast") {
          const [forecast, metrics] = await Promise.all([
            api.forecast(target, horizon),
            api.metrics(target, "apy", 120),
          ]);
          data = { forecast, metrics };
        } else if (id === "metrics") {
          data = await api.metrics(target, "apy", 120);
        } else if (id === "performance") {
          data = await api.performance(target);
        } else if (id === "search") {
          data = await api.search(opts?.query ?? query);
        } else if (id === "status") {
          data = await api.modelStatus(24);
          setStatus(data as ModelStatusResponse);
        } else if (id === "health") {
          data = await api.health();
        } else if (id === "cache") {
          data = await api.cache();
          setCache(data as CacheManifestResponse);
        } else {
          data = await api.agent({
            query: opts?.query ?? query,
            ...(target.length > 0 ? { poolId: target } : {}),
            mode: "v01",
            horizonDays: horizon,
          });
        }
        if (opts?.silent !== true) {
          settle(entryId, {
            state: "ok",
            data,
            ms: Math.round(performance.now() - startedAt),
          });
        }
      } catch (error) {
        if (opts?.silent === true) return;
        const failure =
          error instanceof ApiCallError
            ? { code: error.code, message: error.message }
            : {
                code: "NETWORK",
                message: error instanceof Error ? error.message : String(error),
              };
        settle(entryId, {
          state: "error",
          error: failure,
          ms: Math.round(performance.now() - startedAt),
        });
      }
    },
    [horizon, poolId, pools, push, query, selected, settle],
  );

  // Orientation on arrival. `pools` is shown rather than silent because it is the whole point of the
  // rework: the first thing on screen is the list of what is indexed, and nobody had to know an
  // address to get it. `status` and `cache` feed the strip only — logging them would bury the answer
  // under its own footnotes.
  React.useEffect(() => {
    void run("pools");
    void run("status", { silent: true });
    void run("cache", { silent: true });
    // Intentionally once. These are ambient facts, not a subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [entries.length]);

  const submit = (): void => {
    if (spec.id === "ask" || spec.id === "search") {
      if (query.trim().length === 0) return;
    }
    if (
      (spec.id === "forecast" ||
        spec.id === "metrics" ||
        spec.id === "performance") &&
      poolId.length === 0
    ) {
      return;
    }
    void run(spec.id);
    if (spec.id === "ask" || spec.id === "search") setQuery("");
  };

  const matches = COMMANDS.filter(
    (c) =>
      menuOpen && (query.length === 0 || c.id.startsWith(query.toLowerCase())),
  );

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-edge bg-ink/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3">
          <h1 className="shrink-0 font-mono text-[12px] font-medium uppercase tracking-[0.22em] text-fg">
            Agentic EMS<span className="mx-2 text-fg-faint">//</span>
            <span className="text-amber">Indexer</span>
          </h1>
          <div className="ml-auto min-w-0">
            <DependencyStrip
              status={status}
              cache={cache}
              onRun={(c) => void run(c)}
            />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1180px] px-5 pb-32">
        {/* Composer. Sticky because the log grows downward and the next action should never scroll away. */}
        <div className="sticky top-[53px] z-10 -mx-5 border-b border-edge bg-ink/95 px-5 py-4 backdrop-blur">
          <div className="border border-edge-2 bg-panel focus-within:border-amber-dim">
            <div className="flex items-start gap-3 px-3 py-2.5">
              <span
                aria-hidden
                className="pt-1 font-mono text-[13px] leading-none text-amber"
              >
                ›
              </span>
              <textarea
                ref={inputRef}
                rows={1}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setMenuOpen(true);
                }}
                onFocus={() => setMenuOpen(true)}
                onBlur={() => window.setTimeout(() => setMenuOpen(false), 120)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    setMenuOpen(false);
                    submit();
                  }
                }}
                placeholder={
                  spec.needs === "pool"
                    ? `${spec.id} — pick a pool below, then press enter`
                    : spec.id === "search"
                      ? "search the stored evidence…"
                      : spec.id === "ask"
                        ? "ask the cycle a question…"
                        : `run ${spec.id}`
                }
                aria-label="Command"
                className="min-h-[22px] min-w-0 flex-1 resize-none bg-transparent font-mono text-[13px] leading-relaxed text-fg placeholder:text-fg-faint focus:outline-none"
              />
              <Button
                type="button"
                onClick={submit}
                size="sm"
                className="h-7 shrink-0 gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em]"
              >
                <ArrowUp className="size-3" />
                run
              </Button>
            </div>

            {/* The guided inputs. A pool is chosen, never typed — the whole point of the rework. */}
            <div className="flex flex-wrap items-end gap-x-5 gap-y-3 border-t border-edge px-3 py-3">
              <label className="flex w-full flex-col gap-1.5 sm:w-auto">
                <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-fg-faint">
                  command
                </span>
                <Select
                  value={command}
                  onValueChange={(v) => setCommand(v as CommandId)}
                >
                  <SelectTrigger className="h-7 w-full font-mono text-[11px] sm:w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COMMANDS.map((c) => (
                      <SelectItem
                        key={c.id}
                        value={c.id}
                        className="font-mono text-[12px]"
                      >
                        {c.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>

              {spec.needs === "pool" ? (
                <>
                  <label className="flex w-full flex-col gap-1.5 sm:w-auto">
                    <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-fg-faint">
                      pool
                    </span>
                    <Select value={poolId} onValueChange={setPoolId}>
                      <SelectTrigger className="h-7 w-full font-mono text-[11px] sm:w-[260px]">
                        <SelectValue
                          placeholder={
                            pools.length === 0
                              ? "nothing indexed"
                              : "choose a pool"
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {pools.map((p) => (
                          <SelectItem
                            key={p.poolId}
                            value={p.poolId}
                            className="font-mono text-[12px]"
                          >
                            {p.protocol} · {p.network} · {p.observations} obs
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="flex w-full flex-col gap-1.5 sm:w-auto">
                    <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-fg-faint">
                      {spec.id === "forecast"
                        ? "horizon (days)"
                        : "window (days)"}
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={horizon}
                      onChange={(e) =>
                        setHorizon(
                          Math.max(
                            1,
                            Math.min(365, Number(e.target.value) || 30),
                          ),
                        )
                      }
                      className="h-7 w-full border border-edge-2 bg-panel-2 px-2 font-mono text-[11px] tnum text-fg focus:border-amber-dim focus:outline-none sm:w-[92px]"
                    />
                  </label>
                </>
              ) : null}

              {/* The hint is the first thing to go on a narrow screen: it describes an affordance that
                  is already visible, and at 390px it was the element forcing the page wider than the
                  viewport. */}
              <p className="hidden text-right font-mono text-[10px] leading-relaxed text-fg-faint lg:ml-auto lg:block lg:max-w-[46ch]">
                {spec.hint}
              </p>
            </div>
          </div>

          {menuOpen && matches.length > 1 ? (
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {matches.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setCommand(c.id);
                      setMenuOpen(false);
                      inputRef.current?.focus();
                    }}
                    className={`border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors ${
                      c.id === command
                        ? "border-amber-dim text-amber"
                        : "border-edge text-fg-faint hover:border-edge-2 hover:text-fg-dim"
                    }`}
                  >
                    {c.id}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {/* The log. */}
        <div className="pt-6">
          {entries.length === 0 ? (
            <p className="max-w-[62ch] text-[13px] leading-relaxed text-fg-dim">
              Nothing run yet in this session. Pick a command above —{" "}
              <span className="font-mono text-fg">pools</span> lists what is
              indexed, and nothing here needs you to know a pool address.
            </p>
          ) : null}

          <ol className="divide-y divide-edge">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="animate-fade-slide-up py-6 first:pt-0"
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-mono text-[12px] text-amber">›</span>
                  <span className="font-mono text-[12px] text-fg">
                    {entry.command}
                  </span>
                  {entry.args.length > 0 ? (
                    <span className="font-mono text-[12px] text-fg-dim">
                      {entry.args}
                    </span>
                  ) : null}
                  <span className="ml-auto flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.14em]">
                    {entry.state === "running" ? (
                      <span className="flex items-center gap-1.5 text-fg-faint">
                        <span
                          className="size-1.5 animate-pulse-subtle rounded-full bg-amber"
                          aria-hidden
                        />
                        running
                      </span>
                    ) : entry.state === "ok" ? (
                      <span className="tnum text-fg-faint">{entry.ms}ms</span>
                    ) : (
                      <Badge
                        variant="destructive"
                        className="font-mono text-[9px]"
                      >
                        {entry.error?.code}
                      </Badge>
                    )}
                  </span>
                </div>

                <div className="mt-3">
                  {entry.state === "running" ? (
                    <div className="space-y-2" aria-hidden>
                      <div className="h-3 w-2/5 bg-panel-2" />
                      <div className="h-3 w-3/5 bg-panel-2" />
                    </div>
                  ) : entry.state === "error" ? (
                    <div className="border border-down/40 bg-down/5 px-3 py-2.5">
                      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-down">
                        {entry.error?.code}
                      </p>
                      <p className="mt-1 max-w-[75ch] text-[13px] leading-relaxed text-fg">
                        {entry.error?.message}
                      </p>
                    </div>
                  ) : (
                    <Result
                      entry={entry}
                      onRun={(c, opts) => void run(c, opts)}
                    />
                  )}
                </div>
              </li>
            ))}
          </ol>
          <div ref={endRef} />
        </div>
      </main>
    </div>
  );
}

function Result({
  entry,
  onRun,
}: {
  entry: Entry;
  onRun: (command: CommandId, opts?: { query?: string; pool?: string }) => void;
}): React.JSX.Element {
  const data = entry.data;
  switch (entry.command) {
    case "pools":
      return (
        <>
          <PoolsResult data={data as never} />
          <Raw data={data} />
        </>
      );
    case "forecast": {
      const bundle = data as { forecast: never; metrics: never };
      return (
        <>
          <ForecastResult forecast={bundle.forecast} metrics={bundle.metrics} />
          <Raw data={data} />
        </>
      );
    }
    case "metrics":
      return (
        <>
          <MetricsResult data={data as never} />
          <Raw data={data} />
        </>
      );
    case "performance":
      return (
        <>
          <PerformanceResult data={data as never} />
          <Raw data={data} />
        </>
      );
    case "status":
      return (
        <>
          <StatusResult data={data as never} />
          <Raw data={data} />
        </>
      );
    case "health":
      return (
        <>
          <HealthResult data={data as never} />
          <Raw data={data} />
        </>
      );
    case "cache":
      return (
        <>
          <CacheResult data={data as never} />
          <Raw data={data} />
        </>
      );
    case "search":
      return (
        <>
          <SearchResult data={data as never} />
          <Raw data={data} />
        </>
      );
    case "ask":
      return (
        <>
          <AgentResult data={data as never} />
          <Raw data={data} />
        </>
      );
    default:
      return <Raw data={data} />;
  }
}
