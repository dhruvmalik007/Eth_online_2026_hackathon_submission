import { isHex } from "viem";
import type { ChainKey } from "@ethonline2026/oneinch-aqua";
import { bloomMayContainAll, isBloomHex } from "./_lib/bloom.js";
import { chunkRange, parseBlockNumber } from "./_lib/range.js";
import { clientFor, isChainKey } from "./_lib/rpc.js";
import { guarded, json, readJson, requireMethod } from "./_lib/handler.js";

export const config = { runtime: "nodejs" };

interface Body {
  readonly chain: ChainKey;
  readonly fromBlock: string;
  readonly toBlock: string;
  readonly values: readonly string[];
}

/**
 * Which blocks *may* contain the given address or topics, from each header's bloom filter.
 *
 * This is the cheap negative pass: a non-matching bloom proves the block has no matching log, so it is
 * skipped without fetching anything else. A candidate is not a match — callers then use `/api/logs` on
 * the candidates only.
 */
export default async function handler(request: Request): Promise<Response> {
  return guarded(async () => {
    const method = requireMethod(request, ["POST"]);
    if (method !== null) return method;
    const body = await readJson<Body>(request, (value) => {
      const record = value as { chain?: unknown; fromBlock?: unknown; toBlock?: unknown; values?: unknown };
      if (!isChainKey(record.chain)) return "chain must be a known chain key";
      if (typeof record.fromBlock !== "string" || typeof record.toBlock !== "string") {
        return "fromBlock and toBlock are required";
      }
      if (parseBlockNumber(record.fromBlock) === null || parseBlockNumber(record.toBlock) === null) {
        return "fromBlock and toBlock must be decimal or 0x block numbers";
      }
      if (!Array.isArray(record.values) || record.values.length === 0) return "values must be a non-empty array";
      if (!record.values.every((entry) => typeof entry === "string" && isHex(entry))) return "values must be hex strings";
      return {
        chain: record.chain,
        fromBlock: record.fromBlock,
        toBlock: record.toBlock,
        values: record.values as readonly string[],
      };
    });
    if (!body.ok) return body.response;
    const { chain, fromBlock, toBlock, values } = body.value;
    const from = parseBlockNumber(fromBlock) ?? 0n;
    const to = parseBlockNumber(toBlock) ?? 0n;
    const client = clientFor(chain);
    const blocks: string[] = [];
    let scanned = 0;
    for (const chunk of chunkRange({ fromBlock: from, toBlock: to }, 200n)) {
      const headers = await Promise.all(
        chunkRange(chunk, 1n).map((single) => client.getBlock({ blockNumber: single.fromBlock })),
      );
      for (const header of headers) {
        scanned += 1;
        if (!isBloomHex(header.logsBloom)) continue;
        if (bloomMayContainAll(header.logsBloom, values)) blocks.push(header.number.toString());
      }
    }
    return json({ chain, fromBlock, toBlock, scanned, candidates: blocks.length, blocks });
  });
}
