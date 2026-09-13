/**
 * The signing-intent envelope.
 *
 * These are the invariants that make an intent safe to approve: the digest must
 * describe exactly what is stored (or every legitimate intent fails its own
 * tamper check), and any change to the authorised payload must change the digest.
 */
import { describe, expect, it } from "vitest";
import { buildSigningIntent, verifySigningIntent } from "../src/intent/IntentBuilder.js";
import { canonicalJson, digestIntent, SigningIntentSchema } from "../src/intent/SigningIntent.js";
import type { Eip712TypedData } from "../src/eip712.js";
import { normalizeAuthorizationKey } from "../src/safe/PrivyWalletSigner.js";
import { redactSignerDetail } from "../src/safe/SafeTypedDataSigner.js";
import type { SafeLeg } from "../src/safe/SafeClient.js";

const SAFE = "0x1111111111111111111111111111111111111111" as const;
const RECIPIENT = "0x2222222222222222222222222222222222222222" as const;

const TYPED_DATA: Eip712TypedData = {
  domain: { chainId: 11155111, verifyingContract: SAFE },
  types: {
    SafeTx: [
      { name: "to", type: "address" },
      { name: "nonce", type: "uint256" },
    ],
  },
  primaryType: "SafeTx",
  message: { to: RECIPIENT, nonce: 7 },
};

function legs(): SafeLeg[] {
  return [{ to: RECIPIENT, value: "0", data: "0x", operation: 0 }];
}

function intent(overrides: Partial<Parameters<typeof buildSigningIntent>[0]> = {}) {
  return buildSigningIntent({
    intentId: "intent-1",
    requestId: "req-1",
    agentId: "v01",
    createdAt: "2026-09-12T10:00:00.000Z",
    chain: "eip155:11155111",
    chainId: 11155111,
    account: SAFE,
    kind: "v01-readjustment",
    signing: {
      scheme: "safe-typed-data",
      safeAddress: SAFE,
      safeTxHash: "0x" + "ab".repeat(32),
      safeNonce: 7,
      typedData: TYPED_DATA,
    },
    display: {
      title: "Rebalance",
      sentence: "Supply 1,000 USDC to Morpho on Base.",
      fields: [{ label: "Notional", value: "$1,000" }],
      warnings: [],
    },
    authorized: { legs: legs(), calldata: "0x6a761202deadbeef", nonce: 7 },
    ...overrides,
  });
}

describe("signing intent", () => {
  it("is deterministic: the same body yields the same digest", () => {
    expect(intent().digest).toBe(intent().digest);
  });

  it("verifies its own digest — the defaults applied at parse time are inside the hash", () => {
    const built = intent();
    expect(verifySigningIntent(built)).toBe(true);
  });

  it("changes the digest when a leg changes", () => {
    const altered = intent({
      authorized: {
        legs: [{ to: RECIPIENT, value: "1", data: "0x", operation: 0 }],
        calldata: "0x6a761202deadbeef",
        nonce: 7,
      },
    });
    expect(altered.digest).not.toBe(intent().digest);
  });

  it("changes the digest when the display sentence changes", () => {
    const altered = intent({
      display: {
        title: "Rebalance",
        sentence: "Send 1,000 USDC to an unknown address.",
        fields: [{ label: "Notional", value: "$1,000" }],
        warnings: [],
      },
    });
    expect(altered.digest).not.toBe(intent().digest);
  });

  it("detects tampering anywhere in the body", () => {
    const built = intent();
    expect(verifySigningIntent({ ...built, account: "0xdeadbeef" })).toBe(false);
    expect(verifySigningIntent({ ...built, authorized: { ...built.authorized, nonce: 8 } })).toBe(
      false,
    );
  });

  it("fills policy and provenance defaults rather than requiring them", () => {
    const built = intent();
    expect(built.policy.allowlistOk).toBe(true);
    expect(built.policy.perTxCapUsdc).toBeNull();
    expect(built.provenance.agentRunId).toBe("req-1");
    expect(built.provenance.decisionIds).toEqual([]);
  });

  it("carries the LangSmith trace id, so an authorisation traces back to its reasoning", () => {
    const built = intent({
      provenance: {
        agentId: "v01",
        agentRunId: "run-9",
        langsmithTraceId: "trace-abc",
        model: "gemini-2.5-flash-lite",
        decisionIds: ["d1"],
      },
    });
    expect(built.provenance.langsmithTraceId).toBe("trace-abc");
    expect(verifySigningIntent(built)).toBe(true);
  });

  it("rejects a malformed digest at parse time", () => {
    const built = intent();
    const result = SigningIntentSchema.safeParse({ ...built, digest: "0xnothex" });
    expect(result.success).toBe(false);
  });
});

describe("canonicalJson", () => {
  it("is key-order independent", () => {
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });

  it("drops undefined so an absent field and an undefined field hash alike", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });

  it("stringifies bigint instead of throwing", () => {
    expect(() => digestIntent({ amount: 10n ** 18n })).not.toThrow();
    expect(canonicalJson({ amount: 10n ** 18n })).toBe('{"amount":"1000000000000000000"}');
  });
});

describe("signer redaction", () => {
  it("scrubs an authorization key out of an error message", () => {
    const scrubbed = redactSignerDetail("failed for wallet-auth:AbC123+/=def with key 0x" + "a".repeat(64));
    expect(scrubbed).not.toContain("wallet-auth:AbC");
    expect(scrubbed).toContain("[redacted]");
    expect(scrubbed).not.toContain("a".repeat(64));
  });

  it("accepts the dashboard's prefixed authorization key and the bare form alike", () => {
    expect(normalizeAuthorizationKey("wallet-auth:AbC123")).toBe("AbC123");
    expect(normalizeAuthorizationKey("  AbC123  ")).toBe("AbC123");
  });
});
