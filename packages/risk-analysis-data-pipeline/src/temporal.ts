/**
 * Temporal write path — snapshot records to TimescaleDB history rows.
 *
 * The pipeline publishes each sweep twice, to two stores with different jobs:
 *
 *  - **GCS** holds the *current* snapshot, which answers "what is the risk
 *    profile now" — the shape an API response wants.
 *  - **TimescaleDB** holds the *history*, which answers "what was it at each step
 *    of the target series" — the shape a forecast covariate needs.
 *
 * This module owns the second write, and only the *mapping*: it turns a risk
 * record into the row shape the timeseries package expects. The SQL itself lives
 * in `@ethonline2026/timeseries`'s `RiskHistoryRepository`, because that package
 * owns its schema — so this module never issues a statement of its own. That is
 * the same two-layer division the-graph and arc follow, and it means a schema
 * change has exactly one place to be applied.
 *
 * Every mapping is pure and independently testable, which is why they are
 * exported separately from the write itself.
 */

import {
  RiskHistoryRepository,
  type ChainRiskHistoryRow,
  type MarketMakerMetricsRow,
  type ProtocolGovernanceHistoryRow,
  type SqlRunner,
} from '@ethonline2026/timeseries';
import { TemporalWriteError } from './errors.js';
import { countRiskRelevantProposals } from './proposals.js';
import type {
  ChainRiskProfile,
  MarketMakerProfile,
  ProtocolGovernanceProfile,
} from './types.js';

/** Rows written per table in one sweep, for the manifest. */
export interface TemporalWriteReport {
  readonly chainRiskHistory: number;
  readonly protocolGovernanceHistory: number;
  readonly marketMakerMetrics: number;
  readonly embeddings: number;
}

/** An all-zero report, used when temporal writing is disabled or fails. */
export const EMPTY_TEMPORAL_REPORT: TemporalWriteReport = {
  chainRiskHistory: 0,
  protocolGovernanceHistory: 0,
  marketMakerMetrics: 0,
  embeddings: 0,
};

/**
 * Map a chain risk profile to a history row.
 *
 * The `raw` field carries the verbatim dimension strings, applying the
 * retain-the-source rule: a classifier change stays auditable against what
 * L2Beat published at that instant.
 *
 * @param profile - The validated chain profile.
 * @param observedAt - The instant to stamp the row with. Injected rather than
 *   read from the clock so a run's rows share one timestamp and a test is
 *   deterministic.
 * @returns The history row.
 * @example
 * ```ts
 * const row = chainRowFromProfile(profile, new Date());
 * ```
 */
export function chainRowFromProfile(
  profile: ChainRiskProfile,
  observedAt: Date,
): ChainRiskHistoryRow {
  const d = profile.dimensions;
  return {
    ts: observedAt,
    chainSlug: profile.slug,
    stage: profile.stage,
    stateValidation: d.stateValidation.category,
    dataAvailability: d.dataAvailability.category,
    exitWindow: d.exitWindow.category,
    sequencerFailure: d.sequencerFailure.category,
    proposerFailure: d.proposerFailure.category,
    challengePeriodDays: d.stateValidation.challengePeriodDays,
    exitWindowDays: d.exitWindow.days,
    sequencerDelayHours: d.sequencerFailure.delayHours,
    valueSecuredUsd: profile.valueSecuredUsd,
    compositeScore: profile.riskScores.composite,
    raw: {
      stateValidation: d.stateValidation.raw,
      dataAvailability: d.dataAvailability.raw,
      exitWindow: d.exitWindow.raw,
      sequencerFailure: d.sequencerFailure.raw,
      proposerFailure: d.proposerFailure.raw,
    },
  };
}

/**
 * Map a governance profile to a history row.
 *
 * The proposal counts are split three ways — total, open, and recent — rather
 * than collapsed into one number, because they support different covariate
 * readings: total is history, open is current workload, recent is liveness.
 *
 * @param profile - The validated governance profile.
 * @param observedAt - The instant to stamp the row with.
 * @returns The history row.
 */
export function governanceRowFromProfile(
  profile: ProtocolGovernanceProfile,
  observedAt: Date,
): ProtocolGovernanceHistoryRow {
  const proposals = profile.proposals;
  const openCount = proposals.filter((p) => p.status === 'open').length;

  // A "recent" proposal is one whose last activity falls in the latter half of
  // the observation window. Computed here rather than in SQL so the same rows
  // give the same counts in the snapshot and the history.
  const sorted = [...proposals].sort(
    (a, b) => new Date(b.lastPostedAt).getTime() - new Date(a.lastPostedAt).getTime(),
  );
  const midpoint = Math.floor(sorted.length / 2);
  const recentCount = sorted.length === 0 ? 0 : midpoint + (sorted.length % 2);

  const riskProposalCount = countRiskRelevantProposals(proposals);

  return {
    observedAt,
    protocolSlug: profile.slug,
    proposalCount: proposals.length,
    openCount,
    recentCount,
    riskProposalCount,
    activityScore: profile.governanceScores.activity,
    participationScore: profile.governanceScores.participation,
    riskActivityScore: profile.governanceScores.riskActivity,
    compositeScore: profile.governanceScores.composite,
    raw: {
      forumUrl: profile.governance.forumUrl,
      platform: profile.governance.platform,
    },
  };
}

/**
 * Map a market-maker profile to a history row.
 *
 * The hero-card metrics are nullable because the leaderboard publishes them for
 * only a few makers; `null` records "not published", which is different from the
 * zero a missing value would otherwise become.
 *
 * @param profile - The validated market-maker profile.
 * @param observedAt - The instant to stamp the row with.
 * @returns The history row.
 */
export function marketMakerRowFromProfile(
  profile: MarketMakerProfile,
  observedAt: Date,
): MarketMakerMetricsRow {
  return {
    ts: observedAt,
    marketMaker: profile.slug,
    grade: profile.grade,
    compositeScore: profile.compositeScore,
    rank: profile.rank,
    depthUsd: profile.metrics?.depthUsd ?? null,
    spreadPct: profile.metrics?.spreadPct ?? null,
    volumeUsd: profile.metrics?.volumeUsd ?? null,
    tradingKpis: profile.subScores.tradingKpis,
    trust: profile.subScores.trust,
    coverageCapabilities: profile.subScores.coverageCapabilities,
    uptime: profile.subScores.uptime,
    integrationLevel: profile.subScores.integrationLevel,
    activeEngagements: profile.activeEngagements,
    fdvUsd: profile.fdvUsd,
    raw: { provider: profile.provider, window: profile.window },
  };
}

/**
 * One sweep's records to persist.
 *
 * Declared as a named interface rather than inline so each family is documented
 * once — and so a caller cannot half-specify the input by relying on the shape
 * being visible only at the call site.
 */
export interface WriteRiskHistoryInput {
  /** The instant to stamp every row with, so one sweep shares a timestamp. */
  readonly observedAt: Date;
  /** Chain profiles to append, when any were collected. */
  readonly chains?: readonly ChainRiskProfile[] | undefined;
  /** Governance profiles to append. */
  readonly protocols?: readonly ProtocolGovernanceProfile[] | undefined;
  /** Market-maker profiles to append. */
  readonly marketMakers?: readonly MarketMakerProfile[] | undefined;
}

/**
 * Write one sweep's risk history to TimescaleDB.
 *
 * Each table is written independently and a failure in one does not abandon the
 * others — losing the market-maker series should not also cost the chain series,
 * because they feed different covariates. Failures are collected and reported
 * rather than thrown, matching how the sweep treats a failing source: a partial
 * success is recorded, not silently discarded.
 *
 * @param repository - The history repository supplied by the timeseries package.
 * @param input - The records to persist and the instant to stamp them with.
 * @returns The rows actually inserted per table, plus any per-table errors.
 * @example
 * ```ts
 * const report = await writeRiskHistory(new RiskHistoryRepository(runner), {
 *   observedAt: new Date(),
 *   chains: chainProfiles,
 * });
 * ```
 */
export async function writeRiskHistory(
  repository: RiskHistoryRepository,
  input: WriteRiskHistoryInput,
): Promise<{ readonly report: TemporalWriteReport; readonly errors: readonly string[] }> {
  const errors: string[] = [];
  let chainRiskHistory = 0;
  let protocolGovernanceHistory = 0;
  let marketMakerMetrics = 0;

  if (input.chains !== undefined && input.chains.length > 0) {
    try {
      const rows = input.chains.map((profile) => chainRowFromProfile(profile, input.observedAt));
      chainRiskHistory = (await repository.recordChainRisk(rows)).inserted;
    } catch (err) {
      errors.push(describeWrite('chain_risk_history', err));
    }
  }

  if (input.protocols !== undefined && input.protocols.length > 0) {
    try {
      const rows = input.protocols.map((profile) =>
        governanceRowFromProfile(profile, input.observedAt),
      );
      protocolGovernanceHistory = (await repository.recordGovernance(rows)).inserted;
    } catch (err) {
      errors.push(describeWrite('protocol_governance_history', err));
    }
  }

  if (input.marketMakers !== undefined && input.marketMakers.length > 0) {
    try {
      const rows = input.marketMakers.map((profile) =>
        marketMakerRowFromProfile(profile, input.observedAt),
      );
      marketMakerMetrics = (await repository.recordMarketMakers(rows)).inserted;
    } catch (err) {
      errors.push(describeWrite('market_maker_metrics', err));
    }
  }

  return {
    report: { chainRiskHistory, protocolGovernanceHistory, marketMakerMetrics, embeddings: 0 },
    errors,
  };
}

/**
 * Build the repository over a caller-supplied runner.
 *
 * A factory rather than a class so the pipeline never constructs a connection
 * itself: the runner is injected, which keeps the pipeline testable and leaves
 * credential handling with the composition root.
 *
 * @param runner - The SQL transport port.
 * @returns A history repository bound to that runner.
 */
export function riskHistoryRepository(runner: SqlRunner): RiskHistoryRepository {
  return new RiskHistoryRepository(runner);
}

/**
 * Render a write failure for collection in the report.
 *
 * @param table - The table that failed.
 * @param err - The caught error.
 * @returns A message naming the table, so the manifest says which series is short.
 */
function describeWrite(table: string, err: unknown): string {
  const detail = err instanceof Error ? err.message : String(err);
  return new TemporalWriteError(table, detail).message;
}
