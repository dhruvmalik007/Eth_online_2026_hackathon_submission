import { handleMetrics } from './_lib/handlers.js';
import { getRuntime } from './_lib/runtime.js';
import { sendWebResponse, toWebRequest } from './_lib/vercel.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** GET /api/metrics?poolId&metric&days&bucket — time-bucketed pool metrics. */
// Vercel passes Node's `(request, response)`; `_lib/vercel.ts` owns that translation.
export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  await sendWebResponse(response, await handleMetrics(await toWebRequest(request), getRuntime()));
}
