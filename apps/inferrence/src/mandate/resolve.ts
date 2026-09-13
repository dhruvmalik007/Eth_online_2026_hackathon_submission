import {
  MandateSchema,
  YieldsPoolRowSchema,
  type Mandate,
  type PoolSelector,
  type YieldsPoolRow,
} from "./schema.js";

/**
 * Turns a mandate into the pool identifiers the agent needs.
 *
 * Two properties matter more than the filtering itself:
 *
 * 1. **A miss is loud and diagnostic.** "No pool matched" is useless — the operator cannot tell a typo
 *    from a chain that genuinely lacks the market. So resolution reports a *funnel*: how many rows each
 *    successive filter left standing, which names the filter that killed the search.
 * 2. **One snapshot per resolution.** DefiLlama asks for one `/pools` call per cycle and throttles
 *    fan-out, so every leg shares a single fetch; per-pool `/chart` calls happen only for pools a
 *    mandate actually named.
 */

export const YIELDS_POOLS_URL = "https://yields.llama.fi/pools";
export const yieldsPoolUrl = (poolId: string): string => `https://defillama.com/yields/pool/${poolId}`;

export interface FunnelStage {
  /** The filter applied, in the order it ran. */
  readonly filter: string;
  /** How many rows survived it. */
  readonly remaining: number;
}

export class PoolResolutionError extends Error {
  constructor(
    readonly legId: string,
    readonly selector: PoolSelector,
    readonly funnel: readonly FunnelStage[],
  ) {
    super(
      `mandate leg \`${legId}\` matched no pool. Filters: ${describeSelector(selector)}. ` +
        `Narrowing: ${funnel.map((s) => `${s.filter} → ${s.remaining}`).join(", ")}. ` +
        `The last non-zero stage names the filter to relax.`,
    );
    this.name = "PoolResolutionError";
  }
}

/** Split a DefiLlama symbol like `USDC-WETH` or `USDC / USDT` into comparable tokens. */
export function symbolTokens(symbol: string): string[] {
  return symbol
    .split(/[^A-Za-z0-9]+/)
    .map((part) => part.trim().toUpperCase())
    .filter((part) => part.length > 0);
}

function describeSelector(selector: PoolSelector): string {
  const parts = [`project=${selector.project}`, `chain=${selector.chain}`];
  if (selector.symbols.length > 0) parts.push(`symbols=[${selector.symbols.join(",")}]`);
  if (selector.exposure !== undefined) parts.push(`exposure=${selector.exposure}`);
  if (selector.stablecoin !== undefined) parts.push(`stablecoin=${selector.stablecoin}`);
  parts.push(`minTvlUsd=${selector.minTvlUsd}`);
  return parts.join(", ");
}

/**
 * Apply the selector stage by stage, recording the survivor count at each step.
 *
 * Exported because the funnel is the useful half: a caller may want to show the near-misses without
 * throwing, and tests can assert exactly which filter excluded a row.
 */
export function funnelRows(
  rows: readonly YieldsPoolRow[],
  selector: PoolSelector,
): { readonly stages: readonly FunnelStage[]; readonly survivors: readonly YieldsPoolRow[] } {
  const stages: FunnelStage[] = [];
  let current = rows;

  const step = (filter: string, predicate: (row: YieldsPoolRow) => boolean): void => {
    current = current.filter(predicate);
    stages.push({ filter, remaining: current.length });
  };

  // Case-insensitive on the string fields: DefiLlama's spelling is stable but a template author's
  // memory of it is not, and a case mismatch is indistinguishable from an absent market.
  step("project", (row) => row.project.toLowerCase() === selector.project.toLowerCase());
  step("chain", (row) => row.chain.toLowerCase() === selector.chain.toLowerCase());

  if (selector.symbols.length > 0) {
    const wanted = selector.symbols.map((s) => s.toUpperCase());
    step("symbols", (row) => {
      const have = symbolTokens(row.symbol);
      return wanted.every((token) => have.includes(token));
    });
  }

  if (selector.exposure !== undefined) {
    step("exposure", (row) => row.exposure?.toLowerCase() === selector.exposure);
  }
  if (selector.stablecoin !== undefined) {
    step("stablecoin", (row) => row.stablecoin === selector.stablecoin);
  }

  // Null TVL is excluded rather than treated as zero: an unreported figure is not a small one, and a
  // TVL floor exists precisely to avoid pools whose size is unknown.
  step("minTvlUsd", (row) => row.tvlUsd !== null && row.tvlUsd >= selector.minTvlUsd);

  return { stages, survivors: current };
}

export interface ResolvedPool {
  readonly poolId: string;
  readonly url: string;
  readonly project: string;
  readonly chain: string;
  readonly symbol: string;
  readonly tvlUsd: number | null;
  readonly apy: number | null;
  readonly apyMean30d: number | null;
  /** Carried through as reported. A missing component is `null`, never `0`. */
  readonly apyBase: number | null;
  readonly apyReward: number | null;
  readonly exposure: string | null;
  readonly ilRisk: string | null;
}

/**
 * Pick the best pool for one selector.
 *
 * Ranking is by the 30-day mean, falling back to spot `apy` only when the mean is absent, and final
 * ties break on the pool id so the choice is deterministic — two runs of the same mandate on the same
 * snapshot must select the same pool, or the evidence is not reproducible.
 */
export function resolvePool(
  rows: readonly YieldsPoolRow[],
  selector: PoolSelector,
  legId: string,
): ResolvedPool {
  const { stages, survivors } = funnelRows(rows, selector);
  if (survivors.length === 0) throw new PoolResolutionError(legId, selector, stages);

  const ranked = [...survivors].sort((a, b) => {
    const score = (row: YieldsPoolRow): number => row.apyMean30d ?? row.apy ?? Number.NEGATIVE_INFINITY;
    const delta = score(b) - score(a);
    return delta === 0 ? a.pool.localeCompare(b.pool) : delta;
  });

  const best = ranked[0];
  if (best === undefined) throw new PoolResolutionError(legId, selector, stages);

  return {
    poolId: best.pool,
    url: yieldsPoolUrl(best.pool),
    project: best.project,
    chain: best.chain,
    symbol: best.symbol,
    tvlUsd: best.tvlUsd,
    apy: best.apy,
    apyMean30d: best.apyMean30d ?? null,
    apyBase: best.apyBase ?? null,
    apyReward: best.apyReward ?? null,
    exposure: best.exposure ?? null,
    ilRisk: best.ilRisk ?? null,
  };
}

// ─── The feed ────────────────────────────────────────────────────────────────────────────────────

export interface YieldsSnapshot {
  readonly rows: readonly YieldsPoolRow[];
  /** When this snapshot was taken. Recorded in the evidence — a resolved pool id is only meaningful
   *  alongside the moment it was chosen from, because rankings move. */
  readonly scrapedAt: string;
  readonly url: string;
}

export interface YieldsFeed {
  snapshot(): Promise<YieldsSnapshot>;
}

export interface YieldsFeedOptions {
  readonly url?: string;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
}

/**
 * A feed that fetches at most once per instance.
 *
 * The cache is the rate-limit discipline rather than an optimisation: every leg of a mandate resolves
 * against the same snapshot, so N legs cost one request. A long-lived instance would serve stale data,
 * so treat one as per-resolution — the run's evidence records `scrapedAt`, which is what makes the
 * staleness visible.
 */
export function createYieldsFeed(options: YieldsFeedOptions = {}): YieldsFeed {
  const url = options.url ?? YIELDS_POOLS_URL;
  const doFetch = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  let cached: Promise<YieldsSnapshot> | undefined;

  return {
    snapshot(): Promise<YieldsSnapshot> {
      cached ??= (async () => {
        const response = await doFetch(url);
        if (!response.ok) {
          throw new Error(`the yields feed returned ${response.status} for ${url}`);
        }
        const body: unknown = await response.json();
        // Parsed per row rather than all-or-nothing: the feed is third-party and carries pools this
        // service does not model, so one unfamiliar row must not blank the whole snapshot.
        const rows = parseRows(body);
        return { rows, scrapedAt: now().toISOString(), url };
      })();
      return cached;
    },
  };
}

function parseRows(body: unknown): readonly YieldsPoolRow[] {
  const container = body as { data?: unknown };
  if (!Array.isArray(container?.data)) {
    throw new Error("the yields feed did not return a `data` array");
  }
  const rows: YieldsPoolRow[] = [];
  for (const candidate of container.data) {
    const parsed = YieldsPoolRowSchema.safeParse(candidate);
    if (parsed.success) rows.push(parsed.data);
  }
  return rows;
}

// ─── Mandate resolution ──────────────────────────────────────────────────────────────────────────

export interface ResolvedLeg {
  readonly legId: string;
  readonly kind: string;
  readonly protocol: string;
  readonly weightPct: number;
  readonly intent: string;
  readonly pool: ResolvedPool;
  /** True when the resolved pool's 30-day mean is under the leg's own floor. */
  readonly belowFloor: boolean;
}

export interface ResolvedMandate {
  readonly mandateId: string;
  readonly chain: string;
  readonly settlementChain: string;
  readonly horizonDays: number;
  readonly notionalUsd: number;
  /** Exactly what `AgentRequest` requires — the values that were empty before, and the reason the
   *  agent had no pool context to reason about. */
  readonly pools: readonly string[];
  readonly protocols: readonly string[];
  readonly legs: readonly ResolvedLeg[];
  /** Non-fatal observations: a leg under its floor, weights that do not sum to 100. */
  readonly warnings: readonly string[];
  readonly evidence: {
    readonly source: "defillama-yields";
    readonly url: string;
    readonly scrapedAt: string;
    /** The pool ids and the moment they were chosen, so a later reader can re-derive the choice. */
    readonly pools: readonly { readonly legId: string; readonly poolId: string; readonly apyMean30d: number | null }[];
  };
}

function totalWeight(mandate: Mandate): number {
  return mandate.legs.reduce((sum, leg) => sum + leg.weightPct, 0);
}

/**
 * Resolve every leg against one snapshot.
 *
 * Weights are *reported* when they do not sum to 100 rather than silently normalised: an operator who
 * wrote 65/35 and sees 65/35 can trust the mandate, and one who wrote 60/30 should be told, not have it
 * quietly become 67/33.
 */
export async function resolveMandate(
  input: unknown,
  feed: YieldsFeed,
): Promise<ResolvedMandate> {
  const mandate = MandateSchema.parse(input);
  const warnings: string[] = [];

  const sum = totalWeight(mandate);
  if (Math.abs(sum - 100) > 0.01) {
    warnings.push(`leg weights sum to ${sum}, not 100`);
  }

  const { rows, scrapedAt, url } = await feed.snapshot();

  const legs = mandate.legs.map((leg): ResolvedLeg => {
    const pool = resolvePool(rows, leg.poolSelector, leg.id);
    const floorBps = leg.minApyBps;
    const meanBps = pool.apyMean30d === null ? null : pool.apyMean30d * 100;
    const belowFloor = floorBps !== undefined && meanBps !== null && meanBps < floorBps;
    if (belowFloor) {
      warnings.push(
        `leg \`${leg.id}\` clears ${meanBps?.toFixed(0)}bps against its floor of ${floorBps}bps`,
      );
    }
    if (meanBps === null) {
      warnings.push(`leg \`${leg.id}\` has no 30-day mean, so its floor could not be checked`);
    }
    return {
      legId: leg.id,
      kind: leg.kind,
      protocol: leg.protocol,
      weightPct: leg.weightPct,
      intent: leg.intent,
      pool,
      belowFloor,
    };
  });

  // Deduplicated but order-preserved: two legs may legitimately share a protocol, and the agent's
  // request should not carry the same string twice.
  const pools = [...new Set(legs.map((leg) => leg.pool.poolId))];
  const protocols = [...new Set(legs.map((leg) => leg.protocol))];

  return {
    mandateId: mandate.id,
    chain: mandate.chain,
    settlementChain: mandate.settlementChain,
    horizonDays: mandate.horizonDays,
    notionalUsd: mandate.notionalUsd,
    pools,
    protocols,
    legs,
    warnings,
    evidence: {
      source: "defillama-yields",
      url,
      scrapedAt,
      pools: legs.map((leg) => ({
        legId: leg.legId,
        poolId: leg.pool.poolId,
        apyMean30d: leg.pool.apyMean30d,
      })),
    },
  };
}
