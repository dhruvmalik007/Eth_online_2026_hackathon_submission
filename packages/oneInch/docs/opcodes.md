# Opcodes and the program wire format

## The wire format

A SwapVM program is a flat byte string. Every instruction is a two-byte header followed by its
arguments:

```
[ opcode : 1 byte ][ argsLength : 1 byte ][ args : argsLength bytes ]
```

`SwapVM.runLoop` reads exactly that — `shr(248, word)` for the opcode, `and(shr(240, word), 0xff)` for
the length — and advances by `2 + argsLength`. There is no framing, no length prefix for the program
as a whole, and no terminator. **The program ends when the bytes do.**

That has one consequence worth stating plainly: **order is the only structure a program has.** An
instruction appended after `XYCSwap` sees the amounts the curve produced; one appended before it sees
the amounts the taker supplied. Nothing else distinguishes the two.

## The opcode table

`OpcodeList.sol` banks the space by purpose. `0xf0-0xff` is reserved and nothing may be allocated
there; each family's free slots are taken in order.

| Bank | Purpose | Status |
|---|---|---|
| `0x00-0x0f` | Core control flow (`Stop` 00, `Salt` 02) | in use |
| `0x10-0x1f` | Curve composition | in use |
| `0x20-0x3f` | Conditions and guards | in use |
| `0x40-0x4f` | Invalidators | in use |
| `0x50-0x6f` | Swap curves (`XYCSwap` 50) | in use |
| `0x70-0x8f` | Fees | in use |
| `0x90-0xaf` | Balances tuning | in use |
| `0xb0-0xcf` | **Rates tuning** | `0xb0-b2`, `0xb4` used |
| `0xd0-0xef` | Unallocated | free |
| `0xf0-0xff` | **Reserved** | never allocate |

## Ours: `YieldBandFlight` at `0xb3`

`0xb3` is the next free slot in the **rates-tuning** bank, which is where a rate clamp belongs. The
higher banks (`0xd0-0xef`) were left alone deliberately — taking a slot there would work, but it would
put a rate constraint in a bank that means something else.

### What it does

While the risk signal says *flight*, it clamps the rate the taker receives to a band:

| Direction | Clamp | Rounding |
|---|---|---|
| `isExactIn` | `amountOut = min(amountOut, amountIn × band / 1e18)` | floor (`mulDiv`), favours the maker |
| `isExactOut` | `amountIn = max(amountIn, ceil(amountOut × 1e18 / band))` | ceil, favours the maker |

Both round toward the maker, matching the convention the rest of SwapVM follows.

### Arguments

`abi.encode(address riskSource, uint256 maxRateOut)` — 64 bytes, so `argsLength` is `0x40` and the
whole instruction is 66 bytes.

| Field | Meaning |
|---|---|
| `riskSource` | The `IRiskSignalSource` to consult. `address(0)` means apply the band unconditionally, which is the mode a test uses. |
| `maxRateOut` | The band: most `tokenOut` per `tokenIn`, 1e18-scaled. A source that returns non-zero overrides it, so the band can be tightened without re-shipping the strategy. |

A zero band is a no-op rather than a revert. A misconfigured band should not brick a strategy that
would otherwise trade normally — and an order that silently stops working is worse than one that
trades at the curve price, because the first looks like an outage and the second looks like a choice.

### Why it can be trusted to be ours

The claim is **not** "0xb3 is unused". It is that our router executes it and the canonical router
refuses it:

```
AgenticEMSSwapVMRouter   → program containing 0xb3 executes
AquaSwapVMRouter         → same program reverts UnknownOpcode(0xb3)
```

Both are asserted in `test/router/OpcodeOwnership.t.sol`. The second matters more than the first: on
any router we did not deploy, an unknown opcode fails loudly rather than being silently interpreted as
whatever happens to occupy that slot.

### Where it goes in a program

```
XYCSwap → YieldBandFlight → Salt
```

The clamp **must** follow the curve. Placed before it, the clamp reads the taker's amounts rather than
the curve's and bounds the input instead of the output — a program that runs and is wrong.
`ProgramBuilderParity.t.sol` asserts the order.

## Testing the boundary

Two implementations of one wire format is the situation where a mutual misunderstanding survives every
test on both sides, because each agrees with the other's mistake. So both ends are asserted against a
**hand-assembled literal**, produced by hand rather than by either:

- `packages/oneInch/src/programs/builder.ts` assembles the bytes in TypeScript.
- `XYCSwap.build() ++ YieldBandFlight.build(...) ++ Salt.build(1)` assembles them in Solidity.
- `ProgramBuilderParity.t.sol` and `test/programBuilder.test.ts` each assert the same hex.

The literal for `xycSwap ++ yieldBandFlight(riskSource=0x1111…a90a, maxRateOut=3_400_000_000) ++ salt(1)`
is 78 bytes:

```
0x
5000                                                              ← XYCSwap, no arguments
b340                                                              ← YieldBandFlight, 64-byte args
0000000000000000000000001111113ccf1426a8e30e2bff5e005d929bf6a90a  ← riskSource
00000000000000000000000000000000000000000000000000000000caa7e200  ← maxRateOut (3.4e9)
0208                                                              ← Salt, 8-byte args
0000000000000001                                                  ← the salt
```

`readProgram` in the same module disassembles a program into its instructions with offsets, so a
strategy can be read before it is shipped. An unrecognised opcode decodes with `label: "unknown"`
rather than throwing — a disassembler that refuses to show you the program is useless exactly when you
most need it: reading a strategy you did not write.
