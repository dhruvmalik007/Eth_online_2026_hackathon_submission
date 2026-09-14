/**
 * Where the fork gets its inputs.
 *
 * ## Why every failure here names the variable and an example
 *
 * A fork harness fails in one of two ways: wrong, or absent. Wrong is worse — a fork
 * pointed at a different chain than the registry describes produces evidence that looks
 * plausible and describes nothing, and the checks that would have caught it are the checks
 * you skipped. So configuration is resolved eagerly, once, and a missing value stops the run
 * with the exact `export` line to type.
 *
 * ## Why the RPC URL is never written to evidence
 *
 * Almost every RPC provider puts a key in the URL. Evidence files are meant to be committed —
 * that is what makes a demo reproducible — so the URL would leak the key into git. Only the
 * host is recorded, which is what a reader actually needs to know ("was this mainnet or a
 * private node?"), and never the path or query that carries the credential.
 */

import { createEnv, type EnvSource } from "@ethonline2026/env";
import {
  CHAINS,
  CHAIN_KEYS,
  resolveRpc,
  type ChainKey,
  type RpcSource,
} from "@ethonline2026/oneinch-aqua";

export interface ChainRuntime {
  readonly chainKey: ChainKey;
  readonly chainId: number;
  /** Full URL, including any credential. Never persisted. */
  readonly rpcUrl: string;
  /** Where the URL came from, so `doctor` can say whether the shared key is in use. */
  readonly rpcSource: RpcSource;
  /** Host only. Safe to put in evidence; `rpcUrl` is not. */
  readonly rpcHost: string;
  /** Pinned block, or undefined to fork the chain head. */
  readonly forkBlock: number | undefined;
  /** The env var names, so an error message can point at them. */
  readonly rpcEnvKey: string;
  readonly forkBlockEnvKey: string;
}

export class MissingConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingConfigError";
  }
}

/**
 * Read a chain's RPC and pinned block from the environment.
 *
 * @throws {MissingConfigError} when no RPC is configured — which is the normal state on a
 *   fresh clone, and the reason `doctor` exists.
 */
export function chainRuntime(
  chainKey: ChainKey,
  env: Readonly<Record<string, string | undefined>> = process.env,
): ChainRuntime {
  const deployment = CHAINS[chainKey];

  // Shared with `apps/execution`, deliberately. A fork that reaches a chain by a different rule than
  // the live path would be validating a configuration nobody runs — and the fallback means one
  // `ALCHEMY_API_KEY` covers the whole matrix.
  const resolution = resolveRpc(chainKey, env);

  if (!resolution.ok) {
    throw new MissingConfigError(
      `No RPC configured for ${deployment.name}: ${resolution.reason}. Either:\n` +
        `  export ${deployment.rpcEnvKey}=https://…\n` +
        `  export ALCHEMY_API_KEY=…\n` +
        `Any provider works; the fork reads state and never sends a transaction outside the local node.`,
    );
  }

  const rawBlock = env[deployment.forkBlockEnvKey];
  let forkBlock: number | undefined;
  if (rawBlock !== undefined && rawBlock.trim().length > 0) {
    const parsed = Number(rawBlock);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new MissingConfigError(
        `${deployment.forkBlockEnvKey} must be a positive integer, got "${rawBlock}".`,
      );
    }
    forkBlock = parsed;
  }

  return {
    chainKey,
    chainId: deployment.chainId,
    rpcUrl: resolution.url,
    rpcSource: resolution.source,
    rpcHost: resolution.host,
    forkBlock,
    rpcEnvKey: deployment.rpcEnvKey,
    forkBlockEnvKey: deployment.forkBlockEnvKey,
  };
}

/** The runtime for every chain in the matrix. Throws on the first unconfigured one. */
export function allChainRuntimes(
  env: Readonly<Record<string, string | undefined>> = process.env,
): readonly ChainRuntime[] {
  return CHAIN_KEYS.map((key) => chainRuntime(key, env));
}

/**
 * A chain's runtime, or `undefined` when it is not configured.
 *
 * Used by the matrix run, which should exercise the chains it *can* and say which it skipped
 * rather than refusing to start because one of two is unset.
 */
export function optionalChainRuntime(
  chainKey: ChainKey,
  env: Readonly<Record<string, string | undefined>> = process.env,
): ChainRuntime | undefined {
  try {
    return chainRuntime(chainKey, env);
  } catch (error) {
    if (error instanceof MissingConfigError) return undefined;
    throw error;
  }
}

/**
 * The host of an RPC URL, with the credential-bearing parts removed.
 *
 * Falls back to `"(unparseable)"` rather than throwing: evidence is written *after* work has
 * been done, and losing a completed run's record because its RPC URL was oddly shaped would
 * be a bad trade. The value is diagnostic, not load-bearing.
 */
export function rpcHost(rpcUrl: string): string {
  try {
    return new URL(rpcUrl).host;
  } catch {
    return "(unparseable)";
  }
}

/**
 * The package's own variables, validated against the shared catalog.
 *
 * The chain RPCs are resolved dynamically by `chainRuntime` (each chain contributes its own key),
 * so they are not listed here — but the static variables are, which is what removes the literal key
 * strings that used to live in this file.
 */
export function forkEnv(env: EnvSource = process.env): Readonly<Record<string, string | undefined>> {
  return createEnv({ service: "fork-execution", source: env });
}

/** Where evidence is written. Defaults to the package's own `evidence/` directory. */
export function evidenceDir(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return forkEnv(env).FORK_EVIDENCE_DIR ?? "evidence";
}

/** Which port the local node listens on. */
export function anvilPort(env: Readonly<Record<string, string | undefined>> = process.env): number {
  const raw = forkEnv(env).FORK_ANVIL_PORT;
  if (raw === undefined) return 8545;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new MissingConfigError(`FORK_ANVIL_PORT must be a valid port, got "${raw}".`);
  }
  return parsed;
}
