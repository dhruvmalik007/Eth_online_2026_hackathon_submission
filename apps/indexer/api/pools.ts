import { handlePools } from './_lib/handlers.js';
import { getRuntime } from './_lib/runtime.js';
import { captureInvocation, sendWebResponse, toWebRequest } from './_lib/vercel.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * GET /api/pools?limit&network&protocol — the indexed pool universe.
 *
 * The discovery route: it is what lets the console offer a picker instead of demanding an address,
 * and it doubles as the data-recency view, since every row carries when it was last observed.
 */
// Vercel passes Node's `(request, response)`; `_lib/vercel.ts` owns that translation.
export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  captureInvocation(request);
  await sendWebResponse(response, await handlePools(await toWebRequest(request), getRuntime()));
}
