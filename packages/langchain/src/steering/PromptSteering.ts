import { BaseSteeringStrategy, type AgentContext, type SteeringDecision, type ToolResult } from './SteeringStrategy.js';
import { SYSTEM_PROMPTS } from '../inference/prompts.js';
import { createVertexConfig, createVertexModel } from '../inference/vertex.js';
import { loadEnv } from '../config/env.js';

/**
 * Prompt-based steering strategy.
 * Uses LLM (Vertex AI) to decide the next action based on context and tool results.
 */

export class PromptSteering extends BaseSteeringStrategy {
  readonly name = 'prompt';
  private model: Awaited<ReturnType<typeof createVertexModel>> | null = null;

  constructor() {
    super();
  }

  /**
   * Initialize the LLM model.
   */
  async initialize(): Promise<void> {
    const env = loadEnv();
    const config = createVertexConfig(env);
    this.model = await createVertexModel(config);
  }

  protected async makeDecision(
    context: AgentContext,
    lastResult?: ToolResult,
  ): Promise<SteeringDecision> {
    if (!this.model) {
      await this.initialize();
    }

    const env = loadEnv();
    const config = createVertexConfig(env);
    const model = this.model ?? await createVertexModel(config);

    // Build context summary
    const contextSummary = this.buildContextSummary(context, lastResult);

    const prompt = `${SYSTEM_PROMPTS.MAIN_AGENT}

${SYSTEM_PROMPTS.TOOL_SELECTION}

Current context:
${contextSummary}

Based on the above context, decide the next action. Return JSON:
{
  "action": "continue" | "synthesize" | "stop" | "retry",
  "nextTool": "tool_name_or_undefined",
  "toolInput": {},
  "reasoning": "explanation",
  "confidence": 0.0-1.0
}`;

    const response = await model.invoke(prompt);

    const content = typeof response === 'string' ? response : (response as { content?: string }).content ?? '';

    try {
      const decision = JSON.parse(content);
      return {
        action: {
          type: decision.action,
          nextTool: decision.nextTool,
          toolInput: decision.toolInput,
          reason: decision.reasoning,
        },
        reasoning: decision.reasoning,
        confidence: decision.confidence ?? 0.5,
      };
    } catch {
      // Fallback: synthesize if we have results, continue otherwise
      const shouldSynthesize = context.toolResults.size > 0;
      return {
        action: shouldSynthesize
          ? { type: 'synthesize' }
          : { type: 'stop', reason: 'Unable to parse LLM response' },
        reasoning: 'Fallback decision due to parse error',
        confidence: 0.3,
      };
    }
  }

  private buildContextSummary(context: AgentContext, lastResult?: ToolResult): string {
    const parts: string[] = [];

    parts.push(`Current step: ${context.currentStep}`);
    parts.push(`Messages: ${context.messages.length}`);
    parts.push(`Tool results: ${context.toolResults.size}`);

    if (lastResult) {
      parts.push(`Last tool: ${lastResult.toolName}`);
      parts.push(`Last result success: ${lastResult.success}`);
      if (lastResult.error) {
        parts.push(`Last error: ${lastResult.error}`);
      }
    }

    return parts.join('\n');
  }
}
