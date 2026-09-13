import { describe, expect, it } from "vitest";
import { assessEnablement, type EnablementInput } from "../src/index.js";

function input(over: Partial<EnablementInput> = {}): EnablementInput {
  return {
    chain: "optimism",
    venueAvailable: true,
    alreadyEnabled: false,
    efficiencyBps: 40,
    minEfficiencyBps: 20,
    mandate: { allowAgentEnablement: false, minEfficiencyBpsForAgent: 100 },
    ...over,
  };
}

/** A mandate wide enough for an agent to act on obvious deltas. */
const agenticMandate = { allowAgentEnablement: true, minEfficiencyBpsForAgent: 100 };

describe("assessEnablement", () => {
  it("reports unavailable when the venue cannot serve the chain, whatever the delta", () => {
    // The most extreme possible delta must not talk its way past this check: a venue that cannot
    // serve the chain is a broken configuration, not a decision.
    const result = assessEnablement(
      input({ venueAvailable: false, efficiencyBps: 100_000, mandate: agenticMandate }),
    );

    expect(result.recommendation).toBe("unavailable");
    expect(result.consentRequired).toBe(false);
    expect(result.detail).toContain("optimism");
  });

  it("reports enabled, with nothing to consent to, when already on", () => {
    const result = assessEnablement(input({ alreadyEnabled: true, mandate: agenticMandate }));

    expect(result.recommendation).toBe("enabled");
    expect(result.consentRequired).toBe(false);
  });

  it("still reports the measured delta when already enabled, so both stages agree", () => {
    // The simulation showed a figure; the approval must not show a different one just because the
    // switch flipped in between.
    const result = assessEnablement(input({ alreadyEnabled: true, efficiencyBps: 137 }));

    expect(result.efficiencyBps).toBe(137);
  });

  it("treats a delta under the threshold as not worth doing", () => {
    const result = assessEnablement(input({ efficiencyBps: 19, minEfficiencyBps: 20 }));

    expect(result.recommendation).toBe("not_worthwhile");
    expect(result.consentRequired).toBe(false);
  });

  it("keeps the mandate out of the sub-threshold decision", () => {
    // An agent trusted with obvious deltas is not thereby trusted with imperceptible ones.
    const result = assessEnablement(
      input({ efficiencyBps: 19, minEfficiencyBps: 20, mandate: { allowAgentEnablement: true, minEfficiencyBpsForAgent: 1 } }),
    );

    expect(result.recommendation).toBe("not_worthwhile");
    expect(result.consentGranter).toBe("user");
  });

  it("carries a negative delta through unchanged rather than clamping it to a tie", () => {
    // Aqua being worse is a legitimate outcome, and flooring it at zero would hide the loss.
    const result = assessEnablement(input({ efficiencyBps: -75, minEfficiencyBps: 20 }));

    expect(result.efficiencyBps).toBe(-75);
    expect(result.recommendation).toBe("not_worthwhile");
  });

  it("recommends with consent when the delta clears the threshold", () => {
    const result = assessEnablement(input({ efficiencyBps: 40 }));

    expect(result.recommendation).toBe("recommend");
    expect(result.consentRequired).toBe(true);
    expect(result.consentGranter).toBe("user");
    expect(result.detail).toContain("40 bps");
  });

  it("lets an agent consent above the mandate's threshold", () => {
    const result = assessEnablement(input({ efficiencyBps: 150, mandate: agenticMandate }));

    expect(result.recommendation).toBe("recommend");
    expect(result.consentGranter).toBe("user-or-agent");
    expect(result.detail).toContain("arithmetic");
  });

  it("keeps consent with the user when the delta clears the threshold but not the agent's bar", () => {
    // Worth doing, but not obviously so — that is a preference about risk, not arithmetic.
    const result = assessEnablement(input({ efficiencyBps: 60, mandate: agenticMandate }));

    expect(result.recommendation).toBe("recommend");
    expect(result.consentGranter).toBe("user");
  });

  it("treats the agent's threshold as inclusive", () => {
    const result = assessEnablement(input({ efficiencyBps: 100, mandate: agenticMandate }));

    expect(result.consentGranter).toBe("user-or-agent");
  });

  it("refuses a malformed delta rather than letting NaN reach an approval prompt", () => {
    expect(() => assessEnablement(input({ efficiencyBps: Number.NaN }))).toThrow();
    expect(() => assessEnablement(input({ efficiencyBps: Number.POSITIVE_INFINITY }))).toThrow();
  });

  it("refuses a chain outside the matrix", () => {
    expect(() =>
      assessEnablement(input({ chain: "ethereum" as unknown as EnablementInput["chain"] })),
    ).toThrow();
  });

  it("covers both chains in the matrix", () => {
    for (const chain of ["optimism", "polygon"] as const) {
      expect(assessEnablement(input({ chain })).chain).toBe(chain);
    }
  });
});
