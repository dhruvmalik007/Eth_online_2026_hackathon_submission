/**
 * `@ethonline2026/execution` — the per-user strategy execution service.
 *
 * Phase 2 exposes the runtime and its configuration. The HTTP and WebSocket
 * surfaces (T2.2/T2.3) attach to the runtime created here.
 */
export { loadExecutionEnv, ExecutionEnvSchema, EXECUTION_MODES } from "./env.js";
export type { ExecutionEnv } from "./env.js";
export { createRuntime, closeRuntime } from "./runtime.js";
export type { ExecutionRuntime, RuntimeOverrides } from "./runtime.js";

// ─── Real-time fan-out ────────────────────────────────────────────────────────

export { SubscriptionHub, SubscriptionRefusedError } from "./ws.js";
export type {
  Channel,
  EventSink,
  OwnedSubscription,
  PublishResult,
  VerifyOwnership,
} from "./ws.js";

// ─── HTTP surface ─────────────────────────────────────────────────────────────

export { buildApp } from "./app.js";
export type { AppOptions } from "./app.js";
export {
  ERROR_CODES,
  HeaderAuthenticator,
  HttpError,
  assertDeployable,
  optionalDate,
  optionalInt,
  optionalString,
  requireString,
  toErrorResponse,
} from "./http.js";
export type { Authenticator, ErrorCode } from "./http.js";

// ─── Authentication ───────────────────────────────────────────────────────────

export { PrivyAuthenticator, createAuthenticator } from "./privyAuth.js";
export type { PrivyAuthenticatorOptions, AuthenticatorEnv } from "./privyAuth.js";

// ─── Signing ──────────────────────────────────────────────────────────────────

export { bindSigner, signerChainByName, DEFAULT_SIGNER_CHAIN } from "./signerBinding.js";
export type { BoundSigner, SignerEnv } from "./signerBinding.js";
export { createAquaSurface, type AquaSurface } from "./aqua.js";
