/**
 * Cross-language contract drift test.
 *
 * The Python worker and this package each define the snapshot contract. Nothing
 * structural stops them diverging — a field renamed on one side would only
 * surface when a consumer looked for a number that never arrived.
 *
 * These fixtures are **real Python output**, emitted by
 * `scraper/scripts/emit_contract_fixtures.py` from the captured upstream
 * payloads. Validating them against the zod schemas here means a rename on
 * either side fails the build instead of silently dropping data at the boundary.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SecurityIncidentRowSchema } from '@ethonline2026/timeseries';
import { describe, expect, it } from 'vitest';
import {
  ChainRiskProfileSchema,
  ManifestSchema,
  MarketMakerDetailSchema,
  MarketMakerProfileSchema,
  MarketMakerSummarySchema,
  ProtocolGovernanceProfileSchema,
} from '../src/types.js';

const CONTRACT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'contract');

/**
 * Read a contract fixture emitted by the Python worker.
 *
 * @param name - The fixture file name.
 * @returns The parsed document.
 */
function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(CONTRACT_DIR, name), 'utf8'));
}

describe('contract drift: Python output validates against the TypeScript schemas', () => {
  it('validates a chain risk profile', () => {
    const parsed = ChainRiskProfileSchema.safeParse(fixture('chain-risk-profile.json'));
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      // Field names matter as much as presence: `l2BeatUrl` would validate here
      // but break a consumer, so the exact key is asserted.
      expect(parsed.data).toHaveProperty('l2beatUrl');
      expect(parsed.data.slug).toBe('base');
      expect(parsed.data.stage).toBe('stage-1');
    }
  });

  it('validates a protocol governance profile', () => {
    const parsed = ProtocolGovernanceProfileSchema.safeParse(
      fixture('protocol-governance-profile.json'),
    );
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.proposals.length).toBeGreaterThan(0);
      expect(parsed.data.governance.platform).toBe('discourse');
    }
  });

  it('validates a market maker profile', () => {
    const parsed = MarketMakerProfileSchema.safeParse(fixture('market-maker-profile.json'));
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      // `integrationLevel` is nullable because the leaderboard renders that
      // column empty; the drift test confirms Python emits null rather than 0.
      expect(parsed.data.subScores.integrationLevel).toBeNull();
    }
  });

  it('validates a market maker summary', () => {
    const parsed = MarketMakerSummarySchema.safeParse(fixture('market-maker-summary.json'));
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
  });

  it('validates a market maker detail card', () => {
    const parsed = MarketMakerDetailSchema.safeParse(fixture('market-maker-detail.json'));
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.breakdowns.depth.length).toBeGreaterThan(0);
      expect(parsed.data.cexSupported.length).toBeGreaterThan(0);
      expect(parsed.data.dexSupported.length).toBeGreaterThan(0);
    }
  });

  it('validates a manifest, including a failed source', () => {
    const parsed = ManifestSchema.safeParse(fixture('manifest.json'));
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      // A failed source must round-trip with its reason, since the manifest is
      // how an operator learns what broke without reading individual snapshots.
      expect(parsed.data.sources['discourse']?.state).toBe('failed');
      expect(parsed.data.sources['discourse']?.error).toContain('403');
    }
  });

  /**
   * The cyber family's boundary test.
   *
   * `security_incidents` existed from v0.1.0 with a zod row schema, an embedding
   * kind and a covariate builder, but nothing ever produced a row. The incident
   * collector is the producer, so this is the assertion that it actually feeds the
   * table rather than merely emitting a look-alike shape.
   */
  it('validates security incident rows, across the date boundary', () => {
    const rows = fixture('security-incidents.json') as Record<string, unknown>[];

    // 18 incidents attributed to 9 roster protocols. Both numbers are asserted
    // because they are what the curated alias table buys: if attribution
    // regresses, the count collapses and this fails rather than passing quietly
    // on a smaller set.
    expect(rows.length).toBe(18);
    expect(new Set(rows.map((row) => row['subject'])).size).toBe(9);

    for (const row of rows) {
      // The wire contract carries the timestamp as an ISO-8601 string, because
      // JSON has no date type. `SecurityIncidentRowSchema` types it `z.date()` --
      // that is a *DB-row* contract, not a wire one. The conversion below is the
      // boundary, asserted rather than assumed: it is precisely what a reader
      // must perform before inserting into `security_incidents`.
      expect(typeof row['occurredAt']).toBe('string');
      expect(row['occurredAt']).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);

      const parsed = SecurityIncidentRowSchema.safeParse({
        ...row,
        occurredAt: new Date(row['occurredAt'] as string),
      });
      expect(parsed.error?.issues ?? []).toEqual([]);
      expect(parsed.success).toBe(true);
    }
  });
});
