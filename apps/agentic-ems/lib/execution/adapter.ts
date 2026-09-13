import { explorerTxUrl, scanUrl } from "./chains";
import { planTotals, round2, toBps } from "./fees";
import { planIdFor } from "./intent";
import { chooseProvider, normaliseLayerZeroFees, type LayerZeroMessagingFee } from "./routing";
import {
  POLYMARKET_COLLATERAL,
  SAFE_MULTISEND_OPERATION,
  deterministicHex,
  safeBatchDigest,
  buildPolymarketOrder,
  PolymarketSignatureType,
} from "./signing";
import type {
  ChainKey,
  ExecutionAdapter,
  ExecutionPlan,
  ExecutionRecord,
  ExecutionStep,
  FeeLine,
  IntentLeg,
  Quote,
} from "./types";

/**
 * Simulated execution adapter.
 *
 * Deterministic by construction: every fee, hash and digest derives from the plan
 * seed, so the same intent always produces the same plan. That is what makes the
 * flow testable and the screenshots stable.
 *
 * It is *shape-faithful*, not real: the fee lines come from the same bps maths a
 * live provider would apply, the Polymarket step carries a genuine V2 order
 * payload, and cross-chain steps carry src/msg/dst tracking. Nothing is
 * broadcast, and every surface it feeds is labelled `simulated`.
 */

/* Cost parameters, in bps, so every figure is derived rather than invented. */
const LIFI_SERVICE_BPS = 25; // 0.25% LI.FI service fee
const BRIDGE_FEE_BPS = 3; // typical bridge/solver fee
const ONEINCH_PARTNER_BPS = 25;
const SLIPPAGE_BOUND_BPS = 50; // a bound, not a cost
/** Destination-chain gas, which on L2s really is cents. */
const GAS_USD: Record<ChainKey, number> = { base: 0.18, optimism: 0.09, polygon: 0.05 };
const LZ_NATIVE_USD = 0.34;

function seeded(seed: string, salt: string): number {
  const hex = deterministicHex(`${seed}:${salt}`, 4);
  return parseInt(hex.slice(2), 16) / 0xffffffff;
}

function priceImpactBps(leg: IntentLeg): number {
  // Bigger clip in a thinner venue costs more; deterministic per leg.
  const scale = leg.kind === "prediction" ? 12 : leg.kind === "lp" ? 6 : 3;
  return round2(scale + seeded(leg.id, "impact") * scale);
}

/* ── Quotes ────────────────────────────────────────────────────────────────── */

function buildQuote(leg: IntentLeg, planSeed: string): Quote {
  const provider = chooseProvider(leg);
  const fees: FeeLine[] = [];
  const crossChain = leg.chain !== leg.sourceChain;

  if (provider === "direct") {
    fees.push({
      id: "gas-source",
      label: `Source gas (${leg.chain === "polygon" ? "POL" : "ETH"})`,
      tier: "cost",
      amountUsd: GAS_USD[leg.chain],
      bps: toBps(GAS_USD[leg.chain], leg.amountUsd),
      chain: leg.chain,
      provider,
      note: "approve + supply",
    });
    fees.push({
      id: "gas-dest",
      label: "Vault call gas",
      tier: "cost",
      amountUsd: round2(GAS_USD[leg.chain] * 1.4),
      bps: toBps(GAS_USD[leg.chain] * 1.4, leg.amountUsd),
      chain: leg.chain,
      provider,
      note: "Bundler3 supply via GeneralAdapter1",
    });
  }

  if (provider === "lifi") {
    const bridgeFee = (leg.amountUsd * BRIDGE_FEE_BPS) / 10_000;
    fees.push({
      id: "lifi-service",
      label: "LI.FI service fee",
      tier: "cost",
      amountUsd: round2((leg.amountUsd * LIFI_SERVICE_BPS) / 10_000),
      bps: LIFI_SERVICE_BPS,
      token: leg.token,
      chain: leg.sourceChain,
      provider,
    });
    // Bridge/solver fees are typically already netted into the quoted output —
    // shown for transparency, but excluded from the headline (LI.FI `included`).
    fees.push({
      id: "lifi-bridge",
      label: "Bridge / solver fee",
      tier: "cost",
      amountUsd: round2(bridgeFee),
      bps: BRIDGE_FEE_BPS,
      token: leg.token,
      chain: leg.sourceChain,
      provider,
      included: true,
      note: "already netted into the quoted output",
    });
    fees.push({
      id: "gas-source",
      label: `Source gas (${leg.sourceChain === "polygon" ? "POL" : "ETH"})`,
      tier: "cost",
      amountUsd: GAS_USD[leg.sourceChain],
      bps: toBps(GAS_USD[leg.sourceChain], leg.amountUsd),
      chain: leg.sourceChain,
      provider,
    });
    fees.push({
      id: "gas-dest",
      label: "Destination gas",
      tier: "cost",
      amountUsd: round2(GAS_USD[leg.chain] * 1.6),
      bps: toBps(GAS_USD[leg.chain] * 1.6, leg.amountUsd),
      chain: leg.chain,
      provider,
      note: "local swap into range",
    });
  }

  if (provider === "oneinch") {
    fees.push({
      id: "oneinch-partner",
      label: "Aggregator partner fee",
      tier: "cost",
      amountUsd: round2((leg.amountUsd * ONEINCH_PARTNER_BPS) / 10_000),
      bps: ONEINCH_PARTNER_BPS,
      token: leg.token,
      chain: leg.sourceChain,
      provider,
      note: "Fusion+ intent, gasless",
    });
    fees.push({
      id: "gas-dest",
      label: "Destination gas",
      tier: "cost",
      amountUsd: round2(GAS_USD[leg.chain] * 1.2),
      bps: toBps(GAS_USD[leg.chain] * 1.2, leg.amountUsd),
      chain: leg.chain,
      provider,
      note: "pUSD wrap + approvals",
    });
  }

  if (provider === "layerzero") {
    const messagingFee: LayerZeroMessagingFee = {
      nativeFee: BigInt(Math.round((LZ_NATIVE_USD / 2500) * 1e18)),
      lzTokenFee: 0n,
    };
    fees.push(
      ...normaliseLayerZeroFees(messagingFee, 2500, leg.amountUsd, leg.sourceChain, "ETH"),
    );
    fees.push({
      id: "lz-dest",
      label: "Compose gas on destination",
      tier: "cost",
      amountUsd: round2(GAS_USD[leg.chain] * 3),
      bps: toBps(GAS_USD[leg.chain] * 3, leg.amountUsd),
      chain: leg.chain,
      provider,
      note: "funded via addExecutorLzComposeOption",
    });
  }

  // A bound and a market effect — deliberately NOT costs.
  const boundUsd = (leg.amountUsd * SLIPPAGE_BOUND_BPS) / 10_000;
  fees.push({
    id: "slippage-bound",
    label: `${(SLIPPAGE_BOUND_BPS / 100).toFixed(2)}% slippage tolerance`,
    tier: "bound",
    amountUsd: round2(boundUsd),
    bps: SLIPPAGE_BOUND_BPS,
    token: leg.token,
    chain: leg.chain,
    provider,
    note: "worst case you accept, not an amount charged",
  });
  fees.push({
    id: "price-impact",
    label: "Price impact",
    tier: "market",
    amountUsd: 0,
    bps: priceImpactBps(leg),
    chain: leg.chain,
    provider,
    note: "market reaction to your size",
  });

  const venue =
    provider === "lifi"
      ? "LI.FI · Stargate"
      : provider === "oneinch"
        ? "1inch Fusion+ · Uniswap v3"
        : provider === "layerzero"
          ? "LayerZero OApp + Composer"
          : "Direct · protocol router";

  return {
    legId: leg.id,
    provider,
    venue,
    fees,
    slippageBoundPct: SLIPPAGE_BOUND_BPS / 100,
    priceImpactPct: priceImpactBps(leg) / 100,
    estimatedSeconds: crossChain ? 45 + Math.round(seeded(planSeed, leg.id) * 60) : 12,
    eid: provider === "layerzero" ? 30_111 + Math.round(seeded(planSeed, `${leg.id}-eid`) * 4) : undefined,
    options: provider === "layerzero" ? "0x00030100110100000000000000000000000000011170" : undefined,
  };
}

/* ── Steps ─────────────────────────────────────────────────────────────────── */

function stepBase(leg: IntentLeg, suffix: string, seed: string) {
  return {
    id: `${leg.id}-${suffix}`,
    legId: leg.id,
    tx: {
      // Placeholder targets while simulated; a live adapter fills real addresses.
      to: deterministicHex(`${seed}:${suffix}:to`, 20),
      value: "0",
      data: deterministicHex(`${seed}:${suffix}:data`, 32),
      operation: 0 as const,
    },
  };
}

function buildSteps(leg: IntentLeg, quote: Quote, planSeed: string): ExecutionStep[] {
  const steps: ExecutionStep[] = [];
  const crossChain = leg.chain !== leg.sourceChain;
  const route = crossChain ? `Base → ${leg.chain === "optimism" ? "Optimism" : "Polygon"}` : undefined;

  steps.push({
    ...stepBase(leg, "approve", planSeed),
    kind: "approve",
    label: `Approve ${leg.token}`,
    intent: `Approve ${leg.token} spending for ${leg.protocol} on ${leg.chain}`,
    state: "queued",
    tx: {
      ...stepBase(leg, "approve", planSeed).tx,
      operation: SAFE_MULTISEND_OPERATION,
    },
  });

  if (quote.provider === "lifi") {
    steps.push({
      ...stepBase(leg, "bridge", planSeed),
      kind: "bridge",
      label: "Bridge to destination",
      intent: `Bridge ${leg.amountUsd.toLocaleString("en-US")} ${leg.token} from Base to ${leg.chain}`,
      state: "queued",
      route,
    });
    steps.push({
      ...stepBase(leg, "swap", planSeed),
      kind: "swap",
      label: "Swap into range ratio",
      intent: `Swap half the bridged ${leg.token} into WETH on ${leg.chain}`,
      state: "queued",
    });
    steps.push({
      ...stepBase(leg, "supply", planSeed),
      kind: "supply",
      label: "Provide liquidity",
      intent: `Provide the WETH/USDC position to ${leg.protocol} on ${leg.chain}`,
      state: "queued",
    });
  }

  if (quote.provider === "layerzero") {
    steps.push({
      ...stepBase(leg, "lzSend", planSeed),
      kind: "lzSend",
      label: "Send cross-chain message",
      intent: `Send ${leg.amountUsd.toLocaleString("en-US")} ${leg.token} to ${leg.chain} with a composed supply call`,
      state: "queued",
      route,
    });
    steps.push({
      ...stepBase(leg, "lzCompose", planSeed),
      kind: "lzCompose",
      label: "Compose supply on destination",
      intent: `Supply the delivered ${leg.token} to the ${leg.protocol} vault on ${leg.chain}`,
      state: "queued",
    });
  }

  if (quote.provider === "oneinch") {
    steps.push({
      ...stepBase(leg, "bridge", planSeed),
      kind: "bridge",
      label: "Cross-chain swap (intent)",
      intent: `Swap ${leg.amountUsd.toLocaleString("en-US")} ${leg.token} from Base into ${leg.chain} collateral via 1inch Fusion+`,
      state: "queued",
      route,
    });
    steps.push({
      ...stepBase(leg, "wrap", planSeed),
      kind: "wrap",
      label: "Wrap to pUSD",
      intent: `Wrap ${leg.token} into pUSD collateral`,
      state: "queued",
    });
    steps.push({
      ...stepBase(leg, "approve-market", planSeed),
      kind: "approve",
      label: "Set trading approvals",
      intent: `Approve pUSD and Conditional Tokens for both Polymarket exchanges`,
      state: "queued",
      route: "pUSD → exchange · CTF setApprovalForAll",
    });

    // The step the whole design exists for: the exact V2 order that is signed.
    const order = buildPolymarketOrder({
      tokenId: deterministicHex(`${planSeed}:${leg.id}:tokenId`, 32),
      side: "BUY",
      price: 0.62,
      size: leg.amountUsd / 0.62,
      maker: deterministicHex(`${planSeed}:maker`, 20),
      signer: deterministicHex(`${planSeed}:signer`, 20),
      signatureType: PolymarketSignatureType.GnosisSafe,
      negRisk: false,
      salt: BigInt(parseInt(deterministicHex(`${planSeed}:${leg.id}:salt`, 6).slice(2), 16)),
      timestampMs: 1_772_000_000_000,
    });
    steps.push({
      ...stepBase(leg, "order", planSeed),
      kind: "order",
      label: "Sign & post CLOB order",
      intent: `Buy the YES outcome with ${leg.amountUsd.toLocaleString("en-US")} pUSD at 62¢ (limit, FAK)`,
      state: "queued",
      eip712: order,
    });
  }

  if (quote.provider === "direct") {
    steps.push({
      ...stepBase(leg, "supply", planSeed),
      kind: "supply",
      label: "Supply to vault",
      intent: leg.intent,
      state: "queued",
    });
  }

  return steps;
}

/* ── Adapter ───────────────────────────────────────────────────────────────── */

function attachTracking(step: ExecutionStep, leg: IntentLeg, planSeed: string): ExecutionStep {
  if (step.kind !== "bridge" && step.kind !== "lzSend") return step;

  const srcTxHash = deterministicHex(`${planSeed}:${step.id}:src`, 32);
  const guid = deterministicHex(`${planSeed}:${step.id}:guid`, 32);
  return {
    ...step,
    tracking: {
      srcTxHash,
      srcExplorerUrl: explorerTxUrl(leg.sourceChain, srcTxHash),
      guid,
      scanUrl: scanUrl(srcTxHash),
    },
  };
}

/**
 * Attach the destination half of a cross-chain step. Exported (via the adapter's
 * `toRecord`) so a record built from a step snapshot — not just from a live
 * `submit` run — still carries both ends of the bridge.
 */
function attachDestination(step: ExecutionStep, leg: IntentLeg, planSeed: string): ExecutionStep {
  if (!step.tracking || step.tracking.dstTxHash) return step;
  const dstTxHash = deterministicHex(`${planSeed}:${step.id}:dst`, 32);
  return {
    ...step,
    tracking: { ...step.tracking, dstTxHash, dstExplorerUrl: explorerTxUrl(leg.chain, dstTxHash) },
  };
}

export function createSimulatedAdapter(): ExecutionAdapter {
  return {
    async quote(legs) {
      const seed = planIdFor(legs);
      return legs.map((leg) => buildQuote(leg, seed));
    },

    async buildPlan(legs, quotes, mode) {
      const id = planIdFor(legs);
      const steps = legs.flatMap((leg) => {
        const quote = quotes.find((q) => q.legId === leg.id);
        if (!quote) return [];
        return buildSteps(leg, quote, id).map((step) => attachTracking(step, leg, id));
      });

      const totals = planTotals(
        quotes.map((quote) => quote.fees),
        legs.reduce((sum, leg) => sum + leg.amountUsd, 0),
      );

      const batchIntent = legs.map((leg) => leg.intent).join(" and ");
      const digestSource = mode === "batch" ? safeBatchDigest(id) : deterministicHex(`perleg:${id}`);

      return {
        id,
        createdAt: Date.now(),
        legs,
        quotes,
        steps,
        batchDigest: digestSource,
        batchIntent,
        totals,
        mode,
        signing: mode === "batch" ? "safe-batch" : "per-leg",
        simulated: true,
      };
    },

    /**
     * Drives each step queued → signing → submitted → [bridging] → confirmed.
     * A bridged step spends real time in flight, so it gets its own state rather
     * than pretending "submitted" means done.
     */
    submit(plan, onStep) {
      const legById = new Map(plan.legs.map((leg) => [leg.id, leg]));
      let cancelled = false;
      let index = 0;

      const emit = (step: ExecutionStep) => {
        if (!cancelled) onStep(step);
      };

      const advance = () => {
        if (cancelled || index >= plan.steps.length) return;
        const current = plan.steps[index];
        const leg = legById.get(current.legId);
        const isBridged = current.kind === "bridge" || current.kind === "lzSend";
        const timings = isBridged ? [220, 260, 900, 420] : [200, 240, 360];

        const states: ExecutionStep["state"][] = isBridged
          ? ["signing", "submitted", "bridging", "confirmed"]
          : ["signing", "submitted", "confirmed"];

        let cursor = 0;
        const tick = () => {
          if (cancelled) return;
          const state = states[cursor];
          let step: ExecutionStep = { ...current, state };
          if (state === "confirmed") {
            step.durationMs = timings.reduce((sum, t) => sum + t, 0);
            if (isBridged && leg) step = attachDestination(step, leg, plan.id);
          }
          emit(step);
          cursor += 1;
          if (cursor < states.length) {
            window.setTimeout(tick, timings[cursor] ?? 400);
          } else {
            index += 1;
            window.setTimeout(advance, 180);
          }
        };
        tick();
      };

      advance();
      return () => {
        cancelled = true;
      };
    },

    toRecord(plan, inputSteps) {
      const legById = new Map(plan.legs.map((leg) => [leg.id, leg]));
      // Normalise: a confirmed cross-chain step must carry its destination end
      // whether or not the caller's snapshot came through `submit`.
      const steps = inputSteps.map((step) => {
        if (step.state !== "confirmed") return step;
        const leg = legById.get(step.legId);
        return leg ? attachDestination(step, leg, plan.id) : step;
      });
      const confirmed = steps.filter((step) => step.state === "confirmed");
      const failed = steps.some((step) => step.state === "failed");

      const legs = plan.legs.map((leg) => {
        const quote = plan.quotes.find((q) => q.legId === leg.id);
        const legSteps = steps.filter((step) => step.legId === leg.id);
        const legConfirmed = legSteps.length > 0 && legSteps.every((s) => s.state === "confirmed");
        return {
          id: leg.id,
          label: leg.protocol,
          chain: leg.chain,
          deployedUsd: legConfirmed ? leg.amountUsd : 0,
          costUsd: round2(
            (quote?.fees ?? [])
              .filter((fee) => fee.tier === "cost" && !fee.included)
              .reduce((sum, fee) => sum + fee.amountUsd, 0),
          ),
        };
      });

      const links = steps
        .filter((step) => step.tracking?.srcTxHash || step.tracking?.dstTxHash)
        .flatMap((step) => {
          const leg = legById.get(step.legId);
          const out: { label: string; url?: string; hash?: string }[] = [];
          if (step.tracking?.srcTxHash) {
            out.push({
              label: `${leg?.protocol ?? step.legId} · source`,
              url: step.tracking.srcExplorerUrl,
              hash: step.tracking.srcTxHash,
            });
          }
          if (step.tracking?.dstTxHash) {
            out.push({
              label: `${leg?.protocol ?? step.legId} · destination`,
              url: step.tracking.dstExplorerUrl,
              hash: step.tracking.dstTxHash,
            });
          }
          return out;
        });

      return {
        id: plan.id,
        createdAt: plan.createdAt,
        legs,
        stepCount: plan.steps.length,
        confirmedCount: confirmed.length,
        notionalUsd: plan.totals.notionalUsd,
        costUsd: plan.totals.costUsd,
        status: failed
          ? confirmed.length > 0
            ? "partial"
            : "failed"
          : confirmed.length === plan.steps.length
            ? "complete"
            : "partial",
        simulated: true,
        links,
      } satisfies ExecutionRecord;
    },
  };
}
