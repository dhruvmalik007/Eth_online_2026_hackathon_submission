import { base, optimism, polygon } from "viem/chains";
import type { Chain } from "viem";
import type { PrivyClientConfig } from "@privy-io/react-auth";

/**
 * Privy configuration for the Agentic EMS desk.
 *
 * The App ID is a public identifier (Privy ships it in the client bundle). The
 * matching App Secret is deliberately NOT read anywhere in this app — auth and
 * wallet provisioning are entirely client-side, so there is no secret to leak.
 *
 * Login is email + one-time code only. Google OAuth was removed deliberately:
 * OAuth needs allowlisted redirect domains per environment, which makes preview
 * deployments painful. An email OTP has no redirect step.
 *
 * Dashboard prerequisites (not settable from code):
 *   - Authentication → enable Email
 *   - Smart wallets → enabled, type "Safe", networks Base / Polygon / Optimism
 *   - App settings → allowed domains include this origin
 */
// Literal member access: Next inlines only a statically-referenced public variable into the client
// bundle. Reading it through the catalog (a dynamic lookup) left this empty in the browser.
export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

/** True when the app has enough config to mount Privy. */
export const PRIVY_CONFIGURED = PRIVY_APP_ID.length > 0;

/** The desk settles on Base; Polygon and Optimism are permitted alternates. */
export const DEFAULT_CHAIN: Chain = base;
export const SUPPORTED_CHAINS: Chain[] = [base, polygon, optimism];

/**
 * Circle's Arc is an EVM-compatible L1 that uses USDC as its native gas token,
 * but it is NOT in Privy's built-in network list (Base/Polygon/Optimism are).
 *
 * Two different levels of support, both currently off:
 *
 *  1. Embedded wallet — possible today: define Arc with viem's `defineChain`
 *     and add it to SUPPORTED_CHAINS. Needs Arc's chain ID + RPC URL from
 *     Circle's docs; do not guess them.
 *
 *  2. Smart wallet (Safe) — additionally requires Arc to be registered as a
 *     CUSTOM CHAIN in the Privy Dashboard, which demands an EIP-155 chain ID,
 *     chain name, bundler URL, paymaster URL and RPC URL — none of which can be
 *     defaulted — and the smart-wallet provider must support Arc.
 *
 * Enable only after both are confirmed:
 *
 *   export const arc = defineChain({
 *     id: Number(process.env.NEXT_PUBLIC_ARC_CHAIN_ID!), // TODO: from Circle docs
 *     name: "Arc",
 *     nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 6 },
 *     rpcUrls: { default: { http: [process.env.NEXT_PUBLIC_ARC_RPC_URL!] } },
 *     blockExplorers: { default: { name: "ArcScan", url: "TODO" } },
 *   });
 */

export const PRIVY_CONFIG: PrivyClientConfig = {
  loginMethods: ["email"],
  embeddedWallets: {
    ethereum: {
      createOnLogin: "users-without-wallets",
    },
  },
  defaultChain: DEFAULT_CHAIN,
  supportedChains: SUPPORTED_CHAINS,
  appearance: {
    theme: "dark",
    accentColor: "#ffb300",
  },
};
