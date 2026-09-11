/**
 * Live temporal-write verification against the hosted TimescaleDB.
 *
 * Proves the write path end to end against the real database rather than a fake:
 * map real snapshot records to history rows, write them through the repository,
 * read them back, and clean up. Everything is scoped to a disposable probe slug
 * and deleted at the end, so a run leaves the store as it found it.
 *
 *     pnpm verify:temporal
 *
 * Requires `TIMESERIES_DATABASE_URL`. Reads whatever snapshots exist locally, so
 * run `verify:local` first (or point `RISK_LOCAL_DIR` at an existing snapshot
 * directory).
 */

import { join } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LocalDirStore,
  RiskProfileRepository,
  chainRowFromProfile,
  governanceRowFromProfile,
  marketMakerRowFromProfile,
} from '../src/index.js';
import {
  closeAllPools,
  loadTimeseriesEnv,
  PgSqlRunner,
  RiskHistoryRepository,
  resolveConnectionSpec,
  type SqlRunner,
} from '@ethonline2026/timeseries';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT_DIR = process.env['RISK_LOCAL_DIR'] ?? join(PACKAGE_ROOT, 'logs', 'verify-local', 'snapshots');

/** The disposable slug prefix, so cleanup can target exactly this run. */
const PROBE_PREFIX = 'verify-tmp';

/**
 * Tally of failed assertions, incremented by {@link check}.
 *
 * A module-level counter rather than a returned boolean: `check(...) ? 0 : 1`
 * is a precedence trap (`+=` binds tighter than `?:`), and this shape has no
 * equivalent way to be written wrong.
 */
let failures = 0;

/**
 * Emit a labelled verification result and tally a failure.
 *
 * @param label - What was checked.
 * @param ok - Whether it held.
 * @param detail - Optional detail to print.
 */
function check(label: string, ok: boolean, detail?: unknown): void {
  const mark = ok ? 'OK' : 'XX';
  const suffix = detail === undefined ? '' : ` ${JSON.stringify(detail)}`;
  process.stdout.write(`[${mark}] ${label}${suffix}\n`);
  if (!ok) failures += 1;
}

/**
 * Run the verification.
 *
 * @returns The process exit code.
 */
async function main(): Promise<number> {
  // Fail fast and legibly. Without this, a missing DSN falls back to localhost and
  // the run dies on an opaque connection error that says nothing about the cause —
  // which is exactly how this script first failed.
  const env = loadTimeseriesEnv();
  if ((env.TIMESERIES_DATABASE_URL ?? '').trim().length === 0) {
    process.stderr.write(
      'error: TIMESERIES_DATABASE_URL is not set, so there is no hosted instance to verify against.\n' +
        '       Export it (see packages/timeseries/timescale-tigerdata-creds.md) or run with\n' +
        '       `TIMESERIES_DATABASE_URL=... pnpm verify:temporal`.\n',
    );
    return 2;
  }

  const runner: SqlRunner = new PgSqlRunner(resolveConnectionSpec(env));
  const history = new RiskHistoryRepository(runner);
  const profiles = new RiskProfileRepository(new LocalDirStore(SNAPSHOT_DIR));

  const observedAt = new Date();
  const cleanup = async (): Promise<void> => {
    await runner.query('DELETE FROM chain_risk_history WHERE chain_slug LIKE $1', [`${PROBE_PREFIX}%`]);
    await runner.query('DELETE FROM protocol_governance_history WHERE protocol_slug LIKE $1', [
      `${PROBE_PREFIX}%`,
    ]);
    await runner.query('DELETE FROM market_maker_metrics WHERE market_maker LIKE $1', [
      `${PROBE_PREFIX}%`,
    ]);
  };

  try {
    await cleanup();

    // ── Chain series ─────────────────────────────────────────────────────────
    const chain = await profiles.chain('base');
    if (chain === null) {
      check('a chain snapshot exists to write from', false, {
        hint: 'run pnpm verify:local first',
        dir: SNAPSHOT_DIR,
      });
    } else {
      const row = chainRowFromProfile(chain.value, observedAt);
      const probeRow = { ...row, chainSlug: `${PROBE_PREFIX}-base` };
      const write = await history.recordChainRisk([probeRow]);
      check('chain risk row inserted', write.inserted === 1);

      // Re-writing the same observation must be a no-op: that is what makes the
      // 6-hourly cadence safe to repeat.
      const again = await history.recordChainRisk([probeRow]);
      check('re-writing the same observation is a no-op', again.inserted === 0);

      const series = await history.chainCompositeSeries(probeRow.chainSlug, {
        from: new Date(observedAt.getTime() - 60_000),
        to: new Date(observedAt.getTime() + 60_000),
      });
      check('chain series reads back', series.length === 1, {
        points: series.length,
        value: series[0]?.value,
      });
      check(
        'persisted score matches the snapshot',
        Math.abs((series[0]?.value ?? -1) - chain.value.riskScores.composite) < 1e-9,
      );
    }

    // ── Governance series ────────────────────────────────────────────────────
    const governance = await profiles.protocol('aave');
    if (governance !== null) {
      const row = governanceRowFromProfile(governance.value, observedAt);
      const probeRow = { ...row, protocolSlug: `${PROBE_PREFIX}-aave` };
      const write = await history.recordGovernance([probeRow]);
      check('governance row inserted', write.inserted === 1);

      const series = await history.governanceCompositeSeries(probeRow.protocolSlug, {
        from: new Date(observedAt.getTime() - 60_000),
        to: new Date(observedAt.getTime() + 60_000),
      });
      check('governance series reads back', series.length === 1);
    } else {
      process.stdout.write('[--] no governance snapshot present; skipping\n');
    }

    // ── Market-maker series ──────────────────────────────────────────────────
    const maker = await profiles.marketMaker('flowdesk');
    if (maker !== null) {
      const row = marketMakerRowFromProfile(maker.value, observedAt);
      const probeRow = { ...row, marketMaker: `${PROBE_PREFIX}-flowdesk` };
      const write = await history.recordMarketMakers([probeRow]);
      check('market-maker row inserted', write.inserted === 1);

      if (probeRow.depthUsd !== null) {
        const series = await history.marketMakerDepthSeries(probeRow.marketMaker, {
          from: new Date(observedAt.getTime() - 60_000),
          to: new Date(observedAt.getTime() + 60_000),
        });
        check('market-maker depth series reads back', series.length === 1, {
          depthUsd: series[0]?.value,
        });
      }
    } else {
      process.stdout.write('[--] no market-maker snapshot present; skipping\n');
    }

    // ── Incident path (no collector yet, but the write must work) ────────────
    const incidentWrite = await history.recordIncidents([
      {
        occurredAt: observedAt,
        incidentId: `${PROBE_PREFIX}-inc-1`,
        subject: `${PROBE_PREFIX}-aave`,
        subjectKind: 'protocol',
        incidentKind: 'probe',
        severity: 'low',
        amountUsd: null,
        summary: 'Verification probe incident',
        sourceUrl: null,
        raw: { probe: true },
      },
    ]);
    check('incident row inserted (write path ready for a collector)', incidentWrite.inserted === 1);
    check(
      'incident count reads back',
      (await history.incidentCount(`${PROBE_PREFIX}-aave`, {
        from: new Date(observedAt.getTime() - 60_000),
        to: new Date(observedAt.getTime() + 60_000),
      })) === 1,
    );

    const counts = await history.counts();
    process.stdout.write(`[--] table counts ${JSON.stringify(counts)}\n`);
  } finally {
    await cleanup();
    await runner.query('DELETE FROM security_incidents WHERE incident_id LIKE $1', [`${PROBE_PREFIX}%`]);
    process.stdout.write('[--] probe rows removed\n');
    await closeAllPools();
  }

  if (failures === 0) {
    process.stdout.write('\nTEMPORAL VERIFICATION PASSED\n');
  } else {
    process.stdout.write(`\nTEMPORAL VERIFICATION FAILED (${failures})\n`);
  }
  return failures === 0 ? 0 : 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    process.stdout.write(`FAILED: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
