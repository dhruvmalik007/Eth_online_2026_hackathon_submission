/**
 * `@ethonline2026/order-execution-layer` — the middle layer.
 *
 * ```
 * execution-domain                     what a leg, a step and a plan *are*
 *      ▲
 *      │ vocabulary
 * order-execution-layer                what a venue can be *asked to do*, and who is asked
 *      ▲
 *      ├── @ethonline2026/oneInch       Aqua + SwapVM swaps
 *      ├── @ethonline2026/uniswap       v4 pools and positions
 *      └── @ethonline2026/bridges       cross-chain transfers
 *      ▲
 * apps/execution                       runs the legs an agent defined
 * ```
 *
 * The arrow only ever points up. A venue adapter imports this layer; this layer imports no venue.
 * That is what makes adding one a new package rather than an edit to a dispatch table, and it is why
 * the port moved here from `packages/oneInch` once a second protocol family existed.
 */

export * from "./port.js";
export {
  createAdapterRegistry,
  type AdapterRegistry,
  type LegExecutor,
  type LegPlan,
} from "./registry.js";
export {
  chainExplorer,
  isKnownSource,
  providerScan,
  transactionLinks,
  type ScanTarget,
  type TransactionLinks,
  type TransactionReference,
} from "./explorer.js";
