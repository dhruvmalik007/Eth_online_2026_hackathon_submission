/**
 * Guards for the settlement registry.
 *
 * The load-bearing assertions here are the negative ones. Anyone can add an address
 * to a map; what protects a settlement path is that an unverified protocol resolves
 * to `null` and fails loudly, rather than falling back to a guessed address.
 *
 * These do not hit the network — the on-chain bytecode check is a separate, live
 * verification (see the settlements probe), because a unit test that silently needs
 * an RPC is a unit test that fails in CI for the wrong reason.
 */
import { describe, expect, it } from "vitest";
import {
  SETTLEMENT_CHAIN_ID,
  SETTLEMENT_TOKENS,
  SETTLEMENT_VENUES,
  UNVERIFIED_PROTOCOLS,
  resolveSettlementVenue,
} from "../src/index.js";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

describe("settlement registry", () => {
  it("settles on Sepolia, where the deployed Safe lives", () => {
    expect(SETTLEMENT_CHAIN_ID).toBe(11155111);
  });

  it("keeps all three Sepolia USDCs distinct", () => {
    // Conflating these is the trap this registry exists to prevent. They are all
    // 6-decimal and all called USDC, so only the address separates them: a supply
    // leg built with the wrong one reverts, and a Stargate bridge with the wrong
    // one cannot be deposited into the pool.
    const usdcs = [SETTLEMENT_TOKENS.usdc, SETTLEMENT_TOKENS.usdcCircle, SETTLEMENT_TOKENS.usdcStargate];
    const addresses = usdcs.map((token) => token.address.toLowerCase());
    expect(new Set(addresses).size).toBe(3);
    expect(SETTLEMENT_TOKENS.usdc.note).toContain("NOT the same token");
  });

  it("resolves a verified venue with its target and spender", () => {
    const aave = resolveSettlementVenue("aave-v3");
    expect(aave?.target.address).toBe("0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951");
    expect(aave?.token?.address).toBe(SETTLEMENT_TOKENS.usdc.address);
    // The Pool pulls the deposit, so the Pool must be the approved spender.
    expect(aave?.spender?.address).toBe(aave?.target.address);
    expect(aave?.actions).toContain("SUPPLY_CAPITAL");
  });

  it("is case- and whitespace-insensitive on the protocol name", () => {
    expect(resolveSettlementVenue("  AAVE-V3 ")?.protocol).toBe("aave-v3");
  });

  it("carries Morpho at its canonical address, not the docs' second Sepolia entry", () => {
    // Agents address Morpho's deterministic CREATE2 address. Registering the
    // docs-listed Sepolia-only deployment instead made every real Morpho leg look
    // unmapped, which is how this was caught.
    const morpho = resolveSettlementVenue("morpho");
    expect(morpho?.target.address).toBe("0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb");
    expect(morpho?.auxiliary?.["sepoliaStandaloneDeployment"]?.address).toBe(
      "0xd011EE229E7459ba1ddd22631eF7bF528d424A14",
    );
  });

  it("resolves the LayerZero OApp as Stargate's pool, for bridging only", () => {
    // LayerZero is a messaging layer, not a set of protocol integrations, so the
    // "OApp" for a stablecoin bridge is the Stargate pool.
    const stargate = resolveSettlementVenue("layerzero-stargate");
    expect(stargate?.target.address).toBe("0x4985b8fcEA3659FD801a5b857dA1D00e985863F0");
    expect(stargate?.actions).toEqual(["BRIDGE"]);
    expect(stargate?.mode).toBe("live");
    // It bridges its own pool token, not Circle's or Aave's USDC.
    expect(stargate?.token?.address).toBe(SETTLEMENT_TOKENS.usdcStargate.address);
  });

  it("marks Lido simulation-only and says why", () => {
    // Lido's deposit is a single payable call — the environment is the blocker, not
    // the encoding. Sepolia is deprecated and withdrawals are paused indefinitely,
    // so a live Lido leg would be a round trip that cannot complete.
    const lido = resolveSettlementVenue("lido");
    expect(lido).not.toBeNull();
    expect(lido?.mode).toBe("simulation");
    expect(lido?.modeReason).toContain("withdrawals are paused");
    // A deposit needs no approval leg: `submit()` is payable.
    expect(lido?.spender).toBeUndefined();
  });

  it("requires a reason wherever a venue cannot be broadcast", () => {
    for (const venue of Object.values(SETTLEMENT_VENUES)) {
      if (venue.mode === "simulation") {
        expect(venue.modeReason?.length ?? 0, `${venue.protocol} modeReason`).toBeGreaterThan(0);
      }
    }
  });

  it("refuses protocols whose Sepolia deployment is unverified", () => {
    for (const protocol of Object.keys(UNVERIFIED_PROTOCOLS)) {
      expect(resolveSettlementVenue(protocol), protocol).toBeNull();
      // …and says why, so the caller can surface a reason rather than a blank.
      expect(UNVERIFIED_PROTOCOLS[protocol]?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("returns null for a protocol it has never heard of", () => {
    expect(resolveSettlementVenue("definitely-not-a-protocol")).toBeNull();
  });

  it("carries provenance and a well-formed address on every entry", () => {
    const sourced = [
      ...Object.values(SETTLEMENT_TOKENS),
      ...Object.values(SETTLEMENT_VENUES).flatMap((venue) => [
        venue.target,
        ...(venue.token === undefined ? [] : [venue.token]),
        ...(venue.spender === undefined ? [] : [venue.spender]),
        ...Object.values(venue.auxiliary ?? {}),
      ]),
    ];
    expect(sourced.length).toBeGreaterThan(5);
    for (const entry of sourced) {
      expect(entry.address).toMatch(ADDRESS);
      // Provenance must be re-checkable — either a URL, or a path inside this repo
      // for values the repo itself already asserts (the CCTP test-USDC). An address
      // with no source is how a registry rots.
      expect(entry.source).toMatch(/^(https?:\/\/|[\w.-]+\/)/);
    }
  });
});
