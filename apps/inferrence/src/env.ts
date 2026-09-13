/**
 * Configuration for the inference service.
 *
 * Everything has a safe default so the service boots in `dry` mode with no
 * secrets: `INFERENCE_MODE=dry`, `AGENT_IMPL=mock`, `SANDBOX_PROVIDER=local`.
 * A misconfigured deployment fails at boot rather than on the first request that
 * needs the missing value, and the error lists every bad key at once.
 */
import { z } from "zod";
import { CUSTODY_CHAINS } from "@ethonline2026/custody";

export const INFERENCE_MODES = ["dry", "live"] as const;
export type InferenceMode = (typeof INFERENCE_MODES)[number];

/** `mock` replays a deterministic script (offline, no model call); `langchain` runs the real agent. */
export const AGENT_IMPLS = ["mock", "langchain"] as const;
export type AgentImpl = (typeof AGENT_IMPLS)[number];

export const SANDBOX_PROVIDERS = ["local", "remote", "cloudrun"] as const;
export type SandboxProviderName = (typeof SANDBOX_PROVIDERS)[number];

/**
 * Where run state lives.
 *
 * Deliberately separate from {@link INFERENCE_MODES}: "may this deployment
 * broadcast" and "where is state stored" are different questions, and conflating
 * them made a real-agent revision impossible to boot without also claiming to be
 * a broadcast-live one.
 */
export const PERSISTENCE_KINDS = ["memory", "timescale"] as const;
export type PersistenceKind = (typeof PERSISTENCE_KINDS)[number];

export const InferenceEnvSchema = z.object({
  PORT: z.coerce.number().int().positive().max(65535).default(8080),
  HOST: z.string().min(1).default("0.0.0.0"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),

  INFERENCE_MODE: z.enum(INFERENCE_MODES).default("dry"),
  /** Where sessions/runs/events live. `memory` is per-instance and single-instance-safe only. */
  INFERENCE_PERSISTENCE: z.enum(PERSISTENCE_KINDS).default("memory"),
  AGENT_IMPL: z.enum(AGENT_IMPLS).default("mock"),
  INFERENCE_MAX_CONCURRENT_RUNS: z.coerce.number().int().positive().max(1_000).default(8),
  INFERENCE_RUN_TIMEOUT_MS: z.coerce.number().int().positive().default(600_000),
  INFERENCE_SSE_HEARTBEAT_MS: z.coerce.number().int().positive().default(15_000),

  SANDBOX_PROVIDER: z.enum(SANDBOX_PROVIDERS).default("local"),
  /**
   * The gen2 sandbox-runner's base URL. Required when `SANDBOX_PROVIDER=remote`.
   *
   * Cloud Run sandboxes require the second-generation execution environment, so a
   * gen1 service cannot host them in-process — untrusted work crosses this
   * boundary instead.
   */
  SANDBOX_SERVICE_URL: z.string().optional(),
  SANDBOX_MAX_PER_INSTANCE: z.coerce.number().int().positive().max(1_000).default(8),
  SANDBOX_TTL_MS: z.coerce.number().int().positive().default(900_000),
  SANDBOX_ROOT: z.string().min(1).default("/tmp/inferrence-sandboxes"),
  /** Comma-separated host allowlist. Empty means deny all sandbox egress. */
  SANDBOX_EGRESS_ALLOWLIST: z.string().default(""),

  GOOGLE_CLOUD_PROJECT: z.string().optional(),
  GOOGLE_CLOUD_LOCATION: z.string().default("us-central1"),
  GOOGLE_SERVICE_ACCOUNT_KEY: z.string().optional(),
  VERTEX_AI_MODEL: z.string().default("gemini-2.5-flash-lite"),
  VERTEX_AI_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.1),
  VERTEX_EMBEDDING_MODEL: z.string().default("text-embedding-005"),
  /**
   * The embedding client is its own Vertex client, but it reads the *existing*
   * `GOOGLE_CLOUD_PROJECT` / `GOOGLE_CLOUD_LOCATION` above rather than a second pair of variables —
   * one concept with two names is how a deployment ends up setting the one nothing reads. Both are
   * optional; because the timeseries tool bundle includes `VectorRepository`, leaving the project
   * unset omits that whole group.
   */
  LANGCHAIN_MODEL_PARSER: z.string().optional(),
  LANGCHAIN_MODEL_SYNTHESIS: z.string().optional(),

  TIMESFM3_SERVICE_URL: z.string().optional(),

  TIMESERIES_DATABASE_URL: z.string().optional(),
  TIMESERIES_DB_MAX_CONNECTIONS: z.coerce.number().int().positive().max(20).default(5),

  GATEWAY_API_KEY: z.string().optional(),
  STUDIO_PERP_SEPOLIA_ENDPOINT: z.string().optional(),
  UNISWAP_V4_SUBGRAPH_ID: z.string().optional(),
  RISK_GCS_BUCKET: z.string().optional(),
  RISK_LOCAL_DIR: z.string().optional(),
  LIFI_API_KEY: z.string().optional(),
  CIRCLE_API_KEY: z.string().optional(),
  CIRCLE_ENTITY_SECRET: z.string().optional(),

  ARC_NETWORK: z.string().optional(),
  ARC_TESTNET_RPC_URL: z.string().optional(),
  /**
   * Which owner signer custody uses.
   *   dry       — propose only, never sign (default; needs no credentials)
   *   privy     — a Privy server wallet signs; the key stays in Privy
   *   local-key — a local key signs; DEV/TEST ONLY
   */
  CUSTODY_SIGNER: z.enum(["dry", "privy", "local-key"]).default("dry"),
  CUSTODY_MODE: z.enum(["dry", "live"]).default("dry"),
  CUSTODY_SAFE_ADDRESS: z.string().optional(),
  /** Validated against custody's own chain list, so a typo fails at boot. */
  CUSTODY_SAFE_CHAIN: z.enum(CUSTODY_CHAINS).default("sepolia"),
  /** Comma-separated Safe owners. The signer's address must be one of them. */
  CUSTODY_SAFE_OWNERS: z.string().optional(),
  CUSTODY_SAFE_THRESHOLD: z.coerce.number().int().positive().default(1),
  CUSTODY_SAFE_TX_SERVICE_URL: z.string().optional(),
  /** Append-only audit file. When unset, events are logged as structured lines. */
  CUSTODY_LOG_PATH: z.string().optional(),
  ETHEREUM_SEPOLIA_RPC_URL: z.string().optional(),

  // Privy server wallet (CUSTODY_SIGNER=privy). Never logged; see CustodySigningPort.
  PRIVY_APP_ID: z.string().optional(),
  PRIVY_APP_SECRET: z.string().optional(),
  PRIVY_WALLET_ID: z.string().optional(),
  /**
   * The wallet's address.
   *
   * Required in practice for signing: the Privy API has no cheap "address of this
   * wallet id" call that is worth making on a cold start, so the address is
   * supplied. `CUSTODY_SAFE_OWNERS[0]` is used as a fallback.
   */
  PRIVY_WALLET_ADDRESS: z.string().optional(),
  PRIVY_AUTHORIZATION_PRIVATE_KEY: z.string().optional(),
  /** Local-key signer only (CUSTODY_SIGNER=local-key). Dev/test; never fund it. */
  CUSTODY_E2E_PRIVATE_KEY: z.string().optional(),

  // `z.coerce.boolean()` would read the string "false" as `true`; parse it properly.
  LANGSMITH_TRACING: z
    .union([z.boolean(), z.string()])
    .default(false)
    .transform((value) => value === true || value === "true" || value === "1"),
  LANGSMITH_API_KEY: z.string().optional(),
  /**
   * Region-specific API host.
   *
   * An EU account against the default US host 403s on **every** call, including
   * with a valid key — a hard-won note from `packages/langchain`. Set
   * `https://eu.api.smith.langchain.com` for EU accounts.
   */
  LANGSMITH_ENDPOINT: z.string().optional(),
  LANGSMITH_ORG_ID: z.string().optional(),
  LANGSMITH_WORKSPACE_ID: z.string().optional(),
  /**
   * The project traces land in.
   *
   * The default matches the project this repository already uses rather than a service-specific name.
   * A divergent default is not harmless: the SDK *creates* a project when the name is unknown, so a
   * deployment that set `LANGSMITH_PROJECT` for one package and not the other would scatter traces
   * across two projects and look like lost telemetry rather than a naming difference.
   */
  LANGSMITH_PROJECT: z.string().default("ethonline2026-fixed-income"),
  /**
   * The project's UUID. Set alongside the name because a project can be addressed by id, which survives
   * a rename — and because a name that no longer matches is exactly how the second project gets made.
   */
  LANGSMITH_PROJECT_ID: z.string().optional(),
});

export type InferenceEnv = z.infer<typeof InferenceEnvSchema>;

/**
 * Parse the environment, failing loudly on anything malformed.
 *
 * @param source - usually `process.env`.
 * @throws {Error} listing every invalid key at once, so a deploy is fixed in one pass.
 */
export function loadInferenceEnv(
  source: Readonly<Record<string, unknown>> = process.env,
): InferenceEnv {
  const parsed = InferenceEnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid inferrence-service environment: ${issues}`);
  }
  return parsed.data;
}

/** Parse the egress allowlist into bare hosts. */
export function egressHosts(env: InferenceEnv): string[] {
  return env.SANDBOX_EGRESS_ALLOWLIST.split(",")
    .map((host) => host.trim())
    .filter((host) => host.length > 0);
}
