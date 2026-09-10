import { type AgentState, addMessage, addToolResult, updateGreeks, updateRiskMetrics, setCurrentStep, setNextAction } from './state.js';
import { AIMessage, ToolMessage } from '@langchain/core/messages';
import type { BaseTool } from '../tools/BaseTool.js';
import type { SteeringStrategy } from '../steering/SteeringStrategy.js';

/**
 * LangGraph node functions.
 * Each node performs a specific operation and returns updated state.
 */

export interface NodeContext {
  readonly tools: Map<string, BaseTool>;
  readonly steering: SteeringStrategy;
  readonly systemPrompt?: string;
}

/**
 * Plan node — determines the next action based on current state.
 */
export async function planNode(
  state: AgentState,
  context: NodeContext,
): Promise<AgentState> {
  let currentState = setCurrentStep(state, 'plan');

  // Get last tool result if any
  const toolNames = Object.keys(state.toolResults);
  const lastResult = toolNames.length > 0
    ? state.toolResults[toolNames[toolNames.length - 1]!]
    : undefined;

  // Build context for steering
  const steeringContext = {
    messages: state.messages.map((m) => ({
      role: m._getType() as 'user' | 'assistant' | 'system' | 'tool',
      content: m.content as string,
    })),
    currentStep: state.currentStep,
    toolResults: new Map(Object.entries(state.toolResults)),
    metadata: state.metadata,
  };

  const decision = await context.steering.steer(steeringContext, lastResult);

  // Update state with next action
  currentState = setNextAction(currentState, decision.action.type);

  // Add reasoning message
  currentState = addMessage(currentState, new AIMessage({
    content: decision.reasoning,
  }));

  return currentState;
}

/**
 * Tool node — executes the next tool call.
 */
export async function toolNode(
  state: AgentState,
  context: NodeContext,
): Promise<AgentState> {
  let currentState = setCurrentStep(state, 'tool');

  // Determine which tool to call based on next action
  const nextAction = state.nextAction;

  // Map action to tool name (simplified — in practice, use LLM to select)
  const toolName = nextAction || selectNextTool(state);

  const tool = context.tools.get(toolName);

  if (!tool) {
    currentState = addToolResult(currentState, toolName, {
      toolName,
      success: false,
      error: `Unknown tool: ${toolName}`,
      durationMs: 0,
    });
    return currentState;
  }

  // Build tool input from state
  const input = buildToolInput(toolName, state);

  // Execute tool
  const result = await tool.execute(input);

  // Update state with result
  currentState = addToolResult(currentState, toolName, {
    toolName,
    success: result.success,
    ...(result.data !== undefined ? { data: result.data } : {}),
    ...(result.error !== undefined ? { error: result.error } : {}),
    durationMs: result.durationMs,
  });

  // Add tool message
  currentState = addMessage(currentState, new ToolMessage({
    content: JSON.stringify(result.data ?? result.error),
    tool_call_id: toolName,
    name: toolName,
  }));

  return currentState;
}

/**
 * Greeks node — computes Greek parameters from tool results.
 */
export async function greeksNode(
  state: AgentState,
  _context: NodeContext,
): Promise<AgentState> {
  let currentState = setCurrentStep(state, 'greeks');

  // Extract Greek values from tool results
  const deltaResult = state.toolResults.delta;
  const gammaResult = state.toolResults.gamma;
  const vegaResult = state.toolResults.vega;
  const thetaResult = state.toolResults.theta;
  const rhoResult = state.toolResults.rho;

  currentState = updateGreeks(currentState, {
    delta: (deltaResult?.data as { delta?: number })?.delta ?? state.greeks.delta,
    gamma: (gammaResult?.data as { gamma?: number })?.gamma ?? state.greeks.gamma,
    vega: (vegaResult?.data as { vega?: number })?.vega ?? state.greeks.vega,
    theta: (thetaResult?.data as { theta?: number })?.theta ?? state.greeks.theta,
    rho: (rhoResult?.data as { rho?: number })?.rho ?? state.greeks.rho,
  });

  return currentState;
}

/**
 * Risk node — computes risk metrics from tool results.
 */
export async function riskNode(
  state: AgentState,
  _context: NodeContext,
): Promise<AgentState> {
  let currentState = setCurrentStep(state, 'risk');

  // Extract risk metrics from tool results
  const varResult = state.toolResults.valueAtRisk;
  const mertonResult = state.toolResults.mertonPD;
  const durationResult = state.toolResults.duration;

  currentState = updateRiskMetrics(currentState, {
    var95: (varResult?.data as { var95?: number })?.var95 ?? state.riskMetrics.var95,
    var99: (varResult?.data as { var99?: number })?.var99 ?? state.riskMetrics.var99,
    expectedShortfall: (varResult?.data as { expectedShortfall?: number })?.expectedShortfall ?? state.riskMetrics.expectedShortfall,
    mertonPD: (mertonResult?.data as { probabilityOfDefault?: number })?.probabilityOfDefault ?? state.riskMetrics.mertonPD,
    dv01: (durationResult?.data as { dv01?: number })?.dv01 ?? state.riskMetrics.dv01,
    duration: (durationResult?.data as { duration?: number })?.duration ?? state.riskMetrics.duration,
    convexity: (durationResult?.data as { convexity?: number })?.convexity ?? state.riskMetrics.convexity,
  });

  return currentState;
}

/**
 * Synthesize node — combines all results into final report.
 */
export async function synthesizeNode(
  state: AgentState,
  _context: NodeContext,
): Promise<AgentState> {
  let currentState = setCurrentStep(state, 'synthesize');

  // Build comprehensive risk report
  const report = {
    timestamp: new Date().toISOString(),
    greeks: state.greeks,
    riskMetrics: state.riskMetrics,
    toolResults: Object.keys(state.toolResults).map((name) => ({
      tool: name,
      success: state.toolResults[name]!.success,
    })),
    metadata: state.metadata,
  };

  currentState = addMessage(currentState, new AIMessage({
    content: JSON.stringify(report, null, 2),
  }));

  return currentState;
}

/**
 * Helper: Select next tool based on what's been completed.
 */
function selectNextTool(state: AgentState): string {
  const completed = new Set(Object.keys(state.toolResults));

  const workflow = [
    'subgraphHealth',
    'graphQuery',
    'delta',
    'gamma',
    'vega',
    'theta',
    'rho',
    'valueAtRisk',
    'mertonPD',
    'duration',
    'stressTest',
  ];

  for (const tool of workflow) {
    if (!completed.has(tool)) {
      return tool;
    }
  }

  return 'synthesize';
}

/**
 * Helper: Build tool input from state.
 */
function buildToolInput(toolName: string, state: AgentState): unknown {
  const metadata = state.metadata;

  switch (toolName) {
    case 'subgraphHealth':
      return {};
    case 'graphQuery':
      return { protocolId: metadata.protocolId };
    case 'delta':
    case 'gamma':
      return {
        protocolId: metadata.protocolId,
        poolId: metadata.poolId,
      };
    case 'vega':
    case 'theta':
      return { poolId: metadata.poolId };
    case 'rho':
      return {
        protocolId: metadata.protocolId,
        poolId: metadata.poolId,
      };
    case 'valueAtRisk':
      return { protocolId: metadata.protocolId };
    case 'mertonPD':
    case 'duration':
      return { poolId: metadata.poolId };
    case 'stressTest':
      return {
        protocolId: metadata.protocolId,
        poolId: metadata.poolId,
      };
    default:
      return {};
  }
}
