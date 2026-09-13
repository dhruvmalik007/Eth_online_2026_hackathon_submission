import { isAddress, isHex, type Address, type Hex } from "viem";
import type { ChainKey } from "@ethonline2026/oneinch-aqua";
import { clientFor, isChainKey } from "./_lib/rpc.js";
import { guarded, json, readJson, requireMethod } from "./_lib/handler.js";

export const config = { runtime: "nodejs" };

interface Body {
  readonly chain: ChainKey;
  readonly address: Address;
  readonly slot: Hex;
  readonly block?: string;
}

/** `eth_getStorageAt` — read one storage slot without deploying a fork. */
export default async function handler(request: Request): Promise<Response> {
  return guarded(async () => {
    const method = requireMethod(request, ["POST"]);
    if (method !== null) return method;
    const body = await readJson<Body>(request, (value) => {
      const record = value as { chain?: unknown; address?: unknown; slot?: unknown; block?: unknown };
      if (!isChainKey(record.chain)) return "chain must be a known chain key";
      if (typeof record.address !== "string" || !isAddress(record.address)) return "address must be a 20-byte hex address";
      if (typeof record.slot !== "string" || !isHex(record.slot)) return "slot must be a hex string";
      if (record.block !== undefined && typeof record.block !== "string") return "block must be a string";
      return {
        chain: record.chain,
        address: record.address,
        slot: record.slot,
        ...(record.block === undefined ? {} : { block: record.block }),
      };
    });
    if (!body.ok) return body.response;
    const { chain, address, slot, block } = body.value;
    const value = await clientFor(chain).getStorageAt({
      address,
      slot,
      ...(block === undefined ? {} : { blockNumber: BigInt(block) }),
    });
    return json({ chain, address, slot, block: block ?? "latest", value });
  });
}
