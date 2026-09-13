/**
 * LangChain callbacks → `InferenceEvent`s.
 *
 * This is the seam that replaces `apps/agentic-ems`'s `lib/agent-traces.ts`. Every
 * step the UI renders is produced here, from a callback the agent runtime actually
 * fired — nothing is synthesised after the fact.
 *
 * ## What the callbacks really carry (verified against @langchain/core 1.2.9)
 *
 * These are not what the names suggest, and reading the wrong field yields a
 * trace that looks fine and is empty:
 *
 * - **The tool name is the 7th argument (`runName`), not `tool.name`.** `tool` is
 *   `{ lc: 1, type: "not_implemented", id: ["langchain","tools","DynamicStructuredTool"] }`
 *   for a `StructuredTool`, so `tool.name` is `undefined` for every tool.
 * - **`handleToolStart`'s `input` is a JSON *string*,** not an object, so it must be
 *   parsed before it can be compacted.
 * - **A LangGraph node is `metadata.langgraph_node`.** `runName` is `undefined` and
 *   `runType` is set to the *parent run id* (not a type), so neither is usable.
 *   `handleChainEnd`'s `outputs` are the node's returned state keys, which is the
 *   honest evidence that the node did something.
 * - **`handleToolEnd` carries the tool's real return value**, which is what makes a
 *   tool-call result real rather than described.
 *
 * ## Two rules inherited from the module it replaces
 *
 * 1. A field that does not exist is omitted, never invented. A fabricated rationale
 *    on a trading trace is worse than a blank one.
 * 2. Nothing here may fail a run. Every emit is wrapped: a broken trace is a bug, a
 *    broken turn is an outage.
 */
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { InferenceEventInput } from "../events/contract.js";
import { buildAgentStep } from "../orchestrator/eventMapper.js";
import { redactDeep, redactSecrets } from "./redact.js";

/** Nodes LangGraph runs internally; they are plumbing, not agent work. */
const INTERNAL_NODES = new Set(["LangGraph", "__start__", "__end__", "RunnableSequence"]);

/** Segment in a serialized id that marks LangGraph's own graph wrapper. */
const PREGEL_SEGMENT = "pregel";

const MAX_EVIDENCE_ROWS = 6;
const MAX_SUMMARY = 200;
const MAX_FIELD = 160;
const MAX_RAW = 4_000;

/** Keys that make a better one-line summary when a tool returns an object. */
const SUMMARY_KEYS = ["summary", "answer", "text", "message", "result", "output"] as const;

interface TrackedRun {
  readonly stepId: string;
  readonly agent: string;
  readonly call: string;
  readonly startedAt: number;
  /** Internal plumbing (a LangGraph `__start__`) — tracked only so the end is ignored. */
  readonly ignored: boolean;
}

export interface AgentTraceHandlerOptions {
  readonly emit: (event: InferenceEventInput) => void;
  /** One step per model call. Defaults to true — they are agentic work. */
  readonly includeLlmSteps?: boolean;
  /** Injectable clock so duration assertions in tests are deterministic. */
  readonly now?: () => number;
}

export class AgentTraceHandler extends BaseCallbackHandler {
  override name = "inferrence.agent-trace";

  readonly #emit: (event: InferenceEventInput) => void;
  readonly #includeLlm: boolean;
  readonly #now: () => number;
  readonly #runs = new Map<string, TrackedRun>();
  #lastMessage = "";

  constructor(options: AgentTraceHandlerOptions) {
    super();
    this.#emit = options.emit;
    this.#includeLlm = options.includeLlmSteps ?? true;
    this.#now = options.now ?? (() => Date.now());
  }

  /**
   * The most recent model output, verbatim.
   *
   * The port uses this for the turn's prose so the user sees what the model
   * actually wrote rather than a paraphrase assembled here.
   */
  get lastMessage(): string {
    return this.#lastMessage;
  }

  // ── chains: LangGraph nodes ────────────────────────────────────────────────

  override handleChainStart(
    chain: unknown,
    _inputs: unknown,
    runId: string,
    _runType?: string,
    tags?: string[],
    metadata?: Record<string, unknown>,
    runName?: string,
  ): void {
    const node = this.#nodeName(chain, metadata, runName);
    const ignored = node === null || INTERNAL_NODES.has(node) || (tags ?? []).includes("langsmith:hidden");
    const name = node ?? "chain";
    this.#track(runId, {
      stepId: `lc:node:${runId}`,
      agent: prettyAgent(name),
      call: name,
      startedAt: this.#now(),
      ignored,
    });
    if (ignored) return;

    const step = metadata?.["langgraph_step"];
    this.#safe(() =>
      this.#emit({
        type: "step.start",
        step: buildAgentStep({
          id: `lc:node:${runId}`,
          agent: prettyAgent(name),
          call: name,
          state: "running",
          ...(step === undefined ? {} : { argsSummary: `step ${String(step)}` }),
          provenance: { source: "langgraph" },
        }),
      }),
    );
  }

  override handleChainEnd(outputs: unknown, runId: string): void {
    const tracked = this.#runs.get(runId);
    if (tracked === undefined || tracked.ignored) {
      this.#runs.delete(runId);
      return;
    }
    this.#runs.delete(runId);

    // A node's returned state keys are real evidence it produced something — and
    // the closest thing to a per-node assertion we can derive without guessing.
    const produced = keysOf(outputs);
    this.#safe(() =>
      this.#emit({
        type: "step.completed",
        step: buildAgentStep({
          id: tracked.stepId,
          agent: tracked.agent,
          call: tracked.call,
          state: "done",
          durationMs: this.#now() - tracked.startedAt,
          ...(produced.length === 0
            ? {}
            : { evidence: [{ label: "produced", value: produced.join(", ").slice(0, MAX_FIELD) }] }),
          provenance: { source: "langgraph" },
        }),
      }),
    );
  }

  // ── tools: the real call and its real result ───────────────────────────────

  override handleToolStart(
    tool: unknown,
    input: unknown,
    runId: string,
    _parentRunId?: string,
    _tags?: string[],
    _metadata?: Record<string, unknown>,
    runName?: string,
  ): void {
    const name = runName ?? lastIdSegment(tool) ?? "tool";
    this.#track(runId, {
      stepId: `lc:tool:${runId}`,
      agent: prettyAgent(name),
      call: name,
      startedAt: this.#now(),
      ignored: false,
    });

    const args = parseJsonObject(input);
    this.#safe(() =>
      this.#emit({
        type: "step.start",
        step: buildAgentStep({
          id: `lc:tool:${runId}`,
          agent: prettyAgent(name),
          call: name,
          state: "running",
          ...(args === null ? {} : { argsSummary: compactSummary(args) }),
          provenance: { source: sourceOf(name) },
        }),
      }),
    );
  }

  override handleToolEnd(output: unknown, runId: string): void {
    const tracked = this.#runs.get(runId);
    if (tracked === undefined || tracked.ignored) return;

    const evidence = evidenceFrom(output);
    this.#safe(() =>
      this.#emit({
        type: "step.completed",
        step: buildAgentStep({
          id: tracked.stepId,
          agent: tracked.agent,
          call: tracked.call,
          state: "done",
          durationMs: this.#now() - tracked.startedAt,
          result: { summary: summariseOutput(output) },
          ...(evidence.length === 0 ? {} : { evidence }),
          raw: this.#rawOf(output),
          provenance: { source: sourceOf(tracked.call) },
        }),
      }),
    );
  }

  override handleToolError(err: Error, runId: string): void {
    this.#fail(runId, err);
  }

  // ── models: one step per real call, with real token usage ──────────────────

  override handleChatModelStart(
    llm: unknown,
    messages: unknown,
    runId: string,
    _parentRunId?: string,
    _extraParams?: Record<string, unknown>,
    _tags?: string[],
    metadata?: Record<string, unknown>,
    runName?: string,
  ): void {
    if (!this.#includeLlm) return;
    const model = modelName(llm, metadata, runName);
    // Prompt size is real and cheap; the prompt text itself is not sent.
    const prompts = Array.isArray(messages) ? `messages=${messages.length}` : undefined;
    this.#track(runId, {
      stepId: `lc:llm:${runId}`,
      agent: "Model",
      call: model,
      startedAt: this.#now(),
      ignored: false,
    });
    this.#safe(() =>
      this.#emit({
        type: "step.start",
        step: buildAgentStep({
          id: `lc:llm:${runId}`,
          agent: "Model",
          call: model,
          state: "running",
          ...(prompts === undefined ? {} : { argsSummary: prompts }),
          provenance: { source: "vertex-ai" },
        }),
      }),
    );
  }

  override handleLLMStart(
    llm: unknown,
    prompts: string[],
    runId: string,
    _parentRunId?: string,
    _extraParams?: Record<string, unknown>,
    _tags?: string[],
    metadata?: Record<string, unknown>,
    runName?: string,
  ): void {
    // A chat model fires `handleChatModelStart` instead; both are wired so a
    // non-chat model (or a provider that changes which hook it calls) is traced
    // rather than silently dropped.
    if (!this.#includeLlm) return;
    if (this.#runs.has(runId)) return;
    const model = modelName(llm, metadata, runName);
    this.#track(runId, {
      stepId: `lc:llm:${runId}`,
      agent: "Model",
      call: model,
      startedAt: this.#now(),
      ignored: false,
    });
    this.#safe(() =>
      this.#emit({
        type: "step.start",
        step: buildAgentStep({
          id: `lc:llm:${runId}`,
          agent: "Model",
          call: model,
          state: "running",
          argsSummary: `prompts=${prompts.length}`,
          provenance: { source: "vertex-ai" },
        }),
      }),
    );
  }

  override handleLLMEnd(output: unknown, runId: string): void {
    const tracked = this.#runs.get(runId);
    if (tracked === undefined || tracked.ignored) return;

    const text = textOf(output);
    if (text.length > 0) this.#lastMessage = text;
    const usage = usageOf(output);

    this.#safe(() =>
      this.#emit({
        type: "step.completed",
        step: buildAgentStep({
          id: tracked.stepId,
          agent: tracked.agent,
          call: tracked.call,
          state: "done",
          durationMs: this.#now() - tracked.startedAt,
          ...(text.length === 0 ? {} : { result: { summary: truncate(text, MAX_SUMMARY) } }),
          ...(usage.length === 0 ? {} : { evidence: usage }),
          provenance: { source: "vertex-ai" },
        }),
      }),
    );
  }

  override handleLLMError(err: Error, runId: string): void {
    this.#fail(runId, err);
  }

  // ── internals ─────────────────────────────────────────────────────────────

  #track(runId: string, run: TrackedRun): void {
    this.#runs.set(runId, run);
  }

  #fail(runId: string, err: Error): void {
    const tracked = this.#runs.get(runId);
    if (tracked === undefined || tracked.ignored) return;
    this.#runs.delete(runId);
    const message = redactSecrets(err.message);
    this.#safe(() =>
      this.#emit({
        type: "step.completed",
        step: buildAgentStep({
          id: tracked.stepId,
          agent: tracked.agent,
          call: tracked.call,
          state: "failed",
          durationMs: this.#now() - tracked.startedAt,
          error: message,
          provenance: { source: sourceOf(tracked.call) },
        }),
      }),
    );
  }

  /** Redact, then truncate — never the reverse (a cut secret is still a secret). */
  #rawOf(output: unknown): string {
    const redacted = redactDeep(output, MAX_RAW);
    const text = typeof redacted === "string" ? redacted : JSON.stringify(redacted);
    return text.length > MAX_RAW ? `${text.slice(0, MAX_RAW)}…[truncated]` : text;
  }

  /** Never let a tracing bug surface as an agent failure. */
  #safe(fn: () => void): void {
    try {
      fn();
    } catch {
      // Swallowed deliberately: see the module doc, rule 2.
    }
  }

  /**
   * The LangGraph node name.
   *
   * `metadata.langgraph_node` is the only reliable source: `runName` is undefined
   * and `runType` carries the parent run id instead of a type. A pregel chain with
   * no node metadata is the compiled graph itself — the wrapper around the whole
   * run — and naming it would produce a step that merely duplicates the turn.
   */
  #nodeName(chain: unknown, metadata?: Record<string, unknown>, runName?: string): string | null {
    const fromMeta = metadata?.["langgraph_node"];
    if (typeof fromMeta === "string" && fromMeta.length > 0) return fromMeta;
    if (runName !== undefined && runName.length > 0) return runName;
    if (idIncludes(chain, PREGEL_SEGMENT)) return null;
    return lastIdSegment(chain);
  }
}

/** Whether a serialized runnable's `id` names a given namespace segment. */
export function idIncludes(value: unknown, segment: string): boolean {
  const id = (value as { id?: unknown } | null)?.id;
  return Array.isArray(id) && id.some((part) => part === segment);
}

/**
 * Unwrap a LangChain message envelope.
 *
 * A tool whose implementation returns a message hands the callback
 * `{ lc_serializable, lc_namespace, lc_kwargs, id, name, content }` — the runtime's
 * own bookkeeping wrapped around the payload in `content`. Summarising the envelope
 * puts `lc_namespace` in the UI's evidence rows and buries the actual answer, so the
 * payload is unwrapped first and the envelope is left to the `raw` field.
 */
export function unwrapEnvelope(output: unknown): unknown {
  if (output === null || typeof output !== "object" || Array.isArray(output)) return output;
  const record = output as Record<string, unknown>;
  const content = record["content"];
  if (typeof content !== "string") return output;
  const isEnvelope =
    "lc_serializable" in record || "lc_namespace" in record || "lc_kwargs" in record;
  if (!isEnvelope) return output;
  return parseLoose(content) ?? content;
}

/** JSON when it parses, otherwise the original string. */
function parseLoose(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

// ── pure helpers (exported for tests) ────────────────────────────────────────

/** Last segment of a serialized runnable's `id`, which is the closest thing to a name. */
export function lastIdSegment(value: unknown): string | null {
  const id = (value as { id?: unknown } | null)?.id;
  if (!Array.isArray(id) || id.length === 0) return null;
  const last = id[id.length - 1];
  return typeof last === "string" && last.length > 0 ? last : null;
}

/** `handleToolStart` hands us a JSON string; anything else is not an object of args. */
export function parseJsonObject(input: unknown): Record<string, unknown> | null {
  if (typeof input !== "string") {
    return typeof input === "object" && input !== null ? (input as Record<string, unknown>) : null;
  }
  try {
    const parsed: unknown = JSON.parse(input);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** One-line echo of a tool's arguments — never the raw JSON blob. */
export function compactSummary(args: Record<string, unknown>): string {
  return Object.entries(args)
    .slice(0, 8)
    .map(([key, value]) => `${key}=${scalarToText(value)}`)
    .join(" · ")
    .slice(0, MAX_FIELD);
}

function scalarToText(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.length}]`;
  return "{…}";
}

/**
 * A one-line assertion from a tool's actual output.
 *
 * Preference order is deliberate: a field the tool itself named (`summary`,
 * `answer`) beats anything this module could compose, and when no such field
 * exists the count is stated rather than embellished.
 */
export function summariseOutput(output: unknown): string {
  const unwrapped = unwrapEnvelope(output);
  if (unwrapped === null || unwrapped === undefined) return "no output";
  if (typeof unwrapped === "string") return truncate(redactSecrets(unwrapped), MAX_SUMMARY);
  if (typeof unwrapped === "number" || typeof unwrapped === "boolean") return String(unwrapped);
  if (Array.isArray(unwrapped)) {
    return `${unwrapped.length} row${unwrapped.length === 1 ? "" : "s"}`;
  }

  const record = unwrapped as Record<string, unknown>;
  for (const key of SUMMARY_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) {
      return truncate(redactSecrets(value), MAX_SUMMARY);
    }
  }
  const scalars = Object.entries(record).filter(
    ([, value]) => typeof value === "string" || typeof value === "number" || typeof value === "boolean",
  );
  if (scalars.length > 0) return truncate(compactSummary(Object.fromEntries(scalars)), MAX_SUMMARY);
  return `${Object.keys(record).length} fields`;
}

/** The output's own fields, as evidence rows — redacted and bounded. */
export function evidenceFrom(output: unknown): { label: string; value: string }[] {
  const unwrapped = unwrapEnvelope(output);
  if (unwrapped === null || unwrapped === undefined) return [];
  if (typeof unwrapped !== "object") {
    return [{ label: "result", value: truncate(redactSecrets(String(unwrapped)), MAX_FIELD) }];
  }
  if (Array.isArray(unwrapped)) {
    return [{ label: "rows", value: String(unwrapped.length) }];
  }
  return Object.entries(unwrapped as Record<string, unknown>)
    // `lc_*` is LangChain's own bookkeeping; it is not evidence about the trade.
    .filter(([label]) => !label.startsWith("lc_"))
    .slice(0, MAX_EVIDENCE_ROWS)
    .map(([label, value]) => ({
      label: truncate(label, 40),
      value: truncate(renderValue(value), MAX_FIELD),
    }));
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return redactSecrets(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const redacted = redactDeep(value, MAX_FIELD);
  return typeof redacted === "string" ? redacted : JSON.stringify(redacted);
}

/** Token accounting, which is the honest numeric evidence a model call has. */
export function usageOf(output: unknown): { label: string; value: string }[] {
  const usage = (output as { llmOutput?: { tokenUsage?: Record<string, unknown> } } | null)?.llmOutput
    ?.tokenUsage;
  const rows: { label: string; value: string }[] = [];
  if (usage !== undefined && usage !== null) {
    for (const [key, value] of Object.entries(usage)) {
      if (typeof value === "number") rows.push({ label: camelToWords(key), value: String(value) });
    }
  }
  if (rows.length > 0) return rows;

  // Chat models report usage on the message instead.
  const meta = (
    output as { generations?: { message?: { usage_metadata?: Record<string, unknown> } }[][] } | null
  )?.generations?.[0]?.[0]?.message?.usage_metadata;
  if (meta === undefined || meta === null) return [];
  for (const [key, value] of Object.entries(meta)) {
    if (typeof value === "number") rows.push({ label: camelToWords(key), value: String(value) });
  }
  return rows;
}

/** The model's own text, for the turn's prose. */
export function textOf(output: unknown): string {
  const generations = (output as { generations?: unknown } | null)?.generations;
  if (!Array.isArray(generations)) return "";
  const first = generations[0];
  if (!Array.isArray(first)) return "";
  const candidate = first[0] as { text?: unknown; message?: { content?: unknown } } | undefined;
  if (candidate === undefined) return "";
  if (typeof candidate.text === "string") return candidate.text;
  const content = candidate.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : ""))
      .filter((part) => part.length > 0)
      .join("");
  }
  return "";
}

export function modelName(
  llm: unknown,
  metadata?: Record<string, unknown>,
  runName?: string,
): string {
  const fromMeta = metadata?.["ls_model_name"];
  if (typeof fromMeta === "string" && fromMeta.length > 0) return fromMeta;
  if (runName !== undefined && runName.length > 0) return runName;
  return lastIdSegment(llm) ?? "model";
}

function keysOf(outputs: unknown): string[] {
  if (outputs === null || typeof outputs !== "object" || Array.isArray(outputs)) return [];
  return Object.keys(outputs as Record<string, unknown>);
}

/** `messari_lending_pools` → `Messari Lending Pools`. */
export function prettyAgent(name: string): string {
  return name
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
    .split(" ")
    .filter((word) => word.length > 0)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ")
    .slice(0, 60);
}

function sourceOf(name: string): string {
  const [head] = name.split(/[.:]/);
  return head !== undefined && head.length > 0 ? head : name;
}

function camelToWords(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase();
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
