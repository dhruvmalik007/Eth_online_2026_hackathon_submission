/** Public exports for @ethonline2026/custody. */

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
  SafeClientOptions,
  SafeDeploymentRequest,
  SafeEip712Digest,
  SafeLeg,
  SafeOwnerSource,
  SafeProposal,
  SafeTransaction,
  SafeTransactionOptions,
  SafeVersionName,
  SignedSafeTransaction,
} from "./safe/SafeClient.js";

export {
  LedgerSignerAdapter,
  encodeDeviceSignature,
  DEFAULT_DERIVATION_PATH,
} from "./safe/LedgerSignerAdapter.js";
export type { LedgerSignerAdapterOptions } from "./safe/LedgerSignerAdapter.js";