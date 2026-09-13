/**
 * IntentBuilder — assemble and verify the envelope.
 *
 * Pure and synchronous: no key, no network, no device. `SafeClient` calls this
 * with a real proposal; a caller can also build one from a fixture, which is what
 * makes the envelope testable without a chain.
 */
import {
  SIGNING_INTENT_VERSION,
  SigningIntentSchema,
  digestIntent,
  type SigningIntent,
  type SigningIntentInput,
} from "./SigningIntent.js";

/**
 * The body, without the digest.
 *
 * Normalising through this schema **before** hashing is the point: zod fills in
 * defaults (a field's `tone`, an empty `warnings` array, nulled provenance
 * fields), so a digest computed over the pre-parse draft would not match the
 * object that gets stored — and `verifySigningIntent` would reject every
 * legitimate intent.
 */
const SigningIntentBodySchema = SigningIntentSchema.omit({ digest: true });

export interface BuildSigningIntentInput {
  readonly intentId: string;
  readonly requestId: string;
  readonly agentId: string;
  readonly createdAt: string;
  readonly chain: string;
  readonly chainId: number;
  readonly account: string;
  readonly kind: SigningIntentInput["kind"];
  readonly signing: SigningIntentInput["signing"];
  readonly display: SigningIntentInput["display"];
  readonly authorized: SigningIntentInput["authorized"];
  readonly policy?: SigningIntentInput["policy"];
  readonly provenance?: SigningIntentInput["provenance"];
}

/**
 * Build and validate a signing intent.
 *
 * The digest is computed here rather than accepted from the caller, so a caller
 * cannot pin a digest that disagrees with the payload it describes.
 */
export function buildSigningIntent(input: BuildSigningIntentInput): SigningIntent {
  const draft = {
    version: SIGNING_INTENT_VERSION,
    intentId: input.intentId,
    requestId: input.requestId,
    agentId: input.agentId,
    createdAt: input.createdAt,
    chain: input.chain,
    chainId: input.chainId,
    account: input.account,
    kind: input.kind,
    signing: input.signing,
    display: input.display,
    authorized: input.authorized,
    policy: input.policy ?? {
      perTxCapUsdc: null,
      dailyCapUsdc: null,
      allowlistOk: true,
      evaluatedAt: null,
      privyPolicyId: null,
    },
    provenance: input.provenance ?? {
      agentId: input.agentId,
      agentRunId: input.requestId,
      langsmithTraceId: null,
      model: null,
      decisionIds: [],
    },
  };
  const normalized = SigningIntentBodySchema.parse(draft);
  return SigningIntentSchema.parse({ ...normalized, digest: digestIntent(normalized) });
}

/**
 * Verify a received intent's digest against its own body.
 *
 * A `false` here means the payload was altered after it was built — the intent
 * must be refused, not repaired.
 */
export function verifySigningIntent(intent: SigningIntent): boolean {
  const { digest, ...body } = intent;
  return digestIntent(body) === digest;
}
