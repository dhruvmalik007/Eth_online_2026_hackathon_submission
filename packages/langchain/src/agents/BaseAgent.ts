/**
 * Abstract base agent interface.
 * Defines the contract that all agent implementations must follow.
 *
 * SOLID: Interface Segregation — minimal interface, only essential methods.
 */

export type AgentStatus = 'idle' | 'running' | 'stopped' | 'error';

export interface AgentConfig {
  readonly name: string;
  readonly description?: string;
  readonly timeoutMs?: number;
}

export interface AgentResult<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: string;
  readonly metadata: {
    readonly durationMs: number;
    readonly toolCalls: number;
    readonly timestamp: string;
  };
}

/**
 * Base agent abstract class.
 * All agent implementations extend this class.
 */
export abstract class BaseAgent<TInput = unknown, TOutput = unknown> {
  protected readonly config: AgentConfig;
  private status: AgentStatus = 'idle';

  constructor(config: AgentConfig) {
    this.config = config;
  }

  get name(): string {
    return this.config.name;
  }

  get currentStatus(): AgentStatus {
    return this.status;
  }

  /**
   * Execute the agent's main task.
   */
  async run(input: TInput): Promise<AgentResult<TOutput>> {
    this.status = 'running';
    const startTime = Date.now();

    try {
      const data = await this.execute(input);
      this.status = 'idle';
      return {
        success: true,
        data,
        metadata: {
          durationMs: Date.now() - startTime,
          toolCalls: 0,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error) {
      this.status = 'error';
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        metadata: {
          durationMs: Date.now() - startTime,
          toolCalls: 0,
          timestamp: new Date().toISOString(),
        },
      };
    }
  }

  /**
   * Stop the agent's execution.
   */
  async stop(): Promise<void> {
    this.status = 'stopped';
    await this.onStop();
  }

  /**
   * Get the current status of the agent.
   */
  getStatus(): { name: string; status: AgentStatus; config: AgentConfig } {
    return {
      name: this.config.name,
      status: this.status,
      config: this.config,
    };
  }

  /**
   * Execute the agent's main logic. Subclasses implement this.
   */
  protected abstract execute(input: TInput): Promise<TOutput>;

  /**
   * Cleanup when agent is stopped. Override in subclasses if needed.
   */
  protected async onStop(): Promise<void> {
    // Default: no-op
  }
}
