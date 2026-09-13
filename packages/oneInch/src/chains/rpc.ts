/**
 * How this package reaches a chain.
 *
 * ## Two sources, in precedence order
 *
 * 1. **The chain's own `*_RPC_URL`** — `packages/bridges/.env.example` established this convention
 *    (`ETHEREUM_RPC_URL`, `POLYGON_RPC_URL`, …) and a deployment that wants a dedicated provider sets
 *    it here. Highest precedence because it is the most specific statement of intent.
 * 2. **`ALCHEMY_API_KEY`**, expanded into a per-network URL. The fallback: one key covers every
 *    chain, which is what makes a multi-chain deployment tractable without a variable per network.
 *
 * `ALCHEMY_API_KEY` was already declared in `packages/bridges/.env.example` but nothing read it, so
 * this is the first code to honour it.
 *
 * ## Why a result rather than a string or undefined
 *
 * "No URL" is not the only interesting outcome — *why* there is none is what an operator needs.
 * A chain with no key at all and a chain with a typo'd URL are the same `undefined` and very
 * different problems, so this returns the reason. The same shape is why the Aqua surface can report
 * an unreachable chain as a finding rather than as a broken deployment.
 *
 * ## Never log the URL
 *
 * An Alchemy URL carries the API key **in its path**, which is why `redactRpcUrl` exists rather than
 * a caller doing `url.split("/")[2]` by hand. Every place that records where it talked to — evidence
 * artifacts, logs, error messages — takes the host, never the URL.
 */

import { chain, type ChainKey } from "./chainRegistry.js";

/** Where a resolved URL came from. Recorded so an operator can tell which setting took effect. */
export const RPC_SOURCES = ["explicit", "alchemy"] as const;
export type RpcSource = (typeof RPC_SOURCES)[number];

export type RpcResolution =
  | {
      readonly ok: true;
      readonly url: string;
      readonly source: RpcSource;
      /** Host only. Safe to persist and to log. */
      readonly host: string;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Alchemy network slugs, which are not the chain names.
 *
 * From Alchemy's network list; wrong here means a URL that resolves to the *wrong chain*, which is
 * worse than one that fails, so each is named explicitly rather than derived.
 */
const ALCHEMY_NETWORKS: Record<ChainKey, string> = {
  optimism: "opt-mainnet",
  polygon: "polygon-mainnet",
};

/**
 * The host of an RPC URL, for anything that persists or logs it.
 *
 * Returns `"invalid-url"` rather than throwing: this is called on the error path, and a redaction
 * helper that can itself throw is a redaction helper that leaks the URL.
 */
export function redactRpcUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
}

/**
 * Resolve the RPC for a chain.
 *
 * @param key - a chain in the matrix.
 * @param source - usually `process.env`; injectable so tests need no environment.
 * @throws {Error} when `key` is not in the matrix, which is a programming error rather than a
 *   configuration one — `chain()` names the valid values.
 */
export function resolveRpc(
  key: ChainKey,
  source: Readonly<Record<string, unknown>> = process.env,
): RpcResolution {
  const deployment = chain(key);

  const explicit = source[deployment.rpcEnvKey];
  if (typeof explicit === "string" && explicit.length > 0) {
    if (!/^https?:\/\//i.test(explicit)) {
      return {
        ok: false,
        reason: `${deployment.rpcEnvKey} is set but is not an http(s) URL.`,
      };
    }
    return { ok: true, url: explicit, source: "explicit", host: redactRpcUrl(explicit) };
  }

  const alchemyKey = source["ALCHEMY_API_KEY"];
  if (typeof alchemyKey === "string" && alchemyKey.length > 0) {
    const network = ALCHEMY_NETWORKS[key];
    const url = `https://${network}.g.alchemy.com/v2/${alchemyKey}`;
    return { ok: true, url, source: "alchemy", host: redactRpcUrl(url) };
  }

  return {
    ok: false,
    reason: `neither ${deployment.rpcEnvKey} nor ALCHEMY_API_KEY is set`,
  };
}

/** Every chain in the matrix with its resolution, for `/aqua/enablement` and `doctor`. */
export function resolveAllRpcs(
  source: Readonly<Record<string, unknown>> = process.env,
): readonly { readonly chain: ChainKey; readonly resolution: RpcResolution }[] {
  return (Object.keys(ALCHEMY_NETWORKS) as ChainKey[]).map((key) => ({
    chain: key,
    resolution: resolveRpc(key, source),
  }));
}
