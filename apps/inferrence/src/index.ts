/**
 * Public surface of `@ethonline2026/inferrence`.
 *
 * Consumers import types from here and talk to the service over HTTP; the
 * Next.js app's streaming proxy (`app/api/inference/route.ts`) and the
 * `scripts/smoke-sse.ts` CLI both rely on the event contract below.
 */

// Wire contract
export {
  AGENT_MODES,
  INFERENCE_EVENT_VERSION,
  InferenceEventSchema,
  WidgetSchema,
  serializeSse,
} from "./events/contract.js";
export type {
  AgentMode,
  EventSink,
  InferenceEvent,
  InferenceEventInput,
  Widget,
} from "./events/contract.js";
export { RunEventEmitter } from "./events/emitter.js";
export { RunEventHub } from "./events/hub.js";

// The signing-intent standard lives in `@ethonline2026/custody` so this service
// and every other integrator share one definition. Re-exported here for
// convenience; the authoritative schema is custody's.
export {
  SIGNING_INTENT_KINDS,
  SIGNING_INTENT_VERSION,
  SIGNING_SCHEMES,
  SigningIntentSchema,
  SigningSchemeSchema,
  buildSigningIntent,
  canonicalJson,
  digestIntent,
  verifySigningIntent,
} from "@ethonline2026/custody";
export type { SigningIntent, SigningIntentInput } from "@ethonline2026/custody";
export type {
  CustodyProposal,
  CustodySignature,
  CustodySigningPort,
} from "./web3/CustodySigningPort.js";

// Ports (the seams the roadmap fills in)
export type {
  ExecOptions,
  ExecResult,
  SandboxEntry,
  SandboxHandle,
  SandboxProvider,
  SandboxSpec,
} from "./sandbox/SandboxProvider.js";
export { LocalProcessSandboxProvider } from "./sandbox/LocalProcessSandboxProvider.js";
export { CloudRunSandboxProvider } from "./sandbox/CloudRunSandboxProvider.js";
export { RemoteSandboxProvider } from "./sandbox/RemoteSandboxProvider.js";
export type { RemoteSandboxOptions } from "./sandbox/RemoteSandboxProvider.js";
export type { AgentPort, AgentRequest, AgentRunContext, AgentRunOutcome } from "./orchestrator/AgentPort.js";
export type { ForecastPort, ForecastRequest, ForecastResult } from "./models/ForecastPort.js";
export { TOOL_GROUPS, sandboxTools, toolsForMode } from "./tools/ToolRegistry.js";
export type { ToolGroupDescriptor, ToolPlacement } from "./tools/ToolRegistry.js";

// Composition + app
export { buildApp } from "./app.js";
export type { AppOptions } from "./app.js";
export {
  closeRuntime,
  createRuntime,
  getRuntime,
  prepareVertexCredentials,
  resetRuntime,
  resetVertexCredentials,
} from "./runtime.js";
export type { InferenceRuntime, RuntimeOverrides } from "./runtime.js";
export { loadInferenceEnv, InferenceEnvSchema, egressHosts } from "./env.js";
export type { InferenceEnv, InferenceMode, AgentImpl, SandboxProviderName } from "./env.js";
export { ApprovalQueue } from "./approvals/ApprovalQueue.js";
export type { ApprovalOutcome, PendingApproval } from "./approvals/ApprovalQueue.js";

// Observability (LangSmith traces + the metric mechanism for each operation)
export {
  LazyTracing,
  LangSmithTracing,
  NoopTracing,
  TRACE_RUN_TYPES,
  createTracing,
} from "./observability/tracing.js";
export type {
  BeginTurnSpec,
  FeedbackSpec,
  TraceChildSpec,
  TraceEndSpec,
  TraceRun,
  TraceRunType,
  Tracing,
} from "./observability/tracing.js";
export { TRACE_FEEDBACK_KEYS, TurnTrace } from "./observability/turnTrace.js";
export type { TurnTraceSpec } from "./observability/turnTrace.js";
export { redactDeep, redactSecrets } from "./observability/redact.js";

export {
  ERROR_CODES,
  HttpError,
  NotImplementedError,
  HeaderAuthenticator,
  toErrorResponse,
} from "./http.js";
export type { Authenticator, ErrorCode } from "./http.js";
export { SessionManager, InMemorySessionStore, InMemoryRunRegistry } from "./session/SessionManager.js";
export type {
  RunRecord,
  RunRegistry,
  SessionRecord,
  SessionStatus,
  SessionStore,
} from "./session/SessionManager.js";
export { InMemoryEventJournal } from "./session/EventJournal.js";
export type { EventJournal } from "./session/EventJournal.js";
