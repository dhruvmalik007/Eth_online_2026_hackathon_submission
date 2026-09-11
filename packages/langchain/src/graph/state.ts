import { SystemMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';

/**
 * LangGraph state schema for the agentic workflow.
 * Tracks messages, tool results, Greeks, and risk metrics throughout execution.
 */

export interface GreekValues {
  readonly delta: number | null;
  readonly gamma: number | null;
  readonly vega: number | null;
  readonly theta: number | null;
  readonly rho: number | null;
}

export interface RiskMetrics {
  readonly var95: number | null;
  readonly var99: number | null;
  readonly expectedShortfall: number | null;
  readonly mertonPD: number | null;
  readonly dv01: number | null;
  readonly duration: number | null;
  readonly convexity: number | null;
}

export interface ToolResult {
  readonly toolName: string;
  readonly success: boolean;
  readonly data?: unknown;
  readonly error?: string;
  readonly durationMs: number;
}

export interface AgentState {
  readonly messages: BaseMessage[];
  readonly currentStep: string;
  readonly toolResults: Record<string, ToolResult>;
  readonly greeks: GreekValues;
  readonly riskMetrics: RiskMetrics;
  readonly nextAction: string;
  readonly metadata: Record<string, unknown>;
}

/**
 * Create initial agent state.
 */
export function createInitialState(systemPrompt?: string): AgentState {
  const messages: BaseMessage[] = [];

  if (systemPrompt) {
    messages.push(new SystemMessage(systemPrompt));
  }

  return {
    messages,
    currentStep: 'init',
    toolResults: {},
    greeks: {
      delta: null,
      gamma: null,
      vega: null,
      theta: null,
      rho: null,
    },
    riskMetrics: {
      var95: null,
      var99: null,
      expectedShortfall: null,
      mertonPD: null,
      dv01: null,
      duration: null,
      convexity: null,
    },
    nextAction: '',
    metadata: {},
  };
}

/**
 * Update state with a new message.
 */
export function addMessage(state: AgentState, message: BaseMessage): AgentState {
  return {
    ...state,
    messages: [...state.messages, message],
  };
}

/**
 * Update state with a tool result.
 */
export function addToolResult(state: AgentState, toolName: string, result: ToolResult): AgentState {
  return {
    ...state,
    toolResults: {
      ...state.toolResults,
      [toolName]: result,
    },
  };
}

/**
 * Update state with Greek values.
 */
export function updateGreeks(state: AgentState, greeks: Partial<GreekValues>): AgentState {
  return {
    ...state,
    greeks: {
      ...state.greeks,
      ...greeks,
    },
  };
}

/**
 * Update state with risk metrics.
 */
export function updateRiskMetrics(state: AgentState, metrics: Partial<RiskMetrics>): AgentState {
  return {
    ...state,
    riskMetrics: {
      ...state.riskMetrics,
      ...metrics,
    },
  };
}

/**
 * Update current step.
 */
export function setCurrentStep(state: AgentState, step: string): AgentState {
  return {
    ...state,
    currentStep: step,
  };
}

/**
 * Set next action.
 */
export function setNextAction(state: AgentState, action: string): AgentState {
  return {
    ...state,
    nextAction: action,
  };
}
