import { isHex } from "viem";
import type { ChainKey } from "@ethonline2026/oneinch-aqua";
import { clientFor, isChainKey } from "./_lib/rpc.js";
import { failure, guarded, json, readJson, requireMethod } from "./_lib/handler.js";

export const config = { runtime: "nodejs" };

interface Body {
  readonly chain: ChainKey;
  readonly hash: string;
}

/** `eth_getTransactionReceipt` — the outcome of a specific historical transaction. */
export default async function handler(request: Request): Promise<Response> {
  return guarded(async () => {
    const method = requireMethod(request, ["POST"]);
    if (method !== null) return method;
    const body = await readJson<Body>(request, (value) => {
      const record = value as { chain?: unknown; hash?: unknown };
      if (!isChainKey(record.chain)) return "chain must be a known chain key";
      if (typeof record.hash !== "string" || !isHex(record.hash)) return "hash must be a transaction hash";
      return { chain: record.chain, hash: record.hash };
    });
    if (!body.ok) return body.response;
    const { chain, hash } = body.value;
    const receipt = await clientFor(chain).getTransactionReceipt({ hash: hash as `0x${string}` });
    return json({
      chain,
      hash,
      status: receipt.status,
      blockNumber: receipt.blockNumber.toString(),
      gasUsed: receipt.gasUsed.toString(),
      logs: receipt.logs.length,
    });
  });
}
