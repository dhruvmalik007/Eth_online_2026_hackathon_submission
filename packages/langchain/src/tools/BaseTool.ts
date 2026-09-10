import type { z } from 'zod';

/**
 * Abstract base tool interface.
 * All tool implementations extend this class.
 *
 * SOLID: Interface Segregation — minimal interface for tool contract.
 * SOLID: Liskov Substitution — any BaseTool subclass is interchangeable.
 */

export interface ToolResult<T = unknown> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: string;
  readonly toolName: string;
  readonly durationMs: number;
}

export interface ToolConfig {
  readonly name: string;
  readonly description: string;
  readonly timeoutMs?: number;
}

/**
 * Base tool abstract class.
 * Tools are the atomic units of work that agents can execute.
 */
export abstract class BaseTool<TInput = unknown, TOutput = unknown> {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly schema: z.ZodSchema<TInput>;

  /**
   * Execute the tool with validated input.
   */
  async execute(input: TInput): Promise<ToolResult<TOutput>> {
    const startTime = Date.now();

    // Validate input
    const parsed = this.schema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        error: `Invalid input: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
        toolName: this.name,
        durationMs: Date.now() - startTime,
      };
    }

    try {
      const data = await this.run(parsed.data);
      return {
        success: true,
        data,
        toolName: this.name,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        toolName: this.name,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Run the tool's logic with validated input. Subclasses implement this.
   */
  protected abstract run(input: TInput): Promise<TOutput>;

  /**
   * Get tool metadata for LLM function calling.
   */
  getToolDefinition(): {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required: string[];
    };
  } {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: this.schemaProperties(),
        required: this.schemaRequired(),
      },
    };
  }

  /**
   * Extract schema properties for LLM function calling.
   * Override in subclasses for custom schema generation.
   */
  protected schemaProperties(): Record<string, unknown> {
    return {};
  }

  /**
   * Extract required fields from schema.
   * Override in subclasses for custom required fields.
   */
  protected schemaRequired(): string[] {
    return [];
  }
}
