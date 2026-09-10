import { BaseSteeringStrategy, type AgentContext, type SteeringDecision, type ToolResult } from './SteeringStrategy.js';

/**
 * Plan-based steering strategy.
 * Follows a pre-defined plan (sequence of tool calls).
 *
 * Useful for structured workflows like full risk analysis:
 * 1. Health check → 2. Protocol snapshot → 3. Greeks → 4. VaR → 5. Synthesize
 */

export interface PlanStep {
  readonly tool: string;
  readonly input: Record<string, unknown>;
  readonly description: string;
}

export class PlanSteering extends BaseSteeringStrategy {
  readonly name = 'plan';
  private plan: PlanStep[] = [];
  private currentStepIndex = 0;

  constructor(plan?: PlanStep[]) {
    super();
    if (plan) {
      this.plan = plan;
    }
  }

  /**
   * Set the plan to follow.
   */
  setPlan(plan: PlanStep[]): void {
    this.plan = plan;
    this.currentStepIndex = 0;
  }

  /**
   * Create a standard risk analysis plan.
   */
  static createRiskAnalysisPlan(input: {
    protocolId: string;
    poolId: string;
  }): PlanStep[] {
    return [
      {
        tool: 'subgraphHealth',
        input: {},
        description: 'Check subgraph health before analysis',
      },
      {
        tool: 'graphQuery',
        input: { protocolId: input.protocolId },
        description: 'Fetch protocol snapshot (TVL, OI, revenue)',
      },
      {
        tool: 'delta',
        input: { protocolId: input.protocolId, poolId: input.poolId },
        description: 'Compute position delta',
      },
      {
        tool: 'gamma',
        input: { protocolId: input.protocolId, poolId: input.poolId },
        description: 'Compute position gamma',
      },
      {
        tool: 'vega',
        input: { poolId: input.poolId, hours: 24 },
        description: 'Compute position vega (funding volatility)',
      },
      {
        tool: 'theta',
        input: { poolId: input.poolId },
        description: 'Compute position theta (time decay)',
      },
      {
        tool: 'rho',
        input: { protocolId: input.protocolId, poolId: input.poolId },
        description: 'Compute position rho (rate sensitivity)',
      },
      {
        tool: 'valueAtRisk',
        input: { protocolId: input.protocolId, method: 'historical' },
        description: 'Compute Value at Risk',
      },
      {
        tool: 'mertonPD',
        input: { poolId: input.poolId },
        description: 'Compute Merton Probability of Default',
      },
      {
        tool: 'duration',
        input: { poolId: input.poolId },
        description: 'Compute duration and convexity',
      },
      {
        tool: 'stressTest',
        input: { protocolId: input.protocolId, poolId: input.poolId },
        description: 'Run stress test scenarios',
      },
    ];
  }

  protected async makeDecision(
    context: AgentContext,
    lastResult?: ToolResult,
  ): Promise<SteeringDecision> {
    // If last tool failed, retry or skip
    if (lastResult && !lastResult.success) {
      // Retry once, then skip
      if (this.currentStepIndex > 0) {
        const currentStep = this.plan[this.currentStepIndex - 1];
        if (currentStep) {
          return {
            action: {
              type: 'retry',
              tool: currentStep.tool,
              toolInput: currentStep.input,
            },
            reasoning: `Retrying failed tool: ${lastResult.toolName}`,
            confidence: 0.5,
          };
        }
      }
    }

    // Move to next step
    this.currentStepIndex++;

    // Check if plan is complete
    if (this.currentStepIndex >= this.plan.length) {
      return {
        action: { type: 'synthesize' },
        reasoning: 'All plan steps completed. Synthesizing results.',
        confidence: 0.95,
      };
    }

    // Execute next step
    const nextStep = this.plan[this.currentStepIndex]!;

    return {
      action: {
        type: 'continue',
        nextTool: nextStep.tool,
        toolInput: nextStep.input,
      },
      reasoning: `Executing plan step ${this.currentStepIndex + 1}/${this.plan.length}: ${nextStep.description}`,
      confidence: 0.9,
    };
  }

  override reset(): void {
    super.reset();
    this.currentStepIndex = 0;
  }
}
