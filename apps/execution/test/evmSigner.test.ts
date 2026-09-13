import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";
import { recoverMessageAddress, recoverTypedDataAddress } from "viem";
import { privateKeyEvmSigner, type EvmSigner } from "../src/evmSigner.js";

const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;

/**
 * Deliberately shaped like a Polymarket order payload — V2 domain, one field.
 * The point is not the field set but that whatever payload a protocol assembles
 * is what gets signed, so recovery is the assertion rather than a schema match.
 */
const PAYLOAD = {
  domain: {
    name: "Polymarket CTF Exchange",
    version: "2",
    chainId: 137,
    verifyingContract: "0xE111180000d2663C0091e4f400237545B87B996B" as const,
  },
  types: { Order: [{ name: "salt", type: "uint256" }] },
  // `as const` keeps the literal. viem infers `primaryType` from `types` and
  // rejects a widened `string`, which is the type system catching a payload that
  // disagrees with its own field definitions.
  primaryType: "Order" as const,
  message: { salt: 1n },
};

function signer(): EvmSigner {
  // No transport is exercised in these tests: nothing here reaches the network,
  // because every operation is a local signature.
  return privateKeyEvmSigner({
    privateKey: KEY,
    chain: polygon,
    rpcUrl: "https://polygon-rpc.com",
  });
}

describe("privateKeyEvmSigner", () => {
  it("reports the derived address", async () => {
    expect(await signer().getAddress()).toBe(privateKeyToAccount(KEY).address);
  });

  it("signs typed data that recovers to the signer", async () => {
    // Recovery is the assertion that matters. A wrong domain or a reordered
    // field set recovers to a *different* address rather than throwing, so a
    // passing signature call is not evidence that the payload was right.
    const signature = await signer().signTypedData(PAYLOAD);
    expect(await recoverTypedDataAddress({ ...PAYLOAD, signature })).toBe(
      privateKeyToAccount(KEY).address,
    );
  });

  it("signs a plain message that recovers to the signer", async () => {
    // Polymarket's L1 credential derivation signs a message, not typed data —
    // which is why `signMessage` is part of the contract at all.
    const signature = await signer().signMessage("0x1234");
    expect(
      await recoverMessageAddress({ message: { raw: "0x1234" }, signature }),
    ).toBe(privateKeyToAccount(KEY).address);
  });

  it("exposes exactly the four methods a protocol client expects", () => {
    // Structural conformance is the reason this shape is declared locally: a
    // missing method should fail here rather than at the protocol's first call.
    expect(Object.keys(signer()).sort()).toEqual([
      "getAddress",
      "sendTransaction",
      "signMessage",
      "signTypedData",
    ]);
  });
});
