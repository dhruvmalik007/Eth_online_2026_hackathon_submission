/**
 * The two routes that move funds, and the signer boundary under them.
 *
 * What matters here is not that a signature comes back but *what the signer was handed*. A signature is
 * the one artefact in this system that cannot be inspected for correctness after the fact, so a
 * mistranslated payload produces something that looks fine and verifies against the wrong digest. These
 * tests assert on the arguments, not only the reply.
 */
import { describe, expect, it } from "vitest";
import type { SqlRunner } from "@ethonline2026/timeseries";
import { buildApp } from "../src/app.js";
import { loadExecutionEnv } from "../src/env.js";
import type { EvmSigner } from "../src/evmSigner.js";
import { HeaderAuthenticator } from "../src/http.js";
import { createRuntime, type ExecutionRuntime } from "../src/runtime.js";

const USER = "did:privy:user-1";
const APPROVER = "did:privy:treasury-1";
const SIGNER_ADDRESS = "0x1111111111111111111111111111111111111111";
const ROUTER = "0x2222222222222222222222222222222222222222";

/** The runtime never touches a database on these paths; the runner satisfies the composition root. */
const runner = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as SqlRunner;

/** Records what it was asked to do, so a test can assert on the translation rather than the reply. */
function fakeSigner() {
  const typed: unknown[] = [];
  const sent: unknown[] = [];
  const signer: EvmSigner = {
    getAddress: async () => SIGNER_ADDRESS as `0x${string}`,
    signTypedData: async (payload) => {
      typed.push(payload);
      return "0xsigned" as `0x${string}`;
    },
    signMessage: async () => "0xsigned" as `0x${string}`,
    sendTransaction: async (request) => {
      sent.push(request);
      return { transactionHash: "0xsubmitted" };
    },
  };
  return { signer, typed, sent };
}

function runtimeWith(signer?: EvmSigner): ExecutionRuntime {
  return createRuntime({
    env: loadExecutionEnv({}),
    runner,
    ...(signer === undefined ? {} : { signer }),
  });
}

const invoke = (path: string, payload: Record<string, unknown>, runtime: ExecutionRuntime) =>
  buildApp({ runtime, authenticator: new HeaderAuthenticator() }).inject({
    method: "POST",
    url: path,
    headers: { "x-user-id": USER },
    payload,
  });

const sign = (payload: Record<string, unknown>, runtime: ExecutionRuntime) =>
  invoke("/intents/i1/sign", payload, runtime);
const submit = (payload: Record<string, unknown>, runtime: ExecutionRuntime) =>
  invoke("/intents/i1/submit", payload, runtime);

const TYPED_DATA = {
  domain: { name: "AgenticEMSSwapVMRouter", version: "1.0.0", chainId: 10, verifyingContract: ROUTER },
  types: { Order: [{ name: "maker", type: "address" }] },
  primaryType: "Order",
  message: { maker: SIGNER_ADDRESS },
};

const CALL = { chainId: 10, to: ROUTER, data: "0xdeadbeef", value: "0" };

describe("no signer configured", () => {
  it("reports signing as unavailable rather than failing later", async () => {
    // A deployment statement, not a failed operation: nothing was attempted, so nothing can be
    // partially signed.
    const response = await sign({ typedData: [TYPED_DATA] }, runtimeWith());

    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("UNAVAILABLE");
  });

  it("reports submission as unavailable", async () => {
    const response = await submit({ calls: [CALL] }, runtimeWith());

    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("UNAVAILABLE");
  });
});

describe("signing typed data", () => {
  it("signs each payload and names the signer", async () => {
    const { signer, typed } = fakeSigner();
    const response = await sign({ typedData: [TYPED_DATA] }, runtimeWith(signer));

    expect(response.statusCode).toBe(200);
    expect(response.json().signed).toEqual([{ index: 0, signature: "0xsigned" }]);
    expect(response.json().signedBy).toBe(SIGNER_ADDRESS);
    expect(typed).toHaveLength(1);
  });

  it("passes the payload through unaltered, so the digest is over what the caller wrote", async () => {
    // The route is a signing boundary, not a re-encoder. Any field it added or reordered would change
    // the digest and produce a signature that verifies against nothing.
    const { signer, typed } = fakeSigner();
    await sign({ typedData: [TYPED_DATA] }, runtimeWith(signer));

    expect(typed[0]).toEqual(TYPED_DATA);
  });

  it("attributes the intent to the authenticated caller when no approver is named", async () => {
    const { signer } = fakeSigner();
    const response = await sign({ typedData: [TYPED_DATA] }, runtimeWith(signer));

    expect(response.json().approvedBy).toBe(USER);
  });

  it("keeps an explicitly named approver", async () => {
    const { signer } = fakeSigner();
    const response = await sign({ typedData: [TYPED_DATA], approvedBy: APPROVER }, runtimeWith(signer));

    expect(response.json().approvedBy).toBe(APPROVER);
  });

  it("rejects a payload that is not shaped like EIP-712 rather than signing something meaningless", async () => {
    const { signer, typed } = fakeSigner();
    const response = await sign({ typedData: [{ primaryType: "Order" }] }, runtimeWith(signer));

    expect(response.statusCode).toBe(400);
    expect(response.json().error.details.field).toBe("typedData[0]");
    expect(typed).toHaveLength(0);
  });

  it("rejects an empty array", async () => {
    const { signer } = fakeSigner();
    expect((await sign({ typedData: [] }, runtimeWith(signer))).statusCode).toBe(400);
  });
});

describe("submitting calls", () => {
  it("sends each call and returns the hashes", async () => {
    const { signer, sent } = fakeSigner();
    const response = await submit({ calls: [CALL] }, runtimeWith(signer));

    expect(response.statusCode).toBe(200);
    expect(response.json().submitted).toEqual([{ index: 0, transactionHash: "0xsubmitted" }]);
    expect(sent).toHaveLength(1);
  });

  it("omits a zero value rather than sending bigint zero", async () => {
    // `0` and an absent `value` mean the same thing to a node, and omitting it keeps the request equal
    // to what the adapter produced.
    const { signer, sent } = fakeSigner();
    await submit({ calls: [CALL] }, runtimeWith(signer));

    expect("value" in (sent[0] as Record<string, unknown>)).toBe(false);
  });

  it("converts a wei string to a bigint without passing through a float", async () => {
    // The port carries wei as a decimal string so it never touches a double. 1e18 exceeds
    // Number.MAX_SAFE_INTEGER, so a Number() anywhere on this path would silently round it.
    const { signer, sent } = fakeSigner();
    await submit({ calls: [{ ...CALL, value: "1000000000000000000" }] }, runtimeWith(signer));

    expect((sent[0] as { value: unknown }).value).toBe(1000000000000000000n);
    expect(typeof (sent[0] as { value: unknown }).value).toBe("bigint");
  });

  it("rejects a call the adapters could never have produced", async () => {
    const { signer, sent } = fakeSigner();
    const response = await submit({ calls: [{ chainId: 10 }] }, runtimeWith(signer));

    expect(response.statusCode).toBe(400);
    expect(response.json().error.details.field).toBe("calls[0]");
    expect(sent).toHaveLength(0);
  });

  it("rejects a value that is not an integer string, which is where a float would hide", async () => {
    const { signer, sent } = fakeSigner();
    const response = await submit({ calls: [{ ...CALL, value: "1.5" }] }, runtimeWith(signer));

    expect(response.statusCode).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it("rejects an empty array", async () => {
    const { signer } = fakeSigner();
    expect((await submit({ calls: [] }, runtimeWith(signer))).statusCode).toBe(400);
  });
});
