import { describe, expect, it } from "vitest";
import {
  AQUA_STEP_KINDS,
  STEP_KIND_MAP,
  toExecutionRecord,
  toExecutionStep,
  type AquaReceiptLeg,
  type AquaStep,
  type AquaStepKind,
} from "../src/adapter/receipt.js";

function step(kind: AquaStepKind, over: Partial<AquaStep> = {}): AquaStep {
  return {
    id: "step-1",
    legId: "leg-1",
    kind,
    label: "Swap 1 WETH into USDC",
    intent: "Swap 1 WETH for at least 3,400 USDC through the Aqua/swapVM strategy.",
    tx: {
      chainId: 10,
      to: "0x111111338c5091e8440b67b168bae16a668ac0de",
      data: "0x1234",
      value: "0",
    },
    state: "confirmed",
    ...over,
  };
}

const LEG: AquaReceiptLeg = {
  id: "leg-1",
  label: "USDC/DAI",
  chain: "optimism",
  deployedUsd: 3_400,
  costUsd: 0.12,
};

describe("STEP_KIND_MAP", () => {
  it("covers every kind this package produces", () => {
    // An unmapped kind would surface as `undefined` in the domain enum and fail validation at the
    // UI boundary, which is the worst place to learn about it.
    for (const kind of AQUA_STEP_KINDS) {
      expect(STEP_KIND_MAP[kind]).toBeDefined();
    }
  });

  it("maps a SwapVM fill onto the domain's swap kind", () => {
    expect(STEP_KIND_MAP["swapvm-take"]).toBe("swap");
  });

  it("maps shipping and docking onto order, because neither moves funds when called", () => {
    // Shipping registers a strategy for later fills; docking removes it. Treating either as a transfer
    // would overstate what the operator is approving.
    expect(STEP_KIND_MAP["aqua-ship"]).toBe("order");
    expect(STEP_KIND_MAP["aqua-dock"]).toBe("order");
  });

  it("maps a vault withdrawal onto supply, with the direction in the label", () => {
    // `STEP_KINDS` has no `withdraw`. The family and the call signature are identical to a deposit, so
    // `kind` says which family and `label`/`intent` say what it does. If a `withdraw` kind ever appears
    // upstream this becomes a one-line change rather than a silent mislabel.
    expect(STEP_KIND_MAP["vault-deposit"]).toBe("supply");
    expect(STEP_KIND_MAP["vault-withdraw"]).toBe("supply");
  });
});

describe("toExecutionStep", () => {
  it("passes the transaction value through as a string, never a number", () => {
    // A wei value in a float is the class of bug that silently changes an amount.
    const mapped = toExecutionStep(step("swapvm-take", { tx: { chainId: 10, to: "0x111111338c5091e8440b67b168bae16a668ac0de", data: "0x", value: "1000000000000000000" } }));

    expect(mapped.tx.value).toBe("1000000000000000000");
    expect(typeof mapped.tx.value).toBe("string");
  });

  it("emits operation 0, since none of these steps is a delegatecall", () => {
    expect(toExecutionStep(step("swapvm-take")).tx.operation).toBe(0);
  });

  it("omits optional keys rather than setting them to undefined", () => {
    // Under `exactOptionalPropertyTypes` those are different objects, and the domain schema rejects the
    // second only after a round trip through a form.
    const mapped = toExecutionStep(step("swapvm-take"));

    expect(Object.hasOwn(mapped, "eip712")).toBe(false);
    expect(Object.hasOwn(mapped, "error")).toBe(false);
    expect(Object.hasOwn(mapped, "durationMs")).toBe(false);
  });

  it("carries an EIP-712 authorisation when the step is signed rather than calldata-driven", () => {
    const mapped = toExecutionStep(
      step("vault-deposit", {
        eip712: { primaryType: "Order", domain: { name: "x" }, message: { maker: "0x1" } },
      }),
    );

    expect(mapped.eip712?.primaryType).toBe("Order");
  });

  it("keeps the clear-signed sentence, which is what the operator actually approves", () => {
    expect(toExecutionStep(step("swapvm-take")).intent).toContain("at least 3,400 USDC");
  });
});

describe("toExecutionRecord", () => {
  const base = {
    planId: "plan-1",
    createdAt: 1_700_000_000_000,
    legs: [LEG],
    notionalUsd: 3_400,
    costUsd: 0.12,
    simulated: false,
  } as const;

  it("derives complete only when every step is confirmed", () => {
    const record = toExecutionRecord({ ...base, steps: [step("swapvm-take"), step("vault-deposit", { id: "step-2" })] });

    expect(record.status).toBe("complete");
    expect(record.stepCount).toBe(2);
    expect(record.confirmedCount).toBe(2);
  });

  it("cannot report complete for a run containing a failed step", () => {
    // The one field an operator reads without checking the steps, so it must not be able to disagree
    // with them.
    const record = toExecutionRecord({
      ...base,
      steps: [step("swapvm-take"), step("vault-deposit", { id: "step-2", state: "failed" })],
    });

    expect(record.status).toBe("failed");
    expect(record.confirmedCount).toBe(1);
  });

  it("reports partial while steps are still in flight", () => {
    const record = toExecutionRecord({ ...base, steps: [step("swapvm-take", { state: "submitted" })] });

    expect(record.status).toBe("partial");
  });

  it("does not call an empty run complete", () => {
    // Vacuously true is not done: a plan with no steps has executed nothing.
    const record = toExecutionRecord({ ...base, steps: [] });

    expect(record.status).toBe("partial");
    expect(record.stepCount).toBe(0);
  });

  it("carries the simulated flag through, so a rehearsal is never mistaken for a settlement", () => {
    const record = toExecutionRecord({ ...base, steps: [step("swapvm-take")], simulated: true });

    expect(record.simulated).toBe(true);
  });

  it("omits absent explorer fields rather than rendering an empty link", () => {
    const record = toExecutionRecord({
      ...base,
      steps: [step("swapvm-take")],
      links: [{ label: "swap" }],
    });

    expect(Object.hasOwn(record.links[0] ?? {}, "url")).toBe(false);
    expect(Object.hasOwn(record.links[0] ?? {}, "hash")).toBe(false);
  });
});
