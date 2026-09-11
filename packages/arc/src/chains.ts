/**
 * Arc chain definitions + CCTP domain registry.
 *
 * VERIFIED against primary sources (2026-09-07):
 *  - Chain IDs: 5042002 (testnet) / 5042 (mainnet) — Arcscan docs
 *  - Arc testnet native USDC: 0x3600000000000000000000000000000000000000
 *    ⚠️ 18 decimals on Arc (bridging scales 6dp ↔ 18dp) — UnitFlow/official docs
 *  - Arc testnet MessageTransmitter (MessageTransmitterV2):
 *    0xe737e5cebeeba77efe34d4aa090756590b1ce275 — Circle quickstart
 *    "Transfer USDC from Ethereum to Arc"
 *  - Arc testnet CCTP domain: 26 — same quickstart
 *  - Ethereum Sepolia USDC 0x1c7d4b196cb0c7b01d743fbc6116a902379c7238 (6dp),
 *    TokenMessenger 0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa — same quickstart
 *  - Iris (testnet): https://iris-api-sandbox.circle.com — same quickstart
 *
 * Arc-side TokenMessenger (OUTBOUND Arc → spoke burns) — VERIFIED via
 * circlefin/arc-node#110: Circle deploys CCTP at the same address across chains,
 * so Arc's TokenMessenger is 0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA
 * (identical to Sepolia's). Two Arc-specific rules from the same source:
 *  - Arc-SOURCED burns REQUIRE minFinalityThreshold 2000 — with 1000 the Iris
 *    attestation never progresses past `pending` (arc-node#110).
 *  - Arc CCTP contracts are V2-only; the V1 4-arg selector silently reverts.
 */
import type { Chain } from "viem";

/** Arc TokenMessenger — same cross-chain address as other CCTP deployments. */
export const ARC_TOKEN_MESSENGER_V2 =
  "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA" as const;

/** CCTP domain ids — Circle-published mapping (0 = Ethereum mainnet/Sepolia). */
export const CCTP_DOMAINS = {
  ethereum: 0,
  avalanche: 1,
  optimism: 2,
  arbitrum: 3,
  base: 6,
  polygon: 7,
  "arc-testnet": 26,
} as const;

export type KnownChain = keyof typeof CCTP_DOMAINS;

/** Arc network selector — ARC_NETWORK env switches testnet⇄mainnet. */
export type ArcNetwork = "arc-testnet" | "arc-mainnet";

export interface ArcChainConfig {
  network: ArcNetwork;
  chainId: number;
  rpcUrl: string;
  /** Native USDC on Arc (also the gas token). ⚠️ 18 decimals on Arc. */
  usdcAddress: string;
  usdcDecimals: number;
  /** CCTP V2 MessageTransmitter on Arc (inbound mint path) — verified testnet. */
  messageTransmitterV2: string;
  /** CCTP V2 TokenMessenger on Arc (outbound burns) — verified via arc-node#110. */
  tokenMessengerV2: string;
  cctpDomain: number;
  explorerUrl: string;
}

export function arcChainConfig(network: ArcNetwork): ArcChainConfig {
  if (network === "arc-mainnet") {
    return {
      network,
      chainId: Number(process.env.ARC_MAINNET_CHAIN_ID ?? 5042),
      rpcUrl: process.env.ARC_MAINNET_RPC_URL ?? "",
      usdcAddress: process.env.ARC_MAINNET_USDC ?? "",
      usdcDecimals: 6,
      messageTransmitterV2: process.env.ARC_MAINNET_MESSAGE_TRANSMITTER_V2 ?? "",
      tokenMessengerV2: process.env.ARC_MAINNET_TOKEN_MESSENGER_V2 ?? ARC_TOKEN_MESSENGER_V2,
      cctpDomain: Number(process.env.ARC_MAINNET_CCTP_DOMAIN ?? 0),
      explorerUrl: "https://arc-scan.org",
    };
  }
  return {
    network,
    chainId: Number(process.env.ARC_TESTNET_CHAIN_ID ?? 5042002),
    rpcUrl: process.env.ARC_TESTNET_RPC_URL ?? "https://rpc.testnet.arc.network",
    // ⚠️ 18 decimals on Arc native USDC (bridging scales 6↔18).
    usdcAddress: process.env.ARC_TESTNET_USDC ?? "0x3600000000000000000000000000000000000000",
    usdcDecimals: 18,
    // VERIFIED: Circle quickstart "Transfer USDC from Ethereum to Arc".
    messageTransmitterV2:
      process.env.ARC_TESTNET_MESSAGE_V2 ??
      process.env.ARC_TESTNET_MESSAGE_TRANSMITTER_V2 ??
      "0xe737e5cebeeba77efe34d4aa090756590b1ce275",
    // VERIFIED: arc-node#110 — same address as other CCTP deployments.
    tokenMessengerV2: process.env.ARC_TESTNET_TOKEN_MESSENGER_V2 ?? ARC_TOKEN_MESSENGER_V2,
    cctpDomain: Number(process.env.ARC_TESTNET_CCTP_DOMAIN ?? 26),
    explorerUrl: "https://testnet.arc-scan.org",
  };
}

/** Minimal viem chain object built from config (keeps us independent of viem/chains drift). */
export function arcViemChain(cfg: ArcChainConfig): Chain {
  return {
    id: cfg.chainId,
    name: cfg.network,
    nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: cfg.usdcDecimals },
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
  };
}

/** Spoke chains the EMS already operates on (verified live in this repo). */
export const SPOKE_DOMAINS: Array<{ chain: KnownChain; domain: number; label: string }> = [
  { chain: "ethereum", domain: CCTP_DOMAINS.ethereum, label: "Ethereum" },
  { chain: "arbitrum", domain: CCTP_DOMAINS.arbitrum, label: "Arbitrum" },
  { chain: "optimism", domain: CCTP_DOMAINS.optimism, label: "Optimism" },
  { chain: "polygon", domain: CCTP_DOMAINS.polygon, label: "Polygon" },
];

/**
 * Iris attestation base per network — the testnet quickstart uses the SANDBOX
 * Iris; production Iris only for mainnet.
 */
export function irisBaseUrl(network: ArcNetwork): string {
  return network === "arc-mainnet"
    ? (process.env.IRIS_API_URL ?? "https://iris-api.circle.com")
    : "https://iris-api-sandbox.circle.com";
}
