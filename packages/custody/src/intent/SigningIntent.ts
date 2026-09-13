/**
 * The signing-intent envelope — what a Safe owner is asked to authorise.
 *
 * Nothing like this existed in the repo: `SafeProposal` gave the unsigned Safe
 * transaction and its calldata, `SignedSafeTransaction` carried the exact
 * EIP-712 payload that was signed, and `CustodyEvent` logged an `intentHash`
 * that pointed at nothing in particular. There was no versioned object tying
 * together *what* is authorised, *which* run produced it, *what the human is
 * being shown*, and *which policy was evaluated*.
 *
 * Two properties are deliberate:
 *
 *  1. **Custody-native.** The authorised payload is `SafeLeg[]`, custody's own
 *     type — not `execution-domain`'s `ExecutionStep`. That preserves this
 *     package's documented invariant of depending on no other EMS package, so
 *     any app can integrate it.
 *  2. **The digest describes what is stored.** `buildSigningIntent` normalises
 *     through the schema *before* hashing, because zod applies defaults (a
 *     field's `tone`, an empty `warnings` array) and hashing a pre-parse draft
 *     yields a digest the parsed object can never reproduce — a bug that made
 *     every intent fail its own tamper check.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Eip712TypedData } from "../eip712.js";

export const SIGNING_INTENT_VERSION = "0.1" as const;

/** How the payload reaches the owner's signer. */
export const SIGNING_SCHEMES = ["safe-typed-data", "eip712", "raw-tx"] as const;

/** What kind of agent decision this intent represents. */
export const SIGNING_INTENT_KINDS = [
  "v01-readjustment",
  "safe-batch",
  "eip712-typed-data",
  "erc20-approve",
  "uniswap-v4",
  "polymarket-order",
  "bridge",
  "arc-settlement",
  // The Aqua / SwapVM flight. Four kinds rather than one because they authorise
  // structurally different things, and a signing intent's whole purpose is that the
  // owner can see *what* they are approving:
  //   aqua-ship     — `Aqua.ship(router, order, tokens, amounts)`, granting a strategy its balances
  //   swap-vm       — the taker fill, `swapVM.swap(order, amount, takerTraitsAndData)`
  //   aqua-flight   — the pair, when the ship and the fill are one batch
  //   vault-deposit — an ERC-4626 `deposit(assets, receiver)` into the destination vault
  "aqua-ship",
  "swap-vm",
  "aqua-flight",
  "vault-deposit",
] as const;

/** One leg of a batched Safe proposal. Structurally a `MetaTransactionData`. */
export const SafeLegSchema = z.object({
  to: z.string().min(1),
  value: z.string().min(1),
  data: z.string().min(1),
  /**
   * `0` CALL, `1` DELEGATECALL.
   *
   * Optional to match the Safe SDK's `MetaTransactionData` exactly, so a value
   * can move between this schema and protocol-kit without a cast.
   */
  operation: z.union([z.literal(0), z.literal(1)]).optional(),
});

/**
 * EIP-712 typed data, validated structurally.
 *
 * `z.custom` rather than a rebuilt object schema so the inferred type **is**
 * `Eip712TypedData` — the value is produced by `SafeClient.safeTypedData()` from
 * protocol-kit's own generator, and re-validating that field-by-field would only
 * invent a second definition to drift from.
 */
const TypedDataSchema = z.custom<Eip712TypedData>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    typeof (value as { primaryType?: unknown }).primaryType === "string" &&
    typeof (value as { types?: unknown }).types === "object",
  { error: "not EIP-712 typed data" },
);

export const SigningSchemeSchema = z.discriminatedUnion("scheme", [
  z.object({
    scheme: z.literal("safe-typed-data"),
    safeAddress: z.string().min(1),
    /** What the owner's signature is over. */
    safeTxHash: z.string().min(1),
    safeNonce: z.number().int().nonnegative(),
    typedData: TypedDataSchema,
  }),
  z.object({ scheme: z.literal("eip712"), typedData: TypedDataSchema }),
  z.object({
    scheme: z.literal("raw-tx"),
    chainId: z.number().int().positive(),
    to: z.string().min(1),
    valueWei: z.string().min(1),
    data: z.string().min(1),
  }),
]);

/**
 * What the human sees.
 *
 * `sentence` is the clear-signed line the UI and the audit log both render. On a
 * Ledger this is what the device screen approximates; on a Privy wallet, where
 * there is no screen, it is the only description of the authorisation a human
 * will ever read — so it is stored with the intent rather than reconstructed
 * later from calldata.
 */
export const SigningIntentDisplaySchema = z.object({
  title: z.string().min(1),
  sentence: z.string().min(1),
  fields: z.array(
    z.object({
      label: z.string().min(1),
      value: z.string(),
      tone: z.enum(["default", "up", "down", "amber"]).default("default"),
    }),
  ),
  warnings: z.array(z.string()).default([]),
});

/** The policy evaluation that gated this intent. Caps are whole-USDC, as in `WalletPolicy`. */
export const SigningIntentPolicySchema = z.object({
  perTxCapUsdc: z.number().nonnegative().nullable().default(null),
  dailyCapUsdc: z.number().nonnegative().nullable().default(null),
  /** Result of the local `PolicyGate` pre-flight. */
  allowlistOk: z.boolean(),
  evaluatedAt: z.string().min(1).nullable().default(null),
  /** The Privy policy id that provides the server-side hard stop, when configured. */
  privyPolicyId: z.string().min(1).nullable().default(null),
});

/** Where the intent came from — the join key between the audit log and the trace dashboard. */
export const SigningIntentProvenanceSchema = z.object({
  agentId: z.string().min(1),
  agentRunId: z.string().min(1),
  /** LangSmith trace id, so an on-chain authorisation is traceable to its reasoning. */
  langsmithTraceId: z.string().min(1).nullable().default(null),
  model: z.string().min(1).nullable().default(null),
  /** The upstream decision ids (e.g. v0.1 readjustment rows) this intent realises. */
  decisionIds: z.array(z.string()).default([]),
});

export const SigningIntentSchema = z.object({
  version: z.literal(SIGNING_INTENT_VERSION),
  intentId: z.string().min(1),
  /** Matches `CustodyEvent.requestId`, so the audit trail and the intent join. */
  requestId: z.string().min(1),
  agentId: z.string().min(1),
  createdAt: z.string().min(1),
  /** CAIP-2, e.g. `eip155:11155111`. */
  chain: z.string().min(1),
  chainId: z.number().int().positive(),
  /** The Safe the intent is authored against. */
  account: z.string().min(1),
  kind: z.enum(SIGNING_INTENT_KINDS),
  signing: SigningSchemeSchema,
  display: SigningIntentDisplaySchema,
  /** The exact legs this signature authorises — nothing is implied. */
  authorized: z.object({
    legs: z.array(SafeLegSchema),
    /**
     * `execTransaction` calldata.
     *
     * Null until a proposal has been built against a chain: `SafeClient.proposeIntent`
     * fills it, and an intent assembled ahead of that (a fixture, or a dry-mode
     * preview) must be able to say so rather than carry fake calldata.
     */
    calldata: z.string().min(1).nullable().default(null),
    nonce: z.number().int().nonnegative(),
  }),
  policy: SigningIntentPolicySchema,
  provenance: SigningIntentProvenanceSchema,
  /** `0x` + sha256 of the canonical intent body. This is `CustodyLog.intentHash`. */
  digest: z.string().regex(/^0x[0-9a-f]{64}$/),
});

export type SigningIntent = z.infer<typeof SigningIntentSchema>;
export type SigningIntentInput = z.input<typeof SigningIntentSchema>;
export type SafeLeg = z.infer<typeof SafeLegSchema>;

/**
 * Deterministic JSON: object keys sorted, so two equal intents hash equal.
 *
 * `bigint` is stringified rather than left to `JSON.stringify`, which throws on
 * it — Safe's typed data can carry `uint256` values, and a throw inside digest
 * computation would surface as an opaque signing failure.
 */
export function canonicalJson(value: unknown): string {
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** sha256 over the canonical form. The digest is what the audit log pins. */
export function digestIntent(body: unknown): `0x${string}` {
  return `0x${createHash("sha256").update(canonicalJson(body)).digest("hex")}`;
}
