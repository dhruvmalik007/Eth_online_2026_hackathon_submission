import { describe, expect, it } from "vitest";
import { PolicyGate, DailySpend } from "../src/policy/PolicyGate.js";
import type { WalletPolicy } from "../src/policy/policySchema.js";

const basePolicy: WalletPolicy = {
  perTxCapUsdc: 1000,
  dailyCapUsdc: 2000,
  recipientAllowlist: ["0x1111111111111111111111111111111111111111"],
  chainAllowlist: ["sepolia"],
  expiresAt: 2_000_000_000, // far future
};

const RECIPIENT = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";

const NOW = 1_750_000_000;

function req(overrides: Partial<Parameters<PolicyGate["check"]>[0]> = {}) {
  return {
    agentId: "agent-a",
    recipient: RECIPIENT as `0x${string}`,
    amountUsdc: 100,
    chain: "sepolia",
    nowSec: NOW,
    ...overrides,
  };
}

describe("PolicyGate", () => {
  it("approves a request within all caps and allowlists", () => {
    const gate = new PolicyGate();
    expect(gate.check(req(), basePolicy)).toEqual({ ok: true });
  });

  it("rejects when per-tx cap is exceeded", () => {
    const gate = new PolicyGate();
    const decision = gate.check(req({ amountUsdc: 1001 }), basePolicy);
    expect(decision).toMatchObject({ ok: false });
    if (!decision.ok) expect(decision.reason).toContain("Per-tx cap");
  });

  it("rejects a recipient not on the allowlist", () => {
    const gate = new PolicyGate();
    const decision = gate.check(req({ recipient: OTHER as `0x${string}` }), basePolicy);
    expect(decision).toMatchObject({ ok: false });
    if (!decision.ok) expect(decision.reason).toContain("not in allowlist");
  });

  it("compares allowlisted recipients case-insensitively", () => {
    const gate = new PolicyGate();
    const mixed = "0x1111111111111111111111111111111111111111".toUpperCase() as `0x${string}`;
    expect(gate.check(req({ recipient: mixed }), basePolicy)).toEqual({ ok: true });
  });

  it("rejects a chain outside the allowlist", () => {
    const gate = new PolicyGate();
    const decision = gate.check(req({ chain: "base-sepolia" }), basePolicy);
    expect(decision).toMatchObject({ ok: false });
    if (!decision.ok) expect(decision.reason).toContain("Chain base-sepolia not allowed");
  });

  it("expires capabilities after expiresAt", () => {
    const gate = new PolicyGate();
    const past = { ...basePolicy, expiresAt: NOW - 1 };
    const decision = gate.check(req(), past);
    expect(decision).toMatchObject({ ok: false });
    if (!decision.ok) expect(decision.reason).toContain("expired");
  });

  it("unenforced allowlists are open (empty = no restriction)", () => {
    const gate = new PolicyGate();
    const open = { ...basePolicy, recipientAllowlist: [], chainAllowlist: [] };
    expect(gate.check(req({ recipient: OTHER }), open)).toEqual({ ok: true });
  });

  it("aggregates daily spend and rejects beyond dailyCapUsdc", () => {
    const spend = new DailySpend();
    const gate = new PolicyGate(spend);
    // Isolate the daily cap: high per-tx (5000) but tight daily (1200).
    const tight: WalletPolicy = {
      ...basePolicy,
      perTxCapUsdc: 5000,
      dailyCapUsdc: 1200,
    };
    expect(gate.check(req({ amountUsdc: 500 }), tight)).toEqual({ ok: true });
    expect(spend.dailyTotal("agent-a", NOW)).toBe(500);
    expect(gate.check(req({ amountUsdc: 500 }), tight)).toEqual({ ok: true });
    expect(spend.dailyTotal("agent-a", NOW)).toBe(1000);
    // 500 more would exceed the 1200 daily cap but is well under the per-tx cap — daily must reject.
    const over = gate.check(req({ amountUsdc: 500 }), tight);
    expect(over).toMatchObject({ ok: false });
    if (!over.ok) expect(over.reason).toContain("Daily cap exceeded");
    // rejected attempt must not consume cap
    expect(spend.dailyTotal("agent-a", NOW)).toBe(1000);
  });

  it("rolls the daily window at UTC midnight", () => {
    const spend = new DailySpend();
    const gate = new PolicyGate(spend);
    const day1 = new Date("2026-09-09T23:59:59Z").getTime() / 1000;
    const day2 = new Date("2026-09-10T00:00:01Z").getTime() / 1000;
    // 900 is under the per-tx cap of 1000, so daily accumulation is what's being tested.
    expect(
      gate.check(req({ nowSec: day1, amountUsdc: 900 }), { ...basePolicy, dailyCapUsdc: 1000 }),
    ).toEqual({ ok: true });
    expect(spend.dailyTotal("agent-a", day1)).toBe(900);
    // Next UTC day — a fresh budget, so this must pass even though day1 accumulated 900.
    expect(
      gate.check(req({ nowSec: day2, amountUsdc: 900 }), { ...basePolicy, dailyCapUsdc: 1000 }),
    ).toEqual({ ok: true });
    expect(spend.dailyTotal("agent-a", day2)).toBe(900);
  });
});