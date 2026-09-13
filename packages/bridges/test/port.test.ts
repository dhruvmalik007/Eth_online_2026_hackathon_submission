/**
 * Tests for the port and its vocabulary.
 *
 * These pin the two decisions that are easy to undo by accident: a quote must
 * say when it expires, and `attesting` is not `pending`. Both are the kind of
 * thing a later "simplification" removes without noticing what it was for.
 */
import { describe, expect, it } from "vitest";
import {
  QUOTE_FAILURES,
  QuoteEnvelopeSchema,
  RouteHopSchema,
  SOURCE_IDS,
  SourceIdSchema,
  StatusSnapshotSchema,
} from "../src/index.js";

/** A valid hop — `feeLines` empty, because the fee schema is the domain's. */
function hop(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    source: "lifi",
    protocol: "across",
    kind: "bridge",
    chainId: 8453,
    fromToken: "USDC",
    toToken: "USDC",
    fromAmount: "1000000",
    toAmount: "999000",
    feeLines: [],
    ...overrides,
  };
}

describe("a quote must say when it stops being true", () => {
  it("rejects a quote with no expiry", () => {
    // Every provider's quote expires; making it optional is how a stale price
    // reaches a signature.
    const result = QuoteEnvelopeSchema.safeParse({
      sourceId: "lifi",
      hops: [hop()],
      feeLines: [],
      raw: {},
    });
    expect(result.success).toBe(false);
  });

  it("accepts a quote that carries one", () => {
    const result = QuoteEnvelopeSchema.safeParse({
      sourceId: "lifi",
      hops: [hop()],
      feeLines: [],
      expiresAt: new Date("2026-09-12T03:05:00.000Z"),
      raw: {},
    });
    expect(result.success).toBe(true);
  });

  it("rejects a quote with no hops, because an empty route is not a route", () => {
    const result = QuoteEnvelopeSchema.safeParse({
      sourceId: "lifi",
      hops: [],
      feeLines: [],
      expiresAt: new Date(),
      raw: {},
    });
    expect(result.success).toBe(false);
  });
});

describe("bridge status keeps verifier waiting separate from block waiting", () => {
  it("accepts `attesting`", () => {
    // A bridge waiting on a verifier is not a bridge waiting on a block, and
    // conflating them loses the only signal that explains a slow leg.
    expect(StatusSnapshotSchema.safeParse({ state: "attesting", raw: {} }).success).toBe(true);
  });

  it("carries partial attestations when the provider reports them", () => {
    const parsed = StatusSnapshotSchema.safeParse({
      state: "attesting",
      attestations: { required: 2, received: 1 },
      raw: {},
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a state outside the four that exist", () => {
    expect(StatusSnapshotSchema.safeParse({ state: "slow", raw: {} }).success).toBe(false);
  });
});

describe("amounts are integer strings, not floats", () => {
  it("rejects a decimal amount", () => {
    // Token amounts are in subunits; a float here is a rounding bug waiting to
    // happen at the worst possible moment.
    expect(RouteHopSchema.safeParse(hop({ fromAmount: "1.5" })).success).toBe(false);
  });

  it("accepts a subunit integer", () => {
    expect(RouteHopSchema.safeParse(hop()).success).toBe(true);
  });
});

describe("the source list is closed", () => {
  it("accepts every declared source", () => {
    for (const source of SOURCE_IDS) {
      expect(SourceIdSchema.safeParse(source).success).toBe(true);
    }
  });

  it("rejects an unlisted source, so a typo cannot become a new adapter", () => {
    expect(SourceIdSchema.safeParse("1inch-fusion").success).toBe(false);
  });
});

describe("quote failures are a closed set", () => {
  it("names the routine failures a caller can branch on", () => {
    // Routine outcomes, not exceptions — the caller retries some and abandons
    // others, and the dashboard can say why.
    expect(QUOTE_FAILURES).toContain("rate_limited");
    expect(QUOTE_FAILURES).toContain("no_route");
    expect(QUOTE_FAILURES).toContain("insufficient_liquidity");
  });
});
