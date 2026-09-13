/**
 * ⚠️ This encodes `modifyLiquidity((PoolKey),(int24,int24,int256,bytes32),bytes)` — a signature the
 * **deployed Optimism PositionManager does not expose**. Its verified ABI lists only
 * `modifyLiquidities(bytes,uint256)`, an actions-batch entry point, and has no `mint` or
 * `modifyLiquidity` at all. See `docs/position-manager.md` and `abi/PositionManager.optimism.json`.
 *
 * The encoder below is correct for the signature it names, and its tests verify exactly that. It is
 * kept because that signature is real in other v4-periphery revisions — but it must not be used
 * against this deployment. A correctly-encoded call to a function that does not exist still reverts.
 *
 * Uniswap v4 positions: the tick range and the `modifyLiquidity` call.
 *
 * ## What this encodes, and what it deliberately does not
 *
 * `PositionManager.modifyLiquidity` is encoded because its signature is stable and its parameters are
 * fully determined by the pool key and a tick range. **`PositionManager.mint` is not**, because its
 * parameter shape has changed between v4-periphery revisions — some take a `MintParams` struct, some
 * take the fields positionally — and emitting calldata for the wrong one produces a call that fails
 * at the point of spending, with an error that names neither the version nor the field. So it is left
 * explicit rather than guessed; see *Not encoded* below.
 *
 * ## Ticks must be spaced, and that is not a rounding detail
 *
 * A v4 pool only has initialized ticks at multiples of its `tickSpacing`, and the PoolManager rejects
 * a range that is not aligned. The obvious `tick - width` therefore fails on most inputs. Both bounds
 * are snapped **outward** — lower down, upper up — so that widening to a valid range never silently
 * narrows the position the caller asked for.
 */

import { encodeFunctionData, encodeAbiParameters, type Hex } from "viem";
import type { Address } from "../types.js";
import type { PoolKey } from "./pool.js";

/** v4's tick bounds. A range outside these cannot be represented. */
export const MIN_TICK = -887272;
export const MAX_TICK = 887272;

/** The tuple order v4 uses for a `PoolKey`, everywhere. */
export const POOL_KEY_ABI = [
  { name: "currency0", type: "address" },
  { name: "currency1", type: "address" },
  { name: "fee", type: "uint24" },
  { name: "tickSpacing", type: "int24" },
  { name: "hooks", type: "address" },
] as const;

const MODIFY_LIQUIDITY_ABI = [
  {
    type: "function",
    name: "modifyLiquidity",
    stateMutability: "payable",
    inputs: [
      { name: "key", type: "tuple", components: POOL_KEY_ABI },
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tickLower", type: "int24" },
          { name: "tickUpper", type: "int24" },
          { name: "liquidityDelta", type: "int256" },
          { name: "salt", type: "bytes32" },
        ],
      },
      { name: "hookData", type: "bytes" },
    ],
    outputs: [{ name: "delta", type: "bytes32" }, { name: "feeDelta", type: "bytes32" }],
  },
] as const;

/** A tick range, snapped to the pool's spacing. */
export interface TickRange {
  readonly lower: number;
  readonly upper: number;
}

export class InvalidTickRange extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTickRange";
  }
}

/**
 * Snap a tick to a spacing multiple, away from zero in the given direction.
 *
 * @param direction - `-1` rounds down, `1` rounds up.
 */
function snap(tick: number, spacing: number, direction: -1 | 1): number {
  const quotient = tick / spacing;
  const rounded = direction === -1 ? Math.floor(quotient) : Math.ceil(quotient);
  // `+ 0` turns a `-0` result into `0`. They compare equal but are not identical, and a `-0` tick
  // serialises as "-0" — which reads as a deliberate value rather than as the absence of one.
  return rounded * spacing + 0;
}

/**
 * The widest spaced range covering `[tick - halfWidth, tick + halfWidth]`.
 *
 * Both bounds move **outward**, so the position always covers at least what was asked for. Snapping
 * inward would silently under-provision liquidity, which looks like a smaller position rather than a
 * bug — the failure mode worth designing out.
 *
 * @throws {InvalidTickRange} when the spacing is not positive, the resulting range is empty, or it
 *   falls outside v4's representable ticks.
 */
export function tickRangeFor(input: {
  readonly currentTick: number;
  readonly tickSpacing: number;
  readonly halfWidth: number;
}): TickRange {
  if (!Number.isInteger(input.tickSpacing) || input.tickSpacing <= 0) {
    throw new InvalidTickRange(`tickSpacing must be a positive integer, got ${input.tickSpacing}.`);
  }
  if (!Number.isInteger(input.halfWidth) || input.halfWidth < 0) {
    throw new InvalidTickRange(`halfWidth must be a non-negative integer, got ${input.halfWidth}.`);
  }

  const lower = snap(input.currentTick - input.halfWidth, input.tickSpacing, -1);
  const upper = snap(input.currentTick + input.halfWidth, input.tickSpacing, 1);

  if (lower >= upper) {
    throw new InvalidTickRange(
      `The range [${lower}, ${upper}] is empty at spacing ${input.tickSpacing}. A width of ` +
        `${input.halfWidth} around tick ${input.currentTick} does not span one spacing.`,
    );
  }
  if (lower < MIN_TICK || upper > MAX_TICK) {
    const bound = lower < MIN_TICK ? `lower ${lower} is below ${MIN_TICK}` : `upper ${upper} is above ${MAX_TICK}`;
    throw new InvalidTickRange(`The range is outside v4's representable ticks: ${bound}.`);
  }

  return { lower, upper };
}

/** Whether a range is aligned to the spacing, which the PoolManager requires. */
export function isAligned(range: TickRange, tickSpacing: number): boolean {
  return range.lower % tickSpacing === 0 && range.upper % tickSpacing === 0;
}

/**
 * Encode `PositionManager.modifyLiquidity`.
 *
 * A positive `liquidityDelta` adds to the position and a negative one removes from it, which is why
 * one function covers both legs of a rebalance rather than two.
 *
 * @throws {RangeError} on a range that is not both ordered and aligned. The PoolManager would reject
 *   it too, but only after the caller has paid to find out.
 */
export function encodeModifyLiquidity(input: {
  readonly key: PoolKey;
  readonly range: TickRange;
  readonly liquidityDelta: bigint;
  readonly salt?: Hex;
  readonly hookData?: Hex;
}): Hex {
  if (!isAligned(input.range, input.key.tickSpacing)) {
    throw new RangeError(
      `The range [${input.range.lower}, ${input.range.upper}] is not aligned to spacing ` +
        `${input.key.tickSpacing}. Use tickRangeFor rather than computing ticks by hand.`,
    );
  }
  if (input.range.lower >= input.range.upper) {
    throw new RangeError(`The range [${input.range.lower}, ${input.range.upper}] is empty.`);
  }

  return encodeFunctionData({
    abi: MODIFY_LIQUIDITY_ABI,
    functionName: "modifyLiquidity",
    args: [
      {
        currency0: input.key.currency0,
        currency1: input.key.currency1,
        fee: input.key.fee,
        tickSpacing: input.key.tickSpacing,
        hooks: input.key.hooks,
      },
      {
        tickLower: input.range.lower,
        tickUpper: input.range.upper,
        liquidityDelta: input.liquidityDelta,
        salt: (input.salt ?? `0x${"0".repeat(64)}`) as Hex,
      },
      (input.hookData ?? "0x") as Hex,
    ],
  });
}

/**
 * The pool key as a bare tuple, for callers that need the values rather than a call.
 *
 * Exposed because the same tuple is needed in a `PositionManager.multicall`, where each call is built
 * separately and then batched — the one place a caller cannot simply use the encoded call above.
 */
export function poolKeyTuple(key: PoolKey): readonly [Address, Address, number, number, Address] {
  return [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks];
}

/** `abi.encode(PoolKey)` — the layout used wherever a key is hashed or nested. */
export function encodePoolKey(key: PoolKey): Hex {
  return encodeAbiParameters(POOL_KEY_ABI, [
    key.currency0,
    key.currency1,
    key.fee,
    key.tickSpacing,
    key.hooks,
  ]);
}
