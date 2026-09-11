import { handleRiskAdjustment } from '../_lib/handlers.js';
import { getRuntime } from '../_lib/runtime.js';

/**
 * GET /api/risk/adjustment?chain&protocol&marketMakers&volatility&baseRate
 *
 * The Black-Scholes/Merton parameter derivation the risk layer consumes.
 */
export default async function handler(request: Request): Promise<Response> {
  return handleRiskAdjustment(request, getRuntime());
}
