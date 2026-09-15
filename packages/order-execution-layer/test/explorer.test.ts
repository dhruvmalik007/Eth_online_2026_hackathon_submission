import { describe, expect, it } from "vitest";
import {
  chainExplorer,
  isKnownSource,
  providerScan,
  transactionLinks,
} from "../src/index.js";

const HASH = "0xabc123";

describe("providerScan", () => {
  it("sends a LI.FI transfer to the LI.FI scan, not a block explorer", () => {
    expect(providerScan("lifi", HASH)).toEqual({
      label: "LI.FI scan",
      url: `https://scan.li.fi/tx/${HASH}`,
    });
  });

  it("sends a LayerZero message to LayerZero Scan", () => {
    expect(providerScan("layerzero", HASH)?.url).toBe(`https://layerzeroscan.com/tx/${HASH}`);
  });

  it("publishes nothing for a provider without a scan, rather than guessing", () => {
    // Circle has no public transaction scan. A fabricated link resolves and then misleads.
    expect(providerScan("circle-cctp", HASH)).toBeUndefined();
  });

  it("is case-insensitive", () => {
    expect(providerScan("LiFi", HASH)?.label).toBe("LI.FI scan");
  });
});

describe("chainExplorer", () => {
  it("knows the testnets this repo settles on", () => {
    expect(chainExplorer(11155111)?.label).toContain("Sepolia");
    expect(chainExplorer(5042002)?.label).toContain("ArcScan");
  });

  it("returns undefined for an unknown chain", () => {
    expect(chainExplorer(999999)).toBeUndefined();
  });
});

describe("transactionLinks", () => {
  it("prefers the provider scan as the primary link", () => {
    const links = transactionLinks({ txHash: HASH, chainId: 137, source: "lifi" });
    expect(links?.primary.url).toBe(`https://scan.li.fi/tx/${HASH}`);
    expect(links?.provider?.url).toBe(`https://scan.li.fi/tx/${HASH}`);
    expect(links?.sourceChain?.url).toBe(`https://polygonscan.com/tx/${HASH}`);
  });

  it("falls back to the chain explorer when the provider has no scan", () => {
    const links = transactionLinks({ txHash: HASH, chainId: 137, source: "circle-cctp" });
    expect(links?.primary.label).toBe("Polygonscan");
    expect(links?.provider).toBeUndefined();
  });

  it("carries the destination leg of a bridge as well as the source", () => {
    const links = transactionLinks({
      txHash: HASH,
      chainId: 137,
      source: "lifi",
      deliveredTxHash: "0xdef456",
      destinationChainId: 8453,
    });
    expect(links?.destination?.url).toBe("https://basescan.org/tx/0xdef456");
  });

  it("offers the Circle attestation endpoint for a CCTP message", () => {
    const links = transactionLinks({ txHash: HASH, chainId: 11155111, messageHash: "0xmsg" });
    expect(links?.attestation?.url).toContain("iris-api.circle.com");
  });

  it("returns undefined rather than inventing a link", () => {
    expect(transactionLinks({ txHash: HASH })).toBeUndefined();
    expect(transactionLinks({ txHash: HASH, chainId: 999999 })).toBeUndefined();
    expect(transactionLinks({ txHash: "   " })).toBeUndefined();
  });
});

describe("isKnownSource", () => {
  it("recognises the port's own ids", () => {
    expect(isKnownSource("lifi")).toBe(true);
    expect(isKnownSource("not-a-venue")).toBe(false);
  });
});
