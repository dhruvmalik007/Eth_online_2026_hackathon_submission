import { describe, expect, it } from "vitest";
import {
  InstructionTooLongError,
  OPCODES,
  buildProgram,
  instruction,
  readProgram,
  runsOnCanonicalRouter,
  salt,
  xycSwap,
} from "../src/programs/builder.js";
import { buildYieldBandFlight } from "../src/instructions/yieldBandFlight.js";

/**
 * The bytes `xycSwap ++ yieldBandFlight ++ salt(1)` assemble to.
 *
 * Hand-assembled rather than produced by the builder, and asserted by a Foundry test against a
 * Solidity-built program of the same instructions. Two implementations of one wire format can only be
 * checked against a third thing, or they will agree with each other's mistake.
 */
const FLIGHT_PROGRAM = (
  "0x5000" +
  "b340" +
  "0000000000000000000000001111113ccf1426a8e30e2bff5e005d929bf6a90a" +
  "00000000000000000000000000000000000000000000000000000000caa7e200" +
  "0208" +
  "0000000000000001"
) as `0x${string}`;

const FLIGHT_ARGS = {
  riskSource: "0x1111113ccf1426a8e30e2bff5e005d929bf6a90a" as const,
  maxRateOut: 3_400_000_000n,
};

describe("instruction", () => {
  it("frames an opcode with no arguments as a two-byte header", () => {
    expect(instruction(0x50)).toBe("0x5000");
  });

  it("writes the argument length in one byte", () => {
    expect(instruction(0x02, "0x0000000000000001")).toBe("0x02080000000000000001");
  });

  it("refuses arguments that do not fit the one-byte length field", () => {
    // Silently truncating the length would produce a program whose instruction boundaries are wrong
    // from that point on — a misread opcode rather than an error.
    expect(() => instruction(0x50, `0x${"00".repeat(256)}`)).toThrow(InstructionTooLongError);
  });
});

describe("the known instructions", () => {
  it("encodes XYCSwap with no arguments", () => {
    expect(xycSwap()).toBe("0x5000");
  });

  it("encodes Salt with its eight-byte value", () => {
    expect(salt("0x0000000000000001")).toBe("0x02080000000000000001");
  });

  it("places the clamp at the next free slot in the rates-tuning bank", () => {
    // 0xb0-0xcf is rates tuning, where a rate clamp belongs, and 0xb3 is the next free slot in it.
    expect(OPCODES.YieldBandFlight).toBe(0xb3);
  });
});

describe("buildProgram", () => {
  it("produces the bytes the Solidity libraries produce", () => {
    const program = buildProgram([xycSwap(), buildYieldBandFlight(FLIGHT_ARGS), salt("0x0000000000000001")]);

    expect(program).toBe(FLIGHT_PROGRAM);
  });

  it("is 78 bytes long, so the instruction boundaries land where both sides assume", () => {
    const program = buildProgram([xycSwap(), buildYieldBandFlight(FLIGHT_ARGS), salt("0x0000000000000001")]);

    expect((program.length - 2) / 2).toBe(78);
  });

  it("preserves the order given, because order is the only structure a program has", () => {
    const first = buildProgram([xycSwap(), salt("0x0000000000000001")]);
    const second = buildProgram([salt("0x0000000000000001"), xycSwap()]);

    expect(first).not.toBe(second);
    expect(readProgram(first)[0]?.label).toBe("XYCSwap");
    expect(readProgram(second)[0]?.label).toBe("Salt");
  });

  it("refuses an empty program rather than shipping one that executes nothing", () => {
    expect(() => buildProgram([])).toThrow(/at least one instruction/);
  });
});

describe("readProgram", () => {
  it("walks a program into its instructions", () => {
    const decoded = readProgram(FLIGHT_PROGRAM);

    expect(decoded.map((entry) => entry.label)).toEqual(["XYCSwap", "YieldBandFlight", "Salt"]);
  });

  it("reports byte offsets, so an instruction can be pointed at", () => {
    const decoded = readProgram(FLIGHT_PROGRAM);

    // XYCSwap is two bytes; the clamp's header starts at offset 2 and its args at 4.
    expect(decoded.map((entry) => entry.offset)).toEqual([0, 2, 68]);
  });

  it("carries each instruction's arguments", () => {
    const decoded = readProgram(FLIGHT_PROGRAM);

    expect(decoded[0]?.args).toBe("0x");
    expect(decoded[1]?.args).toHaveLength(2 + 128);
    expect(decoded[2]?.args).toBe("0x0000000000000001");
  });

  it("labels an opcode it does not know rather than refusing to show the program", () => {
    // A disassembler that throws on an unrecognised instruction is useless exactly when someone most
    // needs to read a strategy: one they did not write.
    const decoded = readProgram("0x9900" as `0x${string}`);

    expect(decoded[0]?.label).toBe("unknown");
    expect(decoded[0]?.opcode).toBe(0x99);
  });

  it("names a truncated program rather than reading past the end", () => {
    expect(() => readProgram("0x5000b3" as `0x${string}`)).toThrow(/Truncated program/);
  });

  it("names an instruction that declares more arguments than remain", () => {
    expect(() => readProgram("0x50ff00" as `0x${string}`)).toThrow(/declares 255 bytes/);
  });
});

describe("runsOnCanonicalRouter", () => {
  it("is false for a program containing our opcode", () => {
    // The canonical router reverts `UnknownOpcode(0xb3)`, so a strategy using the clamp needs our
    // deployment — worth knowing before a caller ships it.
    expect(runsOnCanonicalRouter(FLIGHT_PROGRAM)).toBe(false);
  });

  it("is true for a program that stays inside the Aqua subset", () => {
    expect(runsOnCanonicalRouter(buildProgram([xycSwap(), salt("0x0000000000000001")]))).toBe(true);
  });
});
