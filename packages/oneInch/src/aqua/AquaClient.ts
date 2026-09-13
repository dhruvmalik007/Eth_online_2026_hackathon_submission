/**
 * The Aqua registry, from the taker's side.
 *
 * Aqua holds no funds. A maker *ships* a strategy — declaring which tokens and amounts an app may
 * later pull — and the tokens stay in the maker's wallet until a fill happens. That single fact
 * explains the whole API shape, and getting it wrong is the most common way an integration looks like
 * it works and moves nothing:
 *
 * - **`ship` and `dock` are called by the maker**, with the app as a *parameter*. Aqua credits
 *   `msg.sender` as the maker, so an app that proxies `ship` on the maker's behalf records *itself* as
 *   the maker and every later `pull` finds an empty balance. `StablecoinRefugeApp` therefore exposes no
 *   `ship` wrapper, and its tests assert the distinction.
 * - **`pull` is called by the app**, and takes no `app` argument — the app is `msg.sender`.
 * - **`push` is called by the taker**, naming the app, to deliver the input side of a fill.
 *
 * The calldata builders below are pure: they take the addresses they need rather than reading config,
 * so they can be asserted byte-for-byte without a node. The readers take a viem client because there is
 * no useful way to be pure about reading a balance.
 */

import {
  decodeEventLog,
  encodeFunctionData,
  keccak256,
  type Hex,
  type PublicClient,
} from "viem";
import type { Address } from "../chains/address.js";

/** The subset of `IAqua` this package calls. */
export const AQUA_ABI = [
  {
    type: "function",
    name: "ship",
    stateMutability: "nonpayable",
    inputs: [
      { name: "app", type: "address" },
      { name: "strategy", type: "bytes" },
      { name: "tokens", type: "address[]" },
      { name: "amounts", type: "uint256[]" },
    ],
    outputs: [{ name: "strategyHash", type: "bytes32" }],
  },
  {
    type: "function",
    name: "dock",
    stateMutability: "nonpayable",
    inputs: [
      { name: "app", type: "address" },
      { name: "strategyHash", type: "bytes32" },
      { name: "tokens", type: "address[]" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "pull",
    stateMutability: "nonpayable",
    inputs: [
      { name: "maker", type: "address" },
      { name: "strategyHash", type: "bytes32" },
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "to", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "push",
    stateMutability: "nonpayable",
    inputs: [
      { name: "maker", type: "address" },
      { name: "app", type: "address" },
      { name: "strategyHash", type: "bytes32" },
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "rawBalances",
    stateMutability: "view",
    inputs: [
      { name: "maker", type: "address" },
      { name: "app", type: "address" },
      { name: "strategyHash", type: "bytes32" },
      { name: "token", type: "address" },
    ],
    outputs: [
      { name: "balance", type: "uint248" },
      { name: "tokensCount", type: "uint8" },
    ],
  },
  {
    type: "function",
    name: "safeBalances",
    stateMutability: "view",
    inputs: [
      { name: "maker", type: "address" },
      { name: "app", type: "address" },
      { name: "strategyHash", type: "bytes32" },
      { name: "token0", type: "address" },
      { name: "token1", type: "address" },
    ],
    outputs: [
      { name: "balance0", type: "uint256" },
      { name: "balance1", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "Shipped",
    inputs: [
      { name: "maker", type: "address", indexed: false },
      { name: "app", type: "address", indexed: false },
      { name: "strategyHash", type: "bytes32", indexed: false },
      { name: "strategy", type: "bytes", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Docked",
    inputs: [
      { name: "maker", type: "address", indexed: false },
      { name: "app", type: "address", indexed: false },
      { name: "strategyHash", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Pulled",
    inputs: [
      { name: "maker", type: "address", indexed: false },
      { name: "app", type: "address", indexed: false },
      { name: "strategyHash", type: "bytes32", indexed: false },
      { name: "token", type: "address", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Pushed",
    inputs: [
      { name: "maker", type: "address", indexed: false },
      { name: "app", type: "address", indexed: false },
      { name: "strategyHash", type: "bytes32", indexed: false },
      { name: "token", type: "address", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
] as const;

/**
 * The strategy hash Aqua will compute.
 *
 * `keccak256` over the strategy bytes — which means the *encoding* is the identity of the strategy, not
 * the struct behind it. Two callers who encode the same fields in a different order produce different
 * hashes and therefore different balances, so this is exported and used by both the app and its tests
 * rather than recomputed at each call site.
 */
export function strategyHash(strategy: Hex): Hex {
  return keccak256(strategy);
}

export interface ShipInput {
  readonly aqua: Address;
  readonly app: Address;
  readonly strategy: Hex;
  readonly tokens: readonly Address[];
  readonly amounts: readonly bigint[];
}

/**
 * Ship a strategy. **Send this from the maker**, not from the app.
 *
 * A mismatch between `tokens.length` and `amounts.length` is rejected here rather than on-chain: the
 * contract would revert with an index error that says nothing about which array was short.
 */
export function shipCalldata(input: ShipInput): Hex {
  if (input.tokens.length !== input.amounts.length) {
    throw new Error(
      `ship needs one amount per token: ${input.tokens.length} tokens, ${input.amounts.length} amounts.`,
    );
  }
  return encodeFunctionData({
    abi: AQUA_ABI,
    functionName: "ship",
    args: [input.app, input.strategy, [...input.tokens], [...input.amounts]],
  });
}

export function dockCalldata(input: {
  readonly aqua: Address;
  readonly app: Address;
  readonly strategyHash: Hex;
  readonly tokens: readonly Address[];
}): Hex {
  return encodeFunctionData({
    abi: AQUA_ABI,
    functionName: "dock",
    args: [input.app, input.strategyHash, [...input.tokens]],
  });
}

/** Pull balances out of a strategy. **Send this from the app** — Aqua uses `msg.sender` as the app. */
export function pullCalldata(input: {
  readonly aqua: Address;
  readonly maker: Address;
  readonly strategyHash: Hex;
  readonly token: Address;
  readonly amount: bigint;
  readonly to: Address;
}): Hex {
  return encodeFunctionData({
    abi: AQUA_ABI,
    functionName: "pull",
    args: [input.maker, input.strategyHash, input.token, input.amount, input.to],
  });
}

/** Deliver the input side of a fill. **Send this from the taker.** */
export function pushCalldata(input: {
  readonly aqua: Address;
  readonly maker: Address;
  readonly app: Address;
  readonly strategyHash: Hex;
  readonly token: Address;
  readonly amount: bigint;
}): Hex {
  return encodeFunctionData({
    abi: AQUA_ABI,
    functionName: "push",
    args: [input.maker, input.app, input.strategyHash, input.token, input.amount],
  });
}

export interface AquaBalances {
  readonly balance0: bigint;
  readonly balance1: bigint;
}

/**
 * Read an active strategy's balances.
 *
 * `safeBalances` reverts when a token is not part of the *active* strategy, which is what makes it the
 * right read for a live position and the wrong read for "did this ever exist". A caller asking the
 * latter wants `rawBalances`, which returns zero instead.
 */
export async function readSafeBalances(
  client: PublicClient,
  input: {
    readonly aqua: Address;
    readonly maker: Address;
    readonly app: Address;
    readonly strategyHash: Hex;
    readonly token0: Address;
    readonly token1: Address;
  },
): Promise<AquaBalances> {
  const [balance0, balance1] = await client.readContract({
    address: input.aqua,
    abi: AQUA_ABI,
    functionName: "safeBalances",
    args: [input.maker, input.app, input.strategyHash, input.token0, input.token1],
  });
  return { balance0, balance1 };
}

/** Read one token's raw balance, whether or not the strategy is active. */
export async function readRawBalance(
  client: PublicClient,
  input: {
    readonly aqua: Address;
    readonly maker: Address;
    readonly app: Address;
    readonly strategyHash: Hex;
    readonly token: Address;
  },
): Promise<{ readonly balance: bigint; readonly tokensCount: number }> {
  const [balance, tokensCount] = await client.readContract({
    address: input.aqua,
    abi: AQUA_ABI,
    functionName: "rawBalances",
    args: [input.maker, input.app, input.strategyHash, input.token],
  });
  return { balance, tokensCount };
}

export type AquaEventName = "Shipped" | "Docked" | "Pulled" | "Pushed";

export interface AquaEvent {
  readonly name: AquaEventName;
  readonly maker: Address;
  readonly app: Address;
  readonly strategyHash: Hex;
  readonly token?: Address;
  readonly amount?: bigint;
}

/**
 * Decode Aqua logs, ignoring anything else in the receipt.
 *
 * A receipt is a mix of logs from every contract the transaction touched, so a decoder that assumed
 * every log was Aqua's would throw on the first ERC-20 `Transfer`. Unrecognised logs are skipped, which
 * is why the return type has no error case.
 */
export function decodeAquaLogs(
  logs: readonly { readonly address: string; readonly data: Hex; readonly topics: readonly Hex[] }[],
  aqua?: Address,
): AquaEvent[] {
  const out: AquaEvent[] = [];
  const wanted = new Set<string>(["Shipped", "Docked", "Pulled", "Pushed"]);

  for (const log of logs) {
    if (aqua !== undefined && log.address.toLowerCase() !== aqua.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: AQUA_ABI, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      if (!wanted.has(decoded.eventName)) continue;
      const args = decoded.args as Record<string, unknown>;
      out.push({
        name: decoded.eventName as AquaEventName,
        maker: args["maker"] as Address,
        app: args["app"] as Address,
        strategyHash: args["strategyHash"] as Hex,
        ...(args["token"] === undefined ? {} : { token: args["token"] as Address }),
        ...(args["amount"] === undefined ? {} : { amount: args["amount"] as bigint }),
      });
    } catch {
      // Not an Aqua event — every ERC-20 transfer on the same transaction lands here.
    }
  }

  return out;
}
