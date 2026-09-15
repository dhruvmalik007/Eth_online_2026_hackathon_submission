import { handleAgent } from './_lib/handlers.js';
import { getRuntime } from './_lib/runtime.js';
import { captureInvocation, sendWebResponse, toWebRequest } from './_lib/vercel.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * POST /api/agent — run the v0.1 five-node cycle (`mode: "v01"`, default) or
 * the deepagents tool-calling harness (`mode: "deep"`). `dry: true` skips all
 * model calls and returns the deterministic skeleton.
 */
// Vercel passes Node's `(request, response)`; `_lib/vercel.ts` owns that translation.
export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  captureInvocation(request);
  await sendWebResponse(response, await handleAgent(await toWebRequest(request), getRuntime()));
}
