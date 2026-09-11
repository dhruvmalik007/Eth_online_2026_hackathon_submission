import { handleSearch } from './_lib/handlers.js';
import { getRuntime } from './_lib/runtime.js';

/** POST /api/search — temporal-vector search over a pool's stored history. */
export default async function handler(request: Request): Promise<Response> {
  return handleSearch(request, getRuntime());
}
