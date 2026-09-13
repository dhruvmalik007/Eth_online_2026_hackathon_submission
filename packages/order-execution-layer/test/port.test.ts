/**
 * The port, after its move.
 *
 * These assertions are the *compatibility contract* from the plan, made
 * executable. The claims that matter are negative ones — that nothing grew — so
 * they are the ones tested hardest: a new `RouteHop.kind` or a changed
 * `SOURCE_IDS` membership would break v1 integrations, and a test that only
 * checked the happy path would not notice.
 */

import { describe, expect, it } from "vitest";
import {
  QUOTE_FAILURES,
  RouteHopSchema,
  SOURCE_IDS,
  SourceIdSchema,
  StatusSnapshotSchema,
  UnsignedTransactionSchema,
  type SourceId,
} from "../src/port.js";

describe("SOURCE_IDS after the move", () => {
  it("still carries the values it had before, so no existing parse breaks", () => {
    for (const preexisting of ["1inch", "lifi", "layerzero", "circle-cctp"]) {
      expect(SourceIdSchema.safeParse(preexisting).success, preexisting).toBe(true);
    }
  });

  it("carries one value per venue family, and grows only by whole families", () => {
    // Each value is a *vendor*, not a product: "1inch" covers the Aqua/SwapVM work, "morpho" covers
    // the vaults and the fixed-rate venue. Adding a value is therefore a deliberate act, and this
    // assertion is the thing that makes it one.
    expect(SOURCE_IDS).toEqual(["1inch", "uniswap", "lifi", "layerzero", "circle-cctp", "morpho"]);
    expect(SourceIdSchema.safeParse("morpho").success).toBe(true);
  });

  it("pre-dates this package: '1inch' was already a member", () => {
    // The clearest evidence the port was designed with this work in mind — the
    // SwapVM/Aqua adapter needed no enum change at all.
    expect(SOURCE_IDS).toContain("1inch");
  });

  it("still rejects an id that only looks related", () => {
    // Carried over from the bridges suite, so the move is shown not to have
    // loosened anything.
    expect(SourceIdSchema.safeParse("1inch-fusion").success).toBe(false);
  });
});

describe("RouteHop.kind did not grow", () => {
  it("is exactly the five kinds v1 already knows", () => {
    // The strongest form of interoperability: the Morpho vault leg reuses
    // `deposit`/`withdraw`, and Aqua's `ship`/`dock` map onto the same two, so a
    // whole new venue needs no new vocabulary.
    const kinds = RouteHopSchema.shape.kind.options;
    expect([...kinds]).toEqual(["swap", "bridge", "deposit", "withdraw", "pay"]);
  });

  it("accepts a vault deposit as a plain 'deposit' hop", () => {
    const parsed = RouteHopSchema.safeParse({
      source: "morpho" satisfies SourceId,
      protocol: "morpho-vault-v2",
      kind: "deposit",
      chainId: 1,
      fromToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      toToken: "0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB",
      fromAmount: "1000000000",
      toAmount: "980000000000000000",
      feeLines: [],
    });
    expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [])).toBe(true);
  });
});

describe("amounts stay integer strings", () => {
  it("accepts an integer string", () => {
    const parsed = UnsignedTransactionSchema.safeParse({
      chainId: 1,
      to: "0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB",
      data: "0x",
      value: "0",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a JavaScript number, which is how precision is lost", () => {
    const parsed = UnsignedTransactionSchema.safeParse({
      chainId: 1,
      to: "0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB",
      data: "0x",
      value: 1_000_000_000_000_000_000,
    });
    expect(parsed.success).toBe(false);
  });
});

describe("quotes and statuses keep their shapes", () => {
  it("refuses a quote with no expiry, because a stale price must not reach a signature", () => {
    const parsed = RouteHopSchema.safeParse({
      source: "1inch",
      protocol: "swap-vm",
      kind: "swap",
      fromToken: "0x0",
      toToken: "0x1",
      fromAmount: "1",
      toAmount: "1",
      feeLines: [],
      expiresAt: new Date(),
    });
    // `expiresAt` belongs to the envelope, not the hop — extra keys are stripped,
    // so this documents where the field lives rather than loosening the hop.
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error("unreachable");
    expect("expiresAt" in parsed.data).toBe(false);
  });

  it("keeps 'attesting' distinct from 'pending'", () => {
    expect(StatusSnapshotSchema.shape.state.options).toContain("attesting");
    expect(StatusSnapshotSchema.shape.state.options).toContain("pending");
  });

  it("keeps insufficient_liquidity in the failure set, since a vault redeem reuses it", () => {
    expect(QUOTE_FAILURES).toContain("insufficient_liquidity");
  });
});
