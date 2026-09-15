import { handleModelStatus } from './_lib/handlers.js';
import { getRuntime } from './_lib/runtime.js';
import { captureInvocation, sendWebResponse, toWebRequest } from './_lib/vercel.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * GET /api/model-status?hours — recorded model availability.
 *
 * Read-only, and deliberately not a live probe: `/api/health` is the live view, and this one exists
 * to be cacheable and to show a history rather than a moment.
 */
// Vercel passes Node's `(request, response)`; `_lib/vercel.ts` owns that translation.
export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  captureInvocation(request);
  await sendWebResponse(
    response,
    await handleModelStatus(await toWebRequest(request), getRuntime()),
  );
}
