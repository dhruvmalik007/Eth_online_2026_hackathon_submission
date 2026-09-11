import { handleRiskChains } from '../_lib/handlers.js';
import { getRuntime } from '../_lib/runtime.js';

/** GET /api/risk/chains — every collected chain risk profile, with freshness. */
export default async function handler(): Promise<Response> {
  return handleRiskChains(getRuntime());
}
