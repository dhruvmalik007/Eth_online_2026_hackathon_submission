import { handleAgent } from './_lib/handlers.js';
import { getRuntime } from './_lib/runtime.js';

/**
 * POST /api/agent — run the v0.1 five-node cycle (`mode: "v01"`, default) or
 * the deepagents tool-calling harness (`mode: "deep"`). `dry: true` skips all
 * model calls and returns the deterministic skeleton.
 */
export default async function handler(request: Request): Promise<Response> {
  return handleAgent(request, getRuntime());
}
