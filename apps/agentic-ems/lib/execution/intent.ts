import type { ChainKey, IntentLeg, LegKind } from "./types";

/**
 * Natural language → structured legs.
 *
 * PLACEHOLDER: in production this is the agent's LLM tool-call — the model should
 * emit these `IntentLeg` objects as a typed tool result, not prose. This
 * deterministic matcher exists so the component's contract is testable and the
 * demo is reproducible.
 *
 * Two behaviours are non-negotiable and are tested:
 *   1. It returns **structured legs, never prose**.
 *   2. It **flags ambiguity instead of guessing** — an unresolvable protocol or a
 *      chain outside the supported set becomes a warning / `illustrative` flag,
 *      never a silently invented execution.
 */

const SUPPORTED_CHAINS: ChainKey[] = ["base", "optimism", "polygon"];

const CHAIN_PATTERNS: { re: RegExp; chain: ChainKey; label: string }[] = [
  { re: /\bbase\b/i, chain: "base", label: "Base" },
  { re: /\boptimism\b|\bop\s*mainnet\b|\boptimistic\b/i, chain: "optimism", label: "Optimism" },
  { re: /\bpolygon\b|\bmatic\b/i, chain: "polygon", label: "Polygon" },
];

const UNSOURCED_CHAIN = /\brobinhood\b/i;

const PROTOCOL_PATTERNS: { re: RegExp; kind: LegKind; protocol: string }[] = [
  { re: /\bmorpho\b/i, kind: "lend", protocol: "Morpho" },
  { re: /\baave\b/i, kind: "lend", protocol: "Aave v3" },
  { re: /\buniswap\b|\buniv4\b|\bv4\b/i, kind: "lp", protocol: "Uniswap v4" },
  { re: /\bpolymarket\b|\bprediction\b|\bbet\b/i, kind: "prediction", protocol: "Polymarket" },
];

const TOKEN_PATTERNS: { re: RegExp; token: string }[] = [
  { re: /\busdc\b/i, token: "USDC" },
  { re: /\busdt\b/i, token: "USDT" },
  { re: /\bweth\b|\beth\b/i, token: "WETH" },
  { re: /\busdg\b/i, token: "USDG" },
];

const AMOUNT_RE = /\$\s*([0-9][0-9,]*(?:\.\d+)?)\s*([kKmMbB])?|([0-9][0-9,]*(?:\.\d+)?)\s*([kKmMbB])\b/;

/** Tokens that exist but whose exact contract we must not assume. */
const AMBIGUOUS_TOKENS = [/usdgv2/i];

export interface ParseResult {
  legs: IntentLeg[];
  notes: string[];
}

/**
 * Amount extraction takes the **last** match in a segment, not the first.
 * The natural phrasing is "invest $100,000: $50k Morpho on Base" — the leading
 * figure is the total and only the following one is the leg. Taking the first
 * match would size the leg with the total.
 */
function parseAmount(segment: string): number | undefined {
  const matches = [...segment.matchAll(new RegExp(AMOUNT_RE.source, "gi"))];
  const match = matches[matches.length - 1];
  if (!match) return undefined;
  const raw = match[1] ?? match[3];
  const suffix = (match[2] ?? match[4] ?? "").toLowerCase();
  const value = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(value)) return undefined;
  const scale = suffix === "k" ? 1e3 : suffix === "m" ? 1e6 : suffix === "b" ? 1e9 : 1;
  return Math.round(value * scale);
}

/**
 * "Invest $100,000:" announces the notional for the whole run; leaving it in the
 * first segment makes it look like that leg's amount.
 */
function stripLeadingTotal(text: string): string {
  return text.replace(
    /^\s*(?:i\s+want\s+to\s+)?(?:invest|allocate|deploy|put|split)\s+\$?\s*[\d,]+(?:\.\d+)?\s*[kmb]?\s*(?:across|into|between|:)?\s*/i,
    "",
  );
}

function splitSegments(text: string): string[] {
  return stripLeadingTotal(text)
    .split(/\n+|;|,(?![^()]*\))|(?=\b\d+[.)]\s)|\s+(?:and then|then|and also|and)\s+/i)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 2);
}

function detect<T extends { re: RegExp }>(patterns: T[], text: string): T | undefined {
  return patterns.find((pattern) => pattern.re.test(text));
}

/**
 * Deterministic demo intent. Used when the prompt is vague ("invest the
 * allocation") so the flow is reachable without a fully-specified sentence, and
 * as the fixture in tests. It is the plan's worked example:
 * 100,000 USDC on Base → Morpho (Base) + Uniswap v4 (Optimism) + Polymarket (Polygon).
 */
export function defaultIntentLegs(): IntentLeg[] {
  return [
    {
      id: "leg-lend",
      kind: "lend",
      protocol: "Morpho",
      chain: "base",
      sourceChain: "base",
      amountUsd: 50_000,
      token: "USDC",
      minApy: 4.5,
      intent: "Supply 50,000 USDC to a Morpho vault on Base",
      resolvable: true,
    },
    {
      id: "leg-lp",
      kind: "lp",
      protocol: "Uniswap v4",
      chain: "optimism",
      sourceChain: "base",
      amountUsd: 35_000,
      token: "USDC",
      intent:
        "Bridge 35,000 USDC from Base to Optimism and provide it as a Uniswap v4 WETH/USDC position",
      resolvable: true,
    },
    {
      id: "leg-prediction",
      kind: "prediction",
      protocol: "Polymarket",
      chain: "polygon",
      sourceChain: "base",
      amountUsd: 15_000,
      token: "USDC",
      intent: "Bridge 15,000 USDC from Base to Polygon and buy the YES outcome on a Polymarket market",
      resolvable: true,
    },
  ];
}

export function parseIntent(text: string): ParseResult {
  const notes: string[] = [];
  const segments = splitSegments(text);
  const legs: IntentLeg[] = [];

  if (UNSOURCED_CHAIN.test(text)) {
    notes.push("Robinhood Chain is outside the supported set (Base/Polygon/Optimism).");
  }
  if (AMBIGUOUS_TOKENS.some((re) => re.test(text))) {
    notes.push("USDGv2 is ambiguous — not treated as the canonical Paxos USDG.");
  }

  for (const segment of segments) {
    const protocol = detect(PROTOCOL_PATTERNS, segment);
    const chainMatch = detect(CHAIN_PATTERNS, segment);
    const token = detect(TOKEN_PATTERNS, segment)?.token ?? "USDC";
    const amountUsd = parseAmount(segment);

    if (!protocol || !amountUsd) continue;

    const illustrative = UNSOURCED_CHAIN.test(segment) || (Boolean(chainMatch) && !SUPPORTED_CHAINS.includes(chainMatch!.chain));
    const chain: ChainKey = chainMatch?.chain ?? "base";
    const warnings: string[] = [];

    if (UNSOURCED_CHAIN.test(segment)) {
      warnings.push("chain not supported — illustrative only");
    }
    if (AMBIGUOUS_TOKENS.some((re) => re.test(segment))) {
      warnings.push("unverified token — confirm address");
    }
    if (!chainMatch && protocol.kind !== "lend") {
      warnings.push("chain not stated — assumed Base");
    }

    legs.push({
      id: `leg-${protocol.kind}-${legs.length + 1}`,
      kind: protocol.kind,
      protocol: protocol.protocol,
      chain,
      sourceChain: "base",
      amountUsd,
      token,
      minApy: protocol.kind === "lend" ? 4.5 : undefined,
      intent: buildSentence({
        amountUsd,
        token,
        protocol: protocol.protocol,
        chain: chainMatch?.label ?? "Base",
        kind: protocol.kind,
      }),
      resolvable: warnings.length === 0,
      illustrative,
      warnings: warnings.length ? warnings : undefined,
    });
  }

  if (legs.length === 0) {
    return { legs: defaultIntentLegs(), notes: [...notes, "no explicit legs parsed — using the demo allocation"] };
  }

  return { legs, notes };
}

function buildSentence(input: {
  amountUsd: number;
  token: string;
  protocol: string;
  chain: string;
  kind: LegKind;
}): string {
  const amount = input.amountUsd.toLocaleString("en-US");
  switch (input.kind) {
    case "lend":
      return `Supply ${amount} ${input.token} to a ${input.protocol} vault on ${input.chain}`;
    case "lp":
      return `Provide ${amount} ${input.token} as a ${input.protocol} liquidity position on ${input.chain}`;
    case "prediction":
      return `Buy the YES outcome with ${amount} ${input.token} on a ${input.protocol} market (${input.chain})`;
    default:
      return `Deploy ${amount} ${input.token} via ${input.protocol} on ${input.chain}`;
  }
}

/** Deterministic id so a re-parse of the same text yields a stable plan. */
export function planIdFor(legs: IntentLeg[]): string {
  const seed = legs.map((leg) => `${leg.id}:${leg.amountUsd}`).join("|");
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `exec-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
