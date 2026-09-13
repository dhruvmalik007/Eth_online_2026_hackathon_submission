/**
 * LI.FI returns `value` as a hex quantity; the port's schema accepts only decimal.
 *
 * The adapter passed it through unchanged, so every route carrying native value came back as
 * `value Invalid string: must match pattern /^\d+$/` — a malformed-call error from the service for a
 * bug that lived in the code producing the call. Nothing caught it because `build()` had no test, so
 * these cover the conversion directly.
 */
import { describe, expect, it } from "vitest";
import { normalizeValue } from "../src/lifi.js";

describe("normalizeValue", () => {
  it("converts a hex quantity to decimal", () => {
    // The exact value LI.FI returned for a 1 POL bridge leg.
    expect(normalizeValue("0x12a24d457fbd33b0")).toBe("1342720599801017264");
  });

  it("passes a decimal string through", () => {
    expect(normalizeValue("1342177280000000000")).toBe("1342177280000000000");
  });

  it("treats absent value as zero", () => {
    expect(normalizeValue(undefined)).toBe("0");
    expect(normalizeValue(null)).toBe("0");
    expect(normalizeValue("")).toBe("0");
  });

  it("accepts a number", () => {
    expect(normalizeValue(0)).toBe("0");
    expect(normalizeValue(1234)).toBe("1234");
  });

  it("always yields something the schema accepts", () => {
    for (const raw of ["0x0", "0x12a24d457fbd33b0", "0", 0, undefined, "999999999999999999999"]) {
      expect(normalizeValue(raw)).toMatch(/^\d+$/);
    }
  });

  it("refuses a value it cannot represent rather than inventing zero", () => {
    // A silent 0 here would send a transaction with no attached value.
    expect(() => normalizeValue("not-a-number")).toThrow();
  });
});
