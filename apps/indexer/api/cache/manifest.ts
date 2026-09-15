import { handleCacheManifest } from '../_lib/handlers.js';
import { getRuntime } from '../_lib/runtime.js';
import { captureInvocation, sendWebResponse } from '../_lib/vercel.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * GET /api/cache/manifest — the cache index, each entry carrying a short-lived signed URL.
 *
 * The bucket it reads is private, so this is the hop that signs on the browser's behalf; the payloads
 * themselves are then fetched from Google's edge. An absent manifest is reported as a state, not an
 * error — it just means the refresh job has not run yet.
 */
// Vercel passes Node's `(request, response)`; `_lib/vercel.ts` owns that translation.
export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  captureInvocation(request);
  await sendWebResponse(response, await handleCacheManifest(getRuntime()));
}
