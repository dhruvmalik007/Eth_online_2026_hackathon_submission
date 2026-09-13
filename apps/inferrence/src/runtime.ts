/**
 * The composition root — the only place concrete adapters meet.
 *
 * Follows `apps/indexer`'s pattern deliberately: the runtime is cached on
 * `globalThis` because a Cloud Run instance is reused across requests, so a cold
 * start pays for construction once and warm invocations reuse it. Construction is
 * lazy — nothing connects to a database, a model or a sandbox until a request
 * needs it — which is what lets the offline test suite build a runtime freely.
 *
 * Credentials: on Cloud Run/Vercel there is no `gcloud` session and no persistent
 * disk, so `GOOGLE_SERVICE_ACCOUNT_KEY` is materialised to `/tmp` and pointed at
 * by `GOOGLE_APPLICATION_CREDENTIALS`. Locally, an ADC session is enough.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { ApprovalQueue } from "./approvals/ApprovalQueue.js";
import { egressHosts, loadInferenceEnv, type InferenceEnv } from "./env.js";
import type { AgentMode, InferenceEvent } from "./events/contract.js";
import { RunEventHub } from "./events/hub.js";
import { HttpError } from "./http.js";
import {
  TimesFM3ForecastPort,
  UnconfiguredForecastPort,
  type ForecastPort,
} from "./models/ForecastPort.js";
import { ModelRegistry } from "./models/ModelRegistry.js";
import { createTracing, type Tracing } from "./observability/tracing.js";
import type { AgentPort } from "./orchestrator/AgentPort.js";
import { LangchainAgentPort } from "./orchestrator/LangchainAgentPort.js";
import { MockAgentPort } from "./orchestrator/MockAgentPort.js";
import { Orchestrator } from "./orchestrator/Orchestrator.js";
import { createStores, type RunStores } from "./persistence/repositories.js";
import { CloudRunSandboxProvider } from "./sandbox/CloudRunSandboxProvider.js";
import { LocalProcessSandboxProvider } from "./sandbox/LocalProcessSandboxProvider.js";
import { RemoteSandboxProvider } from "./sandbox/RemoteSandboxProvider.js";
import type { SandboxProvider } from "./sandbox/SandboxProvider.js";
import type { EventJournal } from "./session/EventJournal.js";
import { SessionManager, type RunRegistry } from "./session/SessionManager.js";
import type { CustodySigningPort } from "./web3/CustodySigningPort.js";
import { createCustodyPort } from "./web3/createCustody.js";
import { buildTools, type BuiltTools, type ToolDeps } from "./tools/buildTools.js";
import { createYieldsFeed, type YieldsFeed } from "./mandate/resolve.js";
import { createToolDeps } from "./tools/deps.js";

const SERVICE_ACCOUNT_ENV = "GOOGLE_SERVICE_ACCOUNT_KEY";
const SERVICE_ACCOUNT_PATH = "/tmp/inferrence-gac.json";
let credentialsPrepared = false;

/**
 * Point Vertex AI at a service-account key on hosts with no ADC session.
 *
 * A malformed key does not crash the service: it falls back to ADC and the
 * failure surfaces on the model call, where it is a typed `MODEL_UNAVAILABLE`.
 *
 * @returns whether `GOOGLE_APPLICATION_CREDENTIALS` is set afterwards.
 */
export function prepareVertexCredentials(env: NodeJS.ProcessEnv = process.env): boolean {
  if (credentialsPrepared) return env["GOOGLE_APPLICATION_CREDENTIALS"] !== undefined;
  credentialsPrepared = true;

  const raw = env[SERVICE_ACCOUNT_ENV];
  if (raw === undefined || raw.trim().length === 0) {
    return env["GOOGLE_APPLICATION_CREDENTIALS"] !== undefined;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") throw new Error("not a JSON object");
    mkdirSync("/tmp", { recursive: true });
    writeFileSync(SERVICE_ACCOUNT_PATH, raw, { mode: 0o600 });
    env["GOOGLE_APPLICATION_CREDENTIALS"] = SERVICE_ACCOUNT_PATH;
    return true;
  } catch {
    return env["GOOGLE_APPLICATION_CREDENTIALS"] !== undefined;
  }
}

/** Reset the one-shot credential preparation (tests only). */
export function resetVertexCredentials(): void {
  credentialsPrepared = false;
}

export interface InferenceRuntime {
  readonly env: InferenceEnv;
  readonly sessions: SessionManager;
  readonly runs: RunRegistry;
  readonly journal: EventJournal;
  readonly hub: RunEventHub;
  readonly agents: ReadonlyMap<AgentMode, AgentPort>;
  readonly sandbox: SandboxProvider;
  readonly forecasts: ForecastPort;
  readonly models: ModelRegistry;
  readonly custody: CustodySigningPort;
  readonly approvals: ApprovalQueue;
  readonly orchestrator: Orchestrator;
  readonly tracing: Tracing;
  /**
   * The tools each agent mode was actually given, and what was left out.
   *
   * Exposed rather than kept inside the agent because "can the agent see pool data?" has to be
   * answerable from outside the process. A group that is missing is a fact an operator can act on; a
   * group that is present but errors on every call is a fact only the model sees, and it will reason
   * around the gap instead of reporting it.
   */
  readonly tools: ReadonlyMap<AgentMode, BuiltTools>;
  /** The pool feed a turn's mandate is resolved against. Injected so a deployment — and a test — can
   *  point it somewhere else, and so the route does not construct its own client. */
  readonly yieldsFeed: YieldsFeed;
  readonly startedAt: string;
}

export interface RuntimeOverrides {
  readonly env?: InferenceEnv;
  readonly stores?: RunStores;
  readonly sandbox?: SandboxProvider;
  readonly agents?: ReadonlyMap<AgentMode, AgentPort>;
  readonly forecasts?: ForecastPort;
  readonly custody?: CustodySigningPort;
  readonly approvals?: ApprovalQueue;
  readonly tracing?: Tracing;
  /** Tool dependencies. Whatever is absent has its groups reported as omitted on `/health`. */
  readonly toolDeps?: ToolDeps;
  readonly yieldsFeed?: YieldsFeed;
  readonly now?: () => Date;
}

function createSandbox(env: InferenceEnv): SandboxProvider {
  if (env.SANDBOX_PROVIDER === "remote") {
    if (env.SANDBOX_SERVICE_URL === undefined) {
      throw new HttpError(
        "SANDBOX_UNAVAILABLE",
        "SANDBOX_PROVIDER=remote requires SANDBOX_SERVICE_URL to point at the gen2 sandbox-runner.",
      );
    }
    // gen1 cannot host Cloud Run sandboxes in-process, so untrusted work crosses
    // this HTTP boundary to a gen2 service.
    return new RemoteSandboxProvider({ baseUrl: env.SANDBOX_SERVICE_URL });
  }
  if (env.SANDBOX_PROVIDER === "cloudrun") {
    return new CloudRunSandboxProvider({
      egressAllowlist: egressHosts(env),
      maxPerInstance: env.SANDBOX_MAX_PER_INSTANCE,
      defaultTtlMs: env.SANDBOX_TTL_MS,
    });
  }
  return new LocalProcessSandboxProvider({
    root: env.SANDBOX_ROOT,
    maxPerInstance: env.SANDBOX_MAX_PER_INSTANCE,
  });
}

function createAgents(env: InferenceEnv): ReadonlyMap<AgentMode, AgentPort> {
  const useMock = env.AGENT_IMPL === "mock";
  return new Map<AgentMode, AgentPort>([
    ["v01", useMock ? new MockAgentPort("v01") : new LangchainAgentPort({ mode: "v01" })],
    ["deep", useMock ? new MockAgentPort("deep") : new LangchainAgentPort({ mode: "deep" })],
    ["dry", new MockAgentPort("dry")],
  ]);
}

export function createRuntime(overrides: RuntimeOverrides = {}): InferenceRuntime {
  const env = overrides.env ?? loadInferenceEnv();
  const now = overrides.now ?? (() => new Date());

  prepareVertexCredentials();

  const stores = overrides.stores ?? createStores(env);
  const hub = new RunEventHub(
    (runId: string, event: InferenceEvent) => stores.journal.append(runId, event),
    { now },
  );
  const sessions = new SessionManager(stores.sessions, now);
  const approvals = overrides.approvals ?? new ApprovalQueue(now);
  const sandbox = overrides.sandbox ?? createSandbox(env);
  const forecasts =
    overrides.forecasts ??
      (env.TIMESFM3_SERVICE_URL === undefined
        ? new UnconfiguredForecastPort()
        : new TimesFM3ForecastPort(env.TIMESFM3_SERVICE_URL));
  const custody = overrides.custody ?? createCustodyPort(env);
  const agents = overrides.agents ?? createAgents(env);
  const tracing =
    overrides.tracing ??
    createTracing(env, (message: string) => {
      // Fail-open must not mean fail-silent. A dropped trace — a wrong region, an
      // expired key, a policy denial — has to be visible in the logs, or the
      // dashboard silently stays empty and nobody knows why.
      console.error(`[inferrence] ${message}`);
    });

  const orchestrator = new Orchestrator({
    sessions,
    runs: stores.runs,
    hub,
    agents,
    approvals,
    sandbox,
    custody,
    tracing,
    maxConcurrentRuns: env.INFERENCE_MAX_CONCURRENT_RUNS,
    runTimeoutMs: env.INFERENCE_RUN_TIMEOUT_MS,
  });

  // Dependency groups resolve from the environment, so a deployment that sets `TIMESERIES_DATABASE_URL`
  // gains the timeseries tools with no code change. `toolDeps` stays as an override for a caller that
  // owns its own clients — a test, or a service sharing one connection pool.
  const toolDeps = overrides.toolDeps ?? createToolDeps(env);
  const tools = new Map<AgentMode, BuiltTools>([
    ["v01", buildTools("v01", toolDeps)],
    ["deep", buildTools("deep", toolDeps)],
  ]);

  return {
    env,
    sessions,
    runs: stores.runs,
    journal: stores.journal,
    hub,
    agents,
    sandbox,
    forecasts,
    models: new ModelRegistry(env),
    custody,
    approvals,
    orchestrator,
    tracing,
    tools,
    yieldsFeed: overrides.yieldsFeed ?? createYieldsFeed(),
    startedAt: now().toISOString(),
  };
}

interface RuntimeRegistry {
  __agenticEmsInferenceRuntime?: InferenceRuntime;
}

const scope = globalThis as unknown as RuntimeRegistry;

/** The warm-instance runtime. Built on first use, reused thereafter. */
export function getRuntime(overrides: RuntimeOverrides = {}): InferenceRuntime {
  scope.__agenticEmsInferenceRuntime ??= createRuntime(overrides);
  return scope.__agenticEmsInferenceRuntime;
}

/** Drop the cached runtime (tests only). */
export function resetRuntime(): void {
  delete scope.__agenticEmsInferenceRuntime;
}

/**
 * Release runtime-owned resources.
 *
 * In-memory stores and the local sandbox hold nothing to release; the pooled `pg`
 * client lands with the TimescaleDB stores (ROADMAP T1.1). Tracing is flushed
 * here because a frozen Cloud Run instance drops backgrounded trace batches —
 * SIGTERM is the last chance to send them.
 */
export async function closeRuntime(runtime: InferenceRuntime): Promise<void> {
  await runtime.tracing.flush();
}
