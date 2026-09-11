/**
 * Serializer tests: the vector-store trust boundary.
 *
 * Two properties are asserted throughout, because they are what make the store
 * usable rather than dangerous:
 *
 *  1. **Text is rendered only from records.** Nothing here reads model output.
 *  2. **Every line carries a source id**, so a retrieval hit can be traced back
 *    to a real row by the agent's citation guard.
 *
 * Byte-stability is asserted too: the content hash is the idempotency key, so if
 * the same record rendered differently on two runs, a backfill would duplicate
 * rows instead of skipping them.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hashChunk } from '@ethonline2026/timeseries';
import {
  ChainRiskProfileSchema,
  MarketMakerProfileSchema,
  ProtocolGovernanceProfileSchema,
} from '../src/types.js';
import {
  chainRiskId,
  hashRiskChunk,
  marketMakerId,
  proposalId,
  serializeChainRisk,
  serializeGovernanceSummary,
  serializeIncident,
  serializeMarketMaker,
  serializeProposal,
} from '../src/serializer.js';
import { buildChunks } from '../src/embeddings.js';

const CONTRACT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'contract');
const OBSERVED_AT = new Date('2026-09-11T00:00:00Z');

/**
 * Read and validate a contract fixture.
 *
 * @param name - The fixture file name.
 * @returns The parsed document.
 */
function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(CONTRACT_DIR, name), 'utf8'));
}

describe('chain risk serialization', () => {
  it('renders the profile with every dimension and its raw text', () => {
    const profile = ChainRiskProfileSchema.parse(fixture('chain-risk-profile.json'));
    const chunk = serializeChainRisk(profile, OBSERVED_AT);

    expect(chunk.kind).toBe('chain_risk');
    expect(chunk.poolId).toBe('base');
    expect(chunk.sourceIds).toEqual([chainRiskId('base', OBSERVED_AT)]);
    // The raw upstream text must survive into the embedded content, so a
    // retrieval hit can show what the site actually said.
    expect(chunk.content).toContain('Fraud proofs (1R, ZK)');
    expect(chunk.content).toContain('state_validation=fraud-proofs');
    expect(chunk.content).toContain('composite=0.700000');
  });

  it('tags every content line with its source id', () => {
    const profile = ChainRiskProfileSchema.parse(fixture('chain-risk-profile.json'));
    const chunk = serializeChainRisk(profile, OBSERVED_AT);
    const id = chunk.sourceIds[0] ?? '';

    // The first line is the header; every subsequent line is a cited fact.
    for (const line of chunk.content.split('\n').slice(1)) {
      expect(line).toContain(`[${id}]`);
    }
  });

  it('is byte-stable for identical input', () => {
    const profile = ChainRiskProfileSchema.parse(fixture('chain-risk-profile.json'));
    const a = serializeChainRisk(profile, OBSERVED_AT);
    const b = serializeChainRisk(profile, OBSERVED_AT);
    expect(a.content).toBe(b.content);
    expect(hashRiskChunk(a)).toBe(hashRiskChunk(b));
  });

  it('hashes identically to the timeseries package, so the key is comparable', () => {
    const profile = ChainRiskProfileSchema.parse(fixture('chain-risk-profile.json'));
    const chunk = serializeChainRisk(profile, OBSERVED_AT);
    // Both producers must agree on the canonical form, or a backfill would not
    // recognise a chunk it had already stored.
    expect(hashRiskChunk(chunk)).toBe(hashChunk({ ...chunk }));
  });
});

describe('governance serialization', () => {
  it('renders a proposal with its citation id', () => {
    const profile = ProtocolGovernanceProfileSchema.parse(
      fixture('protocol-governance-profile.json'),
    );
    const proposal = profile.proposals[0];
    expect(proposal).toBeDefined();
    const chunk = serializeProposal('aave', proposal!);

    expect(chunk).not.toBeNull();
    expect(chunk?.kind).toBe('governance_proposal');
    expect(chunk?.sourceIds).toEqual([proposalId('aave', proposal!.id)]);
    expect(chunk?.content).toContain(proposal!.title);
  });

  it('carries an excerpt verbatim when the forum publishes one', () => {
    const profile = ProtocolGovernanceProfileSchema.parse(
      fixture('protocol-governance-profile.json'),
    );
    // Whether `/latest.json` populates `excerpt` is forum-dependent: Uniswap's
    // does, Aave's does not (verified — 0 of 30 Aave topics carry one, and the
    // `include_excerpt=true` parameter is ignored). The serializer's job is to
    // render it when present and not invent it when absent, so the behaviour is
    // asserted with a constructed value rather than depending on one forum's
    // configuration.
    const withExcerpt = {
      ...profile.proposals[0]!,
      excerpt: 'Aave Labs proposes activating risk stewards with a cap mandate.',
    };
    const chunk = serializeProposal('aave', withExcerpt);

    expect(chunk?.content).toContain('excerpt=Aave Labs proposes activating risk stewards');
  });

  it('omits the excerpt line entirely when the forum publishes none', () => {
    const profile = ProtocolGovernanceProfileSchema.parse(
      fixture('protocol-governance-profile.json'),
    );
    const without = { ...profile.proposals[0]!, excerpt: null };
    const chunk = serializeProposal('aave', without);

    // No empty `excerpt=` line: an empty field in the embedded text would add
    // noise to the vector without carrying information.
    expect(chunk?.content).not.toContain('excerpt=');
    // The title still carries the stage and subject, which is the primary
    // semantic content either way.
    expect(chunk?.content).toContain(without.title);
  });

  it('returns null for a proposal with an unparseable timestamp', () => {
    const profile = ProtocolGovernanceProfileSchema.parse(
      fixture('protocol-governance-profile.json'),
    );
    const broken = { ...profile.proposals[0]!, createdAt: 'not-a-date' };
    expect(serializeProposal('aave', broken)).toBeNull();
  });

  it('renders a governance summary naming each stage', () => {
    const profile = ProtocolGovernanceProfileSchema.parse(
      fixture('protocol-governance-profile.json'),
    );
    const chunk = serializeGovernanceSummary(profile, OBSERVED_AT);

    expect(chunk.kind).toBe('governance_proposal');
    expect(chunk.content).toContain(`protocol=${profile.slug}`);
    // The stage breakdown is what makes the summary readable as "state of play".
    expect(chunk.content).toContain('stages');
  });
});

describe('market maker serialization', () => {
  it('renders sub-scores and hero metrics', () => {
    const profile = MarketMakerProfileSchema.parse(fixture('market-maker-profile.json'));
    const chunk = serializeMarketMaker(profile, OBSERVED_AT);

    expect(chunk.kind).toBe('market_maker');
    expect(chunk.sourceIds).toEqual([marketMakerId(profile.slug, OBSERVED_AT)]);
    expect(chunk.content).toContain(`grade=${profile.grade}`);
    expect(chunk.content).toContain('depth_usd=');
  });

  it('renders unpublished metrics as null with a reason', () => {
    const profile = MarketMakerProfileSchema.parse(fixture('market-maker-profile.json'));
    const chunk = serializeMarketMaker({ ...profile, metrics: null }, OBSERVED_AT);

    // Rendering a zero here would read as "measured no depth", which the source
    // never said. The explicit "(not published)" keeps that distinction.
    expect(chunk.content).toContain('depth_usd=null');
    expect(chunk.content).toContain('not published');
  });

  it('renders a null integration level rather than zero', () => {
    const profile = MarketMakerProfileSchema.parse(fixture('market-maker-profile.json'));
    const chunk = serializeMarketMaker(profile, OBSERVED_AT);
    expect(chunk.content).toContain('integration_level=null');
  });
});

describe('incident serialization', () => {
  it('renders an incident with its citation id', () => {
    const chunk = serializeIncident({
      incidentId: 'inc-1',
      subject: 'aave',
      subjectKind: 'protocol',
      incidentKind: 'exploit',
      severity: 'high',
      occurredAt: OBSERVED_AT,
      summary: 'Oracle manipulation drained a market',
      amountUsd: 1_200_000,
      sourceUrl: 'https://example.test/inc-1',
    });

    expect(chunk.kind).toBe('security_incident');
    expect(chunk.sourceIds).toEqual(['incident:aave:inc-1']);
    expect(chunk.content).toContain('Oracle manipulation');
    expect(chunk.content).toContain('severity=high');
  });
});

describe('buildChunks', () => {
  it('assembles one chunk per proposal plus a summary per protocol', () => {
    const chain = ChainRiskProfileSchema.parse(fixture('chain-risk-profile.json'));
    const governance = ProtocolGovernanceProfileSchema.parse(
      fixture('protocol-governance-profile.json'),
    );
    const maker = MarketMakerProfileSchema.parse(fixture('market-maker-profile.json'));

    const { chunks, notes } = buildChunks({
      observedAt: OBSERVED_AT,
      chains: [chain],
      protocols: [governance],
      marketMakers: [maker],
    });

    expect(notes).toEqual([]);
    // 1 chain + 1 summary + N proposals + 1 maker
    expect(chunks).toHaveLength(1 + 1 + governance.proposals.length + 1);
    const kinds = new Set(chunks.map((c) => c.kind));
    expect(kinds).toEqual(new Set(['chain_risk', 'governance_proposal', 'market_maker']));
  });

  it('reports a proposal it could not place on the timeline', () => {
    const governance = ProtocolGovernanceProfileSchema.parse(
      fixture('protocol-governance-profile.json'),
    );
    const damaged = {
      ...governance,
      proposals: [{ ...governance.proposals[0]!, createdAt: 'not-a-date' }],
    };
    const { chunks, notes } = buildChunks({ observedAt: OBSERVED_AT, protocols: [damaged] });

    // The summary still renders; the unplaceable proposal is reported, not
    // silently dropped.
    expect(chunks).toHaveLength(1);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('no parseable timestamp');
  });

  it('produces no chunks for no records', () => {
    const { chunks, notes } = buildChunks({ observedAt: OBSERVED_AT });
    expect(chunks).toEqual([]);
    expect(notes).toEqual([]);
  });

  it('gives every chunk a non-empty source id list', () => {
    const chain = ChainRiskProfileSchema.parse(fixture('chain-risk-profile.json'));
    const governance = ProtocolGovernanceProfileSchema.parse(
      fixture('protocol-governance-profile.json'),
    );
    const { chunks } = buildChunks({ observedAt: OBSERVED_AT, chains: [chain], protocols: [governance] });

    // This is the invariant the citation guard depends on: a chunk with no
    // source ids could never be verified, so it must never be stored.
    for (const chunk of chunks) {
      expect(chunk.sourceIds.length).toBeGreaterThan(0);
      expect(chunk.content.length).toBeGreaterThan(0);
    }
  });
});
