import { handleRiskAdjustment } from '../_lib/handlers.js';
import { getRuntime } from '../_lib/runtime.js';
import { captureInvocation, sendWebResponse, toWebRequest } from '../_lib/vercel.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * GET /api/risk/adjustment?chain&protocol&marketMakers&volatility&baseRate
 *
 * The Black-Scholes/Merton parameter derivation the risk layer consumes.
 */
// Vercel passes Node's `(request, response)`; `_lib/vercel.ts` owns that translation.
export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  captureInvocation(request);
  await sendWebResponse(response, await handleRiskAdjustment(await toWebRequest(request), getRuntime()));
}
