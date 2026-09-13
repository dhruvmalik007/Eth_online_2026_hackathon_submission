/**
 * Shared test scaffolding: a runtime built entirely from defaults, so every test
 * runs with no database, no model, no network and no credentials.
 */
import { loadInferenceEnv } from "../src/env.js";
import { createRuntime, type InferenceRuntime, type RuntimeOverrides } from "../src/runtime.js";

export const TEST_ENV = {
  INFERENCE_MODE: "dry",
  AGENT_IMPL: "mock",
  SANDBOX_PROVIDER: "local",
  INFERENCE_SSE_HEARTBEAT_MS: "50",
  LOG_LEVEL: "silent",
} as const;

/**
 * @param overrides runtime seams (stores, tracing, tools, feed)
 * @param env environment for this runtime, layered over `TEST_ENV`. Separate from `overrides` because
 *   some behaviour is chosen by configuration rather than injected — tracing, for one, reads its
 *   enablement from the environment and cannot be substituted.
 */
export function makeRuntime(
  overrides: RuntimeOverrides = {},
  env: Record<string, string | undefined> = {},
): InferenceRuntime {
  return createRuntime({
    env: loadInferenceEnv({ ...TEST_ENV, ...env } as NodeJS.ProcessEnv),
    ...overrides,
  });
}

export const USER = "did:privy:test-user";
