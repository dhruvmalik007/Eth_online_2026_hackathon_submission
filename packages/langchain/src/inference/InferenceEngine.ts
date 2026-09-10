import type { BaseTool, ToolResult } from '../tools/BaseTool.js';
import { SYSTEM_PROMPTS } from './prompts.js';
import { createVertexConfig, createVertexModel, selectModelForTask } from './vertex.js';
import { loadEnv } from '../config/env.js';

/**
 * Inference engine — NL → GraphQL → Result pipeline.
 * Orchestrates LLM calls, tool execution, and result synthesis.
 */

export interface InferenceInput {
  query: string;
  context?: Record<string, unknown>;
}

export interface InferenceOutput {
  result: unknown;
  toolCalls: ToolResult[];
  reasoning: string;
  confidence: number;
}

export class InferenceEngine {
  private tools: Map<string, BaseTool> = new Map();
  private model: Awaited<ReturnType<typeof createVertexModel>> | null = null;

  constructor() {}

  /**
   * Register a tool for use by the inference engine.
   */
  registerTool(tool: BaseTool): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Initialize the Vertex AI model.
   */
  async initialize(): Promise<void> {
    const env = loadEnv();
    const config = createVertexConfig(env);
    this.model = await createVertexModel(config);
  }

  /**
   * Process a natural language query through the agentic pipeline.
   */
  async process(input: InferenceInput): Promise<InferenceOutput> {
    if (!this.model) {
      await this.initialize();
    }

    const env = loadEnv();
    const toolCalls: ToolResult[] = [];

    // Step 1: Analyze query complexity and select model
    const complexity = this.assessComplexity(input.query);
    const config = selectModelForTask(complexity, env);
    const model = await createVertexModel(config);

    // Step 2: Generate tool call plan using LLM
    const toolCallPlan = await this.generateToolCallPlan(input.query, model);

    // Step 3: Execute tool calls
    for (const plan of toolCallPlan) {
      const tool = this.tools.get(plan.toolName);
      if (!tool) {
        toolCalls.push({
          success: false,
          error: `Unknown tool: ${plan.toolName}`,
          toolName: plan.toolName,
          durationMs: 0,
        });
        continue;
      }

      const result = await tool.execute(plan.input);
      toolCalls.push(result);
    }

    // Step 4: Synthesize results
    const synthesis = await this.synthesizeResults(input.query, toolCalls, model);

    return {
      result: synthesis.result,
      toolCalls,
      reasoning: synthesis.reasoning,
      confidence: synthesis.confidence,
    };
  }

  /**
   * Assess query complexity for model selection.
   */
  private assessComplexity(query: string): 'simple' | 'moderate' | 'complex' {
    const lowerQuery = query.toLowerCase();

    // Complex: stress testing, scenario analysis, multi-protocol
    if (
      lowerQuery.includes('stress') ||
      lowerQuery.includes('scenario') ||
      lowerQuery.includes('compare') ||
      lowerQuery.includes('comprehensive')
    ) {
      return 'complex';
    }

    // Moderate: risk analysis, Greeks, VaR
    if (
      lowerQuery.includes('risk') ||
      lowerQuery.includes('greek') ||
      lowerQuery.includes('var') ||
      lowerQuery.includes('exposure')
    ) {
      return 'moderate';
    }

    // Simple: single data point queries
    return 'simple';
  }

  /**
   * Generate a plan of tool calls based on the user query.
   */
  private async generateToolCallPlan(
    query: string,
    model: Awaited<ReturnType<typeof createVertexModel>>,
  ): Promise<Array<{ toolName: string; input: unknown }>> {
    const toolDescriptions = Array.from(this.tools.values())
      .map((t) => `- ${t.name}: ${t.description}`)
      .join('\n');

    const prompt = `${SYSTEM_PROMPTS.MAIN_AGENT}

${SYSTEM_PROMPTS.TOOL_SELECTION}

Available tools:
${toolDescriptions}

User query: ${query}

Return a JSON array of tool calls: [{ "toolName": "...", "input": {...} }]`;

    const response = await model.invoke(prompt);

    try {
      // Parse LLM response as JSON tool call plan
      const content = typeof response === 'string' ? response : (response as { content?: string }).content ?? '';
      const plan = JSON.parse(content);
      return Array.isArray(plan) ? plan : [plan];
    } catch {
      // Fallback: return empty plan if parsing fails
      return [];
    }
  }

  /**
   * Synthesize tool results into a final response.
   */
  private async synthesizeResults(
    query: string,
    toolCalls: ToolResult[],
    model: Awaited<ReturnType<typeof createVertexModel>>,
  ): Promise<{ result: unknown; reasoning: string; confidence: number }> {
    const resultsSummary = toolCalls
      .map((tc) => ({
        tool: tc.toolName,
        success: tc.success,
        data: tc.data,
        error: tc.error,
      }));

    const prompt = `${SYSTEM_PROMPTS.RISK_SYNTHESIS}

User query: ${query}

Tool results:
${JSON.stringify(resultsSummary, null, 2)}

Synthesize these results into a comprehensive response.`;

    const response = await model.invoke(prompt);

    const content = typeof response === 'string' ? response : (response as { content?: string }).content ?? '';

    return {
      result: content,
      reasoning: `Processed ${toolCalls.length} tool calls for query: ${query}`,
      confidence: toolCalls.every((tc) => tc.success) ? 0.95 : 0.7,
    };
  }

  /**
   * Get all registered tool names.
   */
  getRegisteredTools(): string[] {
    return Array.from(this.tools.keys());
  }
}
