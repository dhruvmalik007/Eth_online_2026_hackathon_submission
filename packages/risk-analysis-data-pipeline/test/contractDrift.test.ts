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
});
