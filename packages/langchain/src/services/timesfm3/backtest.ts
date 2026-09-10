/**
 * Deterministic backtest scoring for TimesFM-3 forecasts replayed against
 * realized outcomes. Pure functions — golden-tested, no I/O, no model calls.
 *
 * Scoring contract (BacktestResult UI):
 *  - hitRate: fraction of horizon steps whose realized value falls inside
 *    the [q10, q90] band
 *  - mape: mean absolute percentage error of the median path
 *  - pnlVsHodl: strategy PnL over buy-and-hold (directional rule: enter when
 *    the median path rises above the last realized value, exit on band break)
 */

export interface BacktestInput {
  /** Forecast steps (from TimesFM3Client, in chronological order). */
  readonly steps: ReadonlyArray<{ readonly index: number; readonly q10: number; readonly q50: number; readonly q90: number }>;
  /** Realized values, aligned to the forecast steps (same length). */
  readonly realized: readonly number[];
}

export interface BacktestScore {
  readonly hitRate: number;
  readonly mape: number;
  readonly pnlVsHodl: number;
  readonly steps: number;
}

export function backtestForecast(input: BacktestInput): BacktestScore {
  const { steps, realized } = input;
  if (steps.length === 0 || realized.length !== steps.length) {
    throw new Error(`backtest: realized length ${realized.length} must equal steps length ${steps.length}`);
  }

  let hits = 0;
  let absPctErrors = 0;
  let strategyPnl = 0;
  let hodlPnl = 0;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const actual = realized[i]!;
    if (actual >= step.q10 && actual <= step.q90) hits += 1;
    if (step.q50 !== 0) absPctErrors += Math.abs((actual - step.q50) / step.q50);

    // Directional rule: long when the median forecast is above the previous
    // realized value; flat otherwise. PnL accrues on the next step's move.
    const prev = i === 0 ? actual : realized[i - 1]!;
    const direction = step.q50 > prev ? 1 : 0;
    if (i > 0) {
      const move = actual - realized[i - 1]!;
      strategyPnl += direction * move;
      hodlPnl += move;
    }
  }

  return {
    hitRate: steps.length > 0 ? hits / steps.length : 0,
    mape: steps.length > 0 ? absPctErrors / steps.length : 0,
    pnlVsHodl: strategyPnl - hodlPnl,
    steps: steps.length,
  };
}
