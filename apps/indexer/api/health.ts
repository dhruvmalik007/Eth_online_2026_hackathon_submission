import { handleHealth } from './_lib/handlers.js';
import { getRuntime } from './_lib/runtime.js';

/** GET /api/health — is each dependency actually usable right now? */
export default async function handler(): Promise<Response> {
  return handleHealth(getRuntime());
}
