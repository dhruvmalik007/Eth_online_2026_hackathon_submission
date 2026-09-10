import { z } from 'zod';

/**
 * Network registry — Studio-deployable testnets verified 2026-09-03 against
 * graphprotocol/networks-registry. Keep in sync with SUBGRAPH_SPEC.md §2.
 */
export const TESTNET_CHAINS = ['sepolia', 'arbitrum-sepolia', 'base-sepolia', 'optimism-sepolia', 'polygon-amoy'] as const;

export type TestnetChain = (typeof TESTNET_CHAINS)[number];

export interface ChainInfo {
  readonly id: number;
  readonly name: TestnetChain;
  readonly viemChain: 'sepolia' | 'arbitrumSepolia' | 'baseSepolia' | 'optimismSepolia' | 'polygonAmoy';
  readonly rpcEnvKey:
    | 'RPC_URL_SEPOLIA'
    | 'RPC_URL_BASE_SEPOLIA'
    | 'RPC_URL_ARBITRUM_SEPOLIA'
    | 'RPC_URL_OPTIMISM_SEPOLIA'
    | 'RPC_URL_POLYGON_AMOY';
  readonly explorer: string;
}

export const CHAIN_INFO: Record<TestnetChain, ChainInfo> = {
  sepolia: {
    id: 11155111,
    name: 'sepolia',
    viemChain: 'sepolia',
    rpcEnvKey: 'RPC_URL_SEPOLIA',
    explorer: 'https://sepolia.etherscan.io',
  },
  'arbitrum-sepolia': {
    id: 421614,
    name: 'arbitrum-sepolia',
    viemChain: 'arbitrumSepolia',
    rpcEnvKey: 'RPC_URL_ARBITRUM_SEPOLIA',
    explorer: 'https://sepolia.arbiscan.io',
  },
  'base-sepolia': {
    id: 84532,
    name: 'base-sepolia',
    viemChain: 'baseSepolia',
    rpcEnvKey: 'RPC_URL_BASE_SEPOLIA',
    explorer: 'https://sepolia.basescan.org',
  },
  'optimism-sepolia': {
    id: 11155420,
    name: 'optimism-sepolia',
    viemChain: 'optimismSepolia',
    rpcEnvKey: 'RPC_URL_OPTIMISM_SEPOLIA',
    explorer: 'https://sepolia-optimism.etherscan.io',
  },
  'polygon-amoy': {
    id: 80002,
    name: 'polygon-amoy',
    viemChain: 'polygonAmoy',
    rpcEnvKey: 'RPC_URL_POLYGON_AMOY',
    explorer: 'https://amoy.polygonscan.com',
  },
};

const envSchema = z.object({
  GATEWAY_API_KEY: z.string().min(1).optional(),
  STUDIO_PERP_SEPOLIA_ENDPOINT: z.string().url().optional().or(z.literal('')),
  WALLET_MODE: z.enum(['ledger', 'private-key', '']).optional(),
  WALLET_LEDGER_PATH: z.string().optional(),
  WALLET_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  WALLET_PRIVATE_KEY: z.string().optional(),
  RPC_URL_SEPOLIA: z.string().url().default('https://ethereum-sepolia-rpc.publicnode.com'),
  RPC_URL_BASE_SEPOLIA: z.string().url().default('https://base-sepolia-rpc.publicnode.com'),
  RPC_URL_ARBITRUM_SEPOLIA: z.string().url().default('https://arbitrum-sepolia-rpc.publicnode.com'),
  RPC_URL_OPTIMISM_SEPOLIA: z.string().url().default('https://optimism-sepolia-rpc.publicnode.com'),
  // Official Polygon Amoy public RPC (docs.polygon.technology — chain id 80002)
  RPC_URL_POLYGON_AMOY: z.string().url().default('https://polygon-amoy.drpc.org'),
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
