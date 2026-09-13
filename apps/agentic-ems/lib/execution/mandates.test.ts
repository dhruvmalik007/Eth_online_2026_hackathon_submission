import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_MANDATE,
  DEFAULT_AGENT_ID,
  executionBaseUrl,
  fetchMandate,
  mandateFor,
  saveMandate,
  type AgentMandate,
} from "./mandates";

describe("mandateFor", () => {
  it("falls back to the approval-required default, not to unlimited", () => {
    // An agent with no mandate must not be the permissive case. A refusal to spend is recoverable in a
    // way that a permitted spend is not.
    const mandate = mandateFor(undefined);

    expect(mandate).toEqual(DEFAULT_AGENT_MANDATE);
    expect(mandate.approvalRequired).toBe(true);
  });

  it("uses a stored mandate when one exists", () => {
    const stored: AgentMandate = { maxSpendUsd: 5_000, approvalRequired: false };

    expect(mandateFor({ v01: stored })).toEqual(stored);
  });

  it("does not let one agent's mandate answer for another", () => {
    const stored: AgentMandate = { maxSpendUsd: 5_000, approvalRequired: false };

    expect(mandateFor({ v02: stored }, "v01")).toEqual(DEFAULT_AGENT_MANDATE);
  });
});

describe("executionBaseUrl", () => {
  it("is undefined when the desk runs standalone", () => {
    expect(executionBaseUrl({})).toBeUndefined();
    expect(executionBaseUrl({ NEXT_PUBLIC_EXECUTION_URL: "   " })).toBeUndefined();
  });

  it("strips a trailing slash so paths concatenate without doubling", () => {
    expect(executionBaseUrl({ NEXT_PUBLIC_EXECUTION_URL: "https://ems.example.com/" })).toBe(
      "https://ems.example.com",
    );
  });
});

describe("fetchMandate without a service", () => {
  it("reports the desk default rather than failing, and names the source", async () => {
    // The settings screen still has to render, and `source` is what stops the fallback being mistaken
    // for the value the service enforces.
    const result = await fetchMandate(DEFAULT_AGENT_ID, { baseUrl: undefined });

    expect(result.ok).toBe(false);
    expect(result.source).toBe("desk default");
    expect(result.effective).toEqual(DEFAULT_AGENT_MANDATE);
    expect(result.detail).toContain("nothing is enforced here");
  });
});

describe("saveMandate validation", () => {
  it.each([
    ["zero", 0],
    ["negative", -1],
    ["NaN", Number.NaN],
  ])("rejects a %s limit before any request is made", async (_label, maxSpendUsd) => {
    // Rejected locally as well as on the service: a form that only learns a limit is invalid after a
    // round trip has already let the operator believe it was saved.
    const result = await saveMandate(DEFAULT_AGENT_ID, { maxSpendUsd, approvalRequired: true }, { baseUrl: "http://127.0.0.1:1" });

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("positive amount");
  });

  it("says the limit is session-only when no service is configured", async () => {
    const result = await saveMandate(DEFAULT_AGENT_ID, { maxSpendUsd: 1_000, approvalRequired: true }, { baseUrl: undefined });

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("session only");
  });
});
