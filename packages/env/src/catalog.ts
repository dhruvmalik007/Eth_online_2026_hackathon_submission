import { ENVIRONMENTS, type EnvFormat, type Environment, type EnvVarSpec, type Service } from "./types.js";

const NONE: readonly Environment[] = [];

interface VarOptions {
  readonly requiredIn?: readonly Environment[];
  readonly secret?: boolean;
  readonly format?: EnvFormat;
  readonly allowed?: readonly string[];
  readonly default?: string;
  readonly example?: string;
}

/** Build a spec, filling the fields that are almost always the default. */
function v(
  name: string,
  services: readonly Service[],
  description: string,
  options: VarOptions = {},
): EnvVarSpec {
  return {
    name,
    services,
    description,
    requiredIn: options.requiredIn ?? NONE,
    secret: options.secret ?? false,
    format: options.format ?? "string",
    ...(options.allowed === undefined ? {} : { allowed: options.allowed }),
    ...(options.default === undefined ? {} : { default: options.default }),
    ...(options.example === undefined ? {} : { example: options.example }),
  };
}

/**
 * Every variable the workspace reads, in one place.
 *
 * The rule for adding one: it is described here *and* read via `@ethonline2026/env`, never as a bare
 * `process.env` lookup. A value that is read in two styles is a value that drifts.
 */
export const ENV_CATALOG: readonly EnvVarSpec[] = [
  // ── shared ────────────────────────────────────────────────────────────────────────────────────
  v("EMS_ENV", ["shared"], "Which environment this process serves. Selects every URL, database and key prefix.", {
    requiredIn: ["staging", "production"],
    format: "enum",
    allowed: [...ENVIRONMENTS],
    default: "local",
    example: "local",
  }),
  v("LOG_LEVEL", ["shared", "execution", "inference"], "Pino log level.", {
    format: "enum",
    allowed: ["fatal", "error", "warn", "info", "debug", "trace"],
    default: "info",
  }),
  v("INDEXER_RUNTIME", ["indexer"], "Where the indexer executes: `local` process, `vercel` functions, or `cloudrun` service.", {
    format: "enum",
    allowed: ["local", "vercel", "cloudrun"],
    default: "local",
  }),
  v("FORK_EXECUTION_RUNTIME", ["fork-execution"], "Where fork simulation runs: `local`, the stateless `vercel` façade, or the full `cloudrun` Anvil job.", {
    format: "enum",
    allowed: ["local", "vercel", "cloudrun"],
    default: "local",
  }),

  // ── time-series store ────────────────────────────────────────────────────────────────────────
  v("TIMESERIES_DATABASE_URL", ["timeseries", "execution", "inference", "indexer", "langchain", "risk"], "Postgres/TimescaleDB DSN. Required outside local; local uses the docker compose instance.", {
    requiredIn: ["staging", "production"],
    secret: true,
    format: "dsn",
    example: "postgres://user:password@host:5432/agentic_ems?sslmode=require",
  }),
  v("TIMESERIES_DB_HOST", ["timeseries", "langchain"], "Discrete connection key, used only when no DSN is set.", { format: "string" }),
  v("TIMESERIES_DB_PORT", ["timeseries", "langchain"], "Discrete connection key.", { format: "port" }),
  v("TIMESERIES_DB_NAME", ["timeseries", "langchain"], "Discrete connection key.", { format: "string" }),
  v("TIMESERIES_DB_USER", ["timeseries", "langchain"], "Discrete connection key.", { format: "string" }),
  v("TIMESERIES_DB_PASSWORD", ["timeseries", "langchain"], "Discrete connection key.", { secret: true }),
  v("TIMESERIES_DB_MAX_CONNECTIONS", ["timeseries", "execution", "inference", "indexer", "langchain", "risk"], "Upper bound on pooled connections per instance.", {
    format: "number",
    default: "5",
  }),

  // ── cache ────────────────────────────────────────────────────────────────────────────────────
  v("REDIS_URL", ["execution", "inference"], "Upstash Redis REST URL. Required in staging and production; local uses the in-memory CachePort.", {
    requiredIn: ["staging", "production"],
    secret: true,
    format: "url",
  }),
  v("REDIS_TOKEN", ["execution", "inference"], "Upstash Redis REST token.", {
    requiredIn: ["staging", "production"],
    secret: true,
  }),

  // ── blob / CDN ───────────────────────────────────────────────────────────────────────────────
  v("BLOB_READ_WRITE_TOKEN", ["agentic-ems", "execution", "inference"], "Vercel Blob token for app artifacts (renders, evidence, exports).", { secret: true }),
  v("RISK_GCS_BUCKET", ["risk", "indexer", "inference", "langchain"], "GCS bucket holding the risk feed documents.", { format: "string" }),
  v("RISK_GCS_PREFIX", ["risk", "indexer", "inference", "langchain"], "Prefix inside the risk bucket.", { default: "risk" }),
  v("RISK_LOCAL_DIR", ["risk", "indexer", "inference", "langchain"], "Local directory used instead of GCS (local development).", { format: "path" }),
  v("EDGE_CONFIG", ["agentic-ems", "execution", "indexer"], "Vercel Global Config connection string for runtime flags and per-env service URLs.", { secret: true }),

  // ── scheduled maintenance ───────────────────────────────────────────────────────────────────
  // Tagged `langchain` as well as `indexer`, because that package's schema declares the key and
  // `assertCatalogKeys` checks *service association*, not just membership in the catalog. `requiredIn`
  // is per-spec, so this does make `env check --service langchain --env staging` ask for it — which is
  // accurate rather than noisy: the schema that declares it is langchain's, and the only deployment
  // that consumes it is the indexer, whose refresh probe fails closed without it.
  v("CRON_SECRET", ["indexer", "langchain"], "Bearer token the scheduled refresh job presents to POST /api/cron/probe.", { secret: true, requiredIn: ["staging", "production"] }),

  // ── execution service ────────────────────────────────────────────────────────────────────────
  v("EXECUTION_MODE", ["execution"], "`dry` simulates and records; `live` may broadcast.", {
    format: "enum",
    allowed: ["dry", "live"],
    default: "dry",
  }),
  v("PORT", ["execution", "inference", "indexer"], "HTTP port; Cloud Run injects it.", { format: "port", default: "8080" }),
  v("HOST", ["execution", "inference"], "Bind address.", { default: "0.0.0.0" }),
  v("EXECUTION_EVENT_BUFFER", ["execution"], "Events buffered before a forced flush; bounds memory per instance.", { format: "number", default: "128" }),
  v("ONEINCH_AQUA_ENABLED", ["execution"], "Whether the 1inch Aqua/SwapVM venue is offered at all.", { format: "flag", default: "false" }),
  v("ONEINCH_AQUA_CHAINS", ["execution"], "Chains where the venue may be offered.", { format: "csv", default: "optimism,polygon" }),
  v("ONEINCH_MIN_EFFICIENCY_BPS", ["execution"], "Delta below which switching venue is not worth making.", { format: "number", default: "20" }),
  v("ONEINCH_AGENT_ENABLEMENT", ["execution"], "Whether an agent mandate may enable the venue itself.", { format: "flag", default: "false" }),
  v("ONEINCH_AGENT_MIN_EFFICIENCY_BPS", ["execution"], "Delta above which enabling is arithmetic, so an agent may act.", { format: "number", default: "100" }),
  v("APPROVAL_REQUIRED_BY_DEFAULT", ["execution"], "Whether an operator must approve an intent before it executes.", { format: "flag", default: "true" }),
  v("APPROVAL_MAX_SPEND_USD", ["execution"], "Most one agent may commit in a single intent, in whole USD.", { format: "number", default: "250000" }),
  v("PRIVY_APP_ID", ["execution", "custody", "inference"], "Privy App ID (a public identifier)."),
  v("PRIVY_APP_SECRET", ["execution", "custody", "inference"], "Privy App Secret (server-side).", { secret: true }),
  v("PRIVY_VERIFICATION_KEY", ["execution", "agentic-ems"], "Privy verification key; removes a round-trip from cold start.", { secret: true }),
  v("EXECUTION_SIGNER_PRIVATE_KEY", ["execution"], "Key the service signs and broadcasts with. Absent means the signer routes answer 503.", { secret: true }),
  v("EXECUTION_FALLBACK_SIGNER_PRIVATE_KEY", ["execution"], "Backup payer used only when the primary is absent.", { secret: true }),
  v("EXECUTION_SIGNER_CHAIN", ["execution"], "Chain the signer binds to.", { default: "base-sepolia" }),
  v("EXECUTION_SIGNER_RPC_URL", ["execution"], "RPC overriding the signer chain default.", { format: "url" }),
  v("LIFI_API_KEY", ["execution", "bridges", "inference"], "LI.FI API key for quotes and routes.", { secret: true }),

  // ── inference service ────────────────────────────────────────────────────────────────────────
  v("INFERENCE_MODE", ["inference"], "Operating mode for the inference service.", { default: "serve" }),
  v("INFERENCE_PERSISTENCE", ["inference"], "Where runs are acknowledged; `timescale` is the durable option.", {
    format: "enum",
    allowed: ["memory", "timescale"],
    default: "memory",
  }),
  v("AGENT_IMPL", ["inference"], "Which agent implementation to run.", { default: "v01" }),
  v("INFERENCE_MAX_CONCURRENT_RUNS", ["inference"], "Concurrency cap per instance.", { format: "number", default: "2" }),
  v("INFERENCE_RUN_TIMEOUT_MS", ["inference"], "Hard timeout for one run.", { format: "number", default: "600000" }),
  v("INFERENCE_SSE_HEARTBEAT_MS", ["inference"], "SSE heartbeat interval.", { format: "number", default: "15000" }),
  v("SANDBOX_PROVIDER", ["inference"], "Sandbox backend: local, remote or a Cloud Run service.", { default: "local" }),
  v("SANDBOX_SERVICE_URL", ["inference"], "Remote sandbox endpoint.", { format: "url" }),
  v("SANDBOX_MAX_PER_INSTANCE", ["inference"], "Sandboxes allowed per instance.", { format: "number", default: "4" }),
  v("SANDBOX_TTL_MS", ["inference"], "Sandbox lifetime.", { format: "number", default: "900000" }),
  v("SANDBOX_ROOT", ["inference"], "Root directory for local sandboxes.", { format: "path" }),
  v("SANDBOX_EGRESS_ALLOWLIST", ["inference"], "Egress hosts a sandbox may reach.", { format: "csv" }),
  v("GOOGLE_CLOUD_PROJECT", ["inference", "indexer", "langchain", "risk"], "GCP project for Vertex AI and Cloud Storage.", { format: "string" }),
  v("GOOGLE_CLOUD_LOCATION", ["inference", "indexer", "langchain", "risk"], "GCP region for Vertex AI.", { default: "us-central1" }),
  v("GOOGLE_SERVICE_ACCOUNT_KEY", ["inference", "indexer", "risk", "agentic-ems"], "Service-account JSON, materialised to a 0600 file at boot.", { secret: true, format: "json" }),
  v("GOOGLE_APPLICATION_CREDENTIALS", ["indexer"], "Path to the materialised service-account file.", { format: "path" }),
  v("VERTEX_AI_MODEL", ["inference", "indexer", "langchain"], "Vertex generative model id.", { default: "gemini-2.5-flash" }),
  v("VERTEX_AI_TEMPERATURE", ["inference", "langchain"], "Sampling temperature.", { format: "number" }),
  v("VERTEX_EMBEDDING_MODEL", ["inference", "indexer", "timeseries", "langchain", "risk"], "Vertex embedding model id.", { default: "text-embedding-005" }),
  v("LANGCHAIN_MODEL_PARSER", ["inference"], "Model used for the parsing role.", { default: "gemini-2.5-flash" }),
  v("LANGCHAIN_MODEL_SYNTHESIS", ["inference"], "Model used for the synthesis role.", { default: "gemini-2.5-pro" }),
  v("TIMESFM3_SERVICE_URL", ["inference", "indexer", "langchain"], "TimesFM-3 forecasting service endpoint.", { format: "url" }),
  v("GATEWAY_API_KEY", ["inference", "indexer", "langchain", "the-graph"], "The Graph gateway API key.", { secret: true }),
  v("STUDIO_PERP_SEPOLIA_ENDPOINT", ["inference", "indexer", "langchain", "the-graph"], "Subgraph endpoint for the perpetuals studio dataset.", { format: "url" }),
  v("UNISWAP_V4_SUBGRAPH_ID", ["inference", "indexer", "langchain"], "Uniswap v4 subgraph id.", { format: "string" }),
  v("UNISWAP_V4_STUDIO_ENDPOINT", ["langchain"], "Uniswap v4 studio endpoint override.", { format: "url" }),
  v("CIRCLE_API_KEY", ["inference", "bridges"], "Circle API key (CCTP).", { secret: true }),
  v("CIRCLE_ENTITY_SECRET", ["inference", "bridges"], "Circle entity secret.", { secret: true }),
  v("CIRCLE_TEST_API_KEY", ["bridges"], "Circle testnet API key.", { secret: true }),
  v("ARC_NETWORK", ["inference", "langchain", "arc"], "Arc network selector (testnet/mainnet).", { default: "testnet" }),
  v("ARC_TESTNET_RPC_URL", ["inference", "langchain", "arc"], "Arc testnet RPC.", { format: "url" }),
  v("ARC_PRIVATE_KEY", ["langchain"], "Arc signing key.", { secret: true }),
  v("ARC_TESTNET_USDC", ["langchain", "arc"], "USDC address on the Arc testnet."),
  v("ARC_TESTNET_CCTP_DOMAIN", ["langchain", "arc"], "CCTP domain id for Arc testnet.", { format: "number" }),
  v("ARC_TESTNET_MESSAGE_V2", ["langchain", "arc"], "CCTP v2 message contract address."),
  v("ARC_TESTNET_TOKEN_MESSENGER_V2", ["langchain", "arc"], "CCTP v2 token messenger address."),
  v("ARC_ACP_KERNEL", ["langchain"], "Arc agent-commerce kernel address."),
  v("ARC_RISK_EVALUATOR_HOOK", ["langchain", "arc"], "Arc risk-evaluator hook address."),
  v("STABLEFX_RATE_USDC_EURC", ["langchain"], "Pinned StableFX rate for deterministic runs.", { format: "number" }),
  v("IRIS_API_URL", ["arc"], "Circle Iris attestation API base.", { format: "url" }),

  // ── custody (Ledger + Privy) ─────────────────────────────────────────────────────────────────
  v("CUSTODY_SIGNER", ["custody", "inference"], "Which signer custody uses (ledger, privy, local-key).", { format: "string" }),
  v("CUSTODY_MODE", ["custody", "inference"], "Custody operating mode.", { default: "dry" }),
  v("CUSTODY_SAFE_ADDRESS", ["custody", "inference"], "Safe address that owns execution."),
  v("CUSTODY_SAFE_CHAIN", ["custody", "inference"], "Chain the Safe lives on.", { default: "sepolia" }),
  v("CUSTODY_SAFE_OWNERS", ["custody", "inference"], "Safe owner addresses.", { format: "csv" }),
  v("CUSTODY_SAFE_THRESHOLD", ["custody", "inference"], "Safe signature threshold.", { format: "number" }),
  v("CUSTODY_SAFE_TX_SERVICE_URL", ["custody", "inference"], "Safe transaction service base.", { format: "url" }),
  v("CUSTODY_AGENT_KEY_REF", ["custody"], "Key reference the agent is allowed to use."),
  v("CUSTODY_LOG_PATH", ["custody", "inference"], "Append-only JSONL custody audit log path.", { format: "path" }),
  v("CUSTODY_E2E_PRIVATE_KEY", ["custody", "inference"], "Test-only key for end-to-end signing.", { secret: true }),
  v("WALLET_PASS", ["custody"], "Passphrase for the Ledger device session.", { secret: true }),
  v("WALLET_MODE", ["langchain", "the-graph"], "Wallet backend (ledger/private-key).", { format: "string" }),
  v("WALLET_PRIVATE_KEY", ["langchain", "the-graph"], "Wallet key when mode is private-key.", { secret: true }),
  v("WALLET_LEDGER_PATH", ["langchain", "the-graph"], "Ledger derivation path.", { default: "m/44'/60'/0'/0/0" }),
  v("WALLET_ADDRESS", ["langchain", "the-graph"], "Public wallet address."),
  v("ETHEREUM_SEPOLIA_RPC_URL", ["custody", "inference"], "Sepolia RPC for Safe flows.", { format: "url" }),
  v("PRIVY_AUTHORIZATION_PRIVATE_KEY", ["custody", "inference"], "Privy authorization key for server-side wallet actions.", { secret: true }),
  v("PRIVY_WALLET_ID", ["custody", "inference"], "Privy wallet id."),
  v("PRIVY_WALLET_ADDRESS", ["custody", "inference"], "Privy wallet address."),
  v("PRIVY_POLICY_ID", ["custody", "inference"], "Privy policy id."),

  // ── indexer / web ────────────────────────────────────────────────────────────────────────────
  v("NEXT_PUBLIC_INDEXER_URL", ["agentic-ems"], "Indexer base URL used by the browser.", { format: "url" }),
  v("NEXT_PUBLIC_EXECUTION_URL", ["agentic-ems"], "Execution service base URL used by the browser.", { format: "url" }),
  v("NEXT_PUBLIC_PRIVY_APP_ID", ["agentic-ems"], "Privy App ID exposed to the browser.", {
    requiredIn: ["staging", "production"],
  }),
  v("AUTH_SECRET", ["agentic-ems"], "Secret the desk's session cookie is signed with. A random 32-byte value; rotating it signs everyone out.", {
    requiredIn: ["staging", "production"],
    secret: true,
  }),
  v("REACTOR_API_KEY", ["agentic-ems"], "Reactor video API key for the studio.", { secret: true }),
  v("OPENAI_API_KEY", ["agentic-ems"], "OpenAI key for the upsampling route.", { secret: true }),
  v("OPENAI_BASE_URL", ["agentic-ems"], "OpenAI-compatible base URL.", { format: "url" }),
  v("OPENAI_MODEL", ["agentic-ems"], "OpenAI model id."),
  v("INFERENCE_SERVICE_URL", ["agentic-ems"], "Inference service base URL (server-side).", { format: "url" }),
  v("INFERENCE_USER_ID", ["agentic-ems"], "Service identity used when calling inference."),
  v("INFERENCE_ID_TOKEN", ["agentic-ems"], "Pre-minted identity token for inference (optional).", { secret: true }),

  // ── LangSmith ────────────────────────────────────────────────────────────────────────────────
  v("LANGSMITH_TRACING", ["inference", "indexer", "langchain"], "Whether traces are exported.", { format: "flag", default: "false" }),
  v("LANGSMITH_API_KEY", ["inference", "indexer", "langchain"], "LangSmith API key.", { secret: true }),
  v("LANGSMITH_ENDPOINT", ["inference", "indexer", "langchain"], "LangSmith endpoint.", { format: "url" }),
  v("LANGSMITH_ORG_ID", ["inference", "langchain"], "LangSmith organisation id."),
  v("LANGSMITH_WORKSPACE_ID", ["inference", "langchain"], "LangSmith workspace id."),
  v("LANGSMITH_PROJECT", ["inference", "indexer", "langchain"], "LangSmith project name."),
  v("LANGSMITH_PROJECT_ID", ["inference"], "LangSmith project id."),

  // ── RPC endpoints ────────────────────────────────────────────────────────────────────────────
  v("RPC_URL_SEPOLIA", ["langchain", "the-graph"], "Sepolia RPC.", { format: "url", secret: true }),
  v("RPC_URL_BASE_SEPOLIA", ["langchain", "the-graph"], "Base Sepolia RPC.", { format: "url", secret: true }),
  v("RPC_URL_ARBITRUM_SEPOLIA", ["langchain", "the-graph"], "Arbitrum Sepolia RPC.", { format: "url", secret: true }),
  v("RPC_URL_OPTIMISM_SEPOLIA", ["langchain", "the-graph"], "Optimism Sepolia RPC.", { format: "url", secret: true }),
  v("RPC_URL_POLYGON_AMOY", ["the-graph"], "Polygon Amoy RPC.", { format: "url", secret: true }),
  v("ETHEREUM_RPC_URL", ["bridges", "oneinch"], "Mainnet RPC.", { format: "url", secret: true }),
  v("BASE_RPC_URL", ["bridges"], "Base RPC.", { format: "url", secret: true }),
  v("ARBITRUM_RPC_URL", ["bridges", "oneinch"], "Arbitrum RPC.", { format: "url", secret: true }),
  v("OPTIMISM_RPC_URL", ["oneinch"], "Optimism RPC.", { format: "url", secret: true }),
  v("POLYGON_RPC_URL", ["bridges", "oneinch"], "Polygon RPC.", { format: "url", secret: true }),
  v("ALCHEMY_API_KEY", ["bridges", "fork-execution"], "Alchemy key used to build RPC URLs.", { secret: true }),
  v("PRIVATE_KEY", ["bridges"], "Bridge adapter signing key.", { secret: true }),
  v("LAYERZERO_SCAN_BASE_URL", ["bridges"], "LayerZero scan API base.", { format: "url" }),
  v("LAYERZERO_RPCS", ["bridges"], "Per-chain LayerZero RPC map.", { format: "json" }),
  v("LIFI_BASE_URL", ["bridges"], "LI.FI API base override.", { format: "url" }),
  v("MORPHO_API_KEY", ["oneinch"], "Morpho API key.", { secret: true }),
  v("MORPHO_VAULTS_OVERRIDE", ["oneinch"], "Vault list override for local runs.", { format: "json" }),

  // ── fork execution ───────────────────────────────────────────────────────────────────────────
  v("FORK_AGENT_ADDRESS", ["fork-execution"], "Agent address used in fork scenarios."),
  v("FORK_ROUTER_OWNER", ["fork-execution"], "Owner of the fork router."),
  v("FORK_CONTRACTS_DIR", ["fork-execution"], "Directory holding fork contract artefacts.", { format: "path" }),
  v("FORK_EVIDENCE_DIR", ["fork-execution"], "Where evidence JSON is written.", { format: "path" }),
  v("FORK_ANVIL_PORT", ["fork-execution"], "Port the local Anvil fork listens on.", { format: "port", default: "8545" }),

  // ── risk pipeline ────────────────────────────────────────────────────────────────────────────
  v("RISK_REFRESH_CRON", ["risk"], "Schedule for the risk sweep.", { default: "0 */6 * * *" }),
  v("RISK_LOG_FORMAT", ["risk"], "Risk pipeline log format.", { format: "enum", allowed: ["json", "text"], default: "json" }),
  v("RISK_SOURCE_TIMEOUT_S", ["risk"], "Per-source fetch timeout.", { format: "number", default: "30" }),
  v("RISK_MAX_PAGES", ["risk"], "Page cap per source.", { format: "number", default: "20" }),
  v("RISK_HEADLESS", ["risk"], "Run the browser scraper headless.", { format: "flag", default: "true" }),
  // ── Arc mainnet (read by packages/arc alongside the testnet block above) ─────────────────────
  v("ARC_MAINNET_CHAIN_ID", ["arc"], "Chain id for Arc mainnet.", { format: "number" }),
  v("ARC_MAINNET_RPC_URL", ["arc"], "Arc mainnet RPC.", { format: "url", secret: true }),
  v("ARC_MAINNET_USDC", ["arc"], "USDC address on Arc mainnet."),
  v("ARC_MAINNET_CCTP_DOMAIN", ["arc"], "CCTP domain id for Arc mainnet.", { format: "number" }),
  v("ARC_MAINNET_MESSAGE_TRANSMITTER_V2", ["arc"], "CCTP v2 message transmitter on Arc mainnet."),
  v("ARC_MAINNET_TOKEN_MESSENGER_V2", ["arc"], "CCTP v2 token messenger on Arc mainnet."),
  v("ARC_TESTNET_CHAIN_ID", ["arc"], "Chain id for the Arc testnet.", { format: "number" }),
  v("ARC_TESTNET_MESSAGE_TRANSMITTER_V2", ["arc"], "CCTP v2 message transmitter on the Arc testnet."),
  v("ARC_AGENT_WALLET", ["langchain"], "Agent wallet address used by the Arc settlement pipeline."),

  // ── Token addresses used by the cross-chain pipeline ─────────────────────────────────────────
  v("ETHEREUM_SEPOLIA_USDC", ["langchain"], "USDC address on Ethereum Sepolia."),
  v("ETHEREUM_SEPOLIA_TOKEN_MESSENGER", ["langchain"], "CCTP token messenger on Ethereum Sepolia."),
  v("ARBITRUM_USDC", ["langchain"], "USDC address on Arbitrum."),
  v("OPTIMISM_USDC", ["langchain"], "USDC address on Optimism."),
  v("POLYGON_USDC", ["langchain"], "USDC address on Polygon."),

  // ── Venue + UniV4 addresses used by the agent tools ──────────────────────────────────────────
  v("ONEINCH_API_KEY", ["langchain"], "1inch API key for the Aqua routing tools.", { secret: true }),
  v("V4_POSITION_MANAGER", ["langchain"], "Uniswap v4 position manager address."),
  v("V4_RECIPIENT", ["langchain"], "Recipient address for Uniswap v4 positions."),
  v("SWAP_SENDER", ["langchain"], "Sender address used when building swap calls."),

  // ── Service URLs used by scripts and verification ────────────────────────────────────────────
  v("INFERENCE_URL", ["inference"], "Base URL of the inference service, used by its scripts.", { format: "url" }),
  v("SETTLEMENT_RPC_URL", ["inference"], "RPC used by the settlement verification script.", { format: "url", secret: true }),
  v("INDEXER_URL", ["indexer"], "Base URL of a deployed indexer, used by the verification script.", { format: "url" }),

  // ── Privy keys used by the custody scripts ───────────────────────────────────────────────────
  v("PRIVY_KEY_ID", ["custody"], "Privy key id for the server-side signing scripts."),
  v("PRIVY_PRIVATE_KEY", ["custody"], "Privy authorization private key used by the scripts.", { secret: true }),
  v("PRIVY_SECRET", ["custody"], "Privy app secret used by the scripts.", { secret: true }),

  // ── LangChain convention ─────────────────────────────────────────────────────────────────────
  v("LANGCHAIN_TRACING_V2", ["langchain", "inference", "indexer"], "LangChain's own tracing switch; complements LANGSMITH_TRACING.", { format: "flag", default: "false" }),
  v("NEXT_PUBLIC_ARC_CHAIN_ID", ["agentic-ems"], "Arc chain id exposed to the browser.", {
    format: "number", example: "5042002",
  }),
  v("NEXT_PUBLIC_ARC_RPC_URL", ["agentic-ems"], "Arc RPC endpoint exposed to the browser.", {
    format: "url",
  }),
  // WalletConnect / Reown. The project id is public by design: it ships in every dapp client bundle
  // that offers WalletConnect, so committing it leaks nothing. It is NOT a secret, and it must never
  // be confused with the Privy authorization key, which signs our server requests and stays server-side.
  v("NEXT_PUBLIC_REOWN_PROJECT_ID", ["agentic-ems"], "WalletConnect project id from Reown (public, not a secret).", {
    requiredIn: ["staging", "production"], example: "your-reown-project-id",
  }),
];

/** Look a variable up by name. */
export function specFor(name: string): EnvVarSpec | undefined {
  return ENV_CATALOG.find((spec) => spec.name === name);
}

/** Every variable a service reads, whether or not it is required there. */
export function varsForService(service: Service): readonly EnvVarSpec[] {
  return ENV_CATALOG.filter((spec) => spec.services.includes(service));
}

/** The variables a service must have in a given environment. */
export function requiredFor(service: Service, environment: Environment): readonly EnvVarSpec[] {
  return varsForService(service).filter((spec) => spec.requiredIn.includes(environment));
}

/**
 * Variables this workspace may read but does not own.
 *
 * Read from the environment by the OS, the shell, or the agent harness — not part of our
 * configuration, and not something a deployment sets on our behalf. Kept as an explicit list so the
 * drift check can distinguish "someone read a system variable" from "someone invented a
 * configuration key the catalog does not know about".
 */
export const EXTERNAL_ENV_ALLOWLIST: readonly string[] = [
  "PATH",
  "HOME",
  "PWD",
  "SHELL",
  "TMPDIR",
  "USER",
  "NODE_ENV",
  "COMMANDCODE_SCRATCHPAD",
];
