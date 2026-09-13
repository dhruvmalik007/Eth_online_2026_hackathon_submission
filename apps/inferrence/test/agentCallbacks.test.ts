/**
 * Guard tests for the module that replaces `lib/agent-traces.ts`.
 *
 * These assert the two properties the whole de-mocking effort rests on: a step
 * exists only because a real callback fired, and the fields it carries come from
 * what the callback actually received — not from a fixture.
 *
 * The argument shapes asserted here were captured from the installed versions
 * (`@langchain/core` 1.2.9, `@langchain/langgraph` 1.4.14). The surprising ones —
 * the tool name living in `runName`, the JSON-string tool input, the node name in
 * `metadata.langgraph_node` — are documented in the module under test, because
 * reading the obvious field yields a trace that looks fine and is empty.
 */
import { RunnableLambda } from "@langchain/core/runnables";
import { tool } from "@langchain/core/tools";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { AgentStep } from "../src/events/agentStep.js";
import type { InferenceEventInput } from "../src/events/contract.js";
import {
  AgentTraceHandler,
  compactSummary,
  evidenceFrom,
  parseJsonObject,
  summariseOutput,
  unwrapEnvelope,
} from "../src/observability/agentCallbacks.js";

const SECRET = `0x${"ab".repeat(32)}`;

function collector(): {
  events: InferenceEventInput[];
  emit: (event: InferenceEventInput) => void;
  steps: () => AgentStep[];
} {
  const events: InferenceEventInput[] = [];
  return {
    events,
    emit: (event) => events.push(event),
    steps: () =>
      events
        .filter(
          (event): event is Extract<InferenceEventInput, { type: "step.start" | "step.completed" }> =>
            event.type === "step.start" || event.type === "step.completed",
        )
        .map((event) => event.step),
  };
}

function handlerFor(emit: (event: InferenceEventInput) => void): AgentTraceHandler {
  let clock = 1_000;
  return new AgentTraceHandler({
    emit,
    now: () => (clock += 25),
  });
}

describe("AgentTraceHandler — tools", () => {
  it("takes the tool's real name and its real return value", async () => {
    const { emit, steps } = collector();
    const probe = tool(
      async ({ pool, limit }: { pool: string; limit: number }) => ({
        answer: `${limit} rows for ${pool}`,
        rows: [{ poolId: pool, apy: 0.0431 }],
      }),
      {
        name: "messari_lending_pools",
        description: "Read lending pools from a Messari subgraph.",
        schema: z.object({ pool: z.string(), limit: z.number() }),
      },
    );

    await probe.invoke({ pool: "aave-v3-base", limit: 5 }, { callbacks: [handlerFor(emit)] });

    const started = steps().find((step) => step.state === "running");
    const finished = steps().find((step) => step.state === "done");

    // `tool.name` does NOT carry this — the 7th callback argument does.
    expect(started?.call).toBe("messari_lending_pools");
    expect(started?.agent).toBe("Messari Lending Pools");
    // The input arrives as a JSON string, so a compacted echo proves it was parsed.
    expect(started?.argsSummary).toContain("pool=aave-v3-base");
    expect(started?.argsSummary).toContain("limit=5");

    // The result is the tool's own output, not a description of it.
    expect(finished?.result?.summary).toBe("5 rows for aave-v3-base");
    expect(finished?.evidence?.map((row) => row.label)).toEqual(["answer", "rows"]);
    expect(finished?.evidence?.[1]?.value).toContain("aave-v3-base");
    expect(finished?.durationMs).toBeGreaterThan(0);
    // The full output is kept for the drawer, not dropped.
    expect(finished?.raw).toContain("aave-v3-base");
  });

  it("reports a failing tool as a failed step carrying its error", async () => {
    const { emit, steps } = collector();
    const failing = tool(
      async () => {
        throw new Error("upstream subgraph returned 503");
      },
      { name: "messari_volatile", description: "fails", schema: z.object({}) },
    );

    await failing.invoke({}, { callbacks: [handlerFor(emit)] }).catch(() => undefined);

    const finished = steps().find((step) => step.state === "failed");
    expect(finished?.call).toBe("messari_volatile");
    expect(finished?.error).toBe("upstream subgraph returned 503");
  });

  it("traces a tool called inside a chain, as an agent runtime calls one", async () => {
    const { emit, steps } = collector();
    const handler = handlerFor(emit);
    const probe = tool(async () => ({ answer: "ok" }), {
      name: "messari_probe",
      description: "ok",
      schema: z.object({}),
    });
    // A tool is traced when it inherits the run's callbacks, which is how an agent
    // runtime invokes it. A tool invoked with no config is invisible to callbacks —
    // worth pinning, because it is the difference between a real trace and a gap.
    const chain = RunnableLambda.from(async () => ({
      out: await probe.invoke({}, { callbacks: [handler] }),
    }));

    await chain.invoke({}, { callbacks: [handler] });

    const toolSteps = steps().filter((step) => step.call === "messari_probe");
    expect(toolSteps.map((step) => step.state)).toEqual(["running", "done"]);
    expect(toolSteps[1]?.result?.summary).toBe("ok");
  });

  it("redacts a secret in a tool's output, and does so before truncating", async () => {
    const { emit, steps } = collector();
    const leaky = tool(
      // The secret sits early enough that truncating first would leave a prefix.
      async () => ({ summary: `key=${SECRET} ${"x".repeat(400)}` }),
      { name: "messari_leaky", description: "leaks", schema: z.object({}) },
    );

    await leaky.invoke({}, { callbacks: [handlerFor(emit)] });

    const finished = steps().find((step) => step.state === "done");
    const serialised = JSON.stringify(finished);
    expect(finished?.result?.summary).toContain("[redacted-key]");
    expect(serialised).not.toContain(SECRET);
  });
});

describe("AgentTraceHandler — LangGraph nodes", () => {
  it("names a node from metadata.langgraph_node and completes it with its own outputs", () => {
    const { emit, steps } = collector();
    const handler = handlerFor(emit);

    // The exact metadata LangGraph 1.4.14 passes for a node run: `runName` is
    // undefined and `runType` holds the parent run id, so this is the only name.
    handler.handleChainStart(
      { id: ["langchain_core", "runnables", "RunnableSequence"] },
      { mandate: "supply USDC" },
      "lc-run-1",
      "parent-run-id",
      [],
      { langgraph_node: "ingestion", langgraph_step: 1 },
      undefined,
    );
    handler.handleChainEnd({ rawProtocolRules: [], audit: [] }, "lc-run-1");

    expect(steps().map((step) => step.call)).toEqual(["ingestion", "ingestion"]);
    expect(steps()[1]?.state).toBe("done");
    expect(steps()[1]?.evidence?.[0]?.value).toBe("rawProtocolRules, audit");
    expect(steps()[1]?.provenance?.source).toBe("langgraph");
  });

  it("emits nothing for LangGraph's internal nodes", () => {
    const { emit, steps } = collector();
    const handler = handlerFor(emit);

    for (const internal of ["__start__", "__end__", "LangGraph"]) {
      handler.handleChainStart(
        { id: ["langgraph", "pregel", "CompiledStateGraph"] },
        {},
        `lc-${internal}`,
        undefined,
        [],
        { langgraph_node: internal },
        undefined,
      );
      handler.handleChainEnd({}, `lc-${internal}`);
    }

    expect(steps()).toEqual([]);
  });

  it("emits nothing for the compiled graph that wraps the whole run", () => {
    const { emit, steps } = collector();
    const handler = handlerFor(emit);

    // The root graph has no `langgraph_node` metadata — its id is what identifies it,
    // and a step for it would merely duplicate the turn.
    handler.handleChainStart(
      { id: ["langgraph", "pregel", "CompiledStateGraph"] },
      {},
      "lc-graph",
      undefined,
      [],
      undefined,
      undefined,
    );
    handler.handleChainEnd({}, "lc-graph");

    expect(steps()).toEqual([]);
  });

  it("emits nothing for a run tagged langsmith:hidden", () => {
    const { emit, steps } = collector();
    const handler = handlerFor(emit);

    handler.handleChainStart(
      { id: ["langchain_core", "runnables", "RunnableSequence"] },
      {},
      "lc-hidden",
      undefined,
      ["langsmith:hidden"],
      { langgraph_node: "ingestion" },
      undefined,
    );

    expect(steps()).toEqual([]);
  });
});

describe("AgentTraceHandler — models", () => {
  it("records one step per model call with its token usage as evidence", () => {
    const { emit, steps } = collector();
    const handler = handlerFor(emit);

    handler.handleChatModelStart(
      { id: ["langchain", "chat_models", "ChatVertexAI"] },
      [[{ role: "user" }]],
      "lc-llm-1",
      undefined,
      {},
      [],
      { ls_model_name: "gemini-2.5-flash" },
      undefined,
    );
    handler.handleLLMEnd(
      {
        generations: [[{ text: "Allocate 40% to Aave." }]],
        llmOutput: { tokenUsage: { promptTokens: 812, completionTokens: 96 } },
      },
      "lc-llm-1",
    );

    expect(steps()[0]?.call).toBe("gemini-2.5-flash");
    expect(steps()[0]?.argsSummary).toBe("messages=1");
    expect(steps()[1]?.result?.summary).toBe("Allocate 40% to Aave.");
    expect(steps()[1]?.evidence?.map((row) => row.label)).toEqual([
      "prompt tokens",
      "completion tokens",
    ]);
    // The model's own text is what the port streams as the turn's prose.
    expect(handler.lastMessage).toBe("Allocate 40% to Aave.");
  });

  it("reports a model error as a failed step", () => {
    const { emit, steps } = collector();
    const handler = handlerFor(emit);

    handler.handleChatModelStart({ id: ["x", "ChatVertexAI"] }, [[]], "lc-llm-2", undefined, {}, [], {}, undefined);
    handler.handleLLMError(new Error("429 quota exceeded"), "lc-llm-2");

    expect(steps()[1]?.state).toBe("failed");
    expect(steps()[1]?.error).toBe("429 quota exceeded");
  });
});

describe("agent callback helpers", () => {
  it("parses the JSON-string argument a tool start receives", () => {
    expect(parseJsonObject('{"pool":"aave","limit":5}')).toEqual({ pool: "aave", limit: 5 });
    // A non-JSON payload must not throw into the agent.
    expect(parseJsonObject("not json")).toBeNull();
    expect(parseJsonObject(null)).toBeNull();
  });

  it("prefers a field the tool itself named when summarising", () => {
    expect(summariseOutput({ answer: "5 rows", rows: [1, 2] })).toBe("5 rows");
    expect(summariseOutput("plain text")).toBe("plain text");
    expect(summariseOutput([1, 2, 3])).toBe("3 rows");
    expect(summariseOutput({ a: 1, b: 2 })).toBe("a=1 · b=2");
    expect(summariseOutput(null)).toBe("no output");
  });

  it("unwraps a LangChain message envelope rather than showing its bookkeeping", () => {
    // The shape a tool returns when its implementation returns a message: the real
    // payload is in `content`, and the rest is runtime bookkeeping.
    const envelope = {
      lc_serializable: true,
      lc_namespace: ["langchain_core", "messages"],
      lc_kwargs: { content: "…" },
      id: null,
      name: "getLendingReserves",
      content: JSON.stringify({ protocol: "Aave V3", totalReserves: 10, avgSupplyAPY: 1.063 }),
    };

    expect(unwrapEnvelope(envelope)).toEqual({
      protocol: "Aave V3",
      totalReserves: 10,
      avgSupplyAPY: 1.063,
    });
    expect(summariseOutput(envelope)).toBe(
      "protocol=Aave V3 · totalReserves=10 · avgSupplyAPY=1.063",
    );
    // No `lc_*` row: that is not evidence about the trade.
    expect(evidenceFrom(envelope).map((row) => row.label)).toEqual([
      "protocol",
      "totalReserves",
      "avgSupplyAPY",
    ]);
    // A plain object with a `content` string is payload, not an envelope.
    expect(unwrapEnvelope({ content: "hello", other: 1 })).toEqual({ content: "hello", other: 1 });
  });

  it("compacts arguments without echoing a raw JSON blob", () => {
    expect(compactSummary({ pool: "aave", limit: 5, nested: { deep: true } })).toBe(
      "pool=aave · limit=5 · nested={…}",
    );
  });
});
