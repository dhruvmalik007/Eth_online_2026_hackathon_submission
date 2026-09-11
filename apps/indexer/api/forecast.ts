import { handleForecast } from './_lib/handlers.js';
import { getRuntime } from './_lib/runtime.js';

/**
 * GET|POST /api/forecast — a TimesFM-3 forecast for a pool, or (with
 * `stored=true`) the path already persisted in the forecast ledger.
 */
export default async function handler(request: Request): Promise<Response> {
  return handleForecast(request, getRuntime());
}
