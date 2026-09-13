import { handleForecast } from './_lib/handlers.js';
import { getRuntime } from './_lib/runtime.js';
import { sendWebResponse, toWebRequest } from './_lib/vercel.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * GET|POST /api/forecast — a TimesFM-3 forecast for a pool, or (with
 * `stored=true`) the path already persisted in the forecast ledger.
 */
// Vercel passes Node's `(request, response)`; `_lib/vercel.ts` owns that translation.
export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  await sendWebResponse(response, await handleForecast(await toWebRequest(request), getRuntime()));
}
