/**
 * `@ethonline2026/oneinch-aqua` — the 1inch Aqua + SwapVM execution layer.
 *
 * Four concerns, deliberately separated, and each usable on its own:
 *
 * - **chains** — where the contracts are, with provenance. Every address carries the
 *   source it came from and whether it has been verified; an address we need and have
 *   not checked is a *typed* state, not a placeholder. See `chains/address.ts` for why
 *   that distinction is load-bearing.
 * - **protocols** — the top two venues in each of five DeFi categories, with how to
 *   read each one's yield and volatility.
 * - **morpho** — a Morpho vault as an ERC-4626 destination: read, judge, rank. Pure
 *   rules with an injected reader, so a curated list can be trusted and the selection
 *   logic is testable offline.
 * - **policy** — the flight rule: yield floor and volatility cap in, a deterministic
 *   decision out. No client, no clock, no network.
 *
 * The `./port` subpath carries the capability vocabulary (`QuoteSource`,
 * `TransactionBuilder`, `UnsignedTransaction`, …) that `packages/bridges` re-exports.
 * It is a separate entry point so importing this package's registry does not drag the
 * adapter types along with it.
 */

// ─── Address provenance ──────────────────────────────────────────────────────
export { isAddress, isPinned, pinned, requireAddress, unresolved } from "./chains/address.js";
export type { Address, AddressExpectation, MaybePinned, Pinned, Unresolved } from "./chains/address.js";

// ─── Chains ──────────────────────────────────────────────────────────────────
export {
  CHAINS,
  CHAIN_KEYS,
  chain,
  chainById,
  chainKeyById,
  unresolvedAddresses,
  viemChain,
} from "./chains/chainRegistry.js";
export type {
  AaveDeployment,
  AaveV3Deployment,
  AaveV4Deployment,
  ChainDeployment,
  ChainKey,
  MorphoDeployment,
  MorphoVaultRef,
  TokenDeployment,
} from "./chains/chainRegistry.js";

// ─── Address inventory and token reads ───────────────────────────────────────
export { allChainInventories, chainInventory } from "./chains/inventory.js";
export type { PinnedAddress } from "./chains/inventory.js";
export { ERC20_READ_ABI } from "./chains/tokens.js";

// ─── Protocols ───────────────────────────────────────────────────────────────
export {
  CATEGORIES,
  GRAPH_DEPLOYMENTS,
  PROTOCOLS,
  deepProtocols,
  protocol,
  protocolsIn,
  protocolsOn,
} from "./protocols/registry.js";
export type { Category, ProtocolEntry, SignalSource } from "./protocols/registry.js";

// ─── Morpho vaults ───────────────────────────────────────────────────────────
export {
  ERC4626_ABI,
  MAX_PLAUSIBLE_APY_BPS,
  VAULT_REJECTIONS,
  chooseVault,
  onchainVaultReader,
  validateVault,
} from "./morpho/vaults.js";
export type {
  VaultCandidate,
  VaultChoice,
  VaultReader,
  VaultReadings,
  VaultRejection,
  VaultValidity,
} from "./morpho/vaults.js";

// ─── SwapVM instructions ─────────────────────────────────────────────────────
export {
  YIELD_BAND_FLIGHT_ARGS_BYTES,
  YIELD_BAND_FLIGHT_OPCODE,
  YIELD_BAND_FLIGHT_SIZE,
  argsLengthAt,
  buildYieldBandFlight,
  encodeYieldBandFlightArgs,
  isBandArmed,
  isYieldBandFlight,
  opcodeAt,
  parseYieldBandFlight,
} from "./instructions/yieldBandFlight.js";
export type { YieldBandFlightArgs } from "./instructions/yieldBandFlight.js";

// ─── SwapVM orders ───────────────────────────────────────────────────────────
export {
  ORDER_DATA_HEADER_BYTES,
  ORDER_DATA_SLICES_INDEXES_BIT_OFFSET,
  SWAP_VM_ABI,
  USE_AQUA_INSTEAD_OF_SIGNATURE,
  aquaOrderHash,
  aquaTraits,
  encodeAquaOrder,
  encodeSwapCalldata,
} from "./swapvm/order.js";
export type { AquaOrder, AquaOrderInput } from "./swapvm/order.js";

// ─── The shared offer port ───────────────────────────────────────────────────
// For venues whose market is an order book of signed maker offers — SwapVM and
// Morpho Midnight today. Morpho Vaults is deliberately absent: a vault is a plain
// ERC-4626 position and needs none of this.
export { OFFER_VENUES } from "./offers.js";
export type { OfferVenue, SignedOffer, SignedOfferTaker } from "./offers.js";

// ─── Adapters ────────────────────────────────────────────────────────────────
export { MORPHO_VAULT_ABI, MorphoVaultAdapter } from "./adapter/MorphoVaultAdapter.js";
export type { MorphoVaultAdapterConfig, VaultBinding, VaultRequest } from "./adapter/MorphoVaultAdapter.js";

export { MissingIntentError, OneInchAquaAdapter } from "./adapter/OneInchAquaAdapter.js";
export type {
  AquaFillEncoder,
  AquaQuotePort,
  AquaSwapIntent,
  EncodedFill,
  OneInchAquaAdapterConfig,
  TxSender,
} from "./adapter/OneInchAquaAdapter.js";

// ─── The flight policy ───────────────────────────────────────────────────────
export { decideFlight } from "./policy/rebalancePolicy.js";
export type { FlightPolicyOptions } from "./policy/rebalancePolicy.js";
export {
  CONSENT_GRANTORS,
  ENABLEMENT_RECOMMENDATIONS,
  EnablementInputSchema,
  assessEnablement,
  type ConsentGranter,
  type EnablementAssessment,
  type EnablementInput,
  type EnablementRecommendation,
} from "./gating/enablement.js";
export {
  DEFAULT_FLIGHT_BUFFER_BPS,
  DEFAULT_FLIGHT_THRESHOLDS,
  deriveYieldFloorBps,
  thresholdsFor,
} from "./policy/thresholds.js";
export type { FlightThresholds } from "./policy/thresholds.js";
export { ACTIONS, FLIGHT_REASONS, FLIGHT_STEPS, FlightInputSchema, OnchainGuardSchema } from "./policy/types.js";
export type {
  Action,
  FlightDecision,
  FlightInput,
  FlightReason,
  FlightStep,
  OnchainGuard,
  RejectedVault,
} from "./policy/types.js";
export {
  TAKER_FLAGS,
  TAKER_HEADER_BYTES,
  UnsupportedTakerSlice,
  encodeTakerTraits,
  readTakerHeader,
  type TakerTraitsInput,
} from "./swapvm/takerTraits.js";
export {
  RPC_SOURCES,
  redactRpcUrl,
  resolveAllRpcs,
  resolveRpc,
  type RpcResolution,
  type RpcSource,
} from "./chains/rpc.js";
export {
  InstructionTooLongError,
  OPCODES,
  UnknownOpcodeError,
  buildProgram,
  instruction,
  readProgram,
  runsOnCanonicalRouter,
  salt,
  xycSwap,
  type DecodedInstruction,
  type InstructionArgs,
  type Program,
} from "./programs/builder.js";
export {
  AQUA_STEP_KINDS,
  STEP_KIND_MAP,
  toExecutionRecord,
  toExecutionStep,
  type AquaReceiptInput,
  type AquaReceiptLeg,
  type AquaStep,
  type AquaStepKind,
} from "./adapter/receipt.js";
export {
  AQUA_ABI,
  decodeAquaLogs,
  dockCalldata,
  pullCalldata,
  pushCalldata,
  readRawBalance,
  readSafeBalances,
  shipCalldata,
  strategyHash,
  type AquaBalances,
  type AquaEvent,
  type AquaEventName,
  type ShipInput,
} from "./aqua/AquaClient.js";
export {
  SWAPPED_EVENT_ABI,
  decodeSwappedLogs,
  hashOrder,
  quote,
  quoteMatchesFill,
  type SwapQuote,
  type SwapVmCall,
  type SwappedEvent,
} from "./swapvm/SwapVmClient.js";
