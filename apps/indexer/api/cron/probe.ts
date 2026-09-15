import { handleCronProbe } from '../_lib/handlers.js';
import { getRuntime } from '../_lib/runtime.js';
import { captureInvocation, sendWebResponse, toWebRequest } from '../_lib/vercel.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * POST /api/cron/probe — sweep every dependency and record what was found.
 *
 * Called by the Cloud Run Job, not by a browser. It is the only writer of `model_probes`, which is
 * what gives `/api/model-status` a history to report, and it requires
 * `Authorization: Bearer $CRON_SECRET` — without that it would be an open trigger anyone could use
 * to write rows.
 */
// Vercel passes Node's `(request, response)`; `_lib/vercel.ts` owns that translation.
export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  captureInvocation(request);
  await sendWebResponse(response, await handleCronProbe(await toWebRequest(request), getRuntime()));
}
