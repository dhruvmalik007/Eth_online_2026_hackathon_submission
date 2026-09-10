/**
 * Level-A probe — v0.1 agent tools in LLM-free isolation.
 *
 * Verifies, without any model in the loop:
 *  1. TimesFM-3 service contract: /predict returns a 9-quantile matrix whose
 *     median row matches point_forecast, monotonic, horizon-long.
 *  2. Guardrail module: non-monotonic / drifting wire shapes fail loudly.
 *  3. Execution authorization: scoped approvals carry capped notional and
 *     session expiry; gate rejections are typed.
 *
 * Exits non-zero with enumerated failure reasons (the script IS the test).
 * Uses fixture HTTP responses — no network, no LLM, no spend.
 */
import type { TimesFM3Http } from '../src/services/timesfm3/index.js';
import {
  TimesFM3Client,
  TimesFM3ValidationError,
  backtestForecast,
} from '../src/services/timesfm3/index.js';
import { authorizeExecution } from '../src/execution/authorization.js';

const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`  ✅ ${name}`);
  } else {
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
    failures.push(name);
  }
}

// Wire-shaped fixture from the live contract (docs/timesfm3-service.md).
const LIVE_SHAPE = {
  point_forecast: [0.042, 0.0425, 0.043],
  quantiles: [
    [0.04, 0.0408, 0.0412, 0.0416, 0.042, 0.0425, 0.043, 0.0436, 0.0444],
    [0.0404, 0.0412, 0.0417, 0.0421, 0.0425, 0.043, 0.0435, 0.0441, 0.045],
    [0.0409, 0.0417, 0.0422, 0.0426, 0.043, 0.0435, 0.044, 0.0446, 0.0456],
  ],
  quantile_levels: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9],
  horizon: 3,
  model: 'timesfm-3.0',
  latency_ms: 150,
};

const http: TimesFM3Http = {
  async post(path, body) {
    if (path === '/predict') {
      const req = body as { horizon: number };
      return { ...LIVE_SHAPE, horizon: req.horizon, point_forecast: LIVE_SHAPE.point_forecast.slice(0, req.horizon), quantiles: LIVE_SHAPE.quantiles.slice(0, req.horizon) };
    }
    throw new Error(`unexpected path ${path}`);
  },
};

async function main(): Promise<void> {
  console.log('Level-A: v0.1 agent modules (LLM-free)');

  // 1. TimesFM-3 client — golden fixture
  const client = new TimesFM3Client(http);
  const forecast = await client.predict({ series: [0.041, 0.04, 0.042, 0.0415, 0.0425], horizon: 3 });
  check('predict: 3 steps, 9-quantile mapped', forecast.steps.length === 3 && forecast.steps[0]!.q10 === LIVE_SHAPE.quantiles[0]![0]);
  check('predict: median == point_forecast', forecast.steps.every((s, i) => Math.abs(s.q50 - LIVE_SHAPE.point_forecast[i]!) < 1e-9));
  check('predict: monotonic + not suspicious', forecast.flags.quantileMonotonic && !forecast.flags.scaleSuspicious);
  check('predict: provenance recorded', forecast.model === 'timesfm-3.0' && forecast.latencyMs > 0);

  // 2. Guardrails — wire drift fails loudly
  const bad = structuredClone(LIVE_SHAPE) as typeof LIVE_SHAPE;
  bad.quantiles[0] = [...bad.quantiles[0]!].reverse();
  const driftClient = new TimesFM3Client({ async post() { return bad; } });
  const drifted = await driftClient.predict({ series: [0.041, 0.04, 0.042, 0.0415, 0.0425], horizon: 3 }).catch(
    (e: unknown) => e,
  );
  check('guardrail: non-monotonic wire rejected', drifted instanceof TimesFM3ValidationError);

  // 3. Backtest scoring — realized inside/outside band
  const score = backtestForecast({
    steps: forecast.steps,
    realized: [0.0421, 0.0428, 0.0435],
  });
  check('backtest: hit-rate 1.0 inside bands', score.hitRate === 1);
  check('backtest: mape tiny on sane fixture', score.mape < 0.01, `mape=${score.mape}`);

  // 4. Execution authorization — scoped approval
  const auth = authorizeExecution({
    mode: 'dry',
    portfolioUsd: 1_000_000,
    sessionExpiresAt: Math.floor(Date.now() / 1000) + 3600,
    decisions: [
      { action: 'SUPPLY_CAPITAL', protocol: 'morpho', amountPercentage: 100, citations: ['proj-0xpool-apy', 'c-aave-v3-0-ltv'] },
    ],
    backtestScore: { hitRate: 0.9, mape: 0.05, pnlVsHodl: 1.2 },
  });
  check('authorization: approved in dry mode', auth.approved && auth.mode === 'dry');
  check('authorization: notional capped at 100% × portfolio', auth.scopes[0]!.notionalUsdCap === 1_000_000);
  check('authorization: citations carried', auth.citations.includes('proj-0xpool-apy'));

  const rejected = authorizeExecution({
    mode: 'dry',
    portfolioUsd: 1_000_000,
    sessionExpiresAt: Math.floor(Date.now() / 1000) + 3600,
    decisions: [
      { action: 'SUPPLY_CAPITAL', protocol: 'morpho', amountPercentage: 100, citations: [] },
    ],
    backtestScore: { hitRate: 0.4, mape: 0.5, pnlVsHodl: 0.5 },
  });
  check('authorization: uncited + failed-gate proposal rejected', !rejected.approved && rejected.rejectedReasons.length >= 2);

  console.log(
    failures.length === 0
      ? '\nLevel-A probe PASSED (LLM-free v0.1 modules verified)'
      : `\nLevel-A probe FAILED: ${failures.length} check(s):\n  - ${failures.join('\n  - ')}`,
  );
  if (failures.length > 0) process.exit(1);
}

main().catch((err: unknown) => {
  console.error('Level-A probe crashed:', err);
  process.exit(1);
});
