import { createPublicClient, http, type PublicClient } from "viem";
import { CHAINS, CHAIN_KEYS, resolveRpc, type ChainKey } from "@ethonline2026/oneinch-aqua";

/** Whether a request named a chain this deployment knows about. */
export function isChainKey(value: unknown): value is ChainKey {
  return typeof value === "string" && (CHAIN_KEYS as readonly string[]).includes(value);
}

/**
 * A read-only client for one chain.
 *
 * The RPC is resolved by the same rule the live execution path uses (`resolveRpc`), so a stateless
 * query reaches the chain the registry describes rather than a differently-configured one.
 */
export function clientFor(
  chainKey: ChainKey,
  env: Readonly<Record<string, unknown>> = process.env,
): PublicClient {
  const resolution = resolveRpc(chainKey, env);
  if (!resolution.ok) {
    throw new Error(`No RPC configured for ${CHAINS[chainKey].name}: ${resolution.reason}`);
  }
  return createPublicClient({ transport: http(resolution.url) });
}

/** The chains this deployment can actually reach, and where each RPC came from. */
export function configuredChains(
  env: Readonly<Record<string, unknown>> = process.env,
): readonly { chain: ChainKey; name: string; host: string }[] {
  return CHAIN_KEYS.flatMap((key) => {
    const resolution = resolveRpc(key, env);
    return resolution.ok ? [{ chain: key, name: CHAINS[key].name, host: resolution.host }] : [];
  });
}
