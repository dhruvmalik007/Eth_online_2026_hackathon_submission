import { round2, toBps } from "./fees";
import type { ChainKey, FeeLine, IntentLeg, RoutingProvider } from "./types";

/**
 * Provider fee normalisation.
 *
 * The raw shapes below are transcribed from the providers' own docs so the live
 * adapter has a target to hit, and so the caveats are recorded where someone
 * implementing it will actually read them. They are inert while the adapter is
 * simulated — but they are not decorative: each `CAVEAT` below is a way the
 * live implementation can be wrong in a way users would not notice.
 */

/* ── LI.FI ─────────────────────────────────────────────────────────────────── */

export interface LifiGasCost {
  type: "SEND" | "APPROVE" | "FEE" | "SUM";
  price: string;
  estimate: string;
  limit: string;
  amount: string;
  amountUSD: string;
  token: { symbol: string; decimals: number; chainId: number };
}

export interface LifiFeeCost {
  name: string;
  description: string;
  token: { symbol: string; chainId: number; decimals: number };
  amount: string;
  amountUSD: string;
  percentage: string;
  included: boolean;
}

/**
 * CAVEAT 1 — `included: true` is already netted out of `toAmount`. Adding it to
 * a total double-charges the user in the display while the chain does not.
 * CAVEAT 2 — `fee.name` / `description` are free text, not a stable enum; never
 * branch on them.
 * CAVEAT 3 — `token.chainId` is the chain the cost is *denominated in*, not the
 * chain the work happens on, so it cannot be used to build a per-chain split.
 * CAVEAT 4 — never sum the top-level arrays together with the step-level ones;
 * they overlap.
 */
export function normaliseLifiFees(
  feeCosts: LifiFeeCost[],
  gasCosts: LifiGasCost[],
  notionalUsd: number,
  chain: ChainKey,
  provider: RoutingProvider,
): FeeLine[] {
  const lines: FeeLine[] = [];

  for (const [index, fee] of feeCosts.entries()) {
    const amountUsd = Number(fee.amountUSD);
    lines.push({
      id: `lifi-fee-${index}`,
      label: fee.name,
      tier: "cost",
      amountUsd: round2(amountUsd),
      bps: toBps(amountUsd, notionalUsd),
      token: fee.token.symbol,
      chain,
      provider,
      included: fee.included,
      note: fee.included ? "already netted into the quoted output" : undefined,
    });
  }

  // Only SEND entries are returned today; APPROVE/FEE/SUM are reserved.
  for (const [index, gas] of gasCosts.filter((cost) => cost.type === "SEND").entries()) {
    const amountUsd = Number(gas.amountUSD);
    lines.push({
      id: `lifi-gas-${index}`,
      label: `Source gas (${gas.token.symbol})`,
      tier: "cost",
      amountUsd: round2(amountUsd),
      bps: toBps(amountUsd, notionalUsd),
      token: gas.token.symbol,
      chain,
      provider,
      note: `estimate ${gas.estimate} · limit ${gas.limit} (use the limit when submitting)`,
    });
  }

  return lines;
}

/* ── 1inch ─────────────────────────────────────────────────────────────────── */

export interface OneInchQuoteResponse {
  dstAmount: string;
  gas: number;
  protocols: { token: string; hops: { part: number; dst: string; protocols: { name: string; part: number }[] }[] }[];
}

/**
 * CAVEAT 5 — the classic API returns **no `priceImpact`**; it must be derived
 * from `dstAmount` against a reference (mid) price. `estimatedGas` is returned as
 * `gas`.
 */
export function derivePriceImpact(fromUsd: number, toUsd: number): number {
  if (fromUsd <= 0) return 0;
  return round2(((fromUsd - toUsd) / fromUsd) * 100);
}

export function normaliseOneInchFees(
  response: OneInchQuoteResponse,
  gasUsd: number,
  partnerFeeBps: number,
  notionalUsd: number,
  chain: ChainKey,
  provider: RoutingProvider,
): FeeLine[] {
  const lines: FeeLine[] = [];

  if (partnerFeeBps > 0) {
    const amountUsd = (notionalUsd * partnerFeeBps) / 10_000;
    lines.push({
      id: "oneinch-partner",
      label: "Aggregator partner fee",
      tier: "cost",
      amountUsd: round2(amountUsd),
      bps: partnerFeeBps,
      chain,
      provider,
    });
  }

  lines.push({
    id: "oneinch-gas",
    label: "Swap gas",
    tier: "cost",
    amountUsd: round2(gasUsd),
    bps: toBps(gasUsd, notionalUsd),
    chain,
    provider,
    note: `estimated ${response.gas} gas units`,
  });

  // Route sources are informational, not a charge.
  const sources = response.protocols
    .flatMap((protocol) => protocol.hops.flatMap((hop) => hop.protocols.map((p) => p.name)))
    .filter((name, index, all) => all.indexOf(name) === index);
  if (sources.length) {
    lines[lines.length - 1].note = `${lines[lines.length - 1].note} · route ${sources.join(" → ")}`;
  }

  return lines;
}

/* ── LayerZero ─────────────────────────────────────────────────────────────── */

export interface LayerZeroMessagingFee {
  nativeFee: bigint;
  lzTokenFee: bigint;
}

/**
 * LayerZero's `MessagingFee` is a fee category of its own and is quoted before
 * sending (`quote`/`_quote`). For a batch send the fees are **cumulative** across
 * destinations, which is why an OApp overrides `_payNative` to compare with `<`
 * rather than equality.
 */
export function normaliseLayerZeroFees(
  fee: LayerZeroMessagingFee,
  nativeTokenUsd: number,
  notionalUsd: number,
  chain: ChainKey,
  nativeSymbol = "ETH",
): FeeLine[] {
  const lines: FeeLine[] = [];
  const nativeUsd = Number(fee.nativeFee) * nativeTokenUsd;

  if (nativeUsd > 0) {
    lines.push({
      id: "lz-native",
      label: "LayerZero messaging fee",
      tier: "cost",
      amountUsd: round2(nativeUsd),
      bps: toBps(nativeUsd, notionalUsd),
      token: nativeSymbol,
      chain,
      provider: "layerzero",
      payIn: "native",
    });
  }

  if (fee.lzTokenFee > 0n) {
    lines.push({
      id: "lz-token",
      label: "LayerZero fee (ZRO)",
      tier: "cost",
      amountUsd: 0,
      token: "ZRO",
      chain,
      provider: "layerzero",
      payIn: "zro",
      note: "quoted in ZRO — requires a ZRO balance",
    });
  }

  return lines;
}

/* ── Provider selection ────────────────────────────────────────────────────── */

/**
 * Which router computes the best rate for this leg. Same-chain legs need neither
 * a bridge nor an aggregator; a leg that must *do something* on arrival
 * (compose) is a LayerZero OApp/composer path rather than a plain bridge.
 */
export function chooseProvider(leg: IntentLeg): RoutingProvider {
  if (leg.chain === leg.sourceChain) return "direct";
  switch (leg.kind) {
    case "lp":
      // Cross-chain liquidity: bridge aggregator, then a local swap to ratio.
      return "lifi";
    case "prediction":
      // Intent-based cross-chain swap into a CLOB collateral.
      return "oneinch";
    case "lend":
      // Deposit-and-supply on arrival = a composed cross-chain call.
      return "layerzero";
    default:
      return "lifi";
  }
}

export const PROVIDER_LABEL: Record<RoutingProvider, string> = {
  lifi: "LI.FI",
  oneinch: "1inch",
  layerzero: "LayerZero",
  direct: "Direct",
};
