import { isAddress, isHex, type Address, type Hex } from "viem";
import type { ChainKey } from "@ethonline2026/oneinch-aqua";
import { chunkRange, parseBlockNumber } from "./_lib/range.js";
import { clientFor, isChainKey } from "./_lib/rpc.js";
import { guarded, json, readJson, requireMethod } from "./_lib/handler.js";

export const config = { runtime: "nodejs" };

interface Body {
  readonly chain: ChainKey;
  readonly address?: Address;
  readonly topics?: readonly (Hex | null)[];
  readonly fromBlock: string;
  readonly toBlock: string;
  readonly chunkSize?: number;
}

/**
 * Logs across a block range, fetched as a sequence of bounded calls.
 *
 * The range is chunked rather than sent once because public RPCs cap `eth_getLogs`; a single large
 * range fails as a whole, whereas chunks return what is available.
 */
export default async function handler(request: Request): Promise<Response> {
  return guarded(async () => {
    const method = requireMethod(request, ["POST"]);
    if (method !== null) return method;
    const body = await readJson<Body>(request, (value) => {
      const record = value as {
        chain?: unknown;
        address?: unknown;
        topics?: unknown;
        fromBlock?: unknown;
        toBlock?: unknown;
        chunkSize?: unknown;
      };
      if (!isChainKey(record.chain)) return "chain must be a known chain key";
      if (typeof record.fromBlock !== "string" || typeof record.toBlock !== "string") {
        return "fromBlock and toBlock are required";
      }
      if (parseBlockNumber(record.fromBlock) === null || parseBlockNumber(record.toBlock) === null) {
        return "fromBlock and toBlock must be decimal or 0x block numbers";
      }
      if (record.address !== undefined && (typeof record.address !== "string" || !isAddress(record.address))) return "address must be a hex address";
      if (record.chunkSize !== undefined && (typeof record.chunkSize !== "number" || record.chunkSize <= 0)) {
        return "chunkSize must be a positive number";
      }
      const topics = Array.isArray(record.topics) ? record.topics : undefined;
      if (topics !== undefined && !topics.every((topic) => topic === null || (typeof topic === "string" && isHex(topic)))) {
        return "topics must be hex strings or null";
      }
      return {
        chain: record.chain,
        fromBlock: record.fromBlock,
        toBlock: record.toBlock,
        ...(record.address === undefined ? {} : { address: record.address }),
        ...(topics === undefined ? {} : { topics: topics as readonly (Hex | null)[] }),
        ...(record.chunkSize === undefined ? {} : { chunkSize: record.chunkSize }),
      };
    });
    if (!body.ok) return body.response;
    const { chain, address, topics, fromBlock, toBlock, chunkSize } = body.value;
    const from = parseBlockNumber(fromBlock) ?? 0n;
    const to = parseBlockNumber(toBlock) ?? 0n;
    const size = BigInt(Math.min(chunkSize ?? 2_000, 10_000));
    const client = clientFor(chain);
    const logs: unknown[] = [];
    const chunks = chunkRange({ fromBlock: from, toBlock: to }, size);
    for (const chunk of chunks) {
      const batch = await client.getLogs({
        ...(address === undefined ? {} : { address }),
        ...(topics === undefined ? {} : { topics }),
        fromBlock: chunk.fromBlock,
        toBlock: chunk.toBlock,
      });
      logs.push(...batch);
    }
    return json({ chain, fromBlock, toBlock, chunks: chunks.length, count: logs.length, logs });
  });
}
