# The PositionManager, as deployed

This records what the **deployed** Optimism PositionManager actually exposes, because the encoding must
match the chain rather than a docs page — and because the first attempt at this got it wrong.

Evidence: [`../abi/PositionManager.optimism.json`](../abi/PositionManager.optimism.json), the verified
ABI of `0x3c3ea4b57a46241e54610e5f022e5c45859a1017`, observed at block **156841273**, compiler 0.8.26.

## What is deployed

| Function | Present | Note |
|---|---|---|
| `modifyLiquidities(bytes,uint256)` | **yes** | The real entry point — an encoded batch of actions |
| `modifyLiquiditiesWithoutUnlock(bytes,uint256)` | **yes** | In the ABI |
| `initializePool(...)`, `multicall(bytes[])` | yes | |
| `mint(...)` | **no** | Does not exist on this deployment, in any revision |
| `modifyLiquidity(...)` — singular | **no** | Also absent |

So the modern v4 periphery is **actions-based**: a caller passes `unlockData = abi.encode(actions,
params[])` to `modifyLiquidities`, where `actions` is a `bytes` of one-byte command codes
(`MINT_POSITION`, `SETTLE_PAIR`, …). There is no standalone `mint` to encode, and no singular
`modifyLiquidity`.

## Correction to an earlier claim

`packages/uniswap/src/v4/position.ts` encodes
`modifyLiquidity((PoolKey),(int24,int24,int256,bytes32),bytes)` and has 11 passing tests. That
signature is **not exposed by this deployment** — it belongs to a different v4-periphery revision. The
tests verify that the bytes are a faithful encoding of *that signature*, which is true and also beside
the point: a correctly-encoded call to a function that does not exist still reverts.

It is left in place rather than deleted because it is a correct encoder for a real historical
signature, and the tests remain valid for it — but it must not be used against the OP deployment, and
the module says so.

## Two techniques, one of which misled me

**Sourcify v2 works and is keyless:**

```bash
curl -sL "https://sourcify.dev/server/v2/contract/10/0x3c3ea4b57a46241e54610e5f022e5c45859a1017?fields=abi"
```

`cast interface` does **not** work here — it requires an Etherscan API key, and the failure is
`Invalid API Key` with no fallback.

**Scanning the runtime bytecode for a selector is unreliable.** I built this and it produced two wrong
answers before I noticed:

- it reported `modifyLiquidity(...)` as present, which the ABI contradicts;
- it reported `modifyLiquiditiesWithoutUnlock(...)` as absent, though the ABI lists it.

The tell was the second one: a technique that reports a function the ABI lists as missing cannot be
trusted when it reports one the ABI omits as present. Its true positive rate is not good enough to
distinguish a real function from a coincidental 4-byte sequence in 24 KB of bytecode.

There was also a plain bug worth recording since it cost a cycle: `cast sig` prints the selector
`0x`-prefixed, and searching for `"0xf50b870f"` inside lowercase hex that contains no `0x` **inside it**
can never match. Two rounds were spent "proving" that Aqua's own `ship` was absent — which it obviously
is not. Validating a technique against a case whose answer you already know is what caught it.

## What remains, and why it is not guessed

The missing piece is the **action command bytes** from v4-periphery's `Actions.sol`
(`MINT_POSITION`, `SETTLE_PAIR`, `BURN_POSITION`, …). They could not be retrieved in this session:
every GitHub raw path tried returned empty, and the code-search API requires authentication.

A command byte is a number that cannot be derived, verified, or reasonableness-checked — the encoding
either names the action the contract expects or it names a different one, and a wrong byte reverts or,
worse, executes the neighbouring command. That is precisely the value not to guess, so the outer
encoding is left as the next step rather than half-built.
