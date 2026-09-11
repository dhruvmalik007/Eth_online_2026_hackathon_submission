import { handlePerformance } from './_lib/handlers.js';
import { getRuntime } from './_lib/runtime.js';

/**
 * GET /api/performance?poolId&days — realized yield, forecast calibration and
 * scored decision outcomes, all computed by SQL views.
 */
export default async function handler(request: Request): Promise<Response> {
  return handlePerformance(request, getRuntime());
}
