import type { Env } from '../config/env.js';

/**
 * Vertex AI model configuration.
 * Provides serverless LLM inference via Google Cloud.
 *
 * Authentication: Application Default Credentials (gcloud CLI)
 * No API keys needed in code — IAM roles control access.
 */

export interface VertexAIConfig {
  readonly project: string;
  readonly location: string;
  readonly model: string;
  readonly temperature: number;
  readonly maxTokens?: number;
}

/**
 * Create Vertex AI configuration from environment.
 */
export function createVertexConfig(env: Env): VertexAIConfig {
  if (!env.GOOGLE_CLOUD_PROJECT) {
    throw new Error('GOOGLE_CLOUD_PROJECT is required for Vertex AI. Set it in .env or run `gcloud config set project`.');
  }

  return {
    project: env.GOOGLE_CLOUD_PROJECT,
    location: env.GOOGLE_CLOUD_LOCATION,
    model: env.VERTEX_AI_MODEL,
    temperature: env.VERTEX_AI_TEMPERATURE,
  };
}

/**
 * Get the LangChain VertexAI model instance.
 * Lazy import to avoid loading if not needed.
 */
export async function createVertexModel(config: VertexAIConfig) {
  const { VertexAI } = await import('@langchain/google-vertexai');

  return new VertexAI({
    model: config.model,
    temperature: config.temperature,
    location: config.location,
    // Auth via Application Default Credentials (gcloud CLI)
    // Run `gcloud auth application-default login` to set up
  });
}

/**
 * Model selection based on task complexity.
 */
export function selectModelForTask(
  taskComplexity: 'simple' | 'moderate' | 'complex',
  env: Env,
): VertexAIConfig {
  const baseConfig = createVertexConfig(env);

  switch (taskComplexity) {
    case 'simple':
      // Tool selection, query generation — fast and cheap
      return { ...baseConfig, model: 'gemini-2.0-flash', temperature: 0.1 };
    case 'moderate':
      // Risk analysis, synthesis — balanced
      return { ...baseConfig, model: 'gemini-2.5-flash', temperature: 0.2 };
    case 'complex':
      // Stress testing, scenario modeling — highest quality
      return { ...baseConfig, model: 'gemini-1.5-pro', temperature: 0.3 };
  }
}
