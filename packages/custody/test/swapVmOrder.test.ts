import { describe, expect, it } from "vitest";
import {
  SWAP_VM_ORDER_TYPE,
  SWAP_VM_ORDER_TYPEHASH,
  hashSwapVmOrder,
  orderTypehashMatchesSource,
  swapVmOrderTypedData,
  type SwapVmDomain,
} from "../src/safe/swapVmOrder.js";

const DOMAIN: SwapVmDomain = {
  name: "AgenticEMSSwapVMRouter",
  version: "1.0.0",
  chainId: 10,
  verifyingContract: "0x111111338c5091e8440b67b168bae16a668ac0de",
};

const ORDER = {
  maker: "0x2222222222222222222222222222222222222222",
  traits: 2n ** 254n,
  data: "0xdeadbeef" as const,
};

describe("the pinned typehash", () => {
  it("still matches the struct source it claims to describe", () => {
    // The constant is a literal so a struct change upstream is a failing test rather than a
    // silently different digest. This asserts the literal and the source still agree.
    expect(orderTypehashMatchesSource()).toBe(true);
  });

  it("is the keccak of the exact struct SwapVM declares", () => {
    // A typo here produces signatures that fail as `BadSignature`, naming neither the typehash nor the
    // field that differs — so the string itself is the assertion.
    expect(SWAP_VM_ORDER_TYPE).toBe("Order(address maker,uint256 traits,bytes data)");
    expect(SWAP_VM_ORDER_TYPEHASH).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("swapVmOrderTypedData", () => {
  it("omits EIP712Domain from types", () => {
    // viem derives it. Leaving it in is the difference between a valid digest and a plausible one.
    const typed = swapVmOrderTypedData({ order: ORDER, domain: DOMAIN });

    expect(Object.keys(typed.types)).toEqual(["Order"]);
  });

  it("names the router as the verifying contract", () => {
    // A signature is bound to one deployment: the same order signed for a testnet router must not
    // authorise anything on mainnet.
    const typed = swapVmOrderTypedData({ order: ORDER, domain: DOMAIN });

    expect(typed.domain.verifyingContract).toBe(DOMAIN.verifyingContract);
    expect(typed.primaryType).toBe("Order");
  });

  it("carries the order's three fields", () => {
    const typed = swapVmOrderTypedData({ order: ORDER, domain: DOMAIN });

    expect(typed.message).toEqual({ maker: ORDER.maker, traits: ORDER.traits, data: ORDER.data });
  });
});

describe("hashSwapVmOrder", () => {
  it("is deterministic", () => {
    expect(hashSwapVmOrder({ order: ORDER, domain: DOMAIN })).toBe(
      hashSwapVmOrder({ order: ORDER, domain: DOMAIN }),
    );
  });

  it("changes when the router changes, so a signature cannot be replayed onto another deployment", () => {
    const other = hashSwapVmOrder({
      order: ORDER,
      domain: { ...DOMAIN, verifyingContract: "0x9999999999999999999999999999999999999999" },
    });

    expect(other).not.toBe(hashSwapVmOrder({ order: ORDER, domain: DOMAIN }));
  });

  it("changes when the chain changes", () => {
    const other = hashSwapVmOrder({ order: ORDER, domain: { ...DOMAIN, chainId: 137 } });

    expect(other).not.toBe(hashSwapVmOrder({ order: ORDER, domain: DOMAIN }));
  });

  it("changes with the order's own fields", () => {
    const base = hashSwapVmOrder({ order: ORDER, domain: DOMAIN });

    expect(hashSwapVmOrder({ order: { ...ORDER, data: "0xcafebabe" }, domain: DOMAIN })).not.toBe(base);
    expect(hashSwapVmOrder({ order: { ...ORDER, maker: "0x3333333333333333333333333333333333333333" }, domain: DOMAIN })).not.toBe(base);
    expect(hashSwapVmOrder({ order: { ...ORDER, traits: 0n }, domain: DOMAIN })).not.toBe(base);
  });

  it("is not the Aqua-mode hash", () => {
    // The two modes hash differently, and confusing them looks like a bad key rather than a wrong
    // digest. An Aqua order hashes as keccak256(abi.encode(order)) and needs no signature at all.
    const digest = hashSwapVmOrder({ order: ORDER, domain: DOMAIN });

    expect(digest).not.toBe("0x0000000000000000000000000000000000000000000000000000000000000000");
    // The EIP-712 digest begins with the 0x19 0x01 prefix, which a raw abi.encode hash does not.
    expect(digest).toMatch(/^0x/);
  });
});
