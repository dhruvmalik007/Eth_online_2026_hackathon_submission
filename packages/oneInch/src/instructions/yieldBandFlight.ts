/**
 * The TypeScript half of the `YieldBandFlight` instruction.
 *
 * ## Why this file must be byte-exact
 *
 * A SwapVM program is opaque bytecode. Nothing validates its shape at the boundary:
 * if this encoder wrote the args-length byte one off, the router would read the
 * wrong number of bytes, the args would decode as garbage, and the failure would
 * surface as a wrong price or a decode revert deep inside a swap — not as an error
 * here. So the layout is asserted against a hand-computed literal in
 * `test/instructions.test.ts` rather than only round-tripped against itself, which
 * would pass for any self-consistent mistake.
 *
 * ## The wire format
 *
 * ```
 * [opcode: 1 byte = 0xb3][argsLength: 1 byte = 0x40][args: 64 bytes]
 * ```
 *
 * `ContextLib.runLoop` reads exactly those two header bytes with `shr(248, word)`
 * and `shr(240, word) & 0xff`, and an instruction must report its own length
 * because that is how the program counter advances. The payload is plain
 * `abi.encode` of {@link YieldBandFlightArgs}, matching the Solidity library's
 * `abi.encode(args)` over the same struct field order.
 *
 * ## Solidity is the source of truth
 *
 * The struct below mirrors `YieldBandFlight.Args` field for field, in order. If the
 * Solidity struct changes, this file and the literal in the test must change with
 * it — which is the point of pinning the bytes: the mismatch becomes a failing
 * assertion instead of a mispriced swap.
 */

import { decodeAbiParameters, encodeAbiParameters, type Hex } from "viem";
import type { Address } from "../chains/address.js";

/**
 * The opcode this package adds.
 *
 * `0xb3` is the next free slot in SwapVM's **rates-tuning** family bank
 * (`0xb0-0xcf`), whose occupied slots are `0xb0 RequireMinRate`, `0xb1
 * AdjustMinRate`, `0xb2 OraclePriceAdjuster` and `0xb4 BaseFeeAdjuster`. The
 * reserved bank (`0xf0-0xff`) is deliberately avoided — upstream holds it for a
 * possible two-byte escape prefix.
 *
 * Only `AgenticEMSSwapVMRouter` dispatches it. On the canonical router a program
 * using it reverts `UnknownOpcode(0xb3)`, which is the failure we want: a guard a
 * taker could sidestep by pointing at a different router would be worth nothing.
 */
export const YIELD_BAND_FLIGHT_OPCODE = 0xb3 as const;

/** The two-byte header: opcode plus args length. */
export const YIELD_BAND_FLIGHT_HEADER_BYTES = 2 as const;

/** `abi.encode(address, uint256)` — two 32-byte words. */
export const YIELD_BAND_FLIGHT_ARGS_BYTES = 64 as const;

/** Total program bytes this instruction contributes. */
export const YIELD_BAND_FLIGHT_SIZE = YIELD_BAND_FLIGHT_HEADER_BYTES + YIELD_BAND_FLIGHT_ARGS_BYTES;

/**
 * Compiled configuration, mirroring `YieldBandFlight.Args`.
 *
 * `riskSource` of the zero address means "always apply the band" — the mode for a
 * strategy with a fixed policy and no agent in the loop. `maxRateOut` is the
 * fallback band, used when the source has no opinion; zero means no band, which
 * makes the instruction a no-op rather than an unenforceable constraint.
 */
export interface YieldBandFlightArgs {
  readonly riskSource: Address;
  /** 1e18-scaled ceiling on `stableOut / volatileIn`. */
  readonly maxRateOut: bigint;
}

const ARGS_ABI = [
  { name: "riskSource", type: "address" },
  { name: "maxRateOut", type: "uint256" },
] as const;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

/**
 * Encode the args payload, without the header.
 *
 * Exposed separately because the payload is what a reader parsing a program needs,
 * and because keeping it independent of the header means the byte-order assertion
 * in the test can point at one of the two rather than at the whole blob.
 */
export function encodeYieldBandFlightArgs(args: YieldBandFlightArgs): Hex {
  return encodeAbiParameters(ARGS_ABI, [args.riskSource, args.maxRateOut]);
}

/**
 * Compile the instruction into program bytecode.
 *
 * @throws {Error} when the payload is not exactly
 *   {@link YIELD_BAND_FLIGHT_ARGS_BYTES}. A short or long payload would produce a
 *   program whose next instruction is read from the wrong offset, so this is a
 *   programming error worth failing on rather than a condition to tolerate.
 */
export function buildYieldBandFlight(args: YieldBandFlightArgs): Hex {
  const payload = encodeYieldBandFlightArgs(args);

  // `(payload.length - 2) / 2` because a hex string carries two characters per byte.
  const payloadBytes = (payload.length - 2) / 2;
  if (payloadBytes !== YIELD_BAND_FLIGHT_ARGS_BYTES) {
    throw new Error(
      `YieldBandFlight args encoded to ${payloadBytes} bytes, expected ${YIELD_BAND_FLIGHT_ARGS_BYTES}. ` +
        `The args-length header byte is a single byte, so a longer payload cannot be represented.`,
    );
  }

  const opcode = YIELD_BAND_FLIGHT_OPCODE.toString(16).padStart(2, "0");
  const argsLength = payloadBytes.toString(16).padStart(2, "0");
  return `0x${opcode}${argsLength}${payload.slice(2)}` as Hex;
}

/**
 * Decode args from a program slice that starts at this instruction's opcode.
 *
 * @throws {Error} when the slice is shorter than this instruction, which means the
 *   caller is reading from the wrong offset rather than that the args are unusual.
 */
export function parseYieldBandFlight(program: Hex): YieldBandFlightArgs {
  const body = program.slice(2);
  const argsLength = Number.parseInt(body.slice(2, 4), 16);
  const payload = `0x${body.slice(4, 4 + argsLength * 2)}` as Hex;

  const [riskSource, maxRateOut] = decodeAbiParameters(ARGS_ABI, payload);
  // Lower-cased on purpose. viem decodes an `address` to its checksummed form, while
  // the chain registry stores lower-case, and comparing the two without normalising
  // is the classic "these are the same address and yet they are not equal" bug.
  return { riskSource: (riskSource as string).toLowerCase() as Address, maxRateOut };
}

/** The opcode byte of a program slice, so a decoder can dispatch before parsing. */
export function opcodeAt(program: Hex, byteOffset = 0): number {
  const body = program.slice(2);
  return Number.parseInt(body.slice(byteOffset * 2, byteOffset * 2 + 2), 16);
}

/** The args length declared at a program slice's header. */
export function argsLengthAt(program: Hex, byteOffset = 0): number {
  const body = program.slice(2);
  return Number.parseInt(body.slice(byteOffset * 2 + 2, byteOffset * 2 + 4), 16);
}

/** Whether a slice begins with our instruction. */
export function isYieldBandFlight(program: Hex, byteOffset = 0): boolean {
  return opcodeAt(program, byteOffset) === YIELD_BAND_FLIGHT_OPCODE;
}

/**
 * True when the band will actually constrain something.
 *
 * A guard with no source and no band is inert, and a reader deserves to be told
 * that rather than infer it from two zero-checks. Mirrors the Solidity
 * `_resolveBand` precedence: the source's opinion first, the compiled fallback
 * otherwise, nothing when neither has one.
 *
 * @param args The compiled args.
 * @param sourceBand The band the source currently reports, if it was read.
 */
export function isBandArmed(args: YieldBandFlightArgs, sourceBand?: bigint): boolean {
  if (args.riskSource.toLowerCase() === ZERO_ADDRESS) return args.maxRateOut > 0n;
  return sourceBand === undefined ? args.maxRateOut > 0n : sourceBand > 0n || args.maxRateOut > 0n;
}
