/**
 * The real agent, behind the same port as the mock.
 *
 * Two modes, each doing what it is built for:
 *
 * - **`deep`** — `DeepGraphAgent`, the deepagents tool-calling harness. Free-form
 *   questions; every tool call and its result is a step.
 * - **`v01`** — `runV01`, the 5-node LangGraph cycle. A mandate becomes real
 *   forecasts, real protocol constraints and real readjustment decisions.
 *
 * ## Where the steps come from
 *
 * From `AgentTraceHandler`, which converts LangChain's own callbacks into
 * `InferenceEvent`s. Nothing here reconstructs a step after the fact, and nothing
 * writes a step the agent did not cause — which is the whole point of this port
 * existing rather than the fixture it replaces.
 *
 * The handler is deliberately *not* also a LangSmith client: `TurnTrace` already
 * subscribes to this same emitter and builds the trace tree, so a second client
 * here would double-trace every step.
 *
 * ## What this port does not do yet
 *
 * `v01` produces no signing intent. A `ReadjustmentAction` carries `protocol` and
 * `amountPercentage` and nothing else — no chain, no token, no address — so there
 * is no honest way to turn one into a Safe leg until the protocol→address mapping
 * exists (plan task E2). Emitting a plausible-looking intent here would be exactly
 * the fabrication this service is built to avoid, so the decisions are emitted as
 * steps with their real rationale and citations, and the run lands in `ranked`.
 */
import type { RunState } from "@ethonline2026/execution-domain";
import {
  DeepGraphAgent,
  buildV01Deps,
  runV01,
  type V01State,
  type YieldProjection,
} from "@ethonline2026/langchain-agent";
import type { AgentMode, Widget } from "../events/contract.js";
import { AgentTraceHandler } from "../observability/agentCallbacks.js";
import { redactSecrets } from "../observability/redact.js";
import type { AgentPort, AgentRequest, AgentRunContext, AgentRunOutcome } from "./AgentPort.js";
import { buildAgentStep } from "./eventMapper.js";

/** A readjustment decision, taken from the graph's own state type. */
type Decision = V01State["readjustmentDecisions"][number];

/** At most this many forecast widgets per turn, so a wide mandate cannot flood the stream. */
const MAX_FORECAST_WIDGETS = 3;
/** Chunk size for `message.delta`, chosen to keep the UI's typewriter smooth. */
const MESSAGE_CHUNK = 240;

export interface LangchainAgentOptions {
  /** `v01` runs the LangGraph cycle; `deep` runs the tool-calling harness. */
  readonly mode: AgentMode;
  /**
   * A pre-built deep agent. Injected so a test can drive the port without Vertex,
   * and so a warm runtime can reuse one agent across turns.
   */
  readonly deepAgent?: DeepGraphAgent;
  /** Forwarded to `buildV01Deps` — how a host supplies its own runner or fakes. */
  readonly v01Deps?: Parameters<typeof buildV01Deps>[0];
  /** One step per model call. On by default: those calls are agentic work. */
  readonly includeLlmSteps?: boolean;
  /** Injectable clock for deterministic duration assertions. */
  readonly now?: () => number;
}

export class LangchainAgentPort implements AgentPort {
  readonly id: AgentMode;

  readonly #options: LangchainAgentOptions;
  /** Built lazily: constructing one loads a model client, which a dry run must not. */
  #deepAgent: DeepGraphAgent | null = null;
  #v01Deps: ReturnType<typeof buildV01Deps> | null = null;

  constructor(options: LangchainAgentOptions) {
    this.id = options.mode;
    this.#options = options;
  }

  async run(request: AgentRequest, context: AgentRunContext): Promise<AgentRunOutcome> {
    // `dry` means zero model calls. The runtime routes it to the mock, so reaching
    // here in dry mode is a wiring bug worth failing loudly on.
    if (request.dry) {
      throw new Error(
        "The live agent cannot serve a dry run: `dry` must perform no model calls. " +
          "Route dry turns to the deterministic script instead.",
      );
    }

    const handler = new AgentTraceHandler({
      emit: (event) => context.emit(event),
      includeLlmSteps: this.#options.includeLlmSteps ?? true,
      ...(this.#options.now === undefined ? {} : { now: this.#options.now }),
    });

    return this.#options.mode === "deep"
      ? await this.#runDeep(request, context, handler)
      : await this.#runV01(request, context, handler);
  }

  // ── deepagents: tool calls and their results ───────────────────────────────

  async #runDeep(
    request: AgentRequest,
    context: AgentRunContext,
    handler: AgentTraceHandler,
  ): Promise<AgentRunOutcome> {
    const agent = this.#options.deepAgent ?? (this.#deepAgent ??= new DeepGraphAgent({}));
    const result = await agent.invoke(request.query, 2, {
      callbacks: [handler],
      signal: context.signal,
    });

    // The prose is the model's own output, never a paraphrase assembled here.
    const text = textFromResult(result) ?? handler.lastMessage;
    if (text.trim().length > 0) {
      for (const chunk of chunks(text, MESSAGE_CHUNK)) {
        context.emit({ type: "message.delta", messageId: `msg-${context.runId}`, text: chunk });
      }
      context.emit({
        type: "message.completed",
        messageId: `msg-${context.runId}`,
        text,
      });
    }

    return {
      summary: firstLine(text) || `${request.mode} run finished with no textual result.`,
      state: "ranked" satisfies RunState,
    };
  }

  // ── v01: the LangGraph cycle ───────────────────────────────────────────────

  async #runV01(
    request: AgentRequest,
    context: AgentRunContext,
    handler: AgentTraceHandler,
  ): Promise<AgentRunOutcome> {
    // `V01Input` requires at least one protocol and one pool, so a vague prompt
    // cannot start the cycle. Saying so beats inventing a universe to analyse.
    if (request.protocols.length === 0 || request.pools.length === 0) {
      throw new Error(
        `The v01 cycle needs at least one protocol and one pool (got protocols=${request.protocols.length}, pools=${request.pools.length}). ` +
          "Name the protocols and pools in the mandate, or resolve them from the deployment registry first.",
      );
    }

    this.#v01Deps ??= buildV01Deps(this.#options.v01Deps ?? {});
    const state = await runV01(
      this.#v01Deps,
      {
        mandate: request.query,
        protocols: [...request.protocols],
        poolIds: [...request.pools],
        horizonDays: request.horizonDays,
      },
      { callbacks: [handler], signal: context.signal },
    );

    for (const widget of this.#widgetsFrom(state, request)) {
      context.emit({ type: "widget", widget });
    }
    for (const [index, decision] of state.readjustmentDecisions.entries()) {
      context.emit({ type: "step.completed", step: decisionStep(decision, index) });
    }

    const summary = this.#summarise(state);
    for (const chunk of chunks(summary, MESSAGE_CHUNK)) {
      context.emit({ type: "message.delta", messageId: `msg-${context.runId}`, text: chunk });
    }
    context.emit({ type: "message.completed", messageId: `msg-${context.runId}`, text: summary });

    return { summary, state: "ranked" satisfies RunState };
  }

  /** The widgets the UI already renders, filled from the run's real state. */
  #widgetsFrom(state: V01State, request: AgentRequest): Widget[] {
    const widgets: Widget[] = [];

    for (const projection of state.yieldProjections.slice(0, MAX_FORECAST_WIDGETS)) {
      const point = projection.steps.map((step) => step.q50);
      const q10 = projection.steps.map((step) => step.q10);
      const q90 = projection.steps.map((step) => step.q90);
      if (point.length === 0) continue;
      widgets.push({
        kind: "forecast",
        protocol: protocolFor(projection, request.protocols),
        metric: projection.target,
        horizonDays: projection.horizonDays,
        point,
        q10,
        q90,
        model: projection.model,
        provenance: projection.forecastRunId ?? null,
      });
    }

    const risk = state.riskProfile;
    if (risk !== null && risk.factors.length > 0) {
      widgets.push({
        kind: "risk",
        verdict:
          state.riskAssessment.replanNeeded
            ? `re-plan required: ${state.riskAssessment.reasons.join("; ")}`
            : `${risk.chainName} · ${risk.volatilitySource} volatility`,
        factors: risk.factors.map((factor) => ({
          sym: factor.name,
          label: factor.name,
          value: String(factor.value),
          interp: factor.explanation,
        })),
      });
    }

    return widgets;
  }

  /**
   * A factual turn summary, composed only from counted state.
   *
   * This is the one place prose is assembled rather than received, so it states
   * counts and decisions and nothing else — no adjective the data cannot support.
   */
  #summarise(state: V01State): string {
    const parts: string[] = [
      `Parsed ${state.protocolConstraints.length} constraint(s) from ${state.rawProtocolRules.length} rule doc(s)`,
      `projected ${state.yieldProjections.length} series over ${state.poolIds.length} pool(s)`,
    ];
    if (state.evidence.length > 0) parts.push(`retrieved ${state.evidence.length} evidence chunk(s)`);
    if (state.replanCount > 0) parts.push(`re-planned ${state.replanCount}×`);

    const decisions = state.readjustmentDecisions;
    parts.push(
      decisions.length === 0
        ? "no readjustment proposed"
        : `${decisions.length} decision(s): ${decisions
            .map((decision) => `${decision.action} ${decision.amountPercentage}% ${decision.protocol}`)
            .join("; ")}`,
    );
    if (state.riskAssessment.replanNeeded) {
      parts.push(`risk flagged a re-plan: ${state.riskAssessment.reasons.join("; ")}`);
    }
    if (state.riskAssessment.suspiciousProjections.length > 0) {
      parts.push(`${state.riskAssessment.suspiciousProjections.length} suspicious projection(s)`);
    }
    return `${parts.join("; ")}.`;
  }
}

/**
 * One decision, as a step.
 *
 * The reasoning is the model's own `rationale` and the citations are the graph's
 * own ids — the two fields that make a decision auditable rather than assertive.
 */
export function decisionStep(decision: Decision, index: number) {
  const parameters = Object.entries(decision.parameters).map(([label, value]) => ({
    label,
    value: String(value),
  }));
  return buildAgentStep({
    id: `decision-${index}`,
    agent: "Readjustment Engine",
    call: `decision.${decision.action}`,
    argsSummary: `${decision.protocol} · ${decision.amountPercentage}%`,
    state: "done",
    reasoning: [decision.rationale],
    evidence: [
      { label: "action", value: decision.action },
      { label: "protocol", value: decision.protocol },
      { label: "size", value: `${decision.amountPercentage}%` },
      { label: "citations", value: decision.citations.join(", ") },
      ...parameters,
    ],
    result: { summary: `${decision.action} ${decision.amountPercentage}% on ${decision.protocol}` },
    provenance: { source: "v01.readjustment" },
  });
}

/**
 * The protocol a projection's pool belongs to.
 *
 * `YieldProjection` carries a `poolId` and no protocol, and the widget renders a
 * protocol label, so the requested protocol whose name appears in the pool id is
 * used. When none or several match, the pool id is shown instead of guessing.
 */
export function protocolFor(projection: YieldProjection, protocols: readonly string[]): string {
  const pool = projection.poolId.toLowerCase();
  const matches = protocols.filter((protocol) => pool.includes(protocol.toLowerCase()));
  return matches.length === 1 ? matches[0]! : projection.poolId;
}

/**
 * The model's text out of a deepagents result.
 *
 * The harness returns a state object rather than a string, so the last message is
 * read from `messages`. An unrecognised shape returns `null` and the caller falls
 * back to the handler's captured output rather than stringifying a state blob.
 */
export function textFromResult(result: unknown): string | null {
  if (typeof result === "string") return result;
  if (result === null || typeof result !== "object") return null;

  const messages = (result as { messages?: unknown }).messages;
  if (Array.isArray(messages) && messages.length > 0) {
    const last = messages[messages.length - 1] as { content?: unknown } | undefined;
    const content = last?.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      const joined = content
        .map((part) => {
          if (typeof part === "string") return part;
          const text = (part as { text?: unknown } | null)?.text;
          return typeof text === "string" ? text : "";
        })
        .join("");
      if (joined.length > 0) return joined;
    }
  }
  return null;
}

export function chunks(text: string, size: number): string[] {
  const out: string[] = [];
  for (let index = 0; index < text.length; index += size) {
    out.push(text.slice(index, index + size));
  }
  return out.length === 0 ? [""] : out;
}

export function firstLine(text: string): string {
  const line = text.split("\n").find((candidate) => candidate.trim().length > 0) ?? "";
  const trimmed = line.trim();
  return redactSecrets(trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed);
}
