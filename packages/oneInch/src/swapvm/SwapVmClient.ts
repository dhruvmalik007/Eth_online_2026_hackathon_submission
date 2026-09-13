/**
 * SwapVM from the caller's side — quoting before a fill, and reading what a fill did.
 *
 * ## Quote, then swap, and why they must agree
 *
 * `quote` is a static call and `swap` is the real one. For a fixed-income position the two answering
 * differently is the whole risk: an operator approves `3,400 USDC` and the fill settles at something
 * else. So the caller is expected to compare them, and the adapter's tests assert equality with the
 * guard active — a clamp that applies during `quote` but not `swap` would produce a plan nobody can
 * execute at the approved number.
 *
 * ## What this client does not do
 *
 * It does not sign, and it does not build taker data. A signature-mode order is signed by the maker
 * off-chain and *carried by the taker* — `SwapVM.swap` reads it out of `takerTraitsAndData` — so the
 * signing lives in `@ethonline2026/custody` (`swapVmOrderTypedData`) and the encoding lives in
 * `./takerTraits.ts`. Keeping them out of here means this file has no opinion about either.
 */

import { decodeEventLog, type Hex, type PublicClient } from "viem";
import { SWAP_VM_ABI, type AquaOrder } from "./order.js";
import type { Address } from "../chains/address.js";

/** The fill event, as `SwapVM` declares it. */
export const SWAPPED_EVENT_ABI = [
  {
    type: "event",
    name: "Swapped",
    inputs: [
      { name: "orderHash", type: "bytes32", indexed: false },
      { name: "maker", type: "address", indexed: false },
      { name: "taker", type: "address", indexed: false },
      { name: "tokenIn", type: "address", indexed: false },
      { name: "tokenOut", type: "address", indexed: false },
      { name: "amountIn", type: "uint256", indexed: false },
      { name: "amountOut", type: "uint256", indexed: false },
    ],
  },
] as const;

export interface SwapQuote {
  readonly amountIn: bigint;
  readonly amountOut: bigint;
  readonly orderHash: Hex;
}

export interface SwapVmCall {
  readonly router: Address;
  readonly order: AquaOrder;
  readonly amount: bigint;
  readonly takerTraitsAndData: Hex;
}

/** The order as viem needs it — a plain tuple, not the class that produced the bytes. */
function orderTuple(order: AquaOrder) {
  return { maker: order.maker, traits: order.traits, data: order.data };
}

/**
 * Quote a fill without executing it.
 *
 * A static call, so it cannot move funds — which is what makes it safe to run against an operator's
 * draft. The amounts it returns are the ones a later `swap` must reproduce.
 */
export async function quote(client: PublicClient, call: SwapVmCall): Promise<SwapQuote> {
  const [amountIn, amountOut, orderHash] = await client.readContract({
    address: call.router,
    abi: SWAP_VM_ABI,
    functionName: "quote",
    args: [orderTuple(call.order), call.amount, call.takerTraitsAndData],
  });
  return { amountIn, amountOut, orderHash };
}

/** The hash the router will use for this order, and therefore the strategy's Aqua key. */
export async function hashOrder(client: PublicClient, input: { readonly router: Address; readonly order: AquaOrder }): Promise<Hex> {
  return client.readContract({
    address: input.router,
    abi: SWAP_VM_ABI,
    functionName: "hash",
    args: [orderTuple(input.order)],
  });
}

export interface SwappedEvent {
  readonly orderHash: Hex;
  readonly maker: Address;
  readonly taker: Address;
  readonly tokenIn: Address;
  readonly tokenOut: Address;
  readonly amountIn: bigint;
  readonly amountOut: bigint;
}

/**
 * Decode fill events, skipping everything else in the receipt.
 *
 * The receipt of a flight contains Aqua `Pulled`/`Pushed`, ERC-20 `Transfer`s and this — so a decoder
 * that threw on the first unrecognised log would fail on every real transaction. Unrecognised logs are
 * skipped.
 */
export function decodeSwappedLogs(
  logs: readonly { readonly address: string; readonly data: Hex; readonly topics: readonly Hex[] }[],
  router?: Address,
): SwappedEvent[] {
  const out: SwappedEvent[] = [];

  for (const log of logs) {
    if (router !== undefined && log.address.toLowerCase() !== router.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi: SWAPPED_EVENT_ABI,
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
      });
      if (decoded.eventName !== "Swapped") continue;
      const args = decoded.args as unknown as SwappedEvent;
      out.push({
        orderHash: args.orderHash,
        maker: args.maker,
        taker: args.taker,
        tokenIn: args.tokenIn,
        tokenOut: args.tokenOut,
        amountIn: args.amountIn,
        amountOut: args.amountOut,
      });
    } catch {
      // Not a fill — an ERC-20 transfer, or another contract's event on the same transaction.
    }
  }

  return out;
}

/**
 * Whether a quote and a fill agree.
 *
 * Exported as a function rather than left to each caller, because the comparison is the approval's
 * basis and every caller implementing it separately is how two of them end up comparing the wrong pair
 * of fields — the input of one against the output of the other.
 */
export function quoteMatchesFill(quote: SwapQuote, fill: SwappedEvent): boolean {
  return quote.amountIn === fill.amountIn && quote.amountOut === fill.amountOut;
}
