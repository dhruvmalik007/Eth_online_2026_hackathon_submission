import { describe, expect, it } from "vitest";
import { formatAllocUsd, formatUsd, navFrom } from "./nav";
import type { PortfolioView } from "./server";

function view(over: Partial<PortfolioView>): PortfolioView {
  return {
    address: "0x63185C0f059dE46DBeEa6813ab461A8863E40e21",
    readAt: "2026-09-14T00:00:00.000Z",
    chains: [],
    pricedUsd: 0,
    unpriced: 0,
    unavailableChains: 0,
    tokenSource: "lifi",
    provenance: "client-supplied",
    ...over,
  };
}

const holding = (valueUsd: number | null) => ({
  symbol: "USDC",
  address: null,
  decimals: 6,
  amount: "1",
  formatted: "1",
  priceUsd: valueUsd,
  valueUsd,
});

describe("navFrom", () => {
  it("treats an unread portfolio as empty rather than zero", () => {
    expect(navFrom(null)).toEqual({ pricedUsd: 0, unpriced: 0, empty: true });
  });

  it("counts holdings it could not price, so the total reads as a floor", () => {
    const summary = navFrom(
      view({
        pricedUsd: 1234.5,
        unpriced: 2,
        chains: [
          { chainId: 137, label: "Polygon", nativeSymbol: "POL", status: "ok", native: null, tokens: [holding(1234.5)], pricedUsd: 1234.5, unpriced: 2 },
        ],
      }),
    );
    expect(summary.pricedUsd).toBe(1234.5);
    expect(summary.unpriced).toBe(2);
    expect(summary.empty).toBe(false);
  });

  it("is empty when every chain answered with nothing", () => {
    const summary = navFrom(
      view({ chains: [{ chainId: 1, label: "Ethereum", nativeSymbol: "ETH", status: "ok", native: null, tokens: [], pricedUsd: 0, unpriced: 0 }] }),
    );
    expect(summary.empty).toBe(true);
  });
});

describe("formatUsd", () => {
  it("shortens by magnitude without losing the sense of the number", () => {
    expect(formatUsd(812.4242)).toBe("$812.42");
    expect(formatUsd(12_400)).toBe("$12.4K");
    expect(formatUsd(124_000)).toBe("$124K");
    expect(formatUsd(1_240_000)).toBe("$1.2M");
  });
});

describe("formatAllocUsd", () => {
  it("shows a dash when no total has been read, never a zero", () => {
    expect(formatAllocUsd(null)).toBe("—");
    expect(formatAllocUsd(2500)).toBe("$2,500");
  });
});
