/**
 * Local end-to-end verification: collect, derive, and read back.
 *
 * This is the primary verification path for the package, and it deliberately
 * needs **no cloud**: the Python worker writes snapshots to a local directory, and
 * this script reads them back through the real repository and derives model
 * parameters from them. Everything that runs in production runs here — only the
 * storage adapter differs.
 *
 * Every stage logs what it did, so a run can be audited afterwards without
 * re-running it. Set `RISK_LOG_FORMAT=json` to emit machine-readable records
 * instead of the human-readable form.
 *
 *     pnpm verify:local
 *     pnpm verify:local --source l2beat --days 1
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveRiskAdjustment, RiskProfileRepository, LocalDirStore, rate } from '../src/index.js';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRAPER_ROOT = join(PACKAGE_ROOT, 'scraper');

/** Directory the worker writes to and the repository reads from. */
const SNAPSHOT_DIR = join(PACKAGE_ROOT, 'logs', 'verify-local', 'snapshots');

/** Where the run log is written for later inspection. */
const LOG_DIR = join(PACKAGE_ROOT, 'logs');

const LOG_FORMAT = process.env['RISK_LOG_FORMAT'] === 'json' ? 'json' : 'pretty';

const LEVEL_MARK = { stage: '--', ok: 'OK', warn: '!!', fail: 'XX' } as const;
type LogLevel = keyof typeof LEVEL_MARK;

/** An accumulating record of the run, written to disk at the end. */
const transcript: string[] = [];

/**
 * Emit one structured log line.
 *
 * The same record is written in both formats so a run's shape does not change
 * with the sink — only its presentation.
 *
 * @param level - Severity marker.
 * @param stage - The pipeline stage the record belongs to.
 * @param message - What happened.
 * @param detail - Optional structured detail.
 */
function log(level: LogLevel, stage: string, message: string, detail?: unknown): void {
  const record = { at: new Date().toISOString(), level, stage, message, detail };
  transcript.push(JSON.stringify(record));
  if (LOG_FORMAT === 'json') {
    process.stdout.write(`${JSON.stringify(record)}\n`);
    return;
  }
  const suffix = detail === undefined ? '' : ` ${JSON.stringify(detail)}`;
  process.stdout.write(`[${LEVEL_MARK[level]}] ${stage.padEnd(12)} ${message}${suffix}\n`);
}

/**
 * Parse the script's flags.
 *
 * @param argv - The process arguments after the script name.
 * @returns The parsed options.
 */
function parseArgs(argv: readonly string[]): { source?: string } {
  const options: { source?: string } = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--source') {
      const value = argv[i + 1];
      if (value !== undefined) options.source = value;
      i += 1;
    }
  }
  return options;
}

/**
 * Run the Python worker to collect snapshots locally.
 *
 * @param source - Optional source subset to collect.
 * @returns Whether the worker exited successfully.
 */
function collect(source?: string): boolean {
  const args = [
    'run',
    '--no-sync',
    'python',
    '-m',
    'risk_pipeline',
    '--no-cloud',
    '--out',
    SNAPSHOT_DIR,
    ...(source === undefined ? [] : ['--sources', source]),
  ];
  log('stage', 'collect', 'running the Python worker', { args: args.join(' ') });

  const result = spawnSync('uv', args, { cwd: SCRAPER_ROOT, encoding: 'utf8' });
  if (result.error !== undefined) {
    log('fail', 'collect', `could not launch uv: ${result.error.message}`);
    return false;
  }
  const stdout = (result.stdout ?? '').trim();
  if (stdout.length > 0) {
    for (const line of stdout.split('\n')) log('ok', 'collect', line);
  }
  if (result.status !== 0) {
    log('fail', 'collect', 'worker exited non-zero', { stderr: (result.stderr ?? '').slice(-600) });
    return false;
  }
  return true;
}

/**
 * The script's entry point.
 *
 * @returns The process exit code — 0 when every assertion passed.
 */
async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  let failures = 0;

  /**
   * Assert one expectation, recording the outcome either way.
   *
   * @param label - What was checked.
   * @param condition - Whether it held.
   * @param detail - Optional detail to record.
   */
  const check = (label: string, condition: boolean, detail?: unknown): void => {
    if (condition) {
      log('ok', 'verify', label, detail);
    } else {
      failures += 1;
      log('fail', 'verify', label, detail);
    }
  };

  log('stage', 'setup', 'preparing a scratch snapshot directory', { dir: SNAPSHOT_DIR });
  if (existsSync(SNAPSHOT_DIR)) rmSync(SNAPSHOT_DIR, { recursive: true, force: true });
  mkdirSync(SNAPSHOT_DIR, { recursive: true });

  if (!collect(options.source)) {
    log('fail', 'collect', 'aborting: collection failed');
    return 1;
  }

  // ── Read path ──────────────────────────────────────────────────────────────
  const repository = new RiskProfileRepository(new LocalDirStore(SNAPSHOT_DIR));

  const manifest = await repository.manifest();
  check('manifest is readable', manifest !== null);
  if (manifest !== null) {
    const sources = manifest.value.sources;
    const names = Object.keys(sources);
    check('manifest records at least one source', names.length > 0, { sources: names });
    for (const name of names) {
      const entry = sources[name];
      // Every source must carry an explicit state. A source with neither a fresh
      // state nor an error is the failure this assertion exists to catch.
      const explicit = entry !== undefined && (entry.state === 'fresh' || entry.error !== null);
      check(`source "${name}" has an explicit state`, explicit, {
        state: entry?.state,
        records: entry?.records,
      });
    }
  }

  const slugs = await repository.chainSlugs();
  check('chain snapshots were written', slugs.length > 0, { count: slugs.length });

  // ── Derivation over real records ───────────────────────────────────────────
  for (const slug of slugs.slice(0, 3)) {
    const chain = await repository.chain(slug);
    if (chain === null) {
      check(`chain "${slug}" is readable`, false);
      continue;
    }
    const scores = chain.value.riskScores;
    check(`chain "${slug}" scored`, scores.composite > 0, {
      composite: Number(scores.composite.toFixed(4)),
      stateValidation: scores.stateValidation,
    });

    const adjustment = deriveRiskAdjustment({
      chainScores: scores,
      // No measured volatility is available in this offline run, so the
      // derivation must report the fallback rather than inventing a measurement.
      realizedVolatility: null,
      baseRiskFreeRate: rate(0.05),
    });
    check(`chain "${slug}" derives an adjustment`, adjustment.volatility > 0, {
      volatility: Number(adjustment.volatility.toFixed(4)),
      riskFreeRate: Number(adjustment.riskFreeRate.toFixed(4)),
      volatilitySource: adjustment.volatilitySource,
    });
    check(`chain "${slug}" explains its factors`, adjustment.factors.length >= 5, {
      factors: adjustment.factors.map((f) => f.name),
    });
  }

  // ── Governance ─────────────────────────────────────────────────────────────
  const protocols = ['aave', 'uniswap', 'morpho'];
  for (const slug of protocols) {
    const profile = await repository.protocol(slug);
    if (profile === null) {
      log('warn', 'verify', `no governance snapshot for "${slug}" (source may have failed)`);
      continue;
    }
    check(`governance "${slug}" has proposals`, profile.value.proposals.length > 0, {
      count: profile.value.proposals.length,
      composite: Number(profile.value.governanceScores.composite.toFixed(4)),
    });
  }

  // ── Market makers ──────────────────────────────────────────────────────────
  const summary = await repository.marketMakerSummary();
  if (summary !== null) {
    check('market-maker summary is readable', summary.value.makerCount > 0, {
      makers: summary.value.makerCount,
    });
  }

  const detail = await repository.marketMakerDetail('flowdesk');
  if (detail !== null) {
    check('market-maker detail carries venue coverage', detail.value.cexSupported.length > 0, {
      cex: detail.value.cexSupported.length,
      dex: detail.value.dexSupported.length,
      depthRows: detail.value.breakdowns.depth.length,
    });
  }

  // ── Persist the transcript ─────────────────────────────────────────────────
  mkdirSync(LOG_DIR, { recursive: true });
  const logPath = join(LOG_DIR, `verify-local-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
  writeFileSync(logPath, `${transcript.join('\n')}\n`, 'utf8');
  log('stage', 'report', `run log written to ${logPath}`);

  if (failures === 0) {
    log('ok', 'report', 'LOCAL VERIFICATION PASSED');
  } else {
    log('fail', 'report', `LOCAL VERIFICATION FAILED (${failures} check(s))`);
  }
  return failures === 0 ? 0 : 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    log('fail', 'report', `unhandled failure: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
