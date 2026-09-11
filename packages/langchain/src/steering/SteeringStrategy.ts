/**
 * Steering strategy interface.
 * Defines how the agent decides its next action based on context and tool results.
 *
 * SOLID: Interface Segregation — single method interface.
 * SOLID: Dependency Inversion — agents depend on this abstraction.
 */

export interface ToolResult {
  readonly success: boolean;
  readonly data?: unknown;
  readonly error?: string;
  readonly toolName: string;
  readonly durationMs: number;
}

export interface Message {
  readonly role: 'user' | 'assistant' | 'system' | 'tool';
  readonly content: string;
  readonly toolCallId?: string;
  readonly toolName?: string;
}

export interface AgentContext {
  readonly messages: Message[];
  readonly currentStep: string;
  readonly toolResults: Map<string, ToolResult>;
  readonly metadata: Record<string, unknown>;
}

export type SteeringAction =
  | { type: 'continue'; nextTool?: string; toolInput?: unknown }
  | { type: 'synthesize' }
  | { type: 'stop'; reason: string }
  | { type: 'retry'; tool: string; toolInput?: unknown };

export interface SteeringDecision {
  readonly action: SteeringAction;
  readonly reasoning: string;
  readonly confidence: number; // 0-1
}

/**
 * Steering strategy interface.
 * Implementations determine how the agent navigates multi-step workflows.
 */
export interface SteeringStrategy {
  readonly name: string;

  /**
   * Decide the next action based on current context and tool results.
   */
  steer(context: AgentContext, lastResult?: ToolResult): Promise<SteeringDecision>;

  /**
   * Reset strategy state for new agent runs.
   */
  reset(): void;
}

/**
 * Base steering strategy with common functionality.
 */
export abstract class BaseSteeringStrategy implements SteeringStrategy {
  abstract readonly name: string;
  protected context: AgentContext | null = null;

  async steer(context: AgentContext, lastResult?: ToolResult): Promise<SteeringDecision> {
    this.context = context;
    return this.makeDecision(context, lastResult);
  }

  reset(): void {
    this.context = null;
  }

  protected abstract makeDecision(
    context: AgentContext,
    lastResult?: ToolResult,
  ): Promise<SteeringDecision>;
}
