/**
 * Fixtures for the risk-context tests.
 *
 * Built through the risk package's real schemas rather than cast into shape, so a
 * fixture that drifts from the published contract fails here rather than letting
 * the tests pass against a shape nothing produces.
 */

import {
  ChainRiskProfileSchema,
  MarketMakerProfileSchema,
  ProtocolGovernanceProfileSchema,
  type ChainRiskProfile,
  type MarketMakerProfile,
  type ProtocolGovernanceProfile,
  type RiskProfileReader,
} from '@ethonline2026/risk-analysis-data-pipeline';

/** A chain risk profile with a controllable composite score. */
export function chainFixture(slug = 'base', composite = 0.7): ChainRiskProfile {
  return ChainRiskProfileSchema.parse({
    schemaVersion: '0.1.0',
    slug,
    name: `${slug} Chain`,
    l2beatUrl: `https://l2beat.com/layer2s/projects/${slug}`,
    stage: 'stage-1',
    dimensions: {
      stateValidation: {
        raw: 'Fraud proofs (1R, ZK)',
        category: 'fraud-proofs',
        challengePeriodDays: null,
      },
      dataAvailability: { raw: 'Onchain', category: 'onchain' },
      exitWindow: { raw: 'None', category: 'none', days: null },
      sequencerFailure: { raw: 'Self sequence', category: 'self-sequence', delayHours: null },
      proposerFailure: { raw: 'Self propose', category: 'self-propose' },
    },
    valueSecuredUsd: 14_570_000_000,
    riskScores: {
      stateValidation: composite,
      dataAvailability: composite,
      exit: composite,
      sequencer: composite,
      proposer: composite,
      composite,
    },
    provenance: {
      source: 'l2beat.com',
      sourceUrl: `https://l2beat.com/layer2s/projects/${slug}`,
      fetchedAt: '2026-09-11T00:00:00Z',
      state: 'fresh',
    },
  });
}

/** A governance profile with one risk-relevant, open proposal. */
export function protocolFixture(slug = 'aave'): ProtocolGovernanceProfile {
  return ProtocolGovernanceProfileSchema.parse({
    schemaVersion: '0.1.0',
    slug,
    name: slug,
    category: 'lending',
    governance: {
      forumUrl: `https://governance.${slug}.com`,
      platform: 'discourse',
      jsonApi: `https://governance.${slug}.com/latest.json`,
      reachable: true,
    },
    proposals: [
      {
        id: 1,
        title: '[ARFC] Raise the liquidation threshold',
        slug: 'raise-the-liquidation-threshold',
        stage: 'arfc',
        status: 'open',
        createdAt: '2026-09-01T00:00:00Z',
        lastPostedAt: '2026-09-09T00:00:00Z',
        postsCount: 13,
        replyCount: 12,
        views: 900,
        likeCount: 40,
        url: `https://governance.${slug}.com/t/1`,
        excerpt: null,
      },
    ],
    governanceScores: { activity: 0.8, participation: 0.6, riskActivity: 0.9, composite: 0.75 },
    provenance: {
      source: 'discourse',
      sourceUrl: `https://governance.${slug}.com`,
      fetchedAt: '2026-09-11T00:00:00Z',
      state: 'fresh',
    },
  });
}

/** A market-maker profile carrying the hero-card depth metrics. */
export function marketMakerFixture(slug = 'flowdesk'): MarketMakerProfile {
  return MarketMakerProfileSchema.parse({
    schemaVersion: '0.1.0',
    slug,
    name: slug,
    rank: 1,
    grade: 'AA',
    compositeScore: 9.4,
    subScores: {
      tradingKpis: 9.1,
      trust: 8.9,
      coverageCapabilities: 9.0,
      uptime: 9.5,
      integrationLevel: 8.1,
    },
    metrics: {
      depthUsd: 10_000_000,
      depthRank: 1,
      spreadPct: 8.5,
      spreadRank: 3,
      volumeUsd: 8_750_000,
      volumeRank: 2,
    },
    activeEngagements: 12,
    fdvUsd: null,
    window: '30d',
    provider: 'defillama',
    provenance: {
      source: 'defillama.com',
      sourceUrl: 'https://defillama.com/market-makers',
      fetchedAt: '2026-09-11T00:00:00Z',
      state: 'fresh',
    },
  });
}

/**
 * A reader over in-memory fixtures.
 *
 * A slug the fixture set does not contain resolves to `null`, which is how a real
 * store reports a missing snapshot — so the caller's unresolved-subject handling
 * is exercised rather than assumed.
 */
export function fakeRiskReader(options: {
  readonly chains?: readonly ChainRiskProfile[];
  readonly protocols?: readonly ProtocolGovernanceProfile[];
  readonly marketMakers?: readonly MarketMakerProfile[];
} = {}): RiskProfileReader {
  const chains = options.chains ?? [chainFixture()];
  const protocols = options.protocols ?? [protocolFixture()];
  const marketMakers = options.marketMakers ?? [marketMakerFixture()];

  const find = <T extends { slug: string }>(items: readonly T[], slug: string): T | null =>
    items.find((item) => item.slug === slug) ?? null;

  return {
    async chain(slug) {
      const value = find(chains, slug);
      return value === null ? null : { key: `chains/${slug}.json`, value };
    },
    async chainSlugs() {
      return chains.map((c) => c.slug);
    },
    async protocol(slug) {
      const value = find(protocols, slug);
      return value === null ? null : { key: `protocols/${slug}.json`, value };
    },
    async protocolSlugs() {
      return protocols.map((p) => p.slug);
    },
    async marketMaker(slug) {
      const value = find(marketMakers, slug);
      return value === null ? null : { key: `market-makers/${slug}.json`, value };
    },
    async marketMakerDetail() {
      return null;
    },
    async marketMakerSummary() {
      return null;
    },
    async marketMakerSlugs() {
      return marketMakers.map((m) => m.slug);
    },
    async manifest() {
      return null;
    },
  };
}
