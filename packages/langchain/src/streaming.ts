/**
 * Callback plumbing for observing a real agent run.
 *
 * `runV01` and `DeepGraphAgent` are the two entry points a host drives, and both
 * need to hand LangChain a callback list so the host can stream what the agent
 * actually did — which tool it called, what the tool returned, which model ran.
 * That list lives here so the two entry points agree on the shape, and so passing
 * nothing stays a no-op: every existing caller is unchanged.
 */
import type { Callbacks } from "@langchain/core/callbacks/manager";
import type { RunnableConfig } from "@langchain/core/runnables";

export interface AgentInvokeOptions {
  /** LangChain callbacks — the host's window into real steps and tool results. */
  readonly callbacks?: Callbacks;
  /** Cancels the run. Cloud Run sends SIGTERM before it reclaims an instance. */
  readonly signal?: AbortSignal;
}

/**
 * Build the config for an agent invocation, omitting absent keys.
 *
 * Omission rather than an explicit `undefined` matters: `RunnableConfig` is read
 * under `exactOptionalPropertyTypes`, where passing `callbacks: undefined` is not
 * the same as passing no callbacks at all.
 */
export function invokeConfig(options: AgentInvokeOptions): RunnableConfig {
  return {
    ...(options.callbacks === undefined ? {} : { callbacks: options.callbacks }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  };
}
