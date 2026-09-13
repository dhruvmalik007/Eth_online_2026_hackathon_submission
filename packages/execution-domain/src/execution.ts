/**
 * The execution contract, shared by the service and the dashboard.
 *
 * Adopted from `apps/agentic-ems/lib/execution/types.ts`, which was written so
 * that *"a live adapter can drop in without UI change"*. Two things had to
 * change for that to be true, and both are corrections rather than redesigns:
 *
 * 1. **`simulated` is a `boolean`, not the literal `true`.** The original types
 *    hard-coded `simulated: true`, so they could describe only the fake adapter —
 *    a live plan was literally unrepresentable.
 * 2. **`ExecutionStepState` moved to `./state.js`.** It used to be declared
 *    inside a React component in `@ethonline2026/ux-workflow`; a server process
 *    should not import React to learn a string union.
 *
 * The fee model is preserved exactly, because it encodes hard-won semantics: a
 * `cost` is money that leaves the wallet, a `bound` is a maximum the user
 * accepts, and a `market` effect is a consequence of their own size. Only
 * `cost` is ever summed.
 */
import { z } from "zod";
import { ExecutionStepStateSchema } from "./state.js";

export const LEG_KINDS = ["lend", "lp", "prediction", "bridge", "swap"] as const;
export type LegKind = (typeof LEG_KINDS)[number];
export const LegKindSchema = z.enum(LEG_KINDS);

/**
 * The chains the dashboard currently models.
 *
 * A closed union on purpose — it keeps the UI exhaustive — and widening it is a
 * one-line change here rather than a type nobody checks.
 */
/**
 * Chains a leg, step, plan or record can name.
 *
 * `sepolia` was added because a settlement chain has to be *expressible* for the
 * intent path to be internally consistent. It previously was not, which meant the
 * mock had to declare `base` while the custodian settled on Sepolia — producing an
 * intent that declared one chain and addressed another. That mismatch is invisible to
 * a digest check, because the envelope is self-consistent; it only shows up as legs
 * that cannot execute on the chain they claim.
 *
 * `packages/oneInch`'s docs anticipated this widening. Adding a member is additive:
 * its own `ChainKey` is a separate type, so nothing there narrows.
 */
export const CHAIN_KEYS = ["base", "polygon", "optimism", "sepolia"] as const;
export type ChainKey = (typeof CHAIN_KEYS)[number];
export const ChainKeySchema = z.enum(CHAIN_KEYS);

/** Who computes the route. `direct` = same-chain, no bridge or aggregator. */
export const ROUTING_PROVIDERS = ["lifi", "oneinch", "layerzero", "direct"] as const;
export type RoutingProvider = (typeof ROUTING_PROVIDERS)[number];
export const RoutingProviderSchema = z.enum(ROUTING_PROVIDERS);

export const SIGNING_PROVIDERS = ["safe-batch", "per-leg", "polymarket-order"] as const;
export type SigningProvider = (typeof SIGNING_PROVIDERS)[number];
export const SigningProviderSchema = z.enum(SIGNING_PROVIDERS);

export const STEP_KINDS = [
  "approve",
  "wrap",
  "bridge",
  "lzSend",
  "lzCompose",
  "supply",
  "swap",
  "order",
] as const;
export type StepKind = (typeof STEP_KINDS)[number];
export const StepKindSchema = z.enum(STEP_KINDS);

/**
 * Three tiers, and the distinction is the point:
 *  - `cost`   money that actually leaves the wallet (summed into the headline)
 *  - `bound`  a maximum the user accepts (slippage / minReturn) — never summed
 *  - `market` an effect of their own size (price impact) — never summed
 */
export const FEE_TIERS = ["cost", "bound", "market"] as const;
export type FeeTier = (typeof FEE_TIERS)[number];
export const FeeTierSchema = z.enum(FEE_TIERS);

export const FeeLineSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  tier: FeeTierSchema,
  amountUsd: z.number(),
  bps: z.number().optional(),
  token: z.string().optional(),
  chain: ChainKeySchema.optional(),
  provider: RoutingProviderSchema.optional(),
  /**
   * LI.FI semantics: `true` means the cost is already netted out of the quoted
   * output. Shown for transparency but **must not** be added to the total.
   */
  included: z.boolean().optional(),
  /** LayerZero `MessagingFee` denomination. */
  payIn: z.enum(["native", "zro"]).optional(),
  note: z.string().optional(),
});
export type FeeLine = z.infer<typeof FeeLineSchema>;

export const QuoteSchema = z.object({
  legId: z.string().min(1),
  provider: RoutingProviderSchema,
  /** Human venue, e.g. "LI.FI · Stargate", "1inch · Uniswap v3". */
  venue: z.string().min(1),
  fees: z.array(FeeLineSchema),
  slippageBoundPct: z.number(),
  priceImpactPct: z.number(),
  estimatedSeconds: z.number(),
  /** LayerZero destination endpoint id — from lz-definitions, never memory. */
  eid: z.number().optional(),
  /** Encoded OptionsBuilder bytes (lzReceive + lzCompose gas). */
  options: z.string().optional(),
});
export type Quote = z.infer<typeof QuoteSchema>;

/**
 * Sum the fees that actually leave the wallet — the headline number.
 *
 * Only `cost`-tier lines count, and only when not already `included` in the
 * quoted output: LI.FI reports `included: true` for a cost already netted out of
 * the output, and adding those would double-count it. `bound` and `market` lines
 * are excluded on purpose — a slippage bound is a maximum the user accepts, not
 * a charge, and price impact is an effect of their own size.
 *
 * This lives here rather than in each consumer so the service and the dashboard
 * cannot disagree about the total.
 */
export function sumWalletCost(fees: readonly FeeLine[]): number {
  return fees
    .filter((fee) => fee.tier === "cost" && fee.included !== true)
    .reduce((total, fee) => total + fee.amountUsd, 0);
}

/** A cross-chain step is three independently-failing stages, not one hash. */
export const MessageTrackingSchema = z.object({
  srcTxHash: z.string().optional(),
  srcExplorerUrl: z.string().optional(),
  guid: z.string().optional(),
  scanUrl: z.string().optional(),
  dstTxHash: z.string().optional(),
  dstExplorerUrl: z.string().optional(),
});
export type MessageTracking = z.infer<typeof MessageTrackingSchema>;

export const ExecutionStepSchema = z.object({
  id: z.string().min(1),
  legId: z.string().min(1),
  kind: StepKindSchema,
  label: z.string().min(1),
  /** The clear-signed sentence (ERC-7730 style). */
  intent: z.string().min(1),
  tx: z.object({
    to: z.string(),
    value: z.string(),
    data: z.string(),
    operation: z.union([z.literal(0), z.literal(1)]),
  }),
  state: ExecutionStepStateSchema,
  route: z.string().optional(),
  tracking: MessageTrackingSchema.optional(),
  /** Present when the step is authorised by a signature rather than calldata. */
  eip712: z
    .object({
      primaryType: z.string(),
      domain: z.record(z.string(), z.json()),
      message: z.record(z.string(), z.json()),
    })
    .optional(),
  error: z.string().optional(),
  durationMs: z.number().optional(),
});
export type ExecutionStep = z.infer<typeof ExecutionStepSchema>;

export const IntentLegSchema = z.object({
  id: z.string().min(1),
  kind: LegKindSchema,
  protocol: z.string().min(1),
  chain: ChainKeySchema,
  amountUsd: z.number(),
  token: z.string().min(1),
  sourceChain: ChainKeySchema,
  minApy: z.number().optional(),
  /** ERC-7730-style sentence for this leg. */
  intent: z.string().min(1),
  /** False when the input could not be resolved to a real, supported target. */
  resolvable: z.boolean(),
  illustrative: z.boolean().optional(),
  warnings: z.array(z.string()).optional(),
});
export type IntentLeg = z.infer<typeof IntentLegSchema>;

export const ExecutionPlanSchema = z.object({
  id: z.string().min(1),
  createdAt: z.number(),
  legs: z.array(IntentLegSchema),
  quotes: z.array(QuoteSchema),
  steps: z.array(ExecutionStepSchema),
  /** safeTxHash (Safe MultiSend) or EIP-5792 batch digest. */
  batchDigest: z.string(),
  /** ERC-7730 batch sentence: "A and B and C". */
  batchIntent: z.string(),
  totals: z.object({
    notionalUsd: z.number(),
    costUsd: z.number(),
    boundUsd: z.number(),
  }),
  mode: z.enum(["batch", "per-leg"]),
  signing: SigningProviderSchema,
  /**
   * Whether this plan was produced without touching the network.
   *
   * A `boolean`, not the literal `true` the SPA's original type carried — that
   * literal made a live plan unrepresentable. The UI still must not imply real
   * funds moved unless this is `false` **and** the steps say `confirmed`.
   */
  simulated: z.boolean(),
});
export type ExecutionPlan = z.infer<typeof ExecutionPlanSchema>;

/** The durable record the dashboard lists. */
export const ExecutionRecordSchema = z.object({
  id: z.string().min(1),
  createdAt: z.number(),
  legs: z.array(
    z.object({
      id: z.string().min(1),
      label: z.string(),
      chain: ChainKeySchema,
      deployedUsd: z.number(),
      costUsd: z.number(),
    }),
  ),
  stepCount: z.number().int().nonnegative(),
  confirmedCount: z.number().int().nonnegative(),
  notionalUsd: z.number(),
  costUsd: z.number(),
  status: z.enum(["complete", "partial", "failed"]),
  simulated: z.boolean(),
  /** Final transaction per leg, for the dashboard's explorer links. */
  links: z.array(
    z.object({
      label: z.string(),
      url: z.string().optional(),
      hash: z.string().optional(),
    }),
  ),
});
export type ExecutionRecord = z.infer<typeof ExecutionRecordSchema>;

/**
 * What the dashboard talks to.
 *
 * The simulated adapter already implements this; a live implementation calls the
 * execution service instead, and the UI does not change.
 */
export interface ExecutionAdapter {
  quote(legs: IntentLeg[]): Promise<Quote[]>;
  buildPlan(legs: IntentLeg[], quotes: Quote[], mode: "batch" | "per-leg"): Promise<ExecutionPlan>;
  submit(plan: ExecutionPlan, onStep: (step: ExecutionStep) => void): () => void;
  toRecord(plan: ExecutionPlan, steps: ExecutionStep[]): ExecutionRecord;
}
