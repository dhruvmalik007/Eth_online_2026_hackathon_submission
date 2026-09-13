/**
 * SwapVM program assembly.
 *
 * A SwapVM program is a flat byte string: each instruction is a two-byte header followed by its
 * arguments.
 *
 * ```
 * [ opcode : 1 byte ][ argsLength : 1 byte ][ args : argsLength bytes ]
 * ```
 *
 * `SwapVM.runLoop` reads exactly that — `shr(248, word)` for the opcode, `and(shr(240, word), 0xff)`
 * for the length — and advances by `2 + argsLength`. Nothing frames the program, so **order is the
 * only structure it has**: an instruction appended after the curve sees the amounts the curve
 * produced, and one appended before it sees the amounts the taker supplied. That is why the flight
 * clamp goes *after* `XYCSwap` and not before it, and why the order is asserted in the tests rather
 * than left to a builder's convenience.
 *
 * ## What is encoded here, and what is not
 *
 * Only the instructions this package composes. `XYCSwap` and `Salt` are read off their own libraries
 * in `@1inch/swap-vm`; `YieldBandFlight` is ours. Everything else in the opcode table is deliberately
 * absent: an encoder for an instruction nobody composes is a guess that compiles, and a wrong
 * argument layout fails as an `UnknownOpcode` or, worse, as a valid instruction with misread
 * arguments — silently swapping the meaning of two registers.
 *
 * The opcode numbers are pinned against `OpcodeList.sol`'s comments, which reserve `0xf0-0xff` and
 * state that a family's free slots are taken in order. `0xb3` is the next free slot in the
 * rates-tuning bank (`0xb0-0xcf`), which is where a rate clamp belongs.
 */

export const OPCODES = {
  Stop: 0x00,
  Salt: 0x02,
  XYCSwap: 0x50,
  /** Ours. Valid only on `AgenticEMSSwapVMRouter`; the canonical router reverts `UnknownOpcode`. */
  YieldBandFlight: 0xb3,
} as const;

const LABELS: Record<number, string> = {
  0x00: "Stop",
  0x02: "Salt",
  0x50: "XYCSwap",
  0xb3: "YieldBandFlight",
};

/** A program, as `0x`-prefixed hex. */
export type Program = `0x${string}`;
/** Instruction arguments, as `0x`-prefixed hex. */
export type InstructionArgs = `0x${string}`;

/** Instructions may not exceed one byte of argument length. */
export class InstructionTooLongError extends Error {
  constructor(readonly opcode: number, readonly length: number) {
    super(`Instruction 0x${opcode.toString(16)} has ${length} bytes of arguments; the header allows 255.`);
    this.name = "InstructionTooLongError";
  }
}

/** An opcode this package cannot decode. */
export class UnknownOpcodeError extends Error {
  constructor(readonly opcode: number, readonly offset: number) {
    super(
      `Opcode 0x${opcode.toString(16)} at offset ${offset} is not one this package composes. ` +
        `A program containing it can only be read by whoever wrote it.`,
    );
    this.name = "UnknownOpcodeError";
  }
}

/** Frame one instruction: `[opcode][argsLength][args]`. */
export function instruction(opcode: number, args: InstructionArgs = "0x"): Program {
  const payload = args.slice(2);
  const length = payload.length / 2;
  if (length > 255) throw new InstructionTooLongError(opcode, length);

  const header =
    opcode.toString(16).padStart(2, "0") + length.toString(16).padStart(2, "0");
  return `0x${header}${payload}` as Program;
}

/**
 * `XYCSwap` — the constant-product curve, carrying no arguments.
 *
 * The deployed Aqua router supports it, so a program built here runs unchanged on the canonical
 * router as long as it contains no `YieldBandFlight`.
 */
export function xycSwap(): Program {
  return instruction(OPCODES.XYCSwap);
}

/**
 * `Salt` — the unique per-strategy value.
 *
 * Included in every program because the strategy hash is derived from the order, which contains the
 * program: two strategies with identical instructions but no salt would hash the same and share a
 * balance. The tests use a fixed salt so the bytes are reproducible.
 */
export function salt(value: InstructionArgs): Program {
  return instruction(OPCODES.Salt, value);
}

/**
 * Concatenate instructions into a program.
 *
 * The order given is the order executed, which is why this takes a list rather than composing
 * internally — the caller's ordering decision is the security-relevant one.
 */
export function buildProgram(instructions: readonly Program[]): Program {
  if (instructions.length === 0) {
    throw new Error("A program must contain at least one instruction; an empty program executes nothing.");
  }
  return `0x${instructions.map((piece) => piece.slice(2)).join("")}` as Program;
}

export interface DecodedInstruction {
  readonly offset: number;
  readonly opcode: number;
  /** The instruction's name, or `unknown` — an unlabelled opcode still decodes, it just has no name. */
  readonly label: string;
  readonly args: InstructionArgs;
}

/**
 * Walk a program into its instructions.
 *
 * Used by the tests, which assert the order — that the clamp follows the curve — and by anyone
 * reading a strategy before shipping it. An unrecognised opcode decodes with `label: "unknown"`
 * rather than throwing, because a disassembler that refuses to show you the program is useless
 * exactly when you most need it.
 */
export function readProgram(program: Program): DecodedInstruction[] {
  const body = program.slice(2);
  const out: DecodedInstruction[] = [];
  let cursor = 0;

  while (cursor < body.length) {
    if (cursor + 4 > body.length) {
      throw new Error(
        `Truncated program: ${(body.length - cursor) / 2} bytes remain at offset ${cursor / 2}, ` +
          `fewer than the two-byte header needs.`,
      );
    }
    const opcode = Number.parseInt(body.slice(cursor, cursor + 2), 16);
    const length = Number.parseInt(body.slice(cursor + 2, cursor + 4), 16);
    const argsStart = cursor + 4;
    const argsEnd = argsStart + length * 2;

    if (argsEnd > body.length) {
      throw new Error(
        `Truncated instruction 0x${opcode.toString(16)}: declares ${length} bytes of arguments but ` +
          `only ${(body.length - argsStart) / 2} remain.`,
      );
    }

    out.push({
      offset: cursor / 2,
      opcode,
      label: LABELS[opcode] ?? "unknown",
      args: `0x${body.slice(argsStart, argsEnd)}` as InstructionArgs,
    });
    cursor = argsEnd;
  }

  return out;
}

/** Whether a program can run on the canonical router, which supports only the Aqua opcode subset. */
export function runsOnCanonicalRouter(program: Program): boolean {
  return readProgram(program).every((entry) => entry.opcode !== OPCODES.YieldBandFlight);
}
