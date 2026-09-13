/**
 * Uniswap v4 — pool identity, and whether a pool's hook can refuse us.
 *
 * Part of `@ethonline2026/uniswap`, which is the Uniswap adapter for the Agentic EMS. It depends on
 * nothing protocol-specific outside itself: a Uniswap adapter that imported a 1inch SDK package to
 * get a shared type would be the kind of coupling that makes a package impossible to reuse or to
 *
 * ## Why the hook question comes first
 *
 * A v4 pool is a `PoolKey`, and one of its fields is a hook. Unlike a fee tier, a hook is arbitrary
 * code the PoolManager calls during add, remove and swap — so it is the one field that can say *no*.
 * A hook can implement an allowlist, require KYC, refuse a token, tax a swap, or simply revert.
 *
 * The rest of the flight can survive a bad price; it cannot survive a pool that will not accept the
 * position at all. So admission is decided before anything is built.
 *
 * ## The one hook that needs no proof
 *
 * `address(0)`. The PoolManager checks the permission bits encoded in the hook's own address before
 * making any call, so a zero hook means **no external call happens at all** — nothing can refuse,
 * tax or gate, and that is a property of the address rather than a claim about code we would have to
 * audit. Every pool in the registry below is chosen on that basis.
 *
 * ## `swapAccess` is not enough
 *
 * The official hook registry describes each hook with a `swapAccess` field whose value `none` reads
 * like "unrestricted". It is not: it means no *access* restriction — no allowlist, no token gate —
 * while the hook may still be invoked on `beforeAddLiquidity` or `beforeSwap` and revert. `BunniHook`
 * declares `swapAccess: "none"` and sets `beforeAddLiquidity` and `beforeSwap`. So the decision here
 * is made from the **permission bits**, which say what will be *called*, and never from `swapAccess`.
 */

import { keccak256, encodeAbiParameters } from "viem";
import type { Address } from "../types.js";

/**
 * The 14 permission bits, read off the low bits of the hook's address.
 *
 * The layout is asserted in `test/uniswapV4.test.ts` against `BunniHook`
 * (`0x000052423c1db6b7ff8641b85a7eefc7b2791888`), whose low bits are `0x1888` — bits 12, 11, 7 and
 * 3 — and whose officially declared flags are exactly `afterInitialize`, `beforeAddLiquidity`,
 * `beforeSwap` and `beforeSwapReturnsDelta`. A bit order recalled from documentation would be a
 * guess; this one is checked against a real hook's own declaration.
 */
export const HOOK_PERMISSION_BITS = {
  afterRemoveLiquidityReturnsDelta: 0,
  afterAddLiquidityReturnsDelta: 1,
  afterSwapReturnsDelta: 2,
  beforeSwapReturnsDelta: 3,
  afterDonate: 4,
  beforeDonate: 5,
  afterSwap: 6,
  beforeSwap: 7,
  afterRemoveLiquidity: 8,
  beforeRemoveLiquidity: 9,
  afterAddLiquidity: 10,
  beforeAddLiquidity: 11,
  afterInitialize: 12,
  beforeInitialize: 13,
} as const;

export type HookPermission = keyof typeof HOOK_PERMISSION_BITS;
export type HookPermissions = Readonly<Record<HookPermission, boolean>>;

/** The operations the flight performs on a pool. */
export const V4_OPERATIONS = ["addLiquidity", "removeLiquidity", "swap"] as const;
export type V4Operation = (typeof V4_OPERATIONS)[number];

/**
 * Which permissions cause the PoolManager to invoke the hook for an operation.
 *
 * This is the mapping that makes the answer useful: a hook holding only `beforeSwap` is irrelevant to
 * a position that is only added and removed, so rejecting such a pool outright would be needlessly
 * strict. What matters is whether *our* operations reach the hook.
 */
const PERMISSIONS_BY_OPERATION: Record<V4Operation, readonly HookPermission[]> = {
  // The returns-delta variants are included because they let the hook rewrite the balances settled.
  addLiquidity: ["beforeAddLiquidity", "afterAddLiquidity", "afterAddLiquidityReturnsDelta"],
  removeLiquidity: [
    "beforeRemoveLiquidity",
    "afterRemoveLiquidity",
    "afterRemoveLiquidityReturnsDelta",
  ],
  swap: ["beforeSwap", "afterSwap", "beforeSwapReturnsDelta", "afterSwapReturnsDelta"],
};

/** A v4 pool is addressed by the hash of its key, not by a deployed contract. */
export interface PoolKey {
  readonly currency0: Address;
  readonly currency1: Address;
  readonly fee: number;
  /** `int24` in the contract. Conventional spacings are positive. */
  readonly tickSpacing: number;
  readonly hooks: Address;
}

const POOL_KEY_ABI = [
  { name: "currency0", type: "address" },
  { name: "currency1", type: "address" },
  { name: "fee", type: "uint24" },
  { name: "tickSpacing", type: "int24" },
  { name: "hooks", type: "address" },
] as const;

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

/** Order the currencies, which v4 requires and which decides the direction bit everywhere else. */
export function sortCurrencies(a: Address, b: Address): readonly [Address, Address] {
  if (a.toLowerCase() === b.toLowerCase()) {
    throw new RangeError("A v4 pool needs two distinct currencies.");
  }
  return a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
}

/**
 * The pool id: `keccak256(abi.encode(PoolKey))`.
 *
 * Field widths matter. `tickSpacing` is `int24`, not `uint24` — a key that disagrees hashes to a
 * different id and reads as a pool that does not exist, which is indistinguishable from a pool with
 * no liquidity unless `sqrtPriceX96` is checked separately.
 */
export function poolId(key: PoolKey): `0x${string}` {
  const [currency0, currency1] = sortCurrencies(key.currency0, key.currency1);
  return keccak256(
    encodeAbiParameters(POOL_KEY_ABI, [
      currency0,
      currency1,
      key.fee,
      key.tickSpacing,
      key.hooks,
    ]),
  );
}

/** Decode the permission bits the PoolManager reads. */
export function hookPermissions(hook: Address): HookPermissions {
  const bits = BigInt(hook) & 0x3fffn;
  const permissions = {} as Record<HookPermission, boolean>;
  for (const [name, bit] of Object.entries(HOOK_PERMISSION_BITS)) {
    permissions[name as HookPermission] = (bits & (1n << BigInt(bit))) !== 0n;
  }
  return permissions;
}

/**
 * Whether the PoolManager will invoke this hook for an operation — and therefore whether the hook
 * gets a chance to refuse it.
 *
 * True is not "malicious", it is "unproven": the hook may behave perfectly, but its behaviour lives
 * in code this module has not read. The caller's next step is a fork simulation, not a rejection.
 */
export function gatesOperation(hook: Address, operation: V4Operation): boolean {
  if (hook.toLowerCase() === ZERO_ADDRESS) return false;
  const permissions = hookPermissions(hook);
  return PERMISSIONS_BY_OPERATION[operation].some((name) => permissions[name]);
}

export interface HookAdmission {
  readonly hook: Address;
  /**
   * - `ungated` — no hook call happens, so nothing can refuse. A property of the address.
   * - `unproven` — the hook is invoked; it may be open, but that needs a simulation or a source read.
   */
  readonly verdict: "ungated" | "unproven";
  /** The operations whose hook calls are reachable. Empty when ungated. */
  readonly reachable: readonly V4Operation[];
  readonly detail: string;
}

/** Classify a hook across every operation the flight performs. */
export function hookAdmission(hook: Address): HookAdmission {
  if (hook.toLowerCase() === ZERO_ADDRESS) {
    return {
      hook,
      verdict: "ungated",
      reachable: [],
      detail:
        "The zero hook is never called: the PoolManager reads the permission bits out of the hook " +
        "address and finds none set, so no external call happens and nothing can refuse. This is a " +
        "property of the address, not a claim about code.",
    };
  }

  const reachable = V4_OPERATIONS.filter((operation) => gatesOperation(hook, operation));
  const permissions = hookPermissions(hook);
  const set = Object.entries(permissions)
    .filter(([, value]) => value)
    .map(([name]) => name);

  return {
    hook,
    verdict: "unproven",
    reachable,
    detail:
      reachable.length === 0
        ? `This hook sets ${set.length} permission bit(s) but none on an operation the flight ` +
          `performs, so it is never invoked for us. Still worth simulating: the mapping from bit to ` +
          `operation is the one thing that could be wrong.`
        : `This hook is invoked on ${reachable.join(", ")} and may refuse or alter them. That is not ` +
          `a rejection — it is an absence of proof, and the proof is a fork simulation.`,
  };
}

/** A v4 pool the flight is allowed to consider, with where the choice came from. */
export interface V4Pool {
  readonly key: PoolKey;
  readonly id: `0x${string}`;
  readonly label: string;
  /** Depth observed by `script/ProbePools.s.sol` at discovery time. */
  readonly observedLiquidity: string;
  /** `sqrtPriceX96` observed at the same moment. */
  readonly observedSqrtPriceX96: string;
  readonly provenance: string;
}

/**
 * Pools discovered on Optimism by probing the chain, not by reading a published list.
 *
 * `ProbePools.s.sol` walks the conventional fee/spacing pairs for a currency pair and asks StateView
 * which exist. Every entry below has `hooks == address(0)` — the only admission needing no proof.
 *
 * The two entries that were found and deliberately **not** included are worth recording: USDC/USDT at
 * `10000/200` answers `getSlot0` with a real price and reports `liquidity == 0`, and USDC/USDT at
 * `500/10` reports `998`. Both are initialised, both would pass a naive "does the pool exist" check,
 * and neither could absorb a position. Depth is not existence.
 */
export const V4_POOLS: readonly V4Pool[] = [
  {
    key: {
      currency0: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
      currency1: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
      fee: 100,
      tickSpacing: 1,
      hooks: ZERO_ADDRESS,
    },
    id: "0x2670084f83c0850ce7ff3c843541f4cb4f2a007d945248b3efb22ab31735e7a5",
    label: "USDC/DAI 0.01%",
    observedLiquidity: "5423919317274",
    observedSqrtPriceX96: "79254423044247656359974746969157469",
    provenance: "Probed on an Optimism fork. Deepest stablecoin pool found; DAI priced ~1.0012 USDC.",
  },
  {
    key: {
      currency0: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
      currency1: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58",
      fee: 100,
      tickSpacing: 1,
      hooks: ZERO_ADDRESS,
    },
    id: "0x83dfcb7b726c634c35776adb25f22ff54cd62e25593af523371fc22f3b4e7a2c",
    label: "USDC/USDT 0.01%",
    observedLiquidity: "59531253251",
    observedSqrtPriceX96: "79233297095040843948337245702",
    provenance: "Probed on an Optimism fork. USDT priced ~1.0000 USDC.",
  },
];

/** StateView is the supported read path: `extsload` slot arithmetic differs per field width. */
export const STATE_VIEW = {
  optimism: "0xc18a3169788F4F75A170290584ECA6395C75Ecdb" as Address,
  polygon: "0x5ea1bd7974c8a611cbab0bdcafcb1d9cc9b3ba5a" as Address,
} as const;

/** Minimal StateView ABI — enough for a depth check, and no more. */
export const STATE_VIEW_ABI = [
  {
    type: "function",
    name: "getSlot0",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "protocolFee", type: "uint24" },
      { name: "lpFee", type: "uint24" },
    ],
  },
  {
    type: "function",
    name: "getLiquidity",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [{ name: "liquidity", type: "uint128" }],
  },
] as const;
