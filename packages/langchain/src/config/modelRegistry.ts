import { ChatVertexAI } from '@langchain/google-vertexai';
import type { BaseLanguageModel } from '@langchain/core/language_models/base';
import type { StructuredLlm } from '../graph/v01/ruleParser.js';
import { loadEnv } from './env.js';

/**
 * Model registry — multi-family, env-driven, per-node roles (plan §2.5).
 *
 * Roles: `parser` (node 2, cheap tier), `synthesis` (nodes 4/5, reasoning).
 * Each role resolves a family via env (`LANGCHAIN_MODEL_<ROLE>`), defaulting
 * to the cheapest capable Gemini tier; other families (openai:*, anthropic:*)
 * plug in via env without code changes. The fallback chain from
 * DeepGraphAgent continues to protect inference calls.
 */

export type ModelRole = 'parser' | 'synthesis';

export const MODEL_ROLE_ENV_KEYS: Record<ModelRole, string> = {
  parser: 'LANGCHAIN_MODEL_PARSER',
  synthesis: 'LANGCHAIN_MODEL_SYNTHESIS',
};

export interface RegisteredModel {
  readonly model: BaseLanguageModel;
  readonly family: 'google-vertexai' | string;
  readonly modelName: string;
}

const registry = new Map<ModelRole, RegisteredModel>();

/** Resolve (and cache) the model for a role. */
export function modelForRole(role: ModelRole): RegisteredModel {
  const cached = registry.get(role);
  if (cached) return cached;

  const env = loadEnv();
  const spec = process.env[MODEL_ROLE_ENV_KEYS[role]] ?? env.VERTEX_AI_MODEL;
  const { family, modelName } = splitModelSpec(spec);
  if (family !== 'google-vertexai') {
    throw new Error(
      `model family "${family}" is not yet wired in v0.1 — installed providers: google-vertexai. ` +
        `Add the provider package and extend modelForRole to enable it.`,
    );
  }
  const model = new ChatVertexAI({
    model: modelName,
    temperature: env.VERTEX_AI_TEMPERATURE,
    maxRetries: 4,
  });
  const registered: RegisteredModel = { model, family, modelName };
  registry.set(role, registered);
  return registered;
}

/** Adapter: BaseLanguageModel → the v01 graph's StructuredLlm port. */
export function structuredLlmForRole(role: ModelRole): StructuredLlm {
  const { model } = modelForRole(role);
  return {
    async invoke({ system, user }) {
      const { HumanMessage, SystemMessage } = await import('@langchain/core/messages');
      const messages = [
        ...(system ? [new SystemMessage(system)] : []),
        new HumanMessage(user),
      ];
      const result = await model.invoke(messages);
      const content = result.content;
      if (typeof content === 'string') return content;
      if (Array.isArray(content)) {
        return content
          .map((c) => (typeof c === 'object' && c !== null && 'text' in c ? String(c.text) : String(c)))
          .join('');
      }
      return String(content);
    },
  };
}

/** Split 'family:model' (default family: google-vertexai). */
export function splitModelSpec(spec: string): { family: string; modelName: string } {
  const idx = spec.indexOf(':');
  if (idx === -1) return { family: 'google-vertexai', modelName: spec };
  return { family: spec.slice(0, idx), modelName: spec.slice(idx + 1) };
}
