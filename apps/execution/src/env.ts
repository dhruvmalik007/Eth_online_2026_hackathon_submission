/**
 * Configuration for the execution service.
 *
 * Validated once at boot so a misconfigured deployment fails immediately rather
 * than on the first request that needs the missing value. Paths that reach the
 * database or a signer are read here and nowhere else.
 */
import { z } from "zod";

/** Where the service runs. `dry` builds and simulates; `live` can broadcast. */
export const EXECUTION_MODES = ["dry", "live"] as const;

/**
 * A boolean from an environment string.
 *
 * Not `z.coerce.boolean()`: that runs `Boolean(value)`, so the string `"false"` — the single most
 * likely value anyone would set — becomes `true`. A flag whose off switch turns it on is worse than
 * no flag, and the failure would be a venue enabled in production by a deployment that spelled out
 * `false`.
 */
const envFlag = (fallback: boolean) =>
  z
    .enum(["true", "false", "1", "0"])
    // The default goes on the enum, before the transform. Applied after, it would be checked
    // against the *output* type and would have to be written as a boolean already — which is the
    // same class of confusion as `z.coerce.boolean()`, one layer further in.
    .default(fallback ? "true" : "false")
    .transform((value) => value === "true" || value === "1");

export const ExecutionEnvSchema = z.object({
  /**
   * `dry` (default) never broadcasts: it simulates, ranks and records, so the
   * whole lifecycle is exercisable without funds at risk.
   */
  EXECUTION_MODE: z.enum(EXECUTION_MODES).default("dry"),
  /** HTTP port. Cloud Run injects `PORT`. */
  PORT: z.coerce.number().int().positive().max(65535).default(8080),
  HOST: z.string().min(1).default("0.0.0.0"),
  /** `pino` level for the service logger. */
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  /** Max events buffered before a forced flush — bounds memory in one instance. */
  EXECUTION_EVENT_BUFFER: z.coerce.number().int().positive().max(10_000).default(128),
  /**
   * Connection string for the execution store. Falls back to the shared
   * TimescaleDB instance the other services already use, so a deployment needs
   * no duplicate configuration.
   */
  TIMESERIES_DATABASE_URL: z.string().min(1).optional(),

  /**
   * Whether the 1inch Aqua/SwapVM venue is available to runs at all.
   *
   * Default **off**, and off is a *complete* configuration: with it off the service behaves exactly
   * as it did before this venue existed. That is what makes the flag rollable per environment — it
   * gates construction, never a shape, so removing it later is a deletion rather than a migration.
   */
  ONEINCH_AQUA_ENABLED: envFlag(false),
  /**
   * Chains where the venue may be offered. Intersected with the chains this deployment can actually
   * reach, so a chain listed here without an RPC reports as unavailable rather than as broken.
   */
  ONEINCH_AQUA_CHAINS: z
    .string()
    .default("optimism,polygon")
    .transform((value) => value.split(",").map((part) => part.trim()).filter(Boolean)),
  /** The delta below which switching venue is not worth making. */
  ONEINCH_MIN_EFFICIENCY_BPS: z.coerce.number().nonnegative().default(20),
  /** Whether an agent's mandate may extend to enabling the venue on its own. */
  ONEINCH_AGENT_ENABLEMENT: envFlag(false),
  /** The delta above which enabling is arithmetic rather than preference, so an agent may act. */
  ONEINCH_AGENT_MIN_EFFICIENCY_BPS: z.coerce.number().nonnegative().default(100),

  /**
   * Whether an operator must approve an intent before it executes.
   *
   * Defaults to **true**, and the default is the control. A default that permits is a default that
   * eventually permits something nobody chose, and in fixed-income execution the reliance on an
   * accountable principal is not ceremony — it is the thing being relied on.
   */
  APPROVAL_REQUIRED_BY_DEFAULT: envFlag(true),
  /**
   * The most one agent may commit in a single intent, in whole USD.
   *
   * Per *intent* rather than per leg or per day: a mandate is granted for a trade, and a limit that
   * resets with the calendar is a limit an agent can spend every day. Set from the operator surface
   * in `apps/agentic-ems`; this is only where it lands.
   */
  APPROVAL_MAX_SPEND_USD: z.coerce.number().positive().default(250_000),

  /**
   * Privy credentials for access-token verification.
   *
   * Optional as a *pair*: both set selects the Privy authenticator, neither keeps the development
   * one. Setting exactly one is refused at boot rather than downgraded — see `createAuthenticator`.
   */
  PRIVY_APP_ID: z.string().min(1).optional(),
  PRIVY_APP_SECRET: z.string().min(1).optional(),
  /** Optional: the dashboard's verification key, which removes a Privy round-trip from cold start. */
  PRIVY_VERIFICATION_KEY: z.string().min(1).optional(),

  /**
   * The key the service signs and broadcasts with.
   *
   * Absent by default: `createRuntime` binds a signer only when one is asked for, so a deployment
   * that can move funds is a decision on the record. Set this and the two routes that need a signer
   * stop answering 503. Read here and passed to `bindSigner`; never a literal in source.
   */
  EXECUTION_SIGNER_PRIVATE_KEY: z.string().min(1).optional(),
  /**
   * The backup payer, used only when the primary is absent.
   *
   * Exists so a demonstration can proceed from a second funded testnet wallet. It is deliberately
   * not consulted when the primary is present-but-malformed — that is a configuration error to fix,
   * and swapping keys silently would hide it.
   */
  EXECUTION_FALLBACK_SIGNER_PRIVATE_KEY: z.string().min(1).optional(),
  /** Which chain the signer binds to. Defaults to where the demonstration wallet is funded. */
  EXECUTION_SIGNER_CHAIN: z.string().min(1).default("base-sepolia"),
  EXECUTION_SIGNER_RPC_URL: z.string().min(1).optional(),
});

export type ExecutionEnv = z.infer<typeof ExecutionEnvSchema>;

/**
 * Parse the environment, failing loudly on anything malformed.
 *
 * @param source - usually `process.env`.
 * @throws {Error} listing every invalid key at once, so a deploy is fixed in one pass.
 */
export function loadExecutionEnv(
  source: Readonly<Record<string, unknown>> = process.env,
): ExecutionEnv {
  const parsed = ExecutionEnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid execution-service environment: ${issues}`);
  }
  return parsed.data;
}
