import type { AgentMandate } from "../execution/mandates";
import type { ExecutionRecord } from "../execution/types";

export type RiskProfile = "conservative" | "balanced" | "yieldmax";

export interface StrategyDef {
  id: string;
  subagent: string;
  agentName: string;
  label: string;
  protocols: string[];
  color: string;
  basePct: number;
  apy: number;
  riskLabel: string;
  var95: string;
  description: string;
  forecastKey: string;
}

export interface ForecastPayload {
  protocol: string;
  current_tvl: number;
  forecast_30d: number[];
  quantiles_30d: [number, number, number][];
  provenance?: {
    source: string;
    name?: string;
    generatedAt?: string;
    method?: string;
  };
}

export interface QuestionnaireAnswers {
  experience: string;
  risk: RiskProfile;
  tools: string[];
  integration: string;
}

export type DemoStage =
  | "sso"
  | "questionnaire"
  | "chat"
  | "wallet-onboarding"
  | "simulation"
  | "approvals"
  | "executing";

export interface DemoWallet {
  /** Embedded EOA that signs for the smart account. */
  address: string;
  /** The user's personal smart account (Privy smart wallet, type "safe"). */
  safeAddress: string;
  /** Privy DID the account belongs to. */
  privyUserId?: string;
  /** Smart wallet provider reported by Privy, e.g. "safe". */
  smartWalletType?: string;
}

export interface DemoState {
  stage: DemoStage;
  email: string;
  answers: QuestionnaireAnswers | null;
  wallet: DemoWallet | null;
  approved: string[];
  /**
   * Spend mandates set from the settings screen, keyed by agent.
   *
   * The enforced copy lives in `exec_agent_mandates` and is reached through the execution
   * service; this is the desk's own copy so the setting is visible and editable without a
   * service running. They are kept distinct so the screen cannot show a limit nothing applies.
   */
  mandates: Record<string, AgentMandate>;
  /** Durable transaction records for the agent dashboard. */
  executions: ExecutionRecord[];
  /**
   * Whether the desk replays the recorded mock pipeline instead of calling the
   * inference service.
   *
   * Opt-in only, and never flipped by a failed request: a live run that errors shows
   * the error, and switching is the operator's decision. Auto-falling back would mean
   * a demo that looks like it is working while the real path is down.
   */
  simulated: boolean;
}

export const ALLOCATIONS: Record<RiskProfile, Record<string, number>> = {
  conservative: { lending: 45, staking: 25, prediction: 5, perps: 5, lp: 20 },
  balanced: { lending: 35, staking: 20, prediction: 10, perps: 15, lp: 20 },
  yieldmax: { lending: 20, staking: 15, prediction: 15, perps: 25, lp: 25 },
};

export const STRATEGIES: StrategyDef[] = [
  {
    id: "lending",
    subagent: "lending-specialist",
    agentName: "Lending Agent",
    label: "Stablecoin Lending",
    protocols: ["Aave v3", "Morpho"],
    color: "#16c784",
    basePct: 35,
    apy: 5.1,
    riskLabel: "Low",
    var95: "0.8%",
    description:
      "USDC/USDS supplied to Aave v3 and Morpho stablecoin markets. Source: yields.llama.fi — Aave USDC 4.2%, Spark USDS 5.1%, Morpho WETH 3.2%.",
    forecastKey: "aave",
  },
  {
    id: "staking",
    subagent: "staking-specialist",
    agentName: "Staking Agent",
    label: "Liquid Staking",
    protocols: ["Lido", "RocketPool"],
    color: "#6747ee",
    basePct: 20,
    apy: 2.9,
    riskLabel: "Low",
    var95: "1.6%",
    description:
      "ETH liquid staking via Lido (stETH, 2.18% base) and RocketPool (rETH). Benchmark validator yield + stETH/rETH basis.",
    forecastKey: "lido",
  },
  {
    id: "prediction",
    subagent: "prediction-specialist",
    agentName: "Prediction Agent",
    label: "Prediction Markets",
    protocols: ["Polymarket"],
    color: "#ffb300",
    basePct: 10,
    apy: 6.2,
    riskLabel: "Medium",
    var95: "3.4%",
    description:
      "Low-volatility Polymarket positions: high-probability resolution events (>92¢) with defined downside. UMA resolution risk modelled.",
    forecastKey: "polymarket",
  },
  {
    id: "perps",
    subagent: "perps-specialist",
    agentName: "Perps Agent",
    label: "Perpetual Basis",
    protocols: ["Hyperliquid"],
    color: "#12aab5",
    basePct: 15,
    apy: 8.4,
    riskLabel: "Medium",
    var95: "4.1%",
    description:
      "Delta-neutral funding-rate capture on Hyperliquid perps. Funding z-score gate; positions hedged 1:1 against spot.",
    forecastKey: "hyperliquid",
  },
  {
    id: "lp",
    subagent: "lp-specialist",
    agentName: "LP Agent",
    label: "Uniswap v4 LP",
    protocols: ["Uniswap v4"],
    color: "#ff007a",
    basePct: 20,
    apy: 7.3,
    riskLabel: "Medium",
    var95: "3.8%",
    description:
      "Concentrated liquidity on Uniswap v4 stable/ETH pools via the fixed-income dual-hook. Fee APY net of LVR, range ±10%.",
    forecastKey: "uniswap",
  },
];

export const TOTAL_BALANCE = 100_000;

export function allocationsFor(risk: RiskProfile): { strategy: StrategyDef; pct: number; usd: number }[] {
  const alloc = ALLOCATIONS[risk] ?? ALLOCATIONS.balanced;
  return STRATEGIES.map((strategy) => ({
    strategy,
    pct: alloc[strategy.id] ?? strategy.basePct,
    usd: Math.round(((alloc[strategy.id] ?? strategy.basePct) / 100) * TOTAL_BALANCE),
  }));
}

/** Short ticker strip for the dashboard — values from data/ taxonomy snapshot (2026-09-03). */
export const TICKER = [
  { sym: "AAVE-USDC", apy: 4.2, tvl: "17.3B", up: true },
  { sym: "SPARK-USDS", apy: 5.1, tvl: "1.4B", up: true },
  { sym: "MORPHO-WETH", apy: 3.2, tvl: "892M", up: false },
  { sym: "STETH", apy: 2.18, tvl: "23.9B", up: true },
  { sym: "RETH", apy: 2.42, tvl: "1.3B", up: true },
  { sym: "UNIV4-FEE", apy: 7.3, tvl: "654B cum", up: true },
  { sym: "HL-FUND", apy: 8.4, tvl: "6.8B", up: false },
  { sym: "POLY-OVL", apy: 6.2, tvl: "354M", up: true },
];

/** Trader lifeline — the step-by-step path a fixed-income trader takes on the desk. */
export const TRADER_LIFELINE = [
  { step: 1, label: "Search", hint: "Find liquid instruments & pools across chains" },
  { step: 2, label: "Analyze", hint: "Risk factors: α carry, β sensitivity, γ (vega)" },
  { step: 3, label: "Mandate", hint: "Plain-English intent → parsed strategy legs" },
  { step: 4, label: "Simulate", hint: "Data agents → risk engine → TimesFM-3 co-reasoning" },
  { step: 5, label: "Approve", hint: "Per-agent spend caps, Ledger + Safe signature" },
  { step: 6, label: "Monitor", hint: "Agent activity dashboard, drift & policy alerts" },
];

/** The 4 parallel data-fetch agents feeding the risk engine (per demo spec). */
export const DATA_AGENTS = [
  {
    id: "graph",
    name: "Graph Indexer Agent",
    color: "#6747ee",
    lines: [
      "querying gateway.thegraph.com · 5 subgraphs healthy",
      "lending-v3 schema: aave×eth/arb/opt — 14,882 positions",
      "univ4 pool registry: 131,148 pools indexed",
    ],
  },
  {
    id: "llama",
    name: "DeFiLlama Agent",
    color: "#16c784",
    lines: [
      "pulling yields.llama.fi/pools — 12,404 pools",
      "overview/fees: aave $41.2M/30d · uniswap $96.8M/30d",
      "stablecoins circulation: $168.4B (+0.6% w/w)",
    ],
  },
  {
    id: "timeseries",
    name: "Timeseries Keeper",
    color: "#12aab5",
    lines: [
      "loading 168h realized vol per pool (TimescaleDB)",
      "backfilling 60d TVL history for 5 mandate protocols",
      "gap check: 0 missing intervals · ingest lag 2.1s",
    ],
  },
  {
    id: "oracle",
    name: "Oracle & Vault Agent",
    color: "#ffb300",
    lines: [
      "chainlink ETH/USD freshness 4s · deviation 0.02%",
      "reading vault configs: aave-v3, morpho, spark",
      "cap table snapshot for PolicyGate: OK",
    ],
  },
];

/** Risk-engine output: factor card + interpretable trace lines (dropdown). */
export const RISK_FACTORS = [
  { sym: "α", label: "Alpha (excess carry)", value: "+2.41%", interp: "Return above the risk-free stablecoin baseline (4.1% USDS), explained by pool-specific fees and funding premia rather than market direction." },
  { sym: "β", label: "Beta (market sensitivity)", value: "0.32", interp: "Portfolio moves 0.32× vs the DeFi market factor — dominated by stablecoin legs. β floor 0.60 for MON_MACRO sessions is satisfied on the hedged book." },
  { sym: "γ", label: "Gamma / Vega (vol exposure)", value: "−0.38 /vol-pt", interp: "Short volatility via concentrated LP ranges: each 1 vol-point rise costs 0.38% net carry. Hedged by the perps leg's long-gamma funding position." },
  { sym: "D", label: "Duration-equivalent", value: "0.14y", interp: "Interest-rate-like sensitivity of on-chain carry to protocol-yield shifts. Near-zero — this book is carry, not rate duration." },
  { sym: "VaR", label: "VaR95 (1d)", value: "$1,847", interp: "At 95% confidence the book loses less than $1,847 in a day. Tail driven by LP range breach risk, capped by PolicyGate per-tx limits." },
  { sym: "HHI", label: "Concentration (HHI)", value: "0.18", interp: "Herfindahl index across venues — well under the 0.25 concentration limit; no single protocol dominates the book." },
];

export const RISK_TRACES = [
  { agent: "risk-engine", line: "ingesting 4 data-agent payloads (graph, llama, timeseries, oracle) · checksums OK" },
  { agent: "risk-engine", line: "factor decomposition: OLS on 180d returns → α +2.41% · β 0.32 · R² 0.71" },
  { agent: "risk-engine", line: "vega estimate: LP range gamma vs perps funding overlay → net −0.38/vol-pt" },
  { agent: "risk-engine", line: "VaR95 via 10k-path Monte Carlo (student-t, ν=5) → $1,847 · ES97 $2,911" },
  { agent: "risk-engine", line: "constraint check: β-floor ✓ · HHI ✓ · per-tx caps ✓ · Merton distance 3.1σ ✓" },
  { agent: "risk-engine", line: "verdict: acceptable — proposal may proceed to TimesFM-3 feedback & HITL" },
];

/** Per-agent live update feed for the agent activity dashboard. */
export const AGENT_UPDATES = [
  { ts: "09:32:14", agent: "Lending Agent", color: "#16c784", action: "Supplied $12,400 USDC to Aave v3", detail: "supply APY 4.2% → 4.24% post-trade · tx 0x8f2c…a41b", status: "filled" },
  { ts: "09:31:47", agent: "LP Agent", color: "#ff007a", action: "Rebalanced Uniswap v4 USDC/ETH range ±10% → ±8%", detail: "fee APY +0.6% · LVR unchanged · tx 0xb204…9ce3", status: "filled" },
  { ts: "09:31:02", agent: "Staking Agent", color: "#6747ee", action: "Staked 1.8 ETH via Lido (stETH)", detail: "2.18% base + stETH/ETH basis watch · tx 0x3e91…77d0", status: "filled" },
  { ts: "09:30:02", agent: "Perps Agent", color: "#12aab5", action: "Blocked by PolicyGate", detail: "proposed $26,000 > per-tx cap $25,000 — resubmitted at $18,000", status: "blocked" },
  { ts: "09:29:40", agent: "Prediction Agent", color: "#ffb300", action: "Entered 2 Polymarket >92¢ contracts", detail: "max downside $1,900 · resolves ≤14d · tx 0x51aa…0f88", status: "filled" },
  { ts: "09:28:11", agent: "Lending Agent", color: "#16c784", action: "Drift alert resolved", detail: "aave utilization 82% → yield tilt +12bps vs benchmark", status: "info" },
] as const;
