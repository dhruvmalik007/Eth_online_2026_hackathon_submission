/**
 * `@ethonline2026/bridges` — bridge and swap adapters behind one port.
 *
 * The public surface is protocol-agnostic: nothing exported here names LI.FI,
 * LayerZero or Circle. Adapters land behind {@link BridgeAdapter} as they are
 * built, and `apps/execution` depends only on this file.
 */
export {
  QUOTE_FAILURES,
  SOURCE_IDS,
  STATUS_STATES,
  QuoteEnvelopeSchema,
  RouteHopSchema,
  SourceIdSchema,
  StatusSnapshotSchema,
  UnsignedTransactionSchema,
} from "./port.js";
export type {
  BridgeAdapter,
  BuildContext,
  QuoteEnvelope,
  QuoteFailure,
  QuoteOutcome,
  QuoteSource,
  RouteHop,
  SourceId,
  StatusOutcome,
  StatusReader,
  StatusSnapshot,
  TransactionBuilder,
  UnsignedTransaction,
} from "./port.js";

// ─── Adapters ───────────────────────────────────────────────────────────────
// Each is exported with its own config and request types, because a caller
// configuring LI.FI has nothing in common with one configuring LayerZero.

export { LiFiBridge } from "./lifi.js";
export type { LiFiConfig, LiFiQuoteRequest } from "./lifi.js";

export { CircleCctpBridge } from "./circleCctp.js";
export type {
  CctpChain,
  CctpQuoteReader,
  CctpQuoteRequest,
  CctpSpeed,
  CircleCctpConfig,
} from "./circleCctp.js";

export { LayerZeroBridge } from "./layerzero.js";
export type {
  LayerZeroConfig,
  LayerZeroFeeReader,
  LayerZeroQuoteRequest,
} from "./layerzero.js";

// The concrete fee read, so a caller does not have to write one to quote at all.
export { OnchainFeeReader } from "./onchainFeeReader.js";
export type { OnchainFeeReaderConfig } from "./onchainFeeReader.js";

// The concrete CCTP quote read, against Circle's Quote API.
export { CircleQuoteApiReader } from "./circleQuoteApi.js";
export type { CircleQuoteApiConfig } from "./circleQuoteApi.js";

// The LayerZero fee read that needs no OApp: the protocol's own endpoint.
export { EndpointFeeReader, ENDPOINT_V2_ADDRESS } from "./endpointFeeReader.js";
export type { EndpointFeeReaderConfig } from "./endpointFeeReader.js";

// Values from `LayerZero-Labs/lz-address-book`, with provenance — see the module.
export { ADDRESS_BOOK_CHAINS, addressBookNameForChainId } from "./addressBook.js";
export {
  SETTLEMENT_CHAIN_ID,
  SETTLEMENT_CHAIN_LABEL,
  SETTLEMENT_TOKENS,
  SETTLEMENT_VENUES,
  UNVERIFIED_PROTOCOLS,
  resolveSettlementVenue,
  type SettlementProtocol,
  type SettlementVenue,
  type SourcedAddress,
} from "./settlement.js";

// Polymarket CLOB V2 — the protocol-owned EIP-712 order payload. The signing
// layer never sees this shape; it receives typed data and signs it.
export {
  CLOB_SIGNATURE_TYPES,
  CLOB_V2_EXCHANGE,
  ClobOrderInputSchema,
  clobOrderTypedData,
  clobOrderWireBody,
} from "./polymarket.js";
export type {
  ClobOrderInput,
  ClobOrderMessage,
  ClobOrderTypedData,
  ClobSignatureType,
} from "./polymarket.js";

// Native-token pricing, so a wei-denominated fee becomes a dollar figure.
export { DefiLlamaPriceSource } from "./nativePrice.js";
export type { DefiLlamaPriceConfig, NativePriceSource } from "./nativePrice.js";

// Transactions encoded against the deployed contracts, plus the live probe that
// verifies each ABI instead of trusting it.
export { encodeCctpBurn, encodeLayerZeroSend, probeCall } from "./transactions.js";
export type {
  CctpBurnParams,
  LayerZeroSendParams,
  ProbeResult,
  UnsignedBridgeTransaction,
} from "./transactions.js";
