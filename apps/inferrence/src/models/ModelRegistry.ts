/**
 * Model routing.
 *
 * `packages/langchain` already models this with `modelForRole` / `structuredLlmForRole`
 * and an env-key registry (`LANGCHAIN_MODEL_PARSER` / `LANGCHAIN_MODEL_SYNTHESIS`).
 * This class is the service-side descriptor of that routing: it decides *which*
 * model a role uses and reports it on `/health`, but it does not construct a
 * Vertex client at boot — the model is built lazily by the agent port.
 *
 * Context caching (a 90%-off lever on Vertex) is ROADMAP T5.1: the stable system
 * prompt and tool definitions must sit at the front of the request for implicit
 * caching to hit.
 */
import type { InferenceEnv } from "../env.js";

export const MODEL_ROLES = ["parser", "synthesis", "tools"] as const;
export type ModelRole = (typeof MODEL_ROLES)[number];

export interface ModelDescriptor {
  readonly role: ModelRole;
  readonly family: "google-vertexai";
  readonly model: string;
}

export class ModelRegistry {
  readonly #env: InferenceEnv;

  constructor(env: InferenceEnv) {
    this.#env = env;
  }

  forRole(role: ModelRole): ModelDescriptor {
    const model =
      role === "parser"
        ? (this.#env.LANGCHAIN_MODEL_PARSER ?? this.#env.VERTEX_AI_MODEL)
        : role === "synthesis"
          ? (this.#env.LANGCHAIN_MODEL_SYNTHESIS ?? this.#env.VERTEX_AI_MODEL)
          : this.#env.VERTEX_AI_MODEL;
    return { role, family: "google-vertexai", model };
  }

  describe(): ModelDescriptor[] {
    return MODEL_ROLES.map((role) => this.forRole(role));
  }

  get project(): string | null {
    return this.#env.GOOGLE_CLOUD_PROJECT ?? null;
  }

  get location(): string {
    return this.#env.GOOGLE_CLOUD_LOCATION;
  }
}
