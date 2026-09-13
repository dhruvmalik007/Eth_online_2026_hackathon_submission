/**
 * The agent port — our seam over `packages/langchain`.
 *
 * The service never calls `runV01` or `DeepGraphAgent` directly; it calls this
 * port. That keeps the orchestration, event emission and policy in-one-place and
 * lets the whole pipeline be tested offline against a deterministic script
 * (`MockAgentPort`) without a model, a database or a network.
 */
import type { RunState } from "@ethonline2026/execution-domain";
import type { AgentMode, InferenceEventInput } from "../events/contract.js";
import type { SandboxProvider } from "../sandbox/SandboxProvider.js";
import type { CustodySigningPort } from "../web3/CustodySigningPort.js";

export interface AgentRequest {
  readonly query: string;
  readonly mode: AgentMode;
  readonly pools: readonly string[];
  readonly protocols: readonly string[];
  readonly horizonDays: number;
  /** `dry` must perform zero model calls. */
  readonly dry: boolean;
}

export interface AgentRunContext {
  readonly emit: (event: InferenceEventInput) => void;
  readonly signal: AbortSignal;
  readonly sandbox: SandboxProvider;
  /**
   * The signing path.
   *
   * Injected rather than imported so the agent asks custody for a *real* intent
   * instead of assembling one itself — which is what makes the emitted intent
   * carry real calldata and a real `safeTxHash` rather than a fixture.
   */
  readonly custody: CustodySigningPort;
  readonly userId: string;
  readonly sessionId: string;
  readonly runId: string;
}

export interface AgentRunOutcome {
  readonly summary: string;
  /** Where the run should land. `awaiting_user` when an approval is pending. */
  readonly state: RunState;
}

export interface AgentPort {
  readonly id: AgentMode;
  run(request: AgentRequest, context: AgentRunContext): Promise<AgentRunOutcome>;
}
