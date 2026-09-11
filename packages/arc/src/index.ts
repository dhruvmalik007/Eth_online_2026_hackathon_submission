/**
 * @ethonline2026/arc-client — createArcClient(env) façade.
 *
 * Everything Arc-side (CCTP V2, App Kit, StableFX, Agent Wallet, ERC-8183
 * kernel) is constructed here and exposed time-boxed and typed. LangChain
 * tools consume this façade; they never import SDKs or viem directly.
 *
 * Env (see also apps/langchain .env.example):
 *   ARC_NETWORK            = arc-testnet | arc-mainnet   (default: arc-testnet)
 *   ARC_PRIVATE_KEY        = agent EOA (scoped-wallet policies in code)
 *   ARC_TESTNET_RPC_URL / ARC_MAINNET_RPC_URL
 *   ARC_TESTNET_USDC / ARC_MAINNET_USDC
 *   ARC_TESTNET_TOKEN_MESSENGER_V2 / ARC_MAINNET_TOKEN_MESSENGER_V2
 *   ARC_TESTNET_CCTP_DOMAIN / ARC_MAINNET_CCTP_DOMAIN
 *   ARC_ACP_KERNEL         = deployed AgenticCommerce kernel address
 *   ARC_RISK_EVALUATOR_HOOK= deployed RiskEvaluatorHook address
 *   IRIS_API_URL           = default https://iris-api.circle.com
 *   CIRCLE_API_KEY         = optional, lifts App Kit Swap rate limits
 */
import type { Address } from "viem";
import { AgentWallet } from "./wallet.js";
import { CctpV2 } from "./cctp.js";
import { AppKitBridge } from "./appkit.js";
import { StableFx } from "./stablefx.js";
import { AcpKernel } from "./erc8183/kernel.js";
import { riskEvaluatorHookAddress } from "./erc8183/hook.js";
import { arcChainConfig, arcViemChain, type ArcNetwork } from "./chains.js";

type AddressLike = `0x${string}`;

export interface ArcClientEnv {
  ARC_NETWORK?: ArcNetwork;
  ARC_PRIVATE_KEY?: AddressLike;
  CIRCLE_API_KEY?: string;
  IRIS_API_URL?: string;
  ARC_ACP_KERNEL?: AddressLike;
  ARC_RISK_EVALUATOR_HOOK?: AddressLike;
  [key: string]: unknown;
}

export interface ArcClient {
  network: ArcNetwork;
  wallet: AgentWallet;
  appKit: AppKitBridge;
  stablefx: StableFx;
  cctp(opts: {
    sourceRpcUrl: string;
    sourceUsdc: AddressLike;
    sourceTokenMessengerV2: AddressLike;
    sourceUsdcDecimals?: number;
    sourceIsArc?: boolean;
  }): CctpV2;
  acp(): AcpKernel;
  config: ReturnType<typeof arcChainConfig>;
  chain: ReturnType<typeof arcViemChain>;
  riskEvaluatorHook: AddressLike | null;
}

export function createArcClient(env: ArcClientEnv): ArcClient {
  const network: ArcNetwork = env.ARC_NETWORK ?? "arc-testnet";
  const cfg = arcChainConfig(network);
  const chain = arcViemChain(cfg);
  const privateKey = (env.ARC_PRIVATE_KEY ??
    "0x0000000000000000000000000000000000000000000000000000000000000001") as AddressLike;
  const wallet = new AgentWallet({ privateKey });

  const appKit = new AppKitBridge({
    apiKey: env.CIRCLE_API_KEY,
    environment: network === "arc-mainnet" ? "mainnet" : "testnet",
    wallet,
  });

  const stablefx = new StableFx(appKit);

  return {
    network,
    wallet,
    config: cfg,
    chain,
    appKit,
    stablefx,
    riskEvaluatorHook: env.ARC_RISK_EVALUATOR_HOOK ?? riskEvaluatorHookAddress(),
    cctp(opts: {
      sourceRpcUrl: string;
      sourceUsdc: AddressLike;
      sourceTokenMessengerV2: AddressLike;
      sourceUsdcDecimals?: number;
      sourceIsArc?: boolean;
    }): CctpV2 {
      return new CctpV2({
        network,
        account: wallet.address,
        sourceRpcUrl: opts.sourceRpcUrl,
        sourceUsdc: opts.sourceUsdc as Address,
        sourceTokenMessengerV2: opts.sourceTokenMessengerV2 as Address,
        sourceUsdcDecimals: opts.sourceUsdcDecimals,
        sourceIsArc: opts.sourceIsArc,
        irisApiUrl: (env.IRIS_API_URL as string) ?? undefined,
      });
    },
    acp(): AcpKernel {
      const kernel = env.ARC_ACP_KERNEL;
      if (!kernel) {
        throw new Error(
          "ARC_ACP_KERNEL not set — deploy the ERC-8183 AgenticCommerce kernel on Arc (plan §7 Phase B) and pin the address.",
        );
      }
      return new AcpKernel(kernel as Address, cfg.rpcUrl, chain, wallet.address);
    },
  };
}

// Re-exports for LangChain tools and tests.
export { AgentWallet, CctpV2, AppKitBridge, StableFx, AcpKernel };
export { arcChainConfig, arcViemChain, CCTP_DOMAINS, SPOKE_DOMAINS } from "./chains.js";
export type { ArcNetwork, ArcChainConfig } from "./chains.js";
export { ERC8183_ABI, JOB_STATUS, encodeExpectation, riskEvaluatorHookAddress } from "./erc8183/index.js";
export type { AcpJob, JobStatus } from "./erc8183/kernel.js";
