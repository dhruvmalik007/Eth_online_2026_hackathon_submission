import { handleMetrics } from './_lib/handlers.js';
import { getRuntime } from './_lib/runtime.js';

/** GET /api/metrics?poolId&metric&days&bucket — time-bucketed pool metrics. */
export default async function handler(request: Request): Promise<Response> {
  return handleMetrics(request, getRuntime());
}
