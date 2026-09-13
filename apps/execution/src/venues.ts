/**
 * The venue registry: which adapters this deployment can actually reach.
 *
 * ## Why this is built here and not in a venue package
 *
 * `apps/execution` is the composition root — the one place concrete bindings are chosen. A venue
 * package cannot know whether its RPC is configured, whether its flag is on, or whether another venue
 * could serve the same leg better; those are deployment facts. So the packages export executors and
 * this decides which of them are registered.
 *
 * ## An empty registry is a complete configuration
 *
 * With nothing enabled this returns a registry with no executors, and every leg reports
 * `unsupported_pair` naming the adapters tried. That is the honest answer for a deployment with no
 * venue configured, and it is the same answer a misconfiguration gets — which is why `venueStatus()`
 * exists alongside it, to distinguish "nothing was asked for" from "something was asked for and
 * could not be built".
 *
 * ## Adding a venue
 *
 * Register one more `LegExecutor`, in precedence order. Nothing else changes: not this file's
 * dispatch, not the routes, not the domain. That is the property the layering exists to buy.
 */

import type { IntentLeg } from "@ethonline2026/execution-domain";
import {
  createAdapterRegistry,
  type AdapterRegistry,
  type LegExecutor,
  type SourceId,
  type UnsignedTransaction,
} from "@ethonline2026/order-execution-layer";
import type { ExecutionEnv } from "./env.js";

/**
 * What a leg becomes when a venue plans it.
 *
 * Deliberately thinner than the domain's `ExecutionPlan`: a plan for *one* leg has no batch digest
 * and no totals, and inventing them here would mean a per-leg object pretending to be a run.
 */
export interface VenuePlan {
  /** Un-signed calls the leg needs, in order. The service signs them; the venue does not. */
  readonly calls: readonly UnsignedTransaction[];
  /** A sentence for the timeline, in the leg's own terms. */
  readonly note: string;
}

/** Why a venue is or is not registered. */
export interface VenueStatus {
  readonly id: SourceId;
  readonly registered: boolean;
  readonly detail: string;
}

export interface VenueRegistry {
  readonly registry: AdapterRegistry<IntentLeg, VenuePlan>;
  /** Per venue, whether it was registered and why — for the operator, not the agent. */
  readonly status: readonly VenueStatus[];
}

/**
 * Build the registry for a deployment.
 *
 * @param env - the parsed service environment, which carries the per-venue flags.
 * @param executors - venue executors to consider, supplied by the composition root. Each is paired
 *   with the flag that enables it, so a disabled venue is reported rather than silently absent.
 */
export function createVenueRegistry(
  env: ExecutionEnv,
  executors: readonly { readonly id: SourceId; readonly enabled: boolean; readonly reason?: string; readonly executor?: LegExecutor<IntentLeg, VenuePlan> }[] = [],
): VenueRegistry {
  const status: VenueStatus[] = [];
  const registered: LegExecutor<IntentLeg, VenuePlan>[] = [];

  for (const candidate of executors) {
    if (!candidate.enabled) {
      status.push({
        id: candidate.id,
        registered: false,
        detail: candidate.reason ?? `${candidate.id} is switched off for this deployment.`,
      });
      continue;
    }
    if (candidate.executor === undefined) {
      status.push({
        id: candidate.id,
        registered: false,
        detail: `${candidate.id} is enabled but not constructible: ${candidate.reason ?? "a required setting is missing."}`,
      });
      continue;
    }
    registered.push(candidate.executor);
    status.push({ id: candidate.id, registered: true, detail: `${candidate.id} is registered.` });
  }

  return { registry: createAdapterRegistry(registered), status };
}

/**
 * The registry for a deployment with no venue configuration.
 *
 * Named rather than implied, because "no venues" is a supported state and a reader should be able to
 * see that it was chosen deliberately rather than fallen into.
 */
export function emptyVenueRegistry(): VenueRegistry {
  return { registry: createAdapterRegistry([]), status: [] };
}

/** True when the deployment can run at least one leg. Surfaced by `/health` and the operator UI. */
export function hasVenues(venues: VenueRegistry): boolean {
  return venues.registry.ids.length > 0;
}
