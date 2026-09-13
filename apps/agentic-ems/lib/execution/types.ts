/**
 * Execution domain types.
 *
 * The shape here is deliberately provider-agnostic: the UI renders an
 * `ExecutionPlan`, and an `ExecutionAdapter` produces it. Today that adapter is
 * simulated; a live one will wrap @lifi/sdk, @morpho-org/morpho-sdk, the 1inch
 * REST client, @polymarket/client and a LayerZero OApp/Composer without the UI
 * changing at all.
 */

import type { ExecutionStepState } from "@ethonline2026/ux-workflow";

export type LegKind = "lend" | "lp" | "prediction" | "bridge" | "swap";

export type ChainKey = "base" | "polygon" | "optimism";

/** Who computes the route. `direct` = same-chain, no bridge or aggregator. */
export type RoutingProvider = "lifi" | "oneinch" | "layerzero" | "direct";

export type SigningProvider = "safe-batch" | "per-leg" | "polymarket-order";

export type StepKind =
  | "approve"
  | "wrap"
  | "bridge"
  | "lzSend"
  | "lzCompose"
  | "supply"
  | "swap"
  | "order";

/**
 * Three tiers, and the distinction is the point:
 *  - `cost`   money that actually leaves the wallet (summed into the headline)
 *  - `bound`  a maximum the user accepts (slippage / minReturn) — never summed
 *  - `market` an effect of their own size (price impact) — never summed
 */
export type FeeTier = "cost" | "bound" | "market";

export interface FeeLine {
  id: string;
  label: string;
  tier: FeeTier;
  amountUsd: number;
  bps?: number;
  token?: string;
  chain?: ChainKey;
  provider?: RoutingProvider;
  /**
   * LI.FI semantics: `true` means the cost is already netted out of the quoted
   * output. It is displayed for transparency but must NOT be added to the total.
   */
  included?: boolean;
  /** LayerZero `MessagingFee` denomination. */
  payIn?: "native" | "zro";
  note?: string;
}

export interface Quote {
  legId: string;
  provider: RoutingProvider;
  /** Human venue, e.g. "LI.FI · Stargate", "1inch · Uniswap v3", "LayerZero OApp". */
  venue: string;
  fees: FeeLine[];
  slippageBoundPct: number;
  priceImpactPct: number;
  estimatedSeconds: number;
  /** LayerZero destination endpoint id — must come from lz-definitions, never memory. */
  eid?: number;
  /** Encoded OptionsBuilder bytes (lzReceive + lzCompose gas). */
  options?: string;
}

/** A cross-chain step is three independently-failing stages, not one hash. */
export interface MessageTracking {
  srcTxHash?: string;
  srcExplorerUrl?: string;
  guid?: string;
  scanUrl?: string;
  dstTxHash?: string;
  dstExplorerUrl?: string;
}

export interface ExecutionStep {
  id: string;
  legId: string;
  kind: StepKind;
  label: string;
  /** The clear-signed sentence (ERC-7730 style). */
  intent: string;
  tx: { to: string; value: string; data: string; operation: 0 | 1 };
  state: ExecutionStepState;
  route?: string;
  tracking?: MessageTracking;
  /** Present when the step is authorised by a signature rather than calldata. */
  eip712?: { primaryType: string; domain: Record<string, unknown>; message: Record<string, unknown> };
  error?: string;
  durationMs?: number;
}

export interface IntentLeg {
  id: string;
  kind: LegKind;
  protocol: string;
  chain: ChainKey;
  amountUsd: number;
  token: string;
  sourceChain: ChainKey;
  minApy?: number;
  /** ERC-7730-style sentence for this leg. */
  intent: string;
  /** False when the input could not be resolved to a real, supported target. */
  resolvable: boolean;
  illustrative?: boolean;
  warnings?: string[];
}

export interface ExecutionPlan {
  id: string;
  createdAt: number;
  legs: IntentLeg[];
  quotes: Quote[];
  steps: ExecutionStep[];
  /** safeTxHash (Safe MultiSend) or EIP-5792 batch digest. */
  batchDigest: string;
  /** ERC-7730 batch sentence: "A and B and C". */
  batchIntent: string;
  totals: { notionalUsd: number; costUsd: number; boundUsd: number };
  mode: "batch" | "per-leg";
  signing: SigningProvider;
  /** Never let the UI imply real funds moved. */
  simulated: true;
}

/** The durable record stored for the agent dashboard. */
export interface ExecutionRecord {
  id: string;
  createdAt: number;
  legs: { id: string; label: string; chain: ChainKey; deployedUsd: number; costUsd: number }[];
  stepCount: number;
  confirmedCount: number;
  notionalUsd: number;
  costUsd: number;
  status: "complete" | "partial" | "failed";
  simulated: true;
  /** Final transaction per leg, for the dashboard's explorer links. */
  links: { label: string; url?: string; hash?: string }[];
}

export interface ExecutionAdapter {
  quote(legs: IntentLeg[]): Promise<Quote[]>;
  buildPlan(legs: IntentLeg[], quotes: Quote[], mode: "batch" | "per-leg"): Promise<ExecutionPlan>;
  submit(plan: ExecutionPlan, onStep: (step: ExecutionStep) => void): () => void;
  toRecord(plan: ExecutionPlan, steps: ExecutionStep[]): ExecutionRecord;
}
