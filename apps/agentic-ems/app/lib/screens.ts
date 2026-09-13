// The Agentic EMS screen templates — the on-screen surfaces each actor
// drives, with the exact content each region carries. prompts.ts composes
// scene descriptions from these; the film never names a legacy exchange
// vendor, so every screen is named by what it does.
//
// Layout inspiration: bloomberg_video_context/bloomberg_screens/ and
// bloomberg_video_context/bloomberg_screens/bloomberg_screens_fixed_income/
// — structure only, Agentic branding throughout.

import {
  DEFILLAMA_YIELDS,
  TRADFI_ANCHORS,
  FICT_ANCHOR,
  PERPS_ANCHORS,
  PREDICTION_ANCHORS,
  GOVERNANCE_ANCHORS,
} from "./defillama";

export const BRAND = {
  name: "Agentic EMS",
  tagline: "Tokenized Execution Management System",
  subtitle: "Unified DeFi + tokenized TradFi execution, on-chain",
} as const;

export const THEME = {
  floor: "#0A0E14",
  chrome: "#14181F",
  defi: "#00E5FF",
  tradfi: "#FFB300",
  etf: "#8B5CF6",
  risk: "#FF3B5C",
  pass: "#22C55E",
} as const;

// --- Screen A — Agentic Yield Monitor (Yuki, quant/desk strategist) ---
export const YIELD_MONITOR = {
  title: "Agentic Yield Monitor",
  snapshot: "live snapshot 2026-09-03",
  tabs: [
    "Onchain Benchmark",
    "Pool Key Rates",
    "Money Markets",
    "Overnight Fixings",
    "Onchain Repos",
  ],
  tiles: [...DEFILLAMA_YIELDS, ...TRADFI_ANCHORS.map((t) => ({ pool: t.instrument, apy: t.apy, tvl: t.aum, source: "DefiLlama" as const }))],
  forecastThreshold: "5.00%",
  bottomStrip: [
    "Yield Monitor",
    "Onchain Yields",
    "Stablecoin Monitor",
    "Pool Monitor",
    "Cross-chain Grid",
  ],
} as const;

// --- Screen B — Agentic Risk Desk (Darius, risk/portfolio manager) ---
export const RISK_DESK = {
  title: "Agentic Risk Desk",
  bookSelector: ["TOKENIZED UST BOOK", "DEFI BOOK", "UNIFIED"],
  tabs: ["Risk", "Scenario", "Stress Test", "Reports", "Merton PD"],
  varRow: "VaR 95%: 0.0002986",
  shockPresets: ["+50 bp parallel", "−10% equity", "USDS depeg −5%", "stETH unwind"],
  compliance: "COMPLIANCE: PASSED",
} as const;

// --- Screen C — Agentic Ticket (Morgan, execution trader) ---
export const TICKET = {
  title: "Agentic Ticket",
  instrument: `${FICT_ANCHOR.instrument} · CUSIP ${FICT_ANCHOR.cusip}`,
  pricingMethods: ["Mid", "Ask", "Bid", "Manual"],
  maturities: ["on2YR", "on3YR", "Next", "Worst"],
  fields: [
    `Spot ${FICT_ANCHOR.spot}`,
    `Yield ${FICT_ANCHOR.yield}%`,
    `Coupon ${FICT_ANCHOR.coupon}%`,
    `Maturity ${FICT_ANCHOR.maturity}`,
    `Size (K) ${FICT_ANCHOR.sizeK}`,
  ],
  schedule: `Almgren-Chriss ${FICT_ANCHOR.schedule}`,
  cta: "EXECUTE",
} as const;

// --- Screen D — Agentic Chat (Jamie, sales trader) ---
export const CHAT = {
  title: "Agentic Chat",
  bubbles: [
    "SparkLend: 5.18% +8bp",
    "Morpho Blue: 4.95% −3bp",
    "Ethena USDe: 11.04%",
  ],
  leftRail: ["SPARK USDS 5.18% +8bp", "AAVE v3 4.20%", "MORPHO WETH 3.20%"],
  rightRail: "block height · gas · mempool",
} as const;

// --- Screen E — Agentic Bond Monitor (Morgan secondary) ---
export const BOND_MONITOR = {
  title: "Agentic Bond Monitor",
  maturities: ["1 Year", "2 Year", "5 Year", "10 Year"],
  tabs: ["Funds", "Spreads", "Curves"],
  groups: {
    tokenizedUstFunds: TRADFI_ANCHORS.map((t) => `${t.instrument} ${t.apy} / ${t.aum}`),
    defiLendingPools: DEFILLAMA_YIELDS.slice(0, 5).map((y) => `${y.pool} ${y.apy} / ${y.tvl}`),
  },
  columns: [
    "Issuer",
    "Token",
    "Price",
    "Chg",
    "APY",
    "Chg APY",
    "30d Range (Low/Avg/Now/High)",
    "30d Chg",
  ],
  dataRange: "3 Months",
} as const;

// --- Screen F — Agentic Credit Monitor (Darius secondary) ---
export const CREDIT_MONITOR = {
  title: "Agentic Credit Monitor",
  tabs: ["Stablecoin Pools", "Lending Markets", "Liquid Staking"],
  sectors: {
    lending: DEFILLAMA_YIELDS.filter((y) =>
      ["AAVE v3", "MORPHO WETH", "SPARK USDS", "COMP v3"].includes(y.pool),
    ),
    liquidStaking: DEFILLAMA_YIELDS.filter((y) => y.pool === "LIDO stETH"),
    syntheticDollars: DEFILLAMA_YIELDS.filter((y) => y.pool === "ETHERNA USDe"),
  },
  columns: ["APY", "Chg(bps)", "TVL", "Fees 24h"],
  chartToggles: ["Pool vs Benchmark", "Stable vs Lending"],
  newsStrip: ["Lido 24h fees $1.53M", "Aave 24h fees $1.15M", "Morpho 24h fees $609K", "24h DEX volume"],
} as const;

// --- Screen G — Agentic Swap Portal (Yuki secondary) ---
export const SWAP_PORTAL = {
  title: "Agentic Swap Portal",
  assets: ["USDC", "USDS", "stETH"],
  leftRail: [
    "Spot APY",
    "Fixed-rate ladder",
    "Forward curves",
    "Butterflies",
    "Rolls",
    "Basis (stETH ↔ USDC)",
    "Onchain inflation",
  ],
  tenors: ["7d", "14d", "1M", "3M", "6M", "12M", "24M"],
  sampleRow: "3M · 5.16 · 5.20 · +8bp  (SPARK USDS)",
  shortcuts: ["7d", "1M", "3M", "6M", "12M"],
} as const;

// --- Screen H — Agentic Search (command bar) ---
export const SEARCH = {
  title: "Agentic Search",
  exampleQueries: [
    "Show all tokenized UST funds APY > 4.5",
    "Show DeFi lending pools TVL > $10B",
    "Show stablecoin pools with 24h APY change > 5bp",
  ],
  categories: ["Yield", "Risk", "Execution"],
  shortcuts: ["BUIDL", "USDM", "OUSG", "stETH", "USDC", "USDS", "USDe"],
  hint: "Type the text you want to run. Enter to execute.",
} as const;

// --- Screen I — Agentic TVL Grid (the unified book) ---
export const TVL_GRID = {
  title: "Agentic TVL Grid",
  header: "one book, three asset classes · snapshot 2026-09-03",
  buckets: {
    tradfi: TRADFI_ANCHORS.map((t) => `${t.instrument} ${t.apy} / ${t.aum}`),
    defi: DEFILLAMA_YIELDS.map((y) => `${y.pool} ${y.apy} / ${y.tvl}`),
    etf: ["Tokenised ETF aggregate TVL > $10B", "Ethereum share 56.87%", "674,994 RWA holders"],
  },
} as const;

// --- Screen K — Agentic Copilot Dock (the agentic surface, all scenes) ---
//
// Grammar mined from the DeepAgents workflow recording
// (vanguard_video/deepagents_agent_manifest.json, gemini-2.5-flash): an
// orchestrator that plans by spinning up specialists; a per-specialist
// panel with status tags; tool calls listed and ticked off as they
// complete; an overall "X/N completed" progress line; "Working…" with an
// animated ellipsis while active. Ours renames specialists to desks and
// their output is a mounted dashboard rather than a chat reply.

export const COPILOT_DOCK = {
  title: "Agentic Copilot",
  dockPosition: "docked right edge of the centre monitor",
  progressLine: "Desks — X/5 mounted",
  statusTags: {
    working: { tag: "Building", text: "Working…", accent: THEME.defi },
    awaiting: { tag: "Needs you", accent: THEME.tradfi },
    done: { tag: "Mounted", accent: THEME.pass },
  },
  deskChips: [
    "lending-desk",
    "risk-desk",
    "perps-desk",
    "prediction-desk",
    "governance-desk",
  ],
  toolCallList: "each desk's data queries listed, ticked off as they complete",
  artifactCards: "post-trade memos and risk notes write themselves here",
} as const;

// --- Screen L — Agentic Perps Panel (built by perps-desk) ---
export const PERPS_PANEL = {
  title: "Agentic Perps",
  builtBy: "perps-desk",
  columns: ["instrument", "mark", "funding / 8h", "open interest", "long/short skew", "tail flag"],
  rows: PERPS_ANCHORS.map((a) => `${a.label}: ${a.value}`),
} as const;

// --- Screen M — Agentic Odds Book (built by prediction-desk) ---
export const ODDS_BOOK = {
  title: "Agentic Odds",
  builtBy: "prediction-desk",
  columns: ["event", "price", "24h change", "tail flag"],
  rows: PREDICTION_ANCHORS.map((a) => `${a.label}: ${a.value}`),
} as const;

// --- Screen N — Agentic Vote Tracker (built by governance-desk) ---
export const VOTE_TRACKER = {
  title: "Agentic Votes",
  builtBy: "governance-desk",
  columns: ["proposal", "quorum progress", "for/against", "closes in"],
  rows: GOVERNANCE_ANCHORS.map((a) => `${a.label}: ${a.value}`),
  agentNote: "flags proposals touching the book's pools",
} as const;

// --- agentBuilt chip — appears on any dashboard a sub-agent mounted ---
export const AGENT_BUILT_CHIP = "built by agent" as const;

// --- Screen J — Agentic Floor (wide establishing shot) ---
export const FLOOR = {
  title: "Agentic Floor",
  desks: "three-monitor setups · vertical side monitors · dark blotter left · light OMS centre · chart wall right",
  props: "phone turret · colour-graded keyboard turret · headset",
} as const;
