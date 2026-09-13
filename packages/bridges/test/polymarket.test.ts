/**
 * Polymarket CLOB V2 order payload.
 *
 * The load-bearing test is the last one: sign the payload with a private key and
 * **recover the signer from the digest**. That is the check the migration guide
 * recommends, and it's the only one that proves the domain, the type order and
 * the field set are all consistent — a wrong field order produces a
 * well-formed digest that recovers to a *different address*, which is exactly
 * how these fail in production.
 */
import { privateKeyToAccount } from "viem/accounts";
import { recoverTypedDataAddress } from "viem";
import { describe, expect, it } from "vitest";
import { CLOB_V2_EXCHANGE, clobOrderTypedData, clobOrderWireBody } from "../src/polymarket.js";

const ACCOUNT = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);

const ORDER = {
  maker: ACCOUNT.address,
  signer: ACCOUNT.address,
  tokenId: "102936080997962328012925831936956392563266397182457979594940741005412243916222",
  makerAmount: "1000000",
  takerAmount: "2000000",
  side: "BUY" as const,
  signatureType: 0 as const,
  timestampMs: 1713398400000,
};

describe("the V2 domain", () => {
  it("uses version 2 and the V2 exchange", () => {
    // The guide is unambiguous: domain version "1" → "2", and a moved
    // verifyingContract. A version-1 domain signs fine and verifies nowhere.
    const { domain } = clobOrderTypedData(ORDER, 137);
    expect(domain.version).toBe("2");
    expect(domain.verifyingContract).toBe(CLOB_V2_EXCHANGE.standard);
    expect(domain.chainId).toBe(137);
  });

  it("switches contract for a neg-risk market", () => {
    const { domain } = clobOrderTypedData({ ...ORDER, negRisk: true }, 137);
    expect(domain.verifyingContract).toBe(CLOB_V2_EXCHANGE.negRisk);
  });
});

describe("the signed struct", () => {
  it("KEEPS taker, nonce and feeRateBps even though the SDK input drops them", () => {
    // The trap in the migration guide: its summary says V2 "drops" these, and the
    // SDK's UserOrderV2 does — but the exchange contract still hashes them. The
    // signed payload keeps them zeroed, or every signature fails to verify.
    const { message } = clobOrderTypedData(ORDER, 137);
    expect(message.taker).toBe("0x0000000000000000000000000000000000000000");
    expect(message.nonce).toBe(0n);
    expect(message.feeRateBps).toBe(0n);
  });

  it("adds timestamp, metadata and builder", () => {
    const { message } = clobOrderTypedData(ORDER, 137);
    expect(message.timestamp).toBe(1713398400000n);
    expect(message.metadata).toMatch(/^0x0{64}$/);
    expect(message.builder).toMatch(/^0x0{64}$/);
  });

  it("carries the builder code when supplied", () => {
    const code = `0x${"ab".repeat(32)}` as const;
    const { message } = clobOrderTypedData({ ...ORDER, builderCode: code }, 137);
    expect(message.builder).toBe(code);
  });

  it("keeps timestamp distinct from expiration", () => {
    // Both are "when", and conflating them yields an order that posts and never
    // fills. The timestamp is signed; expiration is a GTD wire concern.
    const { message } = clobOrderTypedData({ ...ORDER, expiration: "1714000000" }, 137);
    expect(message.timestamp).toBe(1713398400000n);
    expect(message.expiration).toBe(1714000000n);
  });

  it("lists the fields in the protocol's order, because order is hashed", () => {
    const names = clobOrderTypedData(ORDER, 137).types.Order.map((field) => field.name);
    expect(names).toEqual([
      "salt", "maker", "signer", "taker", "tokenId", "makerAmount", "takerAmount",
      "expiration", "nonce", "feeRateBps", "side", "signatureType", "timestamp",
      "metadata", "builder",
    ]);
  });
});

describe("the wire body differs from the signed payload", () => {
  it("encodes side as a string on the wire and a number when signing", () => {
    const { message } = clobOrderTypedData(ORDER, 137);
    expect(message.side).toBe(0);

    const body = clobOrderWireBody(ORDER, "0xsignature");
    expect(body.order['side']).toBe("BUY");
    expect(body.order['signature']).toBe("0xsignature");
  });
});

describe("input validation", () => {
  it("rejects a non-integer amount before it reaches a signature", () => {
    expect(() => clobOrderTypedData({ ...ORDER, makerAmount: "1.5" }, 137)).toThrow();
  });

  it("rejects a malformed builder code", () => {
    expect(() => clobOrderTypedData({ ...ORDER, builderCode: "0xabc" }, 137)).toThrow();
  });
});

describe("end-to-end: sign and recover", () => {
  it("recovers the signing account from the digest", async () => {
    // The guide's own advice — "recover the signer from the final typed-data
    // digest and compare all addresses byte-for-byte". A wrong field order or a
    // stale domain recovers to a different address rather than throwing, so this
    // is the assertion that actually protects the payload.
    const typedData = clobOrderTypedData(ORDER, 137);

    const signature = await ACCOUNT.signTypedData({
      domain: typedData.domain,
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
    });

    const recovered = await recoverTypedDataAddress({
      domain: typedData.domain,
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
      signature,
    });

    expect(recovered).toBe(ACCOUNT.address);
    expect(recovered).toBe(ORDER.signer);
    expect(signature).toMatch(/^0x[0-9a-f]{130}$/);
  });
});
