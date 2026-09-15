import { isAddress, isHex, type Address, type Hex } from "viem";
import type { ChainKey } from "@ethonline2026/oneinch-aqua";
import { clientFor, isChainKey } from "./_lib/rpc.js";
import { guarded, json, readJson, requireMethod } from "./_lib/handler.js";

export const config = { runtime: "nodejs" };

interface Body {
  readonly chain: ChainKey;
  readonly to: Address;
  readonly data: Hex;
  readonly block?: string;
}

/**
 * `eth_call` — a read against a historical block.
 *
 * A revert is a valid answer to a simulation ("this would have failed"), so it is returned as
 * `{ reverted: true }` with the revert data rather than as an HTTP error.
 */
export default async function handler(request: Request): Promise<Response> {
  return guarded(async () => {
    const method = requireMethod(request, ["POST"]);
    if (method !== null) return method;
    const body = await readJson<Body>(request, (value) => {
      const record = value as { chain?: unknown; to?: unknown; data?: unknown; block?: unknown };
      if (!isChainKey(record.chain)) return "chain must be a known chain key";
      if (typeof record.to !== "string" || !isAddress(record.to)) return "to must be a 20-byte hex address";
      if (typeof record.data !== "string" || !isHex(record.data)) return "data must be hex calldata";
      if (record.block !== undefined && typeof record.block !== "string") return "block must be a string";
      return {
        chain: record.chain,
        to: record.to,
        data: record.data,
        ...(record.block === undefined ? {} : { block: record.block }),
      };
    });
    if (!body.ok) return body.response;
    const { chain, to, data, block } = body.value;
    const client = clientFor(chain);
    try {
      const result = await client.call({ to, data, ...(block === undefined ? {} : { blockNumber: BigInt(block) }) });
      return json({ chain, to, block: block ?? "latest", reverted: false, result: result.data ?? "0x" });
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      return json({ chain, to, block: block ?? "latest", reverted: true, detail });
    }
  });
}
