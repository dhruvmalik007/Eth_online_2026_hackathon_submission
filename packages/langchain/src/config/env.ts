import { z } from "zod";

/**
 * Environment configuration for the LangChain agent package.
 * Validates Vertex AI + The Graph + Arc + Wallet settings at startup.
 */

const envSchema = z.object({
  // Vertex AI
  GOOGLE_CLOUD_PROJECT: z.string().min(1).optional(),
  GOOGLE_CLOUD_LOCATION: z.string().default('us-central1'),
  // gemini-2.5-flash-lite = cheapest Gemini tier; verified available on this project
  VERTEX_AI_MODEL: z.string().default('gemini-2.5-flash-lite'),
  VERTEX_AI_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.1),

  // LangSmith tracing (Level B/C — traces stream to smith.langchain.com).
  // EU-region accounts MUST set LANGSMITH_ENDPOINT=https://eu.api.smith.langchain.com —
  // against the default US endpoint a valid EU key returns 403 Forbidden.
  LANGSMITH_TRACING: z.enum(['true', 'false']).optional(),
  LANGSMITH_ENDPOINT: z.string().url().optional(),
  LANGSMITH_API_KEY: z.string().min(1).optional(),
  LANGSMITH_ORG_ID: z.string().optional(),
  LANGSMITH_WORKSPACE_ID: z.string().optional(),
  LANGSMITH_PROJECT: z.string().optional(),
  // Arc (testnet) — read by the strategy pipeline's arc-bridge execution leg.
  // RPC is a URL; CCTP domain is a numeric id (26 = Arc testnet per arc-node#110);
  // the contract addresses are 0x-prefixed 20-byte hex.
  ARC_PRIVATE_KEY: z.string().optional(),
  ARC_TESTNET_RPC_URL: z.string().url().optional(),
  ARC_TESTNET_CCTP_DOMAIN: z.coerce.number().default(26),
  ARC_TESTNET_USDC: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  ARC_TESTNET_MESSAGE_V2: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  ARC_TESTNET_TOKEN_MESSENGER_V2: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),


  // The Graph
  GATEWAY_API_KEY: z.string().min(1).optional(),
  STUDIO_PERP_SEPOLIA_ENDPOINT: z.string().url().optional(),

  // Uniswap v4 subgraph (official Ethereum mainnet deployment)
  UNISWAP_V4_SUBGRAPH_ID: z.string().default('DiYPVdygkfjDWhbxGSqAQxwBKmfKnkWQojqeM2rkLb3G'),
  // Optional Studio URL override for self-deployed Sepolia instances
  UNISWAP_V4_STUDIO_ENDPOINT: z.string().url().optional(),

  // TimesFM-3 inference service (deployed Cloud Run, GPU) + TimescaleDB store
  TIMESFM3_SERVICE_URL: z.string().url().default('https://timesfm3-inference-887606357212.us-central1.run.app'),
  TIMESERIES_DB_HOST: z.string().default('localhost'),
  TIMESERIES_DB_PORT: z.coerce.number().default(5432),
  TIMESERIES_DB_NAME: z.string().default('agentic_ems'),
  TIMESERIES_DB_USER: z.string().default('postgres'),
  TIMESERIES_DB_PASSWORD: z.string().default(''),

  // Wallet (optional)
  WALLET_MODE: z.enum(['ledger', 'private-key', 'readonly']).default('readonly'),
  WALLET_PRIVATE_KEY: z.string().optional(),
  WALLET_LEDGER_PATH: z.string().optional(),
  WALLET_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),

  // RPC
  RPC_URL_SEPOLIA: z.string().url().default('https://ethereum-sepolia-rpc.publicnode.com'),
  RPC_URL_BASE_SEPOLIA: z.string().url().default('https://base-sepolia-rpc.publicnode.com'),
  RPC_URL_ARBITRUM_SEPOLIA: z.string().url().default('https://arbitrum-sepolia-rpc.publicnode.com'),
  RPC_URL_OPTIMISM_SEPOLIA: z.string().url().default('https://optimism-sepolia-rpc.publicnode.com'),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  return parsed.data;
}
