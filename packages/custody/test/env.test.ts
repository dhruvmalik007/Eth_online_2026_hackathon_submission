import { describe, expect, it } from "vitest";
import { CHAIN_INFO, CUSTODY_CHAINS, loadEnv, requireSafeAddress } from "../src/config/env.js";

describe("custody env", () => {
  it("defaults to dry mode and sepolia", () => {
    const env = loadEnv({});
    expect(env.CUSTODY_MODE).toBe("dry");
    expect(env.CUSTODY_SAFE_CHAIN).toBe("sepolia");
    expect(env.CUSTODY_AGENT_KEY_REF).toBe("agent-scoped-0");
  });

  it("validates an unsafe CUSTODY_MODE", () => {
    expect(() => loadEnv({ CUSTODY_MODE: "explosive" })).toThrow(/Custody env validation failed/);
  });

  it("registers every supported testnet in viem's chain registry", () => {
    expect(CUSTODY_CHAINS).toContain("sepolia");
    for (const name of CUSTODY_CHAINS) {
      expect(CHAIN_INFO[name], name).toBeDefined();
      expect(CHAIN_INFO[name].id).toBeGreaterThan(0);
    }
  });

  it("resolves sepolia chain id 11155111 via viem", () => {
    expect(CHAIN_INFO.sepolia.id).toBe(11155111);
    expect(CHAIN_INFO["polygon-amoy"].id).toBe(80002);
    expect(CHAIN_INFO["base-sepolia"].id).toBe(84532);
  });

  it("requireSafeAddress throws without a configured safe", () => {
    expect(() => requireSafeAddress(loadEnv({}))).toThrow(/CUSTODY_SAFE_ADDRESS is not set/);
  });

  it("requireSafeAddress returns the configured address", () => {
    const addr = "0x1111111111111111111111111111111111111111";
    expect(requireSafeAddress(loadEnv({ CUSTODY_SAFE_ADDRESS: addr }))).toBe(addr);
  });
});