/**
 * `@ethonline2026/uniswap` — the Uniswap adapter for the Agentic EMS.
 *
 * ## Scope
 *
 * Holding and rebalancing **Uniswap positions**: the liquidity a fixed-income strategy sits in, and
 * the swaps it uses to leave. Two concerns, in the order they matter:
 *
 * 1. **Pool admission.** A v4 pool is a `PoolKey` whose hook field is arbitrary code the PoolManager
 *    calls, so it is the one field that can refuse a position. `hookAdmission` decides whether a pool
 *    can be entered without a proof, and the registry contains only pools that can.
 * 2. **Pool identity.** `poolId` derives the hash the PoolManager knows, and every pinned pool's id
 *    is asserted against live chain state on a fork.
 *
 * ## Where this sits
 *
 * Not in `packages/bridges`, which moves value *between* chains — its capabilities end at a
 * transfer's status, and an LP position has no such status. Not in `packages/execution-domain`, which
 * is deliberately vocabulary only: the interface every adapter implements, with no adapter in it. And
 * not inside `packages/oneInch`, which would put Uniswap's ABIs and tick maths behind a 1inch package
 * name.
 *
 * Protocol-specific work gets a protocol-named package, following `packages/arc`. The execution layer
 * reaches it through the domain's `ExecutionAdapter`, the same way it reaches every other venue.
 */

export type { Address } from "./types.js";

export {
  HOOK_PERMISSION_BITS,
  STATE_VIEW,
  STATE_VIEW_ABI,
  V4_OPERATIONS,
  V4_POOLS,
  ZERO_ADDRESS,
  gatesOperation,
  hookAdmission,
  hookPermissions,
  poolId,
  sortCurrencies,
  type HookAdmission,
  type HookPermission,
  type HookPermissions,
  type PoolKey,
  type V4Operation,
  type V4Pool,
} from "./v4/pool.js";

export {
  MAX_TICK,
  MIN_TICK,
  POOL_KEY_ABI,
  InvalidTickRange,
  encodeModifyLiquidity,
  encodePoolKey,
  isAligned,
  poolKeyTuple,
  tickRangeFor,
  type TickRange,
} from "./v4/position.js";
export {
  DEFAULT_FEE_YIELD_THRESHOLDS,
  YIELD_REJECTIONS,
  annualiseFeeYield,
  yieldOverRiskFree,
  type FeeYieldInput,
  type FeeYieldReading,
  type FeeYieldThresholds,
  type YieldRejection,
} from "./v4/yield.js";
