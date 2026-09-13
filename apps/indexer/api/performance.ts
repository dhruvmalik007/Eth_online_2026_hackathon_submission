import { handlePerformance } from './_lib/handlers.js';
import { getRuntime } from './_lib/runtime.js';
import { sendWebResponse, toWebRequest } from './_lib/vercel.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * GET /api/performance?poolId&days — realized yield, forecast calibration and
 * scored decision outcomes, all computed by SQL views.
 */
// Vercel passes Node's `(request, response)`; `_lib/vercel.ts` owns that translation.
export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  await sendWebResponse(response, await handlePerformance(await toWebRequest(request), getRuntime()));
}
