import { isAddress, type Hex } from "viem";
import type { ChainKey } from "@ethonline2026/oneinch-aqua";
import { clientFor, isChainKey } from "./_lib/rpc.js";
import { failure, guarded, json, readJson, requireMethod } from "./_lib/handler.js";

export const config = { runtime: "nodejs" };

interface Body {
  readonly chain: ChainKey;
  readonly address: Hex;
  readonly block?: string;
}

/** `eth_getCode` — is there a contract at this address, at this block? */
export default async function handler(request: Request): Promise<Response> {
  return guarded(async () => {
    const method = requireMethod(request, ["POST"]);
    if (method !== null) return method;
    const body = await readJson<Body>(request, (value) => {
      const record = value as { chain?: unknown; address?: unknown; block?: unknown };
      if (!isChainKey(record.chain)) return "chain must be a known chain key";
      if (typeof record.address !== "string" || !isAddress(record.address)) return "address must be a 20-byte hex address";
      if (record.block !== undefined && typeof record.block !== "string") return "block must be a string";
      return {
        chain: record.chain,
        address: record.address,
        ...(record.block === undefined ? {} : { block: record.block }),
      };
    });
    if (!body.ok) return body.response;
    const { chain, address, block } = body.value;
    const code = await clientFor(chain).getCode({
      address,
      ...(block === undefined ? {} : { blockNumber: BigInt(block) }),
    });
    if (code === undefined) return failure("no code at address", 404);
    return json({ chain, address, block: block ?? "latest", deployed: code !== "0x", bytecode: code });
  });
}
