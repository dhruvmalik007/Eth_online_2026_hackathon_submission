import { handleRiskProtocols } from '../_lib/handlers.js';
import { getRuntime } from '../_lib/runtime.js';

/** GET /api/risk/protocols — governance profiles, with forum provenance. */
export default async function handler(): Promise<Response> {
  return handleRiskProtocols(getRuntime());
}
