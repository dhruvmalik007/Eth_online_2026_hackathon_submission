import { describe, expect, it } from "vitest";
import { createAdapterRegistry, type LegExecutor } from "../src/index.js";

interface Leg {
  readonly kind: "swap" | "bridge" | "deposit";
}
interface Plan {
  readonly note: string;
}

const swapLeg: Leg = { kind: "swap" };
const bridgeLeg: Leg = { kind: "bridge" };

function executor(
  id: "1inch" | "uniswap" | "lifi",
  kinds: readonly Leg["kind"][],
  plan?: () => Promise<never>,
): LegExecutor<Leg, Plan> & { calls: number } {
  const held = {
    id,
    calls: 0,
    supports: (leg: Leg) => kinds.includes(leg.kind),
    plan: async (leg: Leg) => {
      held.calls += 1;
      if (plan !== undefined) return plan();
      return { ok: true as const, quote: { note: `${id}:${leg.kind}` } };
    },
  };
  return held;
}

describe("createAdapterRegistry", () => {
  it("lists the registered ids in precedence order", () => {
    const registry = createAdapterRegistry([executor("1inch", ["swap"]), executor("uniswap", ["swap"])]);

    expect(registry.ids).toEqual(["1inch", "uniswap"]);
  });

  it("refuses a duplicate id", () => {
    // Two adapters under one name makes every later log line about that venue ambiguous.
    expect(() =>
      createAdapterRegistry([executor("1inch", ["swap"]), executor("1inch", ["deposit"])]),
    ).toThrow(RangeError);
  });

  it("gives the leg to the first adapter that claims it", () => {
    // Registration order is precedence, and it is asserted rather than left implicit: a swap the two
    // venues can both serve must reach a deterministic one.
    const first = executor("1inch", ["swap"]);
    const second = executor("uniswap", ["swap"]);
    const registry = createAdapterRegistry([first, second]);

    const chosen = registry.executorFor(swapLeg);
    expect(chosen.ok).toBe(true);
    if (!chosen.ok) throw new Error("unreachable");
    expect(chosen.quote.id).toBe("1inch");
    expect(second.calls).toBe(0);
  });

  it("names every adapter tried when none claims the leg", () => {
    const registry = createAdapterRegistry([executor("1inch", ["swap"]), executor("lifi", ["bridge"])]);

    const chosen = registry.executorFor({ kind: "deposit" });
    expect(chosen.ok).toBe(false);
    if (chosen.ok) throw new Error("unreachable");
    expect(chosen.reason).toBe("unsupported_pair");
    expect(chosen.detail).toContain("1inch, lifi");
  });

  it("explains an empty registry rather than reporting a missing venue", () => {
    const chosen = createAdapterRegistry<Leg, Plan>([]).executorFor(swapLeg);

    expect(chosen.ok).toBe(false);
    if (chosen.ok) throw new Error("unreachable");
    expect(chosen.detail).toContain("No venue adapters are registered");
  });

  it("plans every leg in order, one entry each", () => {
    // Order matters: an approve precedes a swap precedes a deposit, and a plan reported out of order
    // is a plan nobody can act on.
    const registry = createAdapterRegistry([executor("1inch", ["swap"]), executor("lifi", ["bridge"])]);

    return registry.planAll([swapLeg, bridgeLeg]).then((planned) => {
      expect(planned.map((entry) => entry.source)).toEqual(["1inch", "lifi"]);
      expect(planned.map((entry) => entry.leg.kind)).toEqual(["swap", "bridge"]);
    });
  });

  it("keeps an unclaimed leg from taking the run down with it", async () => {
    const registry = createAdapterRegistry([executor("1inch", ["swap"])]);

    const planned = await registry.planAll([swapLeg, { kind: "deposit" }, swapLeg]);

    expect(planned).toHaveLength(3);
    expect(planned[0]?.outcome.ok).toBe(true);
    expect(planned[1]?.outcome.ok).toBe(false);
    expect(planned[1]?.source).toBeNull();
    expect(planned[2]?.outcome.ok).toBe(true);
  });

  it("contains an adapter that throws instead of returning a failure", async () => {
    // The port says failures are values. The layer is where a breach of that gets contained.
    const rogue = executor("1inch", ["swap"], async () => {
      throw new Error("transport exploded");
    });
    const registry = createAdapterRegistry([rogue]);

    const planned = await registry.planAll([swapLeg]);

    expect(planned[0]?.outcome.ok).toBe(false);
    if (planned[0]?.outcome.ok !== false) throw new Error("unreachable");
    expect(planned[0].outcome.reason).toBe("upstream_error");
    expect(planned[0].outcome.detail).toContain("transport exploded");
  });
});
