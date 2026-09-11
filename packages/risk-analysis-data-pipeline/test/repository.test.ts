/**
 * Read-path tests: the validation frontier.
 *
 * The contract these pin is that nothing unvalidated escapes the repository. A
 * missing snapshot is `null` (a normal first-run state), but a *malformed* one
 * throws — because silently returning a partial shape into the agent is exactly
 * the failure this layer exists to prevent.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RiskProfileRepository } from '../src/repository.js';
import { SnapshotContractError, StoreError } from '../src/errors.js';
import { FakeStore } from './helpers.js';

const CONTRACT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'contract');

/**
 * Read a real Python-emitted fixture.
 *
 * @param name - The fixture file name.
 * @returns The raw JSON body.
 */
function body(name: string): string {
  return readFileSync(join(CONTRACT_DIR, name), 'utf8');
}

describe('RiskProfileRepository', () => {
  it('returns null for a snapshot that does not exist', async () => {
    // Absence is a normal state on a first run, not an error.
    const repo = new RiskProfileRepository(new FakeStore());
    expect(await repo.chain('base')).toBeNull();
  });

  it('reads and validates a real chain profile', async () => {
    const store = new FakeStore({ 'chains/base.json': body('chain-risk-profile.json') });
    const loaded = await new RiskProfileRepository(store).chain('base');

    expect(loaded).not.toBeNull();
    expect(loaded?.key).toBe('chains/base.json');
    expect(loaded?.value.slug).toBe('base');
    expect(loaded?.value.riskScores.composite).toBeCloseTo(0.7, 10);
  });

  it('reads a market maker detail card including its venue lists', async () => {
    const store = new FakeStore({
      'market-makers/auros-global.detail.json': body('market-maker-detail.json'),
    });
    const loaded = await new RiskProfileRepository(store).marketMakerDetail('auros-global');

    expect(loaded?.value.cexSupported.length).toBeGreaterThan(5);
    expect(loaded?.value.dexSupported.length).toBeGreaterThan(2);
    expect(loaded?.value.breakdowns.depth.length).toBeGreaterThan(10);
  });

  it('throws on a malformed snapshot instead of returning a partial record', async () => {
    // A required field removed: the classic drift case.
    const broken = JSON.parse(body('chain-risk-profile.json')) as Record<string, unknown>;
    delete broken['riskScores'];
    const store = new FakeStore({ 'chains/base.json': JSON.stringify(broken) });

    await expect(new RiskProfileRepository(store).chain('base')).rejects.toThrow(
      SnapshotContractError,
    );
  });

  it('names the offending field in the contract error', async () => {
    const broken = JSON.parse(body('chain-risk-profile.json')) as Record<string, unknown>;
    broken['riskScores'] = { composite: 5 }; // out of the 0-1 range
    const store = new FakeStore({ 'chains/base.json': JSON.stringify(broken) });

    await expect(new RiskProfileRepository(store).chain('base')).rejects.toThrow(
      /riskScores|composite|dataAvailability/,
    );
  });

  it('throws on a body that is not JSON at all', async () => {
    const store = new FakeStore({ 'chains/base.json': '<html>not json</html>' });
    await expect(new RiskProfileRepository(store).chain('base')).rejects.toThrow(
      SnapshotContractError,
    );
  });

  it('wraps a store failure as a StoreError rather than a contract error', async () => {
    // The distinction matters: a transport failure is retryable, a contract
    // violation is not.
    const store = new FakeStore();
    store.failures.add('get');
    await expect(new RiskProfileRepository(store).chain('base')).rejects.toThrow(StoreError);
  });

  it('lists chain slugs from the store keys', async () => {
    const store = new FakeStore({
      'chains/base.json': body('chain-risk-profile.json'),
      'chains/arbitrum.json': body('chain-risk-profile.json'),
      'protocols/aave.json': body('protocol-governance-profile.json'),
    });
    expect(await new RiskProfileRepository(store).chainSlugs()).toEqual(['arbitrum', 'base']);
  });

  it('reads the manifest and preserves a failed source', async () => {
    const store = new FakeStore({ 'manifest.json': body('manifest.json') });
    const loaded = await new RiskProfileRepository(store).manifest();
    expect(loaded?.value.sources['discourse']?.state).toBe('failed');
  });

  it('reads a protocol governance profile', async () => {
    const store = new FakeStore({
      'protocols/aave.json': body('protocol-governance-profile.json'),
    });
    const loaded = await new RiskProfileRepository(store).protocol('aave');
    expect(loaded?.value.proposals.length).toBeGreaterThan(0);
    expect(loaded?.value.governanceScores.composite).toBeGreaterThan(0);
  });

  it('reads the market maker summary', async () => {
    const store = new FakeStore({ 'market-makers/summary.json': body('market-maker-summary.json') });
    const loaded = await new RiskProfileRepository(store).marketMakerSummary();
    expect(loaded?.value.makerCount).toBeGreaterThan(0);
  });
});
