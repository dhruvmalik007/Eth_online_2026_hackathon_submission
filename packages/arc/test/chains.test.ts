import { describe, it, expect } from "vitest";
import { arcChainConfig, ARC_TOKEN_MESSENGER_V2, CCTP_DOMAINS } from "../dist/chains.js";

describe("arc chains config", () => {
  it("resolves testnet config with verified addresses", () => {
    const cfg = arcChainConfig("arc-testnet");
    expect(cfg.chainId).toBe(5042002);
    expect(cfg.cctpDomain).toBe(26);
    expect(cfg.usdcAddress.toLowerCase()).toBe("0x3600000000000000000000000000000000000000");
    expect(cfg.messageTransmitterV2.toLowerCase()).toBe(
      "0xe737e5cebeeba77efe34d4aa090756590b1ce275",
    );
  });

  it("exposes the verified cross-chain TokenMessenger address", () => {
    expect(ARC_TOKEN_MESSENGER_V2.toLowerCase()).toBe(
      "0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa",
    );
  });

  it("maps Arc testnet to CCTP domain 26", () => {
    expect(CCTP_DOMAINS["arc-testnet"]).toBe(26);
  });
});
