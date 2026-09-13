/**
 * The middle layer: an agent defines intent legs, and something has to decide who runs them.
 *
 * ## What it is not
 *
 * It does not quote, sign, submit or know what a swap is. Each of those belongs to a venue adapter
 * that implements {@link LegExecutor}, and keeping this file free of them is what lets a new venue be
 * added without touching it — the alternative, a `switch` on venue id, is the thing that makes a
 * dispatcher grow a case per protocol and a dependency per case.
 *
 * ## Two decisions worth naming
 *
 * **Dispatch is by `supports()`, and registration order is precedence.** Not a map from leg kind to
 * adapter, because the same leg kind can be served by several venues — a swap may be runnable by
 * 1inch or by a Uniswap pool — and which is *better* is a pricing question the adapters answer, not
 * one a table can hold. Order is therefore explicit and documented rather than incidental.
 *
 * **A leg that nobody claims is a value, not an exception.** `planAll` returns one entry per leg, in
 * order, so a caller can report "legs 1 and 3 are runnable, leg 2 has no venue" instead of losing the
 * whole plan. The port's `QuoteOutcome` already expresses this; the layer just stops a throw from
 * escaping an adapter and becoming a whole-run failure.
 */

import type { QuoteFailure, QuoteOutcome, SourceId } from "./port.js";

/**
 * A venue adapter, as far as this layer is concerned.
 *
 * `supports` is a claim, not a check: an adapter that returns `true` and then fails in `plan` has
 * still been given the leg honestly. That is deliberate — the alternative is a capability matrix
 * maintained centrally, which drifts from what the adapters can actually do.
 */
export interface LegExecutor<Leg, Plan> {
  readonly id: SourceId;
  supports(leg: Leg): boolean;
  plan(leg: Leg): Promise<QuoteOutcome<Plan>>;
}

/** One leg and what became of it. */
export interface LegPlan<Leg, Plan> {
  readonly leg: Leg;
  /** The adapter that claimed it, or `null` when none did. */
  readonly source: SourceId | null;
  readonly outcome: QuoteOutcome<Plan>;
}

export interface AdapterRegistry<Leg, Plan> {
  /** Registered ids, in precedence order. Surfaced so a caller can log the venue set. */
  readonly ids: readonly SourceId[];
  /** The first adapter that claims the leg, or a failure naming every adapter tried. */
  executorFor(leg: Leg): QuoteOutcome<LegExecutor<Leg, Plan>>;
  /**
   * Plan every leg, in order, one entry each.
   *
   * Sequential rather than concurrent: legs are ordered because they are, and a plan for leg 3 that
   * arrived before leg 2's would be reported out of order. A handful of legs is not worth the
   * ambiguity that parallelism would introduce.
   */
  planAll(legs: readonly Leg[]): Promise<readonly LegPlan<Leg, Plan>[]>;
}

function failure<Quote>(reason: QuoteFailure, detail: string): QuoteOutcome<Quote> {
  return { ok: false, reason, detail };
}

/**
 * Build a registry over a fixed set of adapters.
 *
 * @param executors - in precedence order. The first that claims a leg runs it.
 * @throws {RangeError} on a duplicate id, because two adapters under one name makes every log line
 *   about that venue ambiguous for the rest of the run.
 */
export function createAdapterRegistry<Leg, Plan>(
  executors: readonly LegExecutor<Leg, Plan>[],
): AdapterRegistry<Leg, Plan> {
  const ids = executors.map((executor) => executor.id);
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
  if (duplicate !== undefined) {
    throw new RangeError(`Two adapters are registered under "${duplicate}".`);
  }

  return {
    ids,

    executorFor(leg) {
      const match = executors.find((executor) => executor.supports(leg));
      if (match !== undefined) return { ok: true, quote: match };
      return failure(
        "unsupported_pair",
        executors.length === 0
          ? "No venue adapters are registered, so no leg can be run."
          : `No registered venue claims this leg. Tried, in order: ${ids.join(", ")}.`,
      );
    },

    async planAll(legs) {
      const planned: LegPlan<Leg, Plan>[] = [];
      for (const leg of legs) {
        const executor = this.executorFor(leg);
        if (!executor.ok) {
          planned.push({ leg, source: null, outcome: executor });
          continue;
        }
        try {
          planned.push({ leg, source: executor.quote.id, outcome: await executor.quote.plan(leg) });
        } catch (error) {
          // The port says failures are values. An adapter that throws has broken that convention, and
          // the layer is where that gets contained rather than taking the run with it.
          planned.push({
            leg,
            source: executor.quote.id,
            outcome: failure(
              "upstream_error",
              `${executor.quote.id} threw while planning: ${error instanceof Error ? error.message : String(error)}`,
            ),
          });
        }
      }
      return planned;
    },
  };
}
