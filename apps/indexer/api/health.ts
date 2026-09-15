import { handleHealth } from './_lib/handlers.js';
import { getRuntime } from './_lib/runtime.js';
import { captureInvocation, sendWebResponse } from './_lib/vercel.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** GET /api/health — is each dependency actually usable right now? */
// Vercel passes Node's `(request, response)`; `_lib/vercel.ts` owns that translation.
export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  captureInvocation(request);
  await sendWebResponse(response, await handleHealth(getRuntime()));
}
