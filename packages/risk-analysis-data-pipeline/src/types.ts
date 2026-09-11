/**
 * The snapshot contract — every shape this package publishes or consumes.
 *
 * These schemas are the *seam* between the Python scraper and the TypeScript
 * read path. The Python side has a mirroring `models.py`; a fixture-based drift
 * test (T1.2) asserts that what Python emits validates against these schemas, so
 * the two languages cannot silently diverge.
 *
 * Three rules govern everything here:
 *
 *  1. **`raw` is always retained beside its classification.** L2Beat publishes
 *     prose ("Fraud proofs (1R, ZK)") that we classify into an enum. If the
 *     classifier changes, the original string is still on disk to audit against.
 *     A classification without its source text is unfalsifiable.
 *  2. **Timestamps are ISO-8601 strings, not `Date`.** These documents are JSON
 *     files. Modelling them as `Date` would mean the schema no longer describes
 *     what is actually on disk. The repository converts to `Date` when building
 *     domain objects.
 *  3. **Every record carries `provenance`.** A number the agent can cite must be
 *     traceable to a source URL and a fetch time; without that, a risk figure is
 *     indistinguishable from a hallucination.
 */

import { z } from 'zod';

// ── Shared primitives ────────────────────────────────────────────────────────

/** An ISO-8601 timestamp, as it appears in the serialized JSON. */
export const IsoTimestampSchema = z.iso.datetime();

/** A score normalized to 0–1 where a higher value means *safer*. */
export const RiskScoreSchema = z.number().min(0).max(1);

/** Lifecycle state of a source (or a record produced from one). */
export const SOURCE_STATES = ['fresh', 'stale', 'degraded', 'failed', 'skipped'] as const;
export const SourceStateSchema = z.enum(SOURCE_STATES);
export type SourceState = z.infer<typeof SourceStateSchema>;

/**
 * Where a record came from and whether it can be trusted as current.
 *
 * `state === 'stale'` is deliberately not an error: a stale-but-real snapshot is
 * more useful to the agent than no snapshot, provided the staleness is visible.
 * What is forbidden is presenting stale data as fresh.
 */
export const ProvenanceSchema = z.object({
  /** Short source identifier, e.g. `l2beat.com`. */
  source: z.string().min(1),
  /** The exact URL fetched, so the figure can be re-checked by hand. */
  sourceUrl: z.string().min(1),
  /** When the fetch completed. */
  fetchedAt: IsoTimestampSchema,
  /** Freshness verdict for this record. */
  state: SourceStateSchema,
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

// ── Chain risk (L2Beat) ──────────────────────────────────────────────────────

/** L2Beat's Stages framework rating for a rollup. */
export const CHAIN_STAGES = [
  'stage-0',
  'stage-1',
  'stage-2',
  'not-applicable',
] as const;
export const ChainStageSchema = z.enum(CHAIN_STAGES);
export type ChainStage = z.infer<typeof ChainStageSchema>;

/**
 * A single risk dimension: the site's verbatim text plus our classification.
 *
 * `category` is what code branches on; `raw` is what a human audits. Both are
 * required, which is what makes the classifier testable against real payloads.
 */
export const StateValidationDimensionSchema = z.object({
  raw: z.string().min(1),
  category: z.enum(['fraud-proofs', 'validity-proofs', 'optimistic', 'none', 'other']),
  /** Challenge period before a state root is final, when the source states one. */
  challengePeriodDays: z.number().nullable(),
});
export type StateValidationDimension = z.infer<typeof StateValidationDimensionSchema>;

export const DataAvailabilityDimensionSchema = z.object({
  raw: z.string().min(1),
  category: z.enum(['onchain', 'onchain-sd', 'external', 'self-custodied', 'other']),
});
export type DataAvailabilityDimension = z.infer<typeof DataAvailabilityDimensionSchema>;

export const ExitWindowDimensionSchema = z.object({
  raw: z.string().min(1),
  category: z.enum(['none', 'emergency-only', 'regular', 'infinite', 'not-applicable', 'other']),
  /** Length of the exit window in days; `null` when none or unbounded. */
  days: z.number().nullable(),
});
export type ExitWindowDimension = z.infer<typeof ExitWindowDimensionSchema>;

export const SequencerFailureDimensionSchema = z.object({
  raw: z.string().min(1),
  category: z.enum([
    'self-sequence',
    'force-via-l1',
    'enqueue-via-l1',
    'log-via-l1',
    'decentralized-set',
    'no-mechanism',
    'other',
  ]),
  /** Delay before a forced transaction lands, when stated. */
  delayHours: z.number().nullable(),
});
export type SequencerFailureDimension = z.infer<typeof SequencerFailureDimensionSchema>;

export const ProposerFailureDimensionSchema = z.object({
  raw: z.string().min(1),
  category: z.enum([
    'self-propose',
    'cannot-withdraw',
    'use-escape-hatch',
    'replace-proposer',
    'security-council',
    'other',
  ]),
});
export type ProposerFailureDimension = z.infer<typeof ProposerFailureDimensionSchema>;

/** The five L2Beat risk dimensions, in their published order. */
export const ChainDimensionsSchema = z.object({
  stateValidation: StateValidationDimensionSchema,
  dataAvailability: DataAvailabilityDimensionSchema,
  exitWindow: ExitWindowDimensionSchema,
  sequencerFailure: SequencerFailureDimensionSchema,
  proposerFailure: ProposerFailureDimensionSchema,
});
export type ChainDimensions = z.infer<typeof ChainDimensionsSchema>;

/** Per-dimension and composite safety scores derived deterministically. */
export const ChainRiskScoresSchema = z.object({
  stateValidation: RiskScoreSchema,
  dataAvailability: RiskScoreSchema,
  exit: RiskScoreSchema,
  sequencer: RiskScoreSchema,
  proposer: RiskScoreSchema,
  /** Weighted aggregate; the single number most consumers want. */
  composite: RiskScoreSchema,
});
export type ChainRiskScores = z.infer<typeof ChainRiskScoresSchema>;

/** A chain's macro risk profile, as published to `risk/chains/{slug}.json`. */
export const ChainRiskProfileSchema = z.object({
  schemaVersion: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1),
  /** The L2Beat page this was parsed from. */
  l2beatUrl: z.string().min(1),
  stage: ChainStageSchema,
  dimensions: ChainDimensionsSchema,
  /** Value secured, in USD. `null` when the source does not report it. */
  valueSecuredUsd: z.number().nullable(),
  riskScores: ChainRiskScoresSchema,
  provenance: ProvenanceSchema,
});
export type ChainRiskProfile = z.infer<typeof ChainRiskProfileSchema>;

// ── Protocol governance (Discourse) ──────────────────────────────────────────

/**
 * The governance lifecycle stage, classified deterministically from the topic
 * title prefix.
 *
 * Discourse forums encode the stage in the title — `[RFC]`, `[TEMP CHECK]`,
 * `[ARFC]`, `[AIP]`. Classifying in code (never by an LLM) makes the result
 * reproducible and testable; anything unrecognized becomes `other` rather than a
 * guess.
 */
export const PROPOSAL_STAGES = [
  'rfc',
  'temp-check',
  'arfc',
  'aip',
  'discussion',
  'other',
] as const;
export const ProposalStageSchema = z.enum(PROPOSAL_STAGES);
export type ProposalStage = z.infer<typeof ProposalStageSchema>;

/** Whether a proposal thread is still live. */
export const PROPOSAL_STATUSES = ['open', 'closed', 'archived'] as const;
export const ProposalStatusSchema = z.enum(PROPOSAL_STATUSES);
export type ProposalStatus = z.infer<typeof ProposalStatusSchema>;

/** One governance topic, normalized from the Discourse payload. */
export const ProposalSchema = z.object({
  id: z.number().int(),
  title: z.string().min(1),
  slug: z.string().min(1),
  stage: ProposalStageSchema,
  status: ProposalStatusSchema,
  createdAt: IsoTimestampSchema,
  lastPostedAt: IsoTimestampSchema,
  postsCount: z.number().int().nonnegative(),
  replyCount: z.number().int().nonnegative(),
  views: z.number().int().nonnegative(),
  likeCount: z.number().int().nonnegative(),
  url: z.string().min(1),
  /** Verbatim excerpt, retained so the text can be embedded and audited. */
  excerpt: z.string().nullable(),
});
export type Proposal = z.infer<typeof ProposalSchema>;

/** Where a protocol's governance lives. */
export const GovernanceSourceSchema = z.object({
  forumUrl: z.string().min(1),
  platform: z.enum(['discourse', 'onchain', 'none']),
  /** The machine-readable endpoint when the platform exposes one. */
  jsonApi: z.string().nullable(),
  reachable: z.boolean(),
});
export type GovernanceSource = z.infer<typeof GovernanceSourceSchema>;

/** Participation and activity scores derived from the proposal set. */
export const GovernanceScoresSchema = z.object({
  /** How many proposals landed in the recent window. */
  activity: RiskScoreSchema,
  /** Median replies per proposal — a proxy for genuine deliberation. */
  participation: RiskScoreSchema,
  /** Share of proposals touching risk parameters or collateral. */
  riskActivity: RiskScoreSchema,
  composite: RiskScoreSchema,
});
export type GovernanceScores = z.infer<typeof GovernanceScoresSchema>;

/** A protocol's governance profile, as published to `risk/protocols/{slug}.json`. */
export const ProtocolGovernanceProfileSchema = z.object({
  schemaVersion: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1),
  category: z.enum(['lending', 'dex', 'perps', 'yield', 'stablecoin', 'other']),
  governance: GovernanceSourceSchema,
  proposals: z.array(ProposalSchema),
  governanceScores: GovernanceScoresSchema,
  provenance: ProvenanceSchema,
});
export type ProtocolGovernanceProfile = z.infer<typeof ProtocolGovernanceProfileSchema>;

// ── Market makers (DefiLlama / Forgd) ────────────────────────────────────────

/** Forgd's letter grade, AAA (highest) through CCC (lowest). */
export const MARKET_MAKER_GRADES = ['AAA', 'AA', 'A', 'BBB', 'BB', 'CCC'] as const;
export const MarketMakerGradeSchema = z.enum(MARKET_MAKER_GRADES);
export type MarketMakerGrade = z.infer<typeof MarketMakerGradeSchema>;

/**
 * The weighted sub-scores behind the composite, as published in the table.
 *
 * `integrationLevel` is nullable because the leaderboard renders that column
 * **empty** for many rows — verified against the captured payload, where the
 * row is `\tAA\t9.40\t10.00\t8.50\t8.75\t9.30\t` with nothing after the final
 * tab. Recording `null` is the honest answer; substituting a zero or copying a
 * neighbouring column would invent a figure the source never published.
 */
export const MarketMakerSubScoresSchema = z.object({
  tradingKpis: z.number(),
  trust: z.number(),
  coverageCapabilities: z.number(),
  uptime: z.number(),
  integrationLevel: z.number().nullable(),
});
export type MarketMakerSubScores = z.infer<typeof MarketMakerSubScoresSchema>;

/**
 * The 30-day trading metrics the leaderboard actually publishes.
 *
 * Note what is *absent*: there is no per-market-maker TVL figure, and these
 * depth/volume/spread metrics appear only on the three hero cards, **not** in
 * the full 44-row table. The schema therefore models this as a nullable block —
 * present for the makers the page highlights, absent for the rest — rather than
 * inventing a value or pretending every row has one.
 */
export const MarketMakerMetricsSchema = z.object({
  /** Average order-book depth in USD over the window. */
  depthUsd: z.number(),
  depthRank: z.number().int().nullable(),
  /** Bid-ask spread, as a percentage. */
  spreadPct: z.number(),
  spreadRank: z.number().int().nullable(),
  /** Maker and taker volume in USD over the window. */
  volumeUsd: z.number(),
  volumeRank: z.number().int().nullable(),
});
export type MarketMakerMetrics = z.infer<typeof MarketMakerMetricsSchema>;

/**
 * One row of a detailed KPI breakdown from the per-maker Details modal.
 *
 * The value is carried **both** raw and parsed. The raw string is what the page
 * actually printed — including `"N/A"`, which several loan-utilization metrics
 * legitimately show — and the numeric form is `null` whenever the raw value is
 * not a number. Storing only a number would force a choice between inventing a
 * zero and dropping the row; storing only a string would make the data awkward
 * to analyse. Both, with an explicit null, is honest and usable.
 */
export const MarketMakerMetricRowSchema = z.object({
  /** The metric label exactly as published, e.g. `"Bid Depth 200 bps (USD)"`. */
  metric: z.string().min(1),
  /** The published value verbatim, e.g. `"$553.88K"`, `"87.46%"` or `"N/A"`. */
  valueRaw: z.string().min(1),
  /** The parsed magnitude, or `null` when the value is not numeric. */
  valueNumeric: z.number().nullable(),
  /** Percentile against the peer set, when published (0–100). */
  percentile: z.number().nullable(),
  /** Rank against the peer set, when published. */
  rank: z.number().int().nullable(),
});
export type MarketMakerMetricRow = z.infer<typeof MarketMakerMetricRowSchema>;

/** The four KPI families the Details modal breaks down. */
export const MarketMakerDetailBreakdownsSchema = z.object({
  depth: z.array(MarketMakerMetricRowSchema),
  volume: z.array(MarketMakerMetricRowSchema),
  spread: z.array(MarketMakerMetricRowSchema),
  kpiAdherence: z.array(MarketMakerMetricRowSchema),
});
export type MarketMakerDetailBreakdowns = z.infer<typeof MarketMakerDetailBreakdownsSchema>;

/**
 * Where a maker placed on one leaderboard.
 *
 * The modal reports standings once per metric family and once aggregated, each
 * as a percentile and a rank, alongside a prose sentence derived from them
 * ("Outperformed 84% of their peers…"). Only the numbers are modelled, since the
 * sentence carries no information the percentile does not.
 */
export const MarketMakerStandingSchema = z.object({
  percentile: z.number().nullable(),
  rank: z.number().int().nullable(),
});
export type MarketMakerStanding = z.infer<typeof MarketMakerStandingSchema>;

/** A maker's placement across every leaderboard the modal reports. */
export const MarketMakerStandingsSchema = z.object({
  aggregated: MarketMakerStandingSchema.nullable(),
  depth: MarketMakerStandingSchema.nullable(),
  volume: MarketMakerStandingSchema.nullable(),
  spread: MarketMakerStandingSchema.nullable(),
  kpiAdherence: MarketMakerStandingSchema.nullable(),
});
export type MarketMakerStandings = z.infer<typeof MarketMakerStandingsSchema>;

/**
 * The six scores the modal restates, each on a 0–10 scale.
 *
 * The modal prints these as strings like `"9.10/10.00"`; only the numeric
 * numerator is kept. They duplicate the leaderboard table's values and are
 * captured because the modal is the only place that states the scale explicitly.
 */
export const MarketMakerDetailScoresSchema = z.object({
  composite: z.number().nullable(),
  tradingKpis: z.number().nullable(),
  trust: z.number().nullable(),
  coverageCapabilities: z.number().nullable(),
  uptime: z.number().nullable(),
  integrationLevel: z.number().nullable(),
});
export type MarketMakerDetailScores = z.infer<typeof MarketMakerDetailScoresSchema>;

/**
 * A market maker's full detail card — the drill-down behind `Details`.
 *
 * This is the artifact with the order-book substance: per-band depth at 50/100/
 * 200 bps, maker-versus-taker fill volume, volume-weighted spread, KPI adherence
 * per depth band, and the venues the maker actually supports.
 *
 * `cexSupported` / `dexSupported` answer "which major venues does this maker
 * cover". They are available **only** here — the summary leaderboard rolls
 * coverage into a single score and publishes no venue list, so a consumer that
 * needs venue-level detail must read this card.
 */
export const MarketMakerDetailSchema = z.object({
  schemaVersion: z.string().min(1),
  /** Slug of the maker this card belongs to, matching the profile snapshot. */
  slug: z.string().min(1),
  name: z.string().min(1),
  /** The measurement window; currently always 30 days. */
  window: z.literal('30d'),
  /** The maker's self-description, verbatim from the `About` section. */
  description: z.string().nullable(),
  /** The stated integration tier, e.g. `"Fully Integrated"`. */
  integrationLabel: z.string().nullable(),
  scores: MarketMakerDetailScoresSchema,
  standings: MarketMakerStandingsSchema,
  /** Engagements tracked by Forgd. */
  activeEngagements: z.number().int().nonnegative().nullable(),
  /** Average FDV of the projects this maker is engaged with. */
  avgFdvUsd: z.number().nullable(),
  breakdowns: MarketMakerDetailBreakdownsSchema,
  /** Engagement structures the maker offers, e.g. `"Loan + Call Option"`. */
  engagementOptions: z.array(z.string()),
  /** Major centralised exchanges the maker supports. */
  cexSupported: z.array(z.string()),
  /** Major decentralised exchanges the maker supports. */
  dexSupported: z.array(z.string()),
  /** Non-liquidity services offered, e.g. treasury management. */
  ancillaryServices: z.array(z.string()),
  provenance: ProvenanceSchema,
});
export type MarketMakerDetail = z.infer<typeof MarketMakerDetailSchema>;

/** One market maker, as published to `risk/market-makers/{slug}.json`. */
export const MarketMakerProfileSchema = z.object({
  schemaVersion: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1),
  /** Leaderboard position, 1-based. */
  rank: z.number().int().positive(),
  grade: MarketMakerGradeSchema,
  compositeScore: z.number(),
  subScores: MarketMakerSubScoresSchema,
  /** Present only for makers the leaderboard highlights in its hero cards. */
  metrics: MarketMakerMetricsSchema.nullable(),
  /** Active engagements, published on the hero cards only. */
  activeEngagements: z.number().int().nonnegative().nullable(),
  /** Fully-diluted valuation in USD, published on the hero cards only. */
  fdvUsd: z.number().nullable(),
  /** The measurement window; currently always 30 days. */
  window: z.literal('30d'),
  provider: z.string().min(1),
  provenance: ProvenanceSchema,
});
export type MarketMakerProfile = z.infer<typeof MarketMakerProfileSchema>;

/** Headline aggregates across all market makers, for the summary snapshot. */
export const MarketMakerSummarySchema = z.object({
  schemaVersion: z.string().min(1),
  generatedAt: IsoTimestampSchema,
  makerCount: z.number().int().nonnegative(),
  /** The maker with the deepest average book. */
  topDepth: z.object({ name: z.string().min(1), value: z.number() }).nullable(),
  /** The maker with the highest volume. */
  topVolume: z.object({ name: z.string().min(1), value: z.number() }).nullable(),
  /** The maker with the tightest spread. */
  topSpread: z.object({ name: z.string().min(1), value: z.number() }).nullable(),
  /** The maker with the best combined uptime / KPI adherence. */
  topUptime: z.object({ name: z.string().min(1), value: z.number() }).nullable(),
  provenance: ProvenanceSchema,
});
export type MarketMakerSummary = z.infer<typeof MarketMakerSummarySchema>;

// ── Manifest ─────────────────────────────────────────────────────────────────

/** Per-source outcome recorded in the manifest. */
export const ManifestSourceSchema = z.object({
  state: SourceStateSchema,
  fetchedAt: IsoTimestampSchema.nullable(),
  latencyMs: z.number().nonnegative().nullable(),
  records: z.number().int().nonnegative(),
  /** Content hash, so an unchanged source writes no new bytes. */
  contentHash: z.string().nullable(),
  /** Present only when the source did not succeed. */
  error: z.string().nullable(),
});
export type ManifestSource = z.infer<typeof ManifestSourceSchema>;

/** Rows written per temporal table during the sweep. */
export const ManifestTemporalSchema = z.object({
  chainRiskHistory: z.number().int().nonnegative(),
  protocolGovernanceHistory: z.number().int().nonnegative(),
  marketMakerMetrics: z.number().int().nonnegative(),
  embeddings: z.number().int().nonnegative(),
});
export type ManifestTemporal = z.infer<typeof ManifestTemporalSchema>;

/**
 * The run manifest, extending the shape already used by
 * `data/defillama_metrics/scrape_manifest.json`.
 *
 * This is the artifact an operator reads first: it answers "did the sweep work,
 * what is stale, and why" without needing to inspect individual snapshots.
 */
export const ManifestSchema = z.object({
  schemaVersion: z.string().min(1),
  generatedAt: IsoTimestampSchema,
  /** Configured cadence, so a consumer can judge staleness against intent. */
  cadenceHours: z.number().positive(),
  sources: z.record(z.string(), ManifestSourceSchema),
  temporal: ManifestTemporalSchema,
  /** Non-fatal observations worth surfacing to a human. */
  notes: z.array(z.string()),
});
export type Manifest = z.infer<typeof ManifestSchema>;

// ── Snapshot key helpers ─────────────────────────────────────────────────────

/** The snapshot families this package publishes. */
export const SNAPSHOT_KINDS = ['chains', 'protocols', 'market-makers'] as const;
export const SnapshotKindSchema = z.enum(SNAPSHOT_KINDS);
export type SnapshotKind = z.infer<typeof SnapshotKindSchema>;

/**
 * Build the object key for a snapshot.
 *
 * Keys are derived in one place so a consumer reading a profile and the writer
 * publishing it can never disagree about where it lives.
 *
 * @param kind - The snapshot family.
 * @param slug - The entity slug.
 * @returns The key, relative to the configured prefix.
 */
export function snapshotKey(kind: SnapshotKind, slug: string): string {
  return `${kind}/${slug}.json`;
}

/** The key of the run manifest. */
export const MANIFEST_KEY = 'manifest.json';
