import { type AgentState } from './state.js';

/**
 * LangGraph conditional edge functions.
 * Determine the next node based on current state.
 */

export type NodeType = 'plan' | 'tool' | 'greeks' | 'risk' | 'synthesize' | 'end';

/**
 * Route from plan node to next node.
 */
export function routeFromPlan(state: AgentState): NodeType {
  const action = state.nextAction;

  switch (action) {
    case 'continue':
      return 'tool';
    case 'synthesize':
      return 'synthesize';
    case 'stop':
    case 'retry':
      return 'end';
    default:
      return 'tool';
  }
}

/**
 * Route from tool node to next node.
 */
export function routeFromTool(state: AgentState): NodeType {
  const completedTools = Object.keys(state.toolResults);

  // After data retrieval tools, compute Greeks
  const greekTools = ['delta', 'gamma', 'vega', 'theta', 'rho'];
  const completedGreeks = greekTools.filter((t) => completedTools.includes(t));

  if (completedGreeks.length === greekTools.length && state.greeks.delta === null) {
    return 'greeks';
  }

  // After Greek tools, compute risk metrics
  const riskTools = ['valueAtRisk', 'mertonPD', 'duration'];
  const completedRisk = riskTools.filter((t) => completedTools.includes(t));

  if (completedRisk.length === riskTools.length && state.riskMetrics.var95 === null) {
    return 'risk';
  }

  // Continue with planning
  return 'plan';
}

/**
 * Route from greeks node.
 */
export function routeFromGreeks(_state: AgentState): NodeType {
  // After computing Greeks, continue with risk tools
  return 'plan';
}

/**
 * Route from risk node.
 */
export function routeFromRisk(state: AgentState): NodeType {
  // After computing risk metrics, synthesize results
  const completedTools = Object.keys(state.toolResults);
  const hasStressTest = completedTools.includes('stressTest');

  if (hasStressTest) {
    return 'synthesize';
  }

  return 'plan';
}

/**
 * Route from synthesize node.
 */
export function routeFromSynthesize(_state: AgentState): NodeType {
  return 'end';
}

/**
 * Main routing function — dispatches to specific router based on current step.
 */
export function route(state: AgentState): NodeType {
  switch (state.currentStep) {
    case 'plan':
      return routeFromPlan(state);
    case 'tool':
      return routeFromTool(state);
    case 'greeks':
      return routeFromGreeks(state);
    case 'risk':
      return routeFromRisk(state);
    case 'synthesize':
      return routeFromSynthesize(state);
    default:
      return 'end';
  }
}

/**
 * Check if the workflow should continue.
 */
export function shouldContinue(state: AgentState): boolean {
  return state.currentStep !== 'synthesize' && state.nextAction !== 'stop';
}
