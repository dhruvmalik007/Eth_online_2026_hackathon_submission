/**
 * The instruction encoder, checked against a hand-computed byte layout.
 *
 * The important assertion here is {@link EXPECTED_HEX}: it is written out by hand
 * from the format rather than produced by this package's own encoder. A round-trip
 * test — `parse(build(args)) === args` — would pass for a self-consistent mistake,
 * and a self-consistent mistake is exactly what would misprice a swap on-chain
 * without any error appearing in TypeScript.
 */

import { describe, expect, it } from "vitest";
import {
  YIELD_BAND_FLIGHT_ARGS_BYTES,
  YIELD_BAND_FLIGHT_OPCODE,
  YIELD_BAND_FLIGHT_SIZE,
  argsLengthAt,
  buildYieldBandFlight,
  encodeYieldBandFlightArgs,
  isBandArmed,
  isYieldBandFlight,
  opcodeAt,
  parseYieldBandFlight,
  type YieldBandFlightArgs,
} from "../src/instructions/yieldBandFlight.js";

const AQUA = "0x1111113ccf1426a8e30e2bff5e005d929bf6a90a" as const;
const ZERO = "0x0000000000000000000000000000000000000000" as const;
const ONE_E18 = 10n ** 18n;

/**
 * Hand-computed from the wire format:
 *
 *   `b3`  opcode 0xb3
 *   `40`  args length, 64 as a single byte
 *   `000000000000000000000000` + the 20-byte address   (12 bytes of left padding)
 *   `0…0` (49 zeros) + `de0b6b3a7640000`               (1e18, a 15-hex-digit value)
 */
const EXPECTED_HEX =
  "0xb340" +
  "000000000000000000000000" +
  "1111113ccf1426a8e30e2bff5e005d929bf6a90a" +
  "0000000000000000000000000000000000000000000000000" +
  "de0b6b3a7640000";

const ARGS: YieldBandFlightArgs = { riskSource: AQUA, maxRateOut: ONE_E18 };

describe("the hand-computed fixture is self-consistent", () => {
  it("is the length the constants claim", () => {
    // Guards the fixture itself: if the literal were mistyped, this fails before the
    // parity assertion below can pass or fail for the wrong reason.
    expect(EXPECTED_HEX.length).toBe(2 + YIELD_BAND_FLIGHT_SIZE * 2);
    expect(YIELD_BAND_FLIGHT_SIZE).toBe(66);
    expect(YIELD_BAND_FLIGHT_ARGS_BYTES).toBe(64);
  });
});

describe("buildYieldBandFlight", () => {
  it("produces exactly the hand-computed bytes", () => {
    expect(buildYieldBandFlight(ARGS)).toBe(EXPECTED_HEX);
  });

  it("starts with the opcode byte then the args-length byte", () => {
    const program = buildYieldBandFlight(ARGS);
    expect(opcodeAt(program)).toBe(YIELD_BAND_FLIGHT_OPCODE);
    expect(YIELD_BAND_FLIGHT_OPCODE).toBe(0xb3);
    expect(argsLengthAt(program)).toBe(64);
  });

  it("puts the address before the band, matching the Solidity struct order", () => {
    // The subtle bug this catches: swapping the two fields would still encode to 64
    // bytes, still round-trip through this package, and still decode on-chain — as the
    // wrong numbers. Only a layout assertion sees it.
    const encoded = encodeYieldBandFlightArgs(ARGS);
    expect(encoded.slice(2, 66)).toBe(`000000000000000000000000${AQUA.slice(2)}`);
    expect(encoded.slice(66)).toBe(`0000000000000000000000000000000000000000000000000de0b6b3a7640000`);
  });

  it("encodes the zero address as an all-zero word", () => {
    const program = buildYieldBandFlight({ riskSource: ZERO, maxRateOut: 0n });
    expect(program).toBe(`0xb340${"0".repeat(128)}`);
    expect(program.length).toBe(2 + YIELD_BAND_FLIGHT_SIZE * 2);
  });
});

describe("parseYieldBandFlight", () => {
  it("round-trips the args", () => {
    expect(parseYieldBandFlight(buildYieldBandFlight(ARGS))).toEqual(ARGS);
  });

  it("round-trips a large band without truncation", () => {
    // uint256 is why the band is a bigint here rather than a number: a band above
    // 2^53 would silently lose precision, and 1e18 already sits near that boundary.
    const huge = 2n ** 200n;
    expect(parseYieldBandFlight(buildYieldBandFlight({ riskSource: AQUA, maxRateOut: huge })).maxRateOut).toBe(huge);
  });
});

describe("dispatch helpers", () => {
  it("recognises its own instruction", () => {
    expect(isYieldBandFlight(buildYieldBandFlight(ARGS))).toBe(true);
  });

  it("does not claim a foreign opcode", () => {
    // 0x50 is XYCSwap — the instruction immediately before ours in a flight program.
    expect(isYieldBandFlight("0x5001aa" as `0x${string}`)).toBe(false);
    expect(opcodeAt("0x5001aa" as `0x${string}`)).toBe(0x50);
  });
});

describe("isBandArmed", () => {
  it("is armed with no source and a band, because the compiled band is the policy", () => {
    expect(isBandArmed({ riskSource: ZERO, maxRateOut: ONE_E18 })).toBe(true);
  });

  it("is inert with no source and no band", () => {
    expect(isBandArmed({ riskSource: ZERO, maxRateOut: 0n })).toBe(false);
  });

  it("prefers the source's band when the source reports one", () => {
    expect(isBandArmed({ riskSource: AQUA, maxRateOut: 0n }, ONE_E18)).toBe(true);
  });

  it("falls back to the compiled band when the source reports none", () => {
    // Zero from the source means "no opinion", so the compiled band still applies —
    // mirroring the Solidity `_resolveBand` precedence exactly.
    expect(isBandArmed({ riskSource: AQUA, maxRateOut: ONE_E18 }, 0n)).toBe(true);
  });

  it("is inert when neither has an opinion", () => {
    expect(isBandArmed({ riskSource: AQUA, maxRateOut: 0n }, 0n)).toBe(false);
  });
});
