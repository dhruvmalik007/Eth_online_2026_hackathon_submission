/**
 * Deterministic, citation-tagged serialization for risk embeddings.
 *
 * This is the risk pipeline's half of the vector-store trust boundary. The other
 * half lives in `@ethonline2026/timeseries`, whose serializer renders metric
 * windows, forecasts, decisions and performance slices. Both follow the same two
 * rules, for the same reason:
 *
 *  - **Text is rendered from records only.** An embedding can never be produced
 *    from model prose, so a hallucination cannot become a retrievable "fact" —
 *    there is no vector-store poisoning loop.
 *  - **Every line carries its source id.** Retrieval results therefore carry
 *    `sourceIds`, which is what lets the agent's citation guard verify that a
 *    retrieved chunk traces back to a real row.
 *
 * Output is byte-stable for identical input (fixed precision, ISO timestamps), so
 * the content hash is a valid idempotency key and backfilling twice inserts
 * nothing the second time.
 *
 * ## A note on `poolId`
 *
 * `SerializedChunk.poolId` is required by the shared contract, and for risk
 * chunks it carries the *subject* — a chain slug, protocol slug, or market-maker
 * slug — rather than a liquidity pool. That reuse is deliberate rather than
 * sloppy: the underlying column is a text partition key with a btree index, and
 * reshaping it would mean a second ANN index and a wider table for no analytical
 * gain. Every risk serializer here names its parameter `subject` and documents
 * the mapping, so the overload is explicit at the point it happens.
 */

import { createHash } from 'node:crypto';
import type { EmbeddingKind, SerializedChunk } from '@ethonline2026/timeseries';
import type {
  ChainRiskProfile,
  MarketMakerProfile,
  Proposal,
  ProtocolGovernanceProfile,
} from './types.js';

/**
 * A fixed-precision number, or `null` so a missing value never reads as zero.
 *
 * @param value - The number to render, or `null` for an unpublished value.
 * @param digits - Decimal places to keep.
 * @returns The fixed-precision string, or the literal `"null"`.
 */
function num(value: number | null, digits = 6): string {
  return value === null || !Number.isFinite(value) ? 'null' : value.toFixed(digits);
}

/**
 * An ISO instant, for byte-stable serialization.
 *
 * @param date - The instant to render.
 * @returns The instant as an ISO 8601 string.
 */
function iso(date: Date): string {
  return date.toISOString();
}

/**
 * The citation id for one governance proposal.
 *
 * @param protocolSlug - The protocol the proposal belongs to.
 * @param proposalId - The forum topic id.
 * @returns The citation id.
 * @example
 * ```ts
 * proposalId('aave', 25510); // 'proposal:aave:25510'
 * ```
 */
export function proposalId(protocolSlug: string, proposalId: number): string {
  return `proposal:${protocolSlug}:${proposalId}`;
}

/**
 * The citation id for one chain risk observation.
 *
 * @param chainSlug - The chain.
 * @param observedAt - The observation instant.
 * @returns The citation id.
 */
export function chainRiskId(chainSlug: string, observedAt: Date): string {
  return `chainrisk:${chainSlug}:${iso(observedAt)}`;
}

/**
 * The citation id for one market-maker profile observation.
 *
 * @param marketMaker - The market-maker slug.
 * @param observedAt - The observation instant.
 * @returns The citation id.
 */
export function marketMakerId(marketMaker: string, observedAt: Date): string {
  return `maker:${marketMaker}:${iso(observedAt)}`;
}

/**
 * The idempotency key for a chunk.
 *
 * Mirrors the timeseries package's `hashChunk` rather than importing it, because
 * that function takes the chunk type and this module builds one — the canonical
 * byte string is identical so hashes are comparable across both producers, and a
 * test pins that equivalence.
 *
 * @param chunk - The chunk to hash.
 * @returns The sha256 hex digest.
 */
export function hashRiskChunk(chunk: SerializedChunk): string {
  const canonical = [
    chunk.kind,
    chunk.poolId,
    iso(chunk.tsStart),
    iso(chunk.tsEnd),
    [...chunk.sourceIds].join(','),
    chunk.content,
  ].join('|');
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Render a governance proposal as one chunk.
 *
 * One chunk per proposal rather than per forum, so a retrieval hit names the
 * specific proposal it came from. The title and excerpt are carried verbatim:
 * a proposal's own words are the evidence, and paraphrasing them would put
 * generated text into the vector store.
 *
 * @param protocolSlug - The owning protocol.
 * @param proposal - The normalized proposal.
 * @returns The serialized chunk, or `null` when the proposal has no timestamp to
 *   place it on the timeline.
 * @example
 * ```ts
 * const chunk = serializeProposal('aave', profile.proposals[0]!);
 * ```
 */
export function serializeProposal(
  protocolSlug: string,
  proposal: Proposal,
): SerializedChunk | null {
  const created = new Date(proposal.createdAt);
  const lastPosted = new Date(proposal.lastPostedAt);
  if (Number.isNaN(created.getTime())) return null;

  const id = proposalId(protocolSlug, proposal.id);
  const lines = [
    `governance_proposal protocol=${protocolSlug} id=${proposal.id} stage=${proposal.stage} ` +
      `status=${proposal.status} posts=${proposal.postsCount} replies=${proposal.replyCount} ` +
      `views=${proposal.views} likes=${proposal.likeCount}`,
    `[${id}] title=${proposal.title}`,
    `[${id}] created=${iso(created)} last_posted=${iso(lastPosted)} url=${proposal.url}`,
  ];
  if (proposal.excerpt !== null && proposal.excerpt.length > 0) {
    lines.push(`[${id}] excerpt=${proposal.excerpt.replace(/\s+/g, ' ').trim()}`);
  }

  return {
    kind: 'governance_proposal' satisfies EmbeddingKind,
    // The subject occupies the shared partition-key slot; see the module note.
    poolId: protocolSlug,
    tsStart: created,
    tsEnd: Number.isNaN(lastPosted.getTime()) ? created : lastPosted,
    sourceIds: [id],
    content: lines.join('\n'),
  };
}

/**
 * Render a chain's risk profile as one chunk.
 *
 * The composite score is stated alongside its five component categories so a
 * retrieval hit can explain *why* a chain scored as it did, rather than only
 * reporting the aggregate.
 *
 * @param profile - The validated chain profile.
 * @param observedAt - The instant the profile was observed.
 * @returns The serialized chunk.
 */
export function serializeChainRisk(
  profile: ChainRiskProfile,
  observedAt: Date,
): SerializedChunk {
  const id = chainRiskId(profile.slug, observedAt);
  const d = profile.dimensions;
  const lines = [
    `chain_risk chain=${profile.slug} name=${profile.name} stage=${profile.stage} ` +
      `composite=${num(profile.riskScores.composite)} tvs_usd=${num(profile.valueSecuredUsd, 2)}`,
    `[${id}] state_validation=${d.stateValidation.category} (${d.stateValidation.raw}) ` +
      `challenge_period_days=${num(d.stateValidation.challengePeriodDays)}`,
    `[${id}] data_availability=${d.dataAvailability.category} (${d.dataAvailability.raw})`,
    `[${id}] exit_window=${d.exitWindow.category} (${d.exitWindow.raw}) days=${num(d.exitWindow.days)}`,
    `[${id}] sequencer_failure=${d.sequencerFailure.category} (${d.sequencerFailure.raw}) ` +
      `delay_hours=${num(d.sequencerFailure.delayHours)}`,
    `[${id}] proposer_failure=${d.proposerFailure.category} (${d.proposerFailure.raw})`,
  ];

  return {
    kind: 'chain_risk' satisfies EmbeddingKind,
    poolId: profile.slug,
    tsStart: observedAt,
    tsEnd: observedAt,
    sourceIds: [id],
    content: lines.join('\n'),
  };
}

/**
 * Render a market maker's profile as one chunk.
 *
 * The `integrationLevel` and hero metrics are rendered as `null` when the
 * leaderboard did not publish them, so a retrieval hit cannot be read as
 * claiming a measurement that was never made.
 *
 * @param profile - The validated market-maker profile.
 * @param observedAt - The instant the profile was observed.
 * @returns The serialized chunk.
 */
export function serializeMarketMaker(
  profile: MarketMakerProfile,
  observedAt: Date,
): SerializedChunk {
  const id = marketMakerId(profile.slug, observedAt);
  const lines = [
    `market_maker maker=${profile.slug} name=${profile.name} grade=${profile.grade} ` +
      `composite=${num(profile.compositeScore)} rank=${profile.rank} window=${profile.window}`,
    `[${id}] sub_scores trading_kpis=${num(profile.subScores.tradingKpis)} ` +
      `trust=${num(profile.subScores.trust)} ` +
      `coverage=${num(profile.subScores.coverageCapabilities)} ` +
      `uptime=${num(profile.subScores.uptime)} ` +
      `integration_level=${num(profile.subScores.integrationLevel)}`,
  ];

  if (profile.metrics !== null) {
    lines.push(
      `[${id}] depth_usd=${num(profile.metrics.depthUsd, 2)} ` +
        `spread_pct=${num(profile.metrics.spreadPct)} ` +
        `volume_usd=${num(profile.metrics.volumeUsd, 2)}`,
    );
  } else {
    lines.push(`[${id}] depth_usd=null spread_pct=null volume_usd=null (not published)`);
  }

  return {
    kind: 'market_maker' satisfies EmbeddingKind,
    poolId: profile.slug,
    tsStart: observedAt,
    tsEnd: observedAt,
    sourceIds: [id],
    content: lines.join('\n'),
  };
}

/**
 * A security incident to serialize.
 *
 * Declared as a named interface rather than inline so each property carries its
 * own documentation once, instead of being restated in every caller's `@param`.
 */
export interface IncidentInput {
  /** Stable incident identifier from the source. */
  readonly incidentId: string;
  /** The entity the incident affected, e.g. a chain or protocol slug. */
  readonly subject: string;
  /** What kind of entity `subject` is. */
  readonly subjectKind: string;
  /** The class of incident, e.g. `exploit`, `depeg`, `pause`. */
  readonly incidentKind: string;
  /** Published severity. */
  readonly severity: string;
  /** When the incident occurred. */
  readonly occurredAt: Date;
  /** Human-readable description, kept verbatim for audit. */
  readonly summary: string;
  /** Amount lost, when published. `null` records "not published". */
  readonly amountUsd: number | null;
  /** Where the incident was reported. */
  readonly sourceUrl: string | null;
}

/**
 * Render a security incident as one chunk.
 *
 * No collector feeds this kind yet — the incident source is an open question in
 * the plan — but the serializer exists so adding one requires no change here.
 *
 * @param incident - The incident to render.
 * @returns The serialized chunk.
 * @example
 * ```ts
 * const chunk = serializeIncident({
 *   incidentId: 'inc-1', subject: 'aave', subjectKind: 'protocol',
 *   incidentKind: 'exploit', severity: 'high', occurredAt: new Date(),
 *   summary: 'Oracle manipulation drained a market', amountUsd: 1_200_000,
 *   sourceUrl: null,
 * });
 * ```
 */
export function serializeIncident(incident: IncidentInput): SerializedChunk {
  const id = `incident:${incident.subject}:${incident.incidentId}`;
  const lines = [
    `security_incident incident=${incident.incidentId} subject=${incident.subject} ` +
      `subject_kind=${incident.subjectKind} kind=${incident.incidentKind} ` +
      `severity=${incident.severity} amount_usd=${num(incident.amountUsd, 2)}`,
    `[${id}] occurred_at=${iso(incident.occurredAt)} summary=${incident.summary}`,
  ];
  if (incident.sourceUrl !== null) {
    lines.push(`[${id}] source=${incident.sourceUrl}`);
  }

  return {
    kind: 'security_incident' satisfies EmbeddingKind,
    poolId: incident.subject,
    tsStart: incident.occurredAt,
    tsEnd: incident.occurredAt,
    sourceIds: [id],
    content: lines.join('\n'),
  };
}

/**
 * Render a protocol's governance profile as one aggregate chunk.
 *
 * Complements {@link serializeProposal}: individual proposals answer "what is
 * being debated", while this summary answers "how active and risk-focused is this
 * protocol's governance", which is the shape a covariate or a risk narrative
 * needs.
 *
 * @param profile - The validated governance profile.
 * @param observedAt - The instant the profile was observed.
 * @returns The serialized chunk.
 */
export function serializeGovernanceSummary(
  profile: ProtocolGovernanceProfile,
  observedAt: Date,
): SerializedChunk {
  const id = `governance:${profile.slug}:${iso(observedAt)}`;
  const stages = profile.proposals.reduce<Record<string, number>>((acc, p) => {
    acc[p.stage] = (acc[p.stage] ?? 0) + 1;
    return acc;
  }, {});
  const stageSummary = Object.entries(stages)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([stage, count]) => `${stage}=${count}`)
    .join(' ');

  const lines = [
    `governance_summary protocol=${profile.slug} name=${profile.name} ` +
      `category=${profile.category} proposals=${profile.proposals.length} ` +
      `activity=${num(profile.governanceScores.activity)} ` +
      `participation=${num(profile.governanceScores.participation)} ` +
      `risk_activity=${num(profile.governanceScores.riskActivity)} ` +
      `composite=${num(profile.governanceScores.composite)}`,
    `[${id}] stages ${stageSummary}`,
    `[${id}] forum=${profile.governance.forumUrl} platform=${profile.governance.platform}`,
  ];

  return {
    kind: 'governance_proposal' satisfies EmbeddingKind,
    poolId: profile.slug,
    tsStart: observedAt,
    tsEnd: observedAt,
    sourceIds: [id],
    content: lines.join('\n'),
  };
}
