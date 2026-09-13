/** Inclusive block ranges, chunked so a scan is a sequence of bounded calls rather than one huge one. */
export interface BlockRange {
  readonly fromBlock: bigint;
  readonly toBlock: bigint;
}

/** Split `[fromBlock, toBlock]` into inclusive chunks of at most `size` blocks. */
export function chunkRange(range: BlockRange, size: bigint): readonly BlockRange[] {
  if (size <= 0n) throw new Error("chunk size must be positive");
  if (range.toBlock < range.fromBlock) return [];
  const chunks: BlockRange[] = [];
  let cursor = range.fromBlock;
  while (cursor <= range.toBlock) {
    const end = cursor + size - 1n > range.toBlock ? range.toBlock : cursor + size - 1n;
    chunks.push({ fromBlock: cursor, toBlock: end });
    cursor = end + 1n;
  }
  return chunks;
}

/** Parse a decimal or `0x`-prefixed block number. */
export function parseBlockNumber(value: string): bigint | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  try {
    return BigInt(trimmed);
  } catch {
    return null;
  }
}
