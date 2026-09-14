import { describe, expect, it } from "vitest";
import { ERC20_TRANSFER_SELECTOR, isAddressLike, parseAmount, shorten, transferData } from "./transfer";

const DESK = "0x63185C0f059dE46DBeEa6813ab461A8863E40e21" as const;

describe("parseAmount", () => {
  it("converts a decimal amount to base units exactly", () => {
    expect(parseAmount("1.5", 6)).toEqual({ ok: true, base: 1_500_000n });
    expect(parseAmount("0.000001", 6)).toEqual({ ok: true, base: 1n });
    expect(parseAmount(".5", 6)).toEqual({ ok: true, base: 500_000n });
    expect(parseAmount("5.", 6)).toEqual({ ok: true, base: 5_000_000n });
  });

  it("tolerates separators a person types", () => {
    expect(parseAmount("1,000", 6)).toEqual({ ok: true, base: 1_000_000_000n });
    expect(parseAmount(" 2 ", 6)).toEqual({ ok: true, base: 2_000_000n });
  });

  it("refuses more precision than the token has, rather than rounding it away", () => {
    const result = parseAmount("1.2345678", 6);
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).toContain("6 decimal places");
  });

  it("refuses empty, zero, and non-numeric input with a reason", () => {
    expect(parseAmount("", 6)).toMatchObject({ ok: false });
    expect(parseAmount("0", 6)).toMatchObject({ ok: false });
    expect(parseAmount("0.0", 6)).toMatchObject({ ok: false });
    expect(parseAmount("abc", 6)).toMatchObject({ ok: false });
    expect(parseAmount("1.2.3", 6)).toMatchObject({ ok: false });
  });

  it("keeps precision a float would lose", () => {
    // 1e18-style values are where `Number * 10 ** decimals` stops being exact.
    // A whole number, scaled by 18 — the point is that the scaling is exact, not that it is small.
    expect(parseAmount("123456789012345678901234567890", 18)).toEqual({
      ok: true,
      base: 123456789012345678901234567890n * 10n ** 18n,
    });
  });
});

describe("transferData", () => {
  it("produces ERC-20 transfer calldata for the desk address", () => {
    const data = transferData(DESK, 1_500_000n);
    expect(data.startsWith(ERC20_TRANSFER_SELECTOR)).toBe(true);
    expect(data).toContain(DESK.slice(2).toLowerCase());
    expect(data).toContain(1_500_000n.toString(16).padStart(64, "0"));
  });
});

describe("isAddressLike", () => {
  it("accepts a real address and rejects a truncated pasted one", () => {
    expect(isAddressLike(DESK)).toBe(true);
    expect(isAddressLike(DESK.slice(0, 20))).toBe(false);
    expect(isAddressLike(undefined)).toBe(false);
  });
});

describe("shorten", () => {
  it("shortens long values and leaves short ones alone", () => {
    expect(shorten(DESK)).toBe("0x6318…0e21");
    expect(shorten("0x1234")).toBe("0x1234");
  });
});
