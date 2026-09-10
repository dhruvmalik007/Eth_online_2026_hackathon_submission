import { BaseSteeringStrategy, type AgentContext, type SteeringDecision, type SteeringAction, type ToolResult } from './SteeringStrategy.js';

/**
 * Tool result-based steering strategy.
 * Routes based on tool output — e.g., if health check fails, retry with
 * different endpoint; if delta exceeds threshold, trigger gamma check.
 *
 * This implements conditional routing logic without LLM calls.
 */

export interface RoutingRule {
  readonly condition: (result: ToolResult, context: AgentContext) => boolean;
  readonly action: SteeringAction;
  readonly description: string;
}

export class ToolResultSteering extends BaseSteeringStrategy {
  readonly name = 'toolResult';
  private rules: RoutingRule[] = [];

  constructor(rules?: RoutingRule[]) {
    super();
    if (rules) {
      this.rules = rules;
    } else {
      this.rules = this.getDefaultRules();
    }
  }

  /**
   * Set custom routing rules.
   */
  setRules(rules: RoutingRule[]): void {
    this.rules = rules;
  }

  protected async makeDecision(
    context: AgentContext,
    lastResult?: ToolResult,
  ): Promise<SteeringDecision> {
    // If no result yet, start with health check
    if (!lastResult) {
      return {
        action: { type: 'continue', nextTool: 'subgraphHealth', toolInput: {} },
        reasoning: 'Starting with subgraph health check',
        confidence: 0.95,
      };
    }

    // Apply routing rules
    for (const rule of this.rules) {
      if (rule.condition(lastResult, context)) {
        return {
          action: rule.action,
          reasoning: rule.description,
          confidence: 0.85,
        };
      }
    }

    // Default: continue with next logical step based on what we have
    return this.getDefaultNextAction(context, lastResult);
  }

  /**
   * Default routing rules for risk analysis workflow.
   */
  private getDefaultRules(): RoutingRule[] {
    return [
      // If health check fails, try to continue anyway (data might still be available)
      {
        condition: (result) => result.toolName === 'subgraphHealth' && !result.success,
        action: { type: 'continue', nextTool: 'graphQuery' },
        description: 'Health check failed — attempting data fetch with available endpoints',
      },
      // If delta is high, check gamma (convexity risk)
      {
        condition: (result) => {
          if (result.toolName !== 'delta' || !result.success) return false;
          const data = result.data as { leverageWeightedDelta?: number } | undefined;
          return (data?.leverageWeightedDelta ?? 0) > 1000000; // $1M threshold
        },
        action: { type: 'continue', nextTool: 'gamma' },
        description: 'High delta detected — checking gamma for convexity risk',
      },
      // If VaR exceeds threshold, run stress tests
      {
        condition: (result) => {
          if (result.toolName !== 'valueAtRisk' || !result.success) return false;
          const data = result.data as { var99?: number } | undefined;
          return (data?.var99 ?? 0) > 0.1; // 10% VaR threshold
        },
        action: { type: 'continue', nextTool: 'stressTest' },
        description: 'High VaR detected — running stress tests',
      },
      // If Merton PD is high, flag for review
      {
        condition: (result) => {
          if (result.toolName !== 'mertonPD' || !result.success) return false;
          const data = result.data as { probabilityOfDefault?: number } | undefined;
          return (data?.probabilityOfDefault ?? 0) > 0.1; // 10% PD threshold
        },
        action: { type: 'synthesize' },
        description: 'High probability of default — synthesizing risk report',
      },
    ];
  }

  /**
   * Determine default next action based on context.
   */
  private getDefaultNextAction(
    context: AgentContext,
    _lastResult: ToolResult,
  ): SteeringDecision {
    const completedTools = new Set(context.toolResults.keys());

    // Standard workflow progression
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
      if (!completedTools.has(tool)) {
        return {
          action: { type: 'continue', nextTool: tool },
          reasoning: `Continuing workflow with ${tool}`,
          confidence: 0.8,
        };
      }
    }

    // All tools completed
    return {
      action: { type: 'synthesize' },
      reasoning: 'All analysis tools completed',
      confidence: 0.95,
    };
  }
}
