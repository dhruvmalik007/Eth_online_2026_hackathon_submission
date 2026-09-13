/**
 * Public exports for `@ethonline2026/custody`.
 *
 * Ledger/DMK is NOT here — it lives at `@ethonline2026/custody/ledger`, because
 * the DMK's ESM build cannot be resolved by plain Node and would break any
 * `node dist/…` entrypoint that merely wanted the intent envelope.
 */

export {
  loadEnv,
  CHAIN_INFO,
  CUSTODY_CHAINS,
  requireSafeAddress,
  chainInfo,
  safeOwners,
} from "./config/env.js";
export type { CustodyEnv, CustodyChain } from "./config/env.js";

export { isAddress, toLowerAddress } from "./utils/address.js";

export { walletPolicySchema, capabilitySchema } from "./policy/policySchema.js";
export type { WalletPolicy, AgentCapability } from "./policy/policySchema.js";
export { PolicyGate, DailySpend } from "./policy/PolicyGate.js";
export type { TransferRequest, PolicyDecision } from "./policy/PolicyGate.js";

export { CustodyLog } from "./log/CustodyLog.js";
export type { CustodyEvent, CustodyEventType } from "./log/CustodyLog.js";

export { KeyRingClient } from "./ring/KeyRingClient.js";
export type { RingCliOptions, RingKeyInfo } from "./ring/KeyRingClient.js";
export { ScopedCapability } from "./ring/ScopedCapability.js";
export type { ScopedCapabilityOptions } from "./ring/ScopedCapability.js";

export { SafeClient } from "./safe/SafeClient.js";
export type {
  PredictedSafeConfig,
  ProposeIntentContext,
  SafeClientOptions,
  SafeDeploymentRequest,
  SafeLeg,
  SafeOwnerSource,
  SafeProposal,
  SafeTransaction,
  SafeTransactionOptions,
  SafeVersionName,
  SignedSafeTransaction,
} from "./safe/SafeClient.js";

export { LocalKeySigner } from "./safe/LocalKeySigner.js";
export type { LocalKeySignerOptions } from "./safe/LocalKeySigner.js";
export {
  PrivyWalletSigner,
  PrivySdkTransport,
  normalizeAuthorizationKey,
} from "./safe/PrivyWalletSigner.js";
export type {
  PrivySigningTransport,
  PrivyWalletSignerOptions,
} from "./safe/PrivyWalletSigner.js";
export { SAFE_SIGNER_KINDS, SafeSignerError, redactSignerDetail } from "./safe/SafeTypedDataSigner.js";
export type {
  SafeSignerKind,
  SafeTypedDataSigner,
  SignerFailureOutcome,
} from "./safe/SafeTypedDataSigner.js";
export {
  encodeSignature,
  normalizeRecoveryId,
  splitSignature,
  toSafeSignature,
} from "./safe/signature.js";
export type { SplitSignature } from "./safe/signature.js";

/** The EIP-712 shape every signer speaks. */
export type { Eip712Domain, Eip712Field, Eip712TypedData } from "./eip712.js";
export { toViemDomain, toViemTypedData, withoutDomainType } from "./safe/viemEip712.js";

// The signing-intent standard.
export {
  SIGNING_INTENT_KINDS,
  SIGNING_INTENT_VERSION,
  SIGNING_SCHEMES,
  SafeLegSchema,
  SigningIntentDisplaySchema,
  SigningIntentPolicySchema,
  SigningIntentProvenanceSchema,
  SigningIntentSchema,
  SigningSchemeSchema,
  buildSigningIntent,
  canonicalJson,
  digestIntent,
  verifySigningIntent,
} from "./intent/index.js";
export type {
  BuildSigningIntentInput,
  SigningIntent,
  SigningIntentInput,
} from "./intent/index.js";

// Ledger (DMK) is intentionally NOT exported here — see the header. Import it
// from `@ethonline2026/custody/ledger` when a device is actually involved.
export {
  SWAP_VM_ORDER_TYPE,
  SWAP_VM_ORDER_TYPEHASH,
  SWAP_VM_ORDER_TYPES,
  hashSwapVmOrder,
  orderTypehashMatchesSource,
  swapVmOrderTypedData,
  type SwapVmDomain,
  type SwapVmOrder,
} from "./safe/swapVmOrder.js";
