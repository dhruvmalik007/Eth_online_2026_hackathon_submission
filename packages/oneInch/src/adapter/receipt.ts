/**
 * Mapping Aqua/SwapVM steps onto the execution domain.
 *
 * ## Why this file exists at all
 *
 * The dashboard, the timeline, the fee waterfall and the receipt all read `ExecutionStep`. The
 * adapter's job is to produce that shape from ours, in one place, so a new step kind cannot be added
 * upstream without someone deciding what it looks like downstream. The alternative — each surface
 * interpreting our fields — is how two views of the same execution end up disagreeing.
 *
 * ## The one mapping that is not exact
 *
 * `STEP_KINDS` has no `withdraw`. So `vault-withdraw` maps to `supply`, which is the same contract
 * family and the same call signature — and the **direction is carried in the label and the
 * clear-signed sentence** instead. That is a deliberate split rather than an oversight: `kind` says
 * which family of calls this is, and `label`/`intent` say what it does. A test asserts it, so if a
 * `withdraw` kind ever appears upstream the mapping is a one-line change rather than a silent
 * mislabel.
 *
 * `aqua-ship` and `aqua-dock` map to `order` because that is what they are: shipping balances
 * registers a strategy for later fills, and docking removes it. Neither moves funds at the moment it
 * is called, which is exactly why treating them as a transfer would be wrong.
 */

import {
  ExecutionRecordSchema,
  ExecutionStepSchema,
  type ExecutionRecord,
  type ExecutionStep,
  type ExecutionStepState,
  type StepKind,
} from "@ethonline2026/execution-domain";
import type { UnsignedTransaction } from "../port.js";

/** The step kinds this package produces. */
export const AQUA_STEP_KINDS = [
  "aqua-ship",
  "aqua-dock",
  "swapvm-take",
  "vault-deposit",
  "vault-withdraw",
] as const;
export type AquaStepKind = (typeof AQUA_STEP_KINDS)[number];

/**
 * Our kinds, expressed in the domain's frozen vocabulary.
 *
 * `supply` covers both directions of an ERC-4626 call: the family and the signature are identical and
 * only the sign of the intent differs.
 */
export const STEP_KIND_MAP: Record<AquaStepKind, StepKind> = {
  "aqua-ship": "order",
  "aqua-dock": "order",
  "swapvm-take": "swap",
  "vault-deposit": "supply",
  "vault-withdraw": "supply",
};

/** A step as this package produces it, before it becomes a domain step. */
export interface AquaStep {
  readonly id: string;
  readonly legId: string;
  readonly kind: AquaStepKind;
  readonly label: string;
  /** The clear-signed sentence shown to the operator before they approve (ERC-7730 style). */
  readonly intent: string;
  readonly tx: UnsignedTransaction;
  readonly state: ExecutionStepState;
  /** Present when the step is authorised by a signature rather than by calldata. */
  readonly eip712?: {
    readonly primaryType: string;
    readonly domain: Record<string, unknown>;
    readonly message: Record<string, unknown>;
  };
  readonly route?: string;
  readonly error?: string;
  readonly durationMs?: number;
}

/** Translate one step. Validated on the way out, so a malformed step fails here and not in the UI. */
export function toExecutionStep(step: AquaStep): ExecutionStep {
  return ExecutionStepSchema.parse({
    id: step.id,
    legId: step.legId,
    kind: STEP_KIND_MAP[step.kind],
    label: step.label,
    intent: step.intent,
    tx: {
      to: step.tx.to,
      // The domain requires a string, which is what keeps a wei value out of a float.
      value: step.tx.value,
      data: step.tx.data,
      operation: 0,
    },
    state: step.state,
    // Spread conditionally: under `exactOptionalPropertyTypes` an explicit `undefined` is not the
    // same as an absent key, and these keys must be absent rather than present-and-empty.
    ...(step.route === undefined ? {} : { route: step.route }),
    ...(step.eip712 === undefined ? {} : { eip712: step.eip712 }),
    ...(step.error === undefined ? {} : { error: step.error }),
    ...(step.durationMs === undefined ? {} : { durationMs: step.durationMs }),
  });
}

export interface AquaReceiptLeg {
  readonly id: string;
  readonly label: string;
  readonly chain: string;
  readonly deployedUsd: number;
  readonly costUsd: number;
}

export interface AquaReceiptInput {
  readonly planId: string;
  readonly createdAt: number;
  readonly legs: readonly AquaReceiptLeg[];
  readonly steps: readonly AquaStep[];
  readonly notionalUsd: number;
  readonly costUsd: number;
  /** True when nothing was broadcast — the receipt still renders, and says so. */
  readonly simulated: boolean;
  readonly links?: readonly { readonly label: string; readonly url?: string; readonly hash?: string }[];
}

/**
 * Summarise an execution.
 *
 * `status` is derived rather than passed, so a caller cannot report `complete` for a run that has a
 * failed step. That is the one field an operator will read without checking the steps, so it is the
 * one that must not be able to disagree with them.
 */
export function toExecutionRecord(input: AquaReceiptInput): ExecutionRecord {
  const confirmedCount = input.steps.filter((step) => step.state === "confirmed").length;
  const hasFailure = input.steps.some((step) => step.state === "failed");

  const status: ExecutionRecord["status"] = hasFailure
    ? "failed"
    : confirmedCount === input.steps.length && input.steps.length > 0
      ? "complete"
      : "partial";

  return ExecutionRecordSchema.parse({
    id: input.planId,
    createdAt: input.createdAt,
    legs: input.legs.map((leg) => ({
      id: leg.id,
      label: leg.label,
      chain: leg.chain,
      deployedUsd: leg.deployedUsd,
      costUsd: leg.costUsd,
    })),
    stepCount: input.steps.length,
    confirmedCount,
    notionalUsd: input.notionalUsd,
    costUsd: input.costUsd,
    status,
    simulated: input.simulated,
    links: (input.links ?? []).map((link) => ({
      label: link.label,
      ...(link.url === undefined ? {} : { url: link.url }),
      ...(link.hash === undefined ? {} : { hash: link.hash }),
    })),
  });
}
