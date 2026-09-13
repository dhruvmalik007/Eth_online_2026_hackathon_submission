import { configuredChains } from "./_lib/rpc.js";
import { guarded, json, requireMethod } from "./_lib/handler.js";

export const config = { runtime: "nodejs" };

/**
 * Reports which chains this deployment can reach, and where it is running.
 *
 * Deliberately does not make an RPC call: a health route that depends on a third party reports the
 * third party's health, not ours. Reachability is proven by the per-chain endpoints.
 */
export default async function handler(request: Request): Promise<Response> {
  return guarded(async () => {
    const method = requireMethod(request, ["GET"]);
    if (method !== null) return method;
    const chains = configuredChains();
    return json({
      service: "fork-execution",
      runtime: process.env.FORK_EXECUTION_RUNTIME ?? "local",
      stateless: true,
      chains,
    });
  });
}
