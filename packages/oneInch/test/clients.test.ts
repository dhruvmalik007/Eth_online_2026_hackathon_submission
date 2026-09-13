import { describe, expect, it } from "vitest";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, keccak256, toHex } from "viem";
import {
  AQUA_ABI,
  decodeAquaLogs,
  dockCalldata,
  pullCalldata,
  pushCalldata,
  shipCalldata,
  strategyHash,
} from "../src/aqua/AquaClient.js";
import {
  SWAPPED_EVENT_ABI,
  decodeSwappedLogs,
  quoteMatchesFill,
} from "../src/swapvm/SwapVmClient.js";

const AQUA = "0x1111113ccf1426a8e30e2bff5e005d929bf6a90a" as const;
const APP = "0xf5a6e0e0f5a6e0e0f5a6e0e0f5a6e0e0f5a6e0e0" as const;
const MAKER = "0x2222222222222222222222222222222222222222" as const;
const USDC = "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85" as const;
const WETH = "0x4200000000000000000000000000000000000006" as const;
const HASH = keccak256(toHex("strategy")) as `0x${string}`;

function decode(data: `0x${string}`) {
  return decodeFunctionData({ abi: AQUA_ABI, data });
}

/**
 * Compare an address the decoder returned against one this test wrote.
 *
 * viem returns checksummed addresses, so comparing against the lowercase literals below fails on case
 * alone — which reads like corruption rather than normalisation. Every address assertion goes through
 * here so the comparison is about the value.
 */
function addr(value: unknown): string {
  return String(value).toLowerCase();
}

describe("strategyHash", () => {
  it("is the keccak of the strategy bytes, which is what makes the encoding the identity", () => {
    const strategy = toHex("USDC/WETH 100/10") as `0x${string}`;

    expect(strategyHash(strategy)).toBe(keccak256(strategy));
  });

  it("differs when the same fields are encoded differently", () => {
    // Which is the point: a second caller encoding the same values in another order gets a different
    // hash, and therefore a different balance rather than a collision.
    expect(strategyHash(toHex("ab"))).not.toBe(strategyHash(toHex("ba")));
  });
});

describe("shipCalldata", () => {
  it("encodes the app as a parameter, because Aqua credits msg.sender as the maker", () => {
    const data = shipCalldata({
      aqua: AQUA,
      app: APP,
      strategy: "0xdeadbeef",
      tokens: [USDC, WETH],
      amounts: [1_000_000n, 2n ** 60n],
    });

    const decoded = decode(data);
    expect(decoded.functionName).toBe("ship");
    expect(addr(decoded.args[0])).toBe(APP);
    expect((decoded.args[2] as readonly string[]).map(addr)).toEqual([addr(USDC), addr(WETH)]);
  });

  it("refuses mismatched token and amount arrays, which on-chain would be an index error", () => {
    expect(() =>
      shipCalldata({ aqua: AQUA, app: APP, strategy: "0x", tokens: [USDC, WETH], amounts: [1_000_000n] }),
    ).toThrow(/one amount per token/);
  });
});

describe("dock, pull and push calldata", () => {
  it("encodes dock with the app as a parameter", () => {
    const decoded = decode(dockCalldata({ aqua: AQUA, app: APP, strategyHash: HASH, tokens: [USDC] }));

    expect(decoded.functionName).toBe("dock");
    expect(addr(decoded.args[0])).toBe(APP);
  });

  it("encodes pull without an app, because the app is msg.sender", () => {
    const decoded = decode(
      pullCalldata({ aqua: AQUA, maker: MAKER, strategyHash: HASH, token: USDC, amount: 5n, to: MAKER }),
    );

    expect(decoded.functionName).toBe("pull");
    // Four parameters after the strategy hash: token, amount, to — and no app among them.
    expect(decoded.args).toHaveLength(5);
    expect(decoded.args[3]).toBe(5n);
  });

  it("encodes push with the app, because the taker names whose balance to credit", () => {
    const decoded = decode(
      pushCalldata({ aqua: AQUA, maker: MAKER, app: APP, strategyHash: HASH, token: WETH, amount: 7n }),
    );

    expect(decoded.functionName).toBe("push");
    expect(addr(decoded.args[1])).toBe(APP);
  });
});

describe("decodeAquaLogs", () => {
  function shippedLog(aqua: string) {
    return {
      address: aqua,
      topics: encodeEventTopics({ abi: AQUA_ABI, eventName: "Shipped" }) as unknown as `0x${string}`[],
      data: encodeAbiParameters(
        [{ type: "address" }, { type: "address" }, { type: "bytes32" }, { type: "bytes" }],
        [MAKER, APP, HASH, "0xdeadbeef"],
      ) as `0x${string}`,
    };
  }

  it("decodes a Shipped event", () => {
    const events = decodeAquaLogs([shippedLog(AQUA)]);

    expect(events).toHaveLength(1);
    expect(events[0]?.name).toBe("Shipped");
    expect(addr(events[0]?.maker)).toBe(MAKER);
    expect(events[0]?.strategyHash).toBe(HASH);
  });

  it("skips logs that are not Aqua's, rather than throwing on the first ERC-20 transfer", () => {
    // A receipt mixes logs from every contract the transaction touched, so a decoder that assumed
    // every log was Aqua's would fail on every real transaction.
    const transfer = {
      address: USDC,
      topics: [keccak256(toHex("Transfer(address,address,uint256)"))] as `0x${string}`[],
      data: encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [MAKER, 1n]) as `0x${string}`,
    };

    const events = decodeAquaLogs([transfer, shippedLog(AQUA)]);

    expect(events).toHaveLength(1);
  });

  it("filters by address when one is given", () => {
    const events = decodeAquaLogs([shippedLog(APP)], AQUA);

    expect(events).toHaveLength(0);
  });

  it("carries token and amount on the balance-moving events", () => {
    const pulled = {
      address: AQUA,
      topics: encodeEventTopics({ abi: AQUA_ABI, eventName: "Pulled" }) as unknown as `0x${string}`[],
      data: encodeAbiParameters(
        [{ type: "address" }, { type: "address" }, { type: "bytes32" }, { type: "address" }, { type: "uint256" }],
        [MAKER, APP, HASH, USDC, 3_400_000_000n],
      ) as `0x${string}`,
    };

    const [event] = decodeAquaLogs([pulled]);

    expect(event?.name).toBe("Pulled");
    expect(event?.amount).toBe(3_400_000_000n);
  });
});

describe("decodeSwappedLogs", () => {
  const fill = {
    address: "0x111111338c5091e8440b67b168bae16a668ac0de",
    topics: encodeEventTopics({ abi: SWAPPED_EVENT_ABI, eventName: "Swapped" }) as unknown as `0x${string}`[],
    data: encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
      ],
      [HASH, MAKER, MAKER, WETH, USDC, 1_000_000_000_000_000_000n, 3_400_000_000n],
    ) as `0x${string}`,
  };

  it("decodes a fill with its amounts intact", () => {
    const [event] = decodeSwappedLogs([fill]);

    expect(event?.amountIn).toBe(1_000_000_000_000_000_000n);
    expect(event?.amountOut).toBe(3_400_000_000n);
    expect(addr(event?.tokenOut)).toBe(addr(USDC));
  });

  it("skips other logs", () => {
    const other = { address: USDC, topics: [HASH] as `0x${string}`[], data: "0x" as `0x${string}` };

    expect(decodeSwappedLogs([other])).toHaveLength(0);
  });

  it("filters by router when one is given", () => {
    expect(decodeSwappedLogs([fill], APP)).toHaveLength(0);
  });
});

describe("quoteMatchesFill", () => {
  const quoted = { amountIn: 1_000n, amountOut: 3_400n, orderHash: HASH };

  it("is true when both amounts agree", () => {
    expect(
      quoteMatchesFill(quoted, {
        orderHash: HASH,
        maker: MAKER,
        taker: MAKER,
        tokenIn: WETH,
        tokenOut: USDC,
        amountIn: 1_000n,
        amountOut: 3_400n,
      }),
    ).toBe(true);
  });

  it("is false when the output differs by one unit", () => {
    // The comparison is the approval's basis, so it is exported rather than left to each caller: two
    // callers implementing it separately is how one of them ends up comparing the wrong pair of fields.
    expect(
      quoteMatchesFill(quoted, {
        orderHash: HASH,
        maker: MAKER,
        taker: MAKER,
        tokenIn: WETH,
        tokenOut: USDC,
        amountIn: 1_000n,
        amountOut: 3_401n,
      }),
    ).toBe(false);
  });

  it("is false when the input differs, even if the output matches", () => {
    expect(
      quoteMatchesFill(quoted, {
        orderHash: HASH,
        maker: MAKER,
        taker: MAKER,
        tokenIn: WETH,
        tokenOut: USDC,
        amountIn: 1_001n,
        amountOut: 3_400n,
      }),
    ).toBe(false);
  });
});
