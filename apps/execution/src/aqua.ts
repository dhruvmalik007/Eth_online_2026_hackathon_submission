/**
 * The 1inch Aqua/SwapVM surface the execution service exposes to its routes.
 *
 * ## Why this is a surface rather than the adapter itself
 *
 * `app.ts`'s rule is that **no route imports an adapter**. The rule exists because a route holding a
 * concrete adapter is a route that cannot be tested without that adapter's dependencies, and here
 * those are a chain, an RPC and a signer. So the routes read this narrow interface and
 * `runtime.ts` decides whether it exists.
 *
 * ## Why it is absent rather than disabled
 *
 * With `ONEINCH_AQUA_ENABLED` off, `createAquaSurface` returns `undefined` — not an object whose
 * every method refuses. An absent surface makes the flag's off-state structural: a route cannot
 * accidentally reach a disabled venue because there is nothing to reach, and the compiler enforces
 * the optional check that a runtime boolean would let you forget.
 *
 * ## What "available" means here
 *
 * Not "the code exists" but "this deployment can reach this chain": the chain must be named in
 * `ONEINCH_AQUA_CHAINS`, registered in the chain registry, and have its RPC present. A chain that
 * fails any of those reports as `unavailable` in the assessment — which is a *finding* the
 * simulation stage should show, not a broken configuration to swallow.
 */

import {
  CHAIN_KEYS,
  assessEnablement,
  resolveRpc,
  type ChainKey,
  type EnablementAssessment,
  type RpcSource,
} from "@ethonline2026/oneinch-aqua";
import type { ExecutionEnv } from "./env.js";

/** The narrow read the routes perform. */
export interface AquaSurface {
  /** Chains this deployment can actually offer the venue on. */
  readonly chains: readonly ChainKey[];
  /** Chains named in config but not currently servable, with the reason. */
  readonly unreachable: readonly { readonly chain: ChainKey; readonly reason: string }[];
  /**
   * Where each reachable chain is being reached, host only.
   *
   * Answering "am I on the dedicated key or the shared one?" is otherwise guesswork from an
   * environment dump, and the URL itself must not be surfaced because an Alchemy key is in its path.
   */
  readonly rpc: readonly { readonly chain: ChainKey; readonly source: RpcSource; readonly host: string }[];
  /**
   * The enablement assessment for a chain.
   *
   * Called by the **simulation** stage to show what is on the table, and re-called by the
   * **approval** stage so both display the same figure. `venueAvailable` is derived here rather than
   * passed in, so a caller cannot claim a venue is available on a chain this deployment cannot reach.
   */
  assess(input: {
    readonly chain: ChainKey;
    readonly efficiencyBps: number;
    readonly alreadyEnabled: boolean;
  }): EnablementAssessment;
  /** Thresholds and mandate, surfaced so a caller can explain the assessment without re-deriving it. */
  readonly thresholds: {
    readonly minEfficiencyBps: number;
    readonly agentEnablement: boolean;
    readonly agentMinEfficiencyBps: number;
  };
}

/**
 * Build the surface, or `undefined` when the venue is switched off.
 *
 * @param env - the parsed service environment.
 * @param source - usually `process.env`; injectable so tests need no real environment.
 * @throws {Error} when `ONEINCH_AQUA_CHAINS` names a chain that is not in the matrix. A typo is a
 *   configuration error, and silently dropping the chain would leave an operator believing a venue
 *   was offered on a chain where nothing was ever checked.
 */
export function createAquaSurface(
  env: ExecutionEnv,
  source: Readonly<Record<string, unknown>> = process.env,
): AquaSurface | undefined {
  if (!env.ONEINCH_AQUA_ENABLED) return undefined;

  const requested: ChainKey[] = [];
  for (const name of env.ONEINCH_AQUA_CHAINS) {
    const match = CHAIN_KEYS.find((key) => key === name);
    if (match === undefined) {
      throw new Error(
        `ONEINCH_AQUA_CHAINS names "${name}", which is not one of: ${CHAIN_KEYS.join(", ")}. ` +
          `Widen CHAIN_KEYS before naming it here, or drop it from the list.`,
      );
    }
    requested.push(match);
  }

  const chains: ChainKey[] = [];
  const unreachable: { chain: ChainKey; reason: string }[] = [];

  const rpc: { chain: ChainKey; source: RpcSource; host: string }[] = [];

  for (const key of requested) {
    // The chain's own `*_RPC_URL` wins, then `ALCHEMY_API_KEY`. `resolveRpc` carries the reason a
    // chain is unreachable, which is the difference between "no key configured" and "a typo'd URL".
    const resolution = resolveRpc(key, source);
    if (!resolution.ok) {
      unreachable.push({ chain: key, reason: resolution.reason });
      continue;
    }
    chains.push(key);
    rpc.push({ chain: key, source: resolution.source, host: resolution.host });
  }

  const thresholds = {
    minEfficiencyBps: env.ONEINCH_MIN_EFFICIENCY_BPS,
    agentEnablement: env.ONEINCH_AGENT_ENABLEMENT,
    agentMinEfficiencyBps: env.ONEINCH_AGENT_MIN_EFFICIENCY_BPS,
  };

  return {
    chains,
    unreachable,
    rpc,
    thresholds,
    assess({ chain: chainKey, efficiencyBps, alreadyEnabled }) {
      return assessEnablement({
        chain: chainKey,
        // Derived, never taken from the caller: the assessment is only as trustworthy as this bit,
        // and a caller that could set it could claim a venue on a chain nothing reaches.
        venueAvailable: chains.includes(chainKey),
        alreadyEnabled,
        efficiencyBps,
        minEfficiencyBps: thresholds.minEfficiencyBps,
        mandate: {
          allowAgentEnablement: thresholds.agentEnablement,
          minEfficiencyBpsForAgent: thresholds.agentMinEfficiencyBps,
        },
      });
    },
  };
}
