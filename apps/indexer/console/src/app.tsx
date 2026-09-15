"use client";

import * as React from "react";
import {
  Badge,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
  Input,
  Label,
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@ethonline2026/ux-workflow";

import { api, ApiCallError, type PoolSummary } from "./api.js";
import {
  classifyFailure,
  classifyOk,
  codeOf,
  readErrorEnvelope,
  type Classified,
} from "./classify.js";
import { next, specOf, type RunEvent, type RunState } from "./machine.js";
import { Results } from "./render.js";
import { RunStateDiagram } from "./state-diagram.js";

/* ── the commands ─────────────────────────────────────────────────────────── */

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
  /** What it does, in one line, shown beside the picker. */
  readonly hint: string;
  /** The guided input it reveals. A pool is never typed. */
  readonly wants: "pool" | "text" | "none";
}

const COMMANDS: readonly CommandSpec[] = [
  { id: "ask", hint: "run the v0.1 agent cycle on a question", wants: "text" },
  {
    id: "pools",
    hint: "every pool this deployment holds metrics for",
    wants: "none",
  },
  {
    id: "forecast",
    hint: "TimesFM-3 quantile band for one pool",
    wants: "pool",
  },
  {
    id: "metrics",
    hint: "hourly observations behind a pool's history",
    wants: "pool",
  },
  { id: "performance", hint: "realized yield, computed in SQL", wants: "pool" },
  {
    id: "search",
    hint: "temporal-vector retrieval over stored evidence",
    wants: "text",
  },
  {
    id: "status",
    hint: "recorded reachability and latency per dependency",
    wants: "none",
  },
  { id: "health", hint: "probe every dependency right now", wants: "none" },
  {
    id: "cache",
    hint: "what the refresh job has cached, and when",
    wants: "none",
  },
];

const specOfCommand = (id: CommandId): CommandSpec =>
  COMMANDS.find((c) => c.id === id) ?? COMMANDS[0]!;

/* ── one session entry ────────────────────────────────────────────────────── */

interface Entry {
  readonly id: string;
  readonly command: CommandId;
  /** The arguments as a human-readable line, composed at submit time. */
  readonly args: string;
  readonly startedAt: number;
  readonly ms: number | null;
  /** The machine's state for this entry once it settled; `running` while in flight. */
  readonly outcome: RunState;
  readonly data: unknown;
  readonly notice: Classified | null;
}

/* ── the shell ────────────────────────────────────────────────────────────── */

export function App(): React.JSX.Element {
  const [run, dispatch] = React.useReducer(
    (state: RunState, event: RunEvent): RunState => next(state, event) ?? state,
    "idle",
  );
  const [command, setCommand] = React.useState<CommandId>("ask");
  const [question, setQuestion] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [poolId, setPoolId] = React.useState("");
  const [horizon, setHorizon] = React.useState(30);
  const [windowDays, setWindowDays] = React.useState(30);
  const [entries, setEntries] = React.useState<readonly Entry[]>([]);
  const [pools, setPools] = React.useState<readonly PoolSummary[]>([]);
  const [poolsState, setPoolsState] = React.useState<
    "loading" | "ready" | "failed"
  >("loading");
  const [strip, setStrip] = React.useState<StripState | null>(null);

  const spec = specOfCommand(command);
  const busy = run === "submitting" || run === "running";

  /** The pool picker is the whole point: it exists so no address is ever typed. */
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await api.pools();
        if (cancelled) return;
        setPools(response.pools);
        setPoolsState("ready");
        setPoolId((current) =>
          current.length > 0 ? current : (response.pools[0]?.poolId ?? ""),
        );
      } catch {
        if (!cancelled) setPoolsState("failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** The header strip: recorded reachability, and how old the cache is. */
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [status, cache] = await Promise.allSettled([
        api.modelStatus(24),
        api.cache(),
      ]);
      if (cancelled) return;
      setStrip({
        services: status.status === "fulfilled" ? status.value.services : [],
        recordedSince:
          status.status === "fulfilled"
            ? status.value.window.recordedSince
            : null,
        cachedAt:
          cache.status === "fulfilled" && cache.value.cached
            ? cache.value.generatedAt
            : null,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const argumentProblem = React.useMemo((): string | null => {
    if (spec.wants === "pool" && poolId.length === 0)
      return "pick a pool first";
    if (spec.id === "ask" && question.trim().length === 0)
      return "a question is required";
    if (spec.id === "search" && search.trim().length === 0)
      return "a query is required";
    return null;
  }, [spec, poolId, question, search]);

  const argsLine = React.useMemo((): string => {
    const pool = pools.find((p) => p.poolId === poolId);
    const subject =
      pool === undefined ? poolId : `${pool.protocol} · ${pool.network}`;
    switch (spec.id) {
      case "ask":
        return question.trim();
      case "search":
        return search.trim();
      case "pools":
      case "status":
      case "health":
      case "cache":
        return "this deployment";
      case "forecast":
        return `${subject} · horizon ${horizon}d`;
      case "metrics":
        return `${subject} · ${windowDays}d`;
      case "performance":
        return `${subject} · ${windowDays}d`;
      default:
        return subject;
    }
  }, [spec, pools, poolId, question, search, horizon, windowDays]);

  /**
   * Send one command and settle its entry.
   *
   * Shared by a typed command and the opening read, so both take the same path: the same machine
   * transitions, the same classification, the same entry. A second implementation for the opening
   * read would be a second set of behaviours to keep in step.
   */
  const perform = React.useCallback(
    async (
      id: string,
      command: CommandId,
      args: {
        poolId: string;
        question: string;
        search: string;
        horizon: number;
        windowDays: number;
      },
    ): Promise<void> => {
      const startedAt = Date.now();
      let classified: Classified;
      let data: unknown = null;
      try {
        data = await call(command, args);
        classified = classifyOk(data);
      } catch (error) {
        if (error instanceof ApiCallError) {
          classified = classifyFailure(
            error.status,
            codeOf(error.code),
            error.message,
          );
        } else {
          // Nothing came back, so nothing came back with a status.
          const envelope = readErrorEnvelope(error);
          classified = classifyFailure(0, envelope.code, envelope.message);
        }
      }
      dispatch(classified.event);
      const settled = next("running", classified.event) ?? "failed";
      setEntries((current) =>
        current.map((entry) =>
          entry.id === id
            ? {
                ...entry,
                ms: Date.now() - startedAt,
                outcome: settled,
                data,
                notice: classified,
              }
            : entry,
        ),
      );
    },
    [],
  );

  const submit = React.useCallback(async (): Promise<void> => {
    if (busy) return;

    // The machine has a state for a request that cannot be sent, so an incomplete form is a
    // transition rather than a disabled button — the reader is told what is missing and the diagram
    // shows why nothing went out.
    if (argumentProblem !== null) {
      dispatch("reject");
      return;
    }

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setEntries((current) => [
      ...current,
      {
        id,
        command: spec.id,
        args: argsLine,
        startedAt: Date.now(),
        ms: null,
        outcome: "running",
        data: null,
        notice: null,
      },
    ]);
    // Two transitions, not one. `submitting` is "the request is going out" and `accept` is "it went
    // out"; the outcome events leave from `running`, so without the second the machine has no
    // transition to take on success and sticks in `submitting` forever.
    dispatch("submit");
    dispatch("accept");
    await perform(id, spec.id, {
      poolId,
      question: question.trim(),
      search: search.trim(),
      horizon,
      windowDays,
    });
  }, [
    busy,
    argumentProblem,
    spec,
    argsLine,
    poolId,
    question,
    search,
    horizon,
    windowDays,
    perform,
  ]);

  /**
   * The opening read.
   *
   * A session log that starts empty tells a visitor nothing about the deployment they just opened.
   * `pools` runs on arrival because it answers "what is indexed here?" — and because it is the
   * command that could not exist before this branch: nothing could enumerate the universe, so the
   * first thing anyone saw was a form demanding an address they did not have.
   *
   * It goes through `perform`, so the machine, the diagram and the entry behave exactly as they do
   * for a typed command. The arguments are the composer's defaults and are ignored by this command.
   */
  React.useEffect(() => {
    const id = "opening-pools";
    setEntries([
      {
        id,
        command: "pools",
        args: "this deployment",
        startedAt: Date.now(),
        ms: null,
        outcome: "running",
        data: null,
        notice: null,
      },
    ]);
    dispatch("select");
    dispatch("submit");
    dispatch("accept");
    void perform(id, "pools", {
      poolId: "",
      question: "",
      search: "",
      horizon: 30,
      windowDays: 90,
    });
  }, [perform]);

  return (
    <div className="min-h-dvh bg-ink text-fg">
      <Header strip={strip} />

      <main className="mx-auto flex max-w-[1180px] flex-col px-5 pb-16">
        <section className="sticky top-[57px] z-10 -mx-5 bg-ink/95 px-5 pt-5 backdrop-blur">
          <Composer
            command={command}
            onCommand={setCommand}
            spec={spec}
            question={question}
            onQuestion={setQuestion}
            search={search}
            onSearch={setSearch}
            pools={pools}
            poolsState={poolsState}
            poolId={poolId}
            onPool={setPoolId}
            horizon={horizon}
            onHorizon={setHorizon}
            windowDays={windowDays}
            onWindowDays={setWindowDays}
            busy={busy}
            onSubmit={submit}
          />
          <RunStateDiagram state={run} />
        </section>

        <Conversation className="mt-6 min-h-[40vh]">
          <ConversationContent className="gap-0 p-0">
            {entries.length === 0 ? (
              <ConversationEmptyState
                title="Nothing run yet"
                description="Pick a command above. Nothing here needs a pool address — the universe is read from this deployment."
              />
            ) : (
              entries.map((entry) => <EntryRow key={entry.id} entry={entry} />)
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      </main>
    </div>
  );
}

/* ── the header ───────────────────────────────────────────────────────────── */

interface StripState {
  readonly services: readonly {
    service: string;
    p50LatencyMs: number | null;
    lastReachable: boolean | null;
    samples: number;
  }[];
  readonly recordedSince: string | null;
  readonly cachedAt: string | null;
}

function Header({ strip }: { strip: StripState | null }): React.JSX.Element {
  return (
    <header className="sticky top-0 z-20 border-b border-edge bg-ink/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3">
        <h1 className="shrink-0 font-mono text-[12px] font-medium uppercase tracking-[0.22em] text-fg">
          Agentic EMS <span className="text-fg-faint">//</span>{" "}
          <span className="text-amber">Indexer</span>
        </h1>
        <div className="ml-auto min-w-0">
          {strip === null ? (
            <div className="flex items-center gap-3">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-16" />
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              {strip.services.map((service) => (
                <Tooltip key={service.service}>
                  <TooltipTrigger asChild>
                    <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-dim">
                      <span
                        aria-hidden
                        className={`inline-block size-1.5 rounded-full ${
                          service.lastReachable === null
                            ? "bg-fg-faint"
                            : service.lastReachable
                              ? "bg-up"
                              : "bg-down"
                        }`}
                      />
                      {service.service}
                      {service.p50LatencyMs === null ? null : (
                        <span className="tabular-nums text-fg-faint">
                          {Math.round(service.p50LatencyMs)}ms
                        </span>
                      )}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {service.samples === 0
                      ? "no probe recorded in the last 24h — this dependency is unobserved, not necessarily healthy"
                      : `${service.samples} probes in the last 24h; median ${Math.round(service.p50LatencyMs ?? 0)}ms`}
                  </TooltipContent>
                </Tooltip>
              ))}
              {strip.cachedAt === null ? null : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
                      cached {ago(strip.cachedAt)}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    The refresh job last wrote the cache {ago(strip.cachedAt)}.
                    Cached figures were observed then, not now.
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

/* ── the composer ─────────────────────────────────────────────────────────── */

interface ComposerProps {
  readonly command: CommandId;
  readonly onCommand: (id: CommandId) => void;
  readonly spec: CommandSpec;
  readonly question: string;
  readonly onQuestion: (value: string) => void;
  readonly search: string;
  readonly onSearch: (value: string) => void;
  readonly pools: readonly PoolSummary[];
  readonly poolsState: "loading" | "ready" | "failed";
  readonly poolId: string;
  readonly onPool: (value: string) => void;
  readonly horizon: number;
  readonly onHorizon: (value: number) => void;
  readonly windowDays: number;
  readonly onWindowDays: (value: number) => void;
  readonly busy: boolean;
  readonly onSubmit: () => Promise<void>;
}

function Composer(props: ComposerProps): React.JSX.Element {
  const { spec, pools, poolsState } = props;
  const needsText = spec.wants === "text";
  const text = spec.id === "search" ? props.search : props.question;
  const onText = spec.id === "search" ? props.onSearch : props.onQuestion;

  return (
    <div className="flex flex-col gap-2.5">
      <PromptInput
        isLoading={props.busy}
        onSubmit={(event) => {
          event.preventDefault();
          void props.onSubmit();
        }}
      >
        <div className="flex min-w-0 flex-1 items-start gap-1">
          <span
            aria-hidden
            className="select-none pt-0.5 font-mono text-[13px] text-amber"
          >
            ›
          </span>
          {needsText ? (
            <PromptInputTextarea
              autoFocus
              value={text}
              onChange={(event) => onText(event.target.value)}
              placeholder={
                spec.id === "ask"
                  ? "ask the cycle a question…"
                  : "describe what to retrieve…"
              }
              className="min-h-[22px] flex-1 border-0 bg-transparent px-1 py-0 text-[13px] focus-visible:ring-0"
            />
          ) : (
            <p className="flex-1 px-1 py-0.5 font-mono text-[12px] text-fg-faint">
              {spec.id === "pools"
                ? "read every pool this deployment holds metrics for"
                : spec.id === "status"
                  ? "read the recorded probe history"
                  : spec.id === "health"
                    ? "probe each dependency now"
                    : "read what the refresh job cached"}
            </p>
          )}
          <PromptInputSubmit disabled={props.busy} aria-label="Run">
            {props.busy ? "running" : "run"}
          </PromptInputSubmit>
        </div>
      </PromptInput>

      <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
        <div className="flex w-full flex-col gap-1.5 sm:w-auto">
          <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
            command
          </Label>
          <Select
            value={props.command}
            onValueChange={(value) => props.onCommand(value as CommandId)}
          >
            <SelectTrigger
              className="h-7 w-full font-mono text-[11px] sm:w-[170px]"
              aria-label="Command"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COMMANDS.map((item) => (
                <SelectItem
                  key={item.id}
                  value={item.id}
                  className="font-mono text-[11px]"
                >
                  {item.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {spec.wants === "pool" ? (
          <div className="flex w-full flex-col gap-1.5 sm:w-auto">
            <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
              pool
            </Label>
            {poolsState === "loading" ? (
              <Skeleton className="h-7 w-full sm:w-[320px]" />
            ) : poolsState === "failed" ? (
              <p className="font-mono text-[11px] text-down">
                could not read the pool list
              </p>
            ) : (
              <Select value={props.poolId} onValueChange={props.onPool}>
                <SelectTrigger
                  className="h-7 w-full font-mono text-[11px] sm:w-[320px]"
                  aria-label="Pool"
                >
                  <SelectValue placeholder="choose a pool" />
                </SelectTrigger>
                <SelectContent>
                  {pools.map((pool) => (
                    <SelectItem
                      key={pool.poolId}
                      value={pool.poolId}
                      className="font-mono text-[11px]"
                    >
                      {pool.protocol} · {pool.network} · {pool.observations} obs
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        ) : null}

        {spec.id === "forecast" ? (
          <div className="flex w-full flex-col gap-1.5 sm:w-auto">
            <Label
              htmlFor="horizon"
              className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint"
            >
              horizon (days)
            </Label>
            <Input
              id="horizon"
              type="number"
              min={1}
              max={365}
              value={props.horizon}
              onChange={(event) => props.onHorizon(Number(event.target.value))}
              className="h-7 w-full font-mono text-[11px] sm:w-[92px]"
            />
          </div>
        ) : null}

        {spec.id === "metrics" || spec.id === "performance" ? (
          <div className="flex w-full flex-col gap-1.5 sm:w-auto">
            <Label
              htmlFor="window"
              className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint"
            >
              window (days)
            </Label>
            <Input
              id="window"
              type="number"
              min={1}
              max={365}
              value={props.windowDays}
              onChange={(event) =>
                props.onWindowDays(Number(event.target.value))
              }
              className="h-7 w-full font-mono text-[11px] sm:w-[92px]"
            />
          </div>
        ) : null}

        <p className="hidden max-w-[42ch] text-right font-mono text-[10px] leading-relaxed text-fg-faint lg:ml-auto lg:block">
          {spec.hint}
        </p>
      </div>
    </div>
  );
}

/* ── one entry ────────────────────────────────────────────────────────────── */

function EntryRow({ entry }: { entry: Entry }): React.JSX.Element {
  const running = entry.outcome === "running";
  const spec = specOf(entry.outcome);

  return (
    <article className="border-b border-edge py-5 first:pt-0">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span aria-hidden className="font-mono text-[12px] text-amber">
          ›
        </span>
        <span className="font-mono text-[12px] font-medium uppercase tracking-[0.1em] text-fg">
          {entry.command}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg-dim">
          {entry.args}
        </span>
        <Badge
          variant={badgeFor(entry.outcome)}
          className="font-mono text-[9px] uppercase tracking-[0.14em]"
        >
          {running ? "running" : spec.label}
        </Badge>
        <span className="font-mono text-[10px] tabular-nums text-fg-faint">
          {entry.ms === null ? "…" : `${entry.ms}ms`}
        </span>
      </header>

      <div className="mt-3 pl-5">
        {running ? (
          <div className="space-y-2">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ) : entry.outcome === "unavailable" ? (
          <Unavailable notice={entry.notice} />
        ) : entry.outcome === "refused" || entry.outcome === "failed" ? (
          <Refused notice={entry.notice} outcome={entry.outcome} />
        ) : (
          <Results command={entry.command} data={entry.data} />
        )}
      </div>
    </article>
  );
}

/**
 * A command this deployment cannot answer, which is not the same as one that failed.
 *
 * The distinction decides what the reader does next: a failed request is worth retrying, an
 * unavailable one never will be until something is configured. `RISK_UNAVAILABLE` on three routes is
 * the case that made this a state rather than an error string.
 */
function Unavailable({
  notice,
}: {
  notice: Classified | null;
}): React.JSX.Element {
  return (
    <div className="border border-edge-2 bg-panel/60 p-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
        not available on this deployment
      </p>
      <p className="mt-1.5 max-w-[70ch] text-[13px] leading-relaxed text-fg">
        {notice?.remedy ?? "A dependency this route needs is not configured."}
      </p>
      {notice?.summary === undefined ? null : (
        <p className="mt-2 font-mono text-[11px] text-fg-faint">
          {notice.code ?? "—"} · HTTP {notice.status} · {notice.summary}
        </p>
      )}
    </div>
  );
}

function Refused({
  notice,
  outcome,
}: {
  notice: Classified | null;
  outcome: RunState;
}): React.JSX.Element {
  return (
    <div className="border border-down/40 bg-down/5 p-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-down">
        {outcome === "refused" ? "request refused" : "request failed"}
      </p>
      <p className="mt-1.5 max-w-[70ch] text-[13px] leading-relaxed text-fg">
        {notice?.summary ?? "The call did not complete."}
      </p>
      {notice?.code == null ? null : (
        <p className="mt-2 font-mono text-[11px] text-fg-faint">
          {notice.code} · HTTP {notice.status}
        </p>
      )}
    </div>
  );
}

/* ── calling ──────────────────────────────────────────────────────────────── */

async function call(
  command: CommandId,
  input: {
    poolId: string;
    question: string;
    search: string;
    horizon: number;
    windowDays: number;
  },
): Promise<unknown> {
  switch (command) {
    case "ask":
      return input.poolId.length > 0
        ? api.agent({
            query: input.question,
            poolId: input.poolId,
            mode: "v01",
            horizonDays: input.horizon,
          })
        : api.agent({
            query: input.question,
            mode: "v01",
            horizonDays: input.horizon,
          });
    case "pools":
      return api.pools();
    case "forecast": {
      // Both halves in one command. The band alone says where the model thinks the yield goes; the
      // observations are what make it legible as a continuation of a past rather than a floating
      // prediction, which is the reason the chart takes history and forecast together.
      const [forecast, metrics] = await Promise.all([
        api.forecast(input.poolId, input.horizon),
        api.metrics(input.poolId, "apy", 90),
      ]);
      return { forecast, metrics };
    }
    case "metrics":
      return api.metrics(input.poolId, "apy", input.windowDays);
    case "performance":
      return api.performance(input.poolId);
    case "search":
      return api.search(input.search);
    case "status":
      return api.modelStatus(24);
    case "health":
      return api.health();
    case "cache":
      return api.cache();
    default:
      return null;
  }
}

/* ── small shared helpers ─────────────────────────────────────────────────── */

const badgeFor = (state: RunState): "up" | "down" | "secondary" | "outline" => {
  const accent = specOf(state).accent;
  if (accent === "up") return "up";
  if (accent === "down") return "down";
  if (accent === "faint") return "outline";
  return "secondary";
};

function ago(instant: string | null): string {
  if (instant === null) return "—";
  const then = Date.parse(instant);
  if (Number.isNaN(then)) return "—";
  const minutes = Math.round((Date.now() - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
