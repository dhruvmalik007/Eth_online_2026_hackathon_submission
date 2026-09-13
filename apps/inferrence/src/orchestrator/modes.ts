/**
 * Resolve the agent mode a turn asks for.
 *
 * `v01` (the 5-node LangGraph cycle) is the default, `deep` is the deepagents
 * tool-calling harness, and `dry` performs zero model calls. Same vocabulary as
 * `apps/indexer`'s `POST /api/agent`, so the two services are not two dialects.
 */
import { AGENT_MODES, type AgentMode } from "../events/contract.js";
import { HttpError } from "../http.js";

export function resolveAgentMode(
  source: Readonly<Record<string, unknown>>,
  fallback: AgentMode = "v01",
): AgentMode {
  const raw = source["mode"];
  if (raw === undefined) return fallback;
  if (typeof raw !== "string" || !(AGENT_MODES as readonly string[]).includes(raw)) {
    throw new HttpError("BAD_REQUEST", "`mode` must be one of: v01, deep, dry.", { field: "mode" });
  }
  return raw as AgentMode;
}
