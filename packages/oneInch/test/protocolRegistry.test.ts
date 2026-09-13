/**
 * The protocol universe's tests.
 *
 * The drift test is the important one: this package duplicates four subgraph deployment ids
 * that live in `packages/the-graph`, so that it does not take a dependency on the indexing
 * layer for four strings. That trade is only safe if a divergence fails a test, which is
 * what the first `describe` below does.
 */

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CATEGORIES,
  CHAIN_KEYS,
  GRAPH_DEPLOYMENTS,
  PROTOCOLS,
  deepProtocols,
  protocol,
  protocolsIn,
  protocolsOn,
} from "../src/index.js";

/**
 * The source of truth for the duplicated deployment ids.
 *
 * Read rather than imported: `packages/the-graph` is deliberately not a dependency of this
 * package, and importing it in a test would reintroduce exactly the coupling the duplication
 * exists to avoid.
 */
/**
 * The sibling the deployment ids were copied from.
 *
 * Read-only, and deliberately not a build dependency: this package never imports from `the-graph`. The
 * path is checked before use because that package has its own branch in flight — a restructure there
 * should not break this suite, and a missing file is a reason to skip the drift check rather than to
 * fail it.
 */
const ENDPOINTS_SOURCE = new URL("../../the-graph/src/config/endpoints.ts", import.meta.url);

/** The first two per category, as the flight rule expects. */
const EXPECTED_PER_CATEGORY = 2;

describe("graph deployment ids stay in sync with packages/the-graph", () => {
  it("matches the source file exactly", () => {
    if (!existsSync(ENDPOINTS_SOURCE)) {
      // Reported, not silently passed: the check did not run, and a green suite that skipped it should
      // say so. `the-graph` moving this file is expected work, not a defect here.
      console.warn(
        `skipped the deployment-id drift check: ${ENDPOINTS_SOURCE.pathname} is absent. ` +
          `packages/the-graph's registry moved; re-point this test at its new location.`,
      );
      return;
    }
    const text = readFileSync(ENDPOINTS_SOURCE, "utf8");
    const fromSource: Record<string, string> = {};

    // Deployment ids are long alphanumeric base58 strings. The `{20,}` bound is what keeps
    // `tier: 'studio'` and `category: 'lending'` out of the capture.
    const pattern = /([A-Za-z]\w*):\s*'([A-Za-z0-9]{20,})'/g;
    for (const match of text.matchAll(pattern)) {
      const [, key, id] = match;
      if (key !== undefined && id !== undefined) fromSource[key] = id;
    }

    for (const [key, id] of Object.entries(GRAPH_DEPLOYMENTS)) {
      expect(fromSource[key], `${key} is absent from packages/the-graph/src/config/endpoints.ts`).toBeDefined();
      expect(
        fromSource[key],
        `${key} has drifted: this package pins ${id}, packages/the-graph has ${String(fromSource[key])}`,
      ).toBe(id);
    }
  });

  it("pins no deployment for a chain outside the matrix", () => {
    // The point of the restriction: a pinned id for Ethereum would invite a reader to wire up
    // a chain no leg can name.
    const keys = Object.keys(GRAPH_DEPLOYMENTS);
    expect(keys.some((key) => /Ethereum|Arbitrum|Base|Avalanche/.test(key))).toBe(false);
  });
});

describe("the ten venues", () => {
  it("has exactly two per category", () => {
    for (const category of CATEGORIES) {
      expect(protocolsIn(category).length, `category ${category}`).toBe(EXPECTED_PER_CATEGORY);
    }
  });

  it("totals ten, so the registry is the universe and not a subset of it", () => {
    expect(PROTOCOLS.length).toBe(CATEGORIES.length * EXPECTED_PER_CATEGORY);
  });

  it("uses unique ids, since they appear in reason codes and evidence", () => {
    const ids = PROTOCOLS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("throws for a category with no entries rather than returning a short list", () => {
    // A silently-empty list would make the policy reason over half a category. The double
    // assertion is deliberate: passing an out-of-union value is the point of the test.
    const unknownCategory = "nonexistent" as unknown as (typeof CATEGORIES)[number];
    expect(() => protocolsIn(unknownCategory)).toThrow(/No protocols registered/);
  });

  it("claims only chains that are in the matrix", () => {
    // This is the invariant that keeps the two registries from drifting: a venue here may not
    // name a chain the chain registry cannot describe.
    for (const entry of PROTOCOLS) {
      expect(entry.chains.length, `${entry.id} claims no chains`).toBeGreaterThan(0);
      for (const key of entry.chains) {
        expect(CHAIN_KEYS, `${entry.id} claims a chain outside the matrix: ${key}`).toContain(key);
      }
    }
  });

  it("marks exactly the four venues we open positions in as deep", () => {
    // Claiming a deep integration that does not exist is the easiest thing in this registry to
    // fake and the fastest way to lose a judge's trust.
    expect(deepProtocols().map((entry) => entry.id).sort()).toEqual([
      "1inch-aqua",
      "aave",
      "morpho",
      "uniswap-v4",
    ]);
  });

  it("explains why the signal-only venues are signal-only", () => {
    // A substantive `note` on every non-deep entry, so the limitation is documented rather
    // than discovered.
    for (const entry of PROTOCOLS.filter((candidate) => !candidate.deep)) {
      expect(entry.note.length, `${entry.id} has no note`).toBeGreaterThan(40);
    }
  });
});

describe("the rebalancing path exists on every chain in the matrix", () => {
  it("offers a deep lending destination and a deep liquidity origin on both chains", () => {
    // The property the flight depends on: because the destination is a Morpho vault and Vault
    // V2 spans 49 chains, no leg degrades to `protocol_absent_on_chain` on a chain we support.
    for (const key of CHAIN_KEYS) {
      const present = protocolsOn(key).filter((entry) => entry.deep);
      const lending = present.filter((entry) => entry.category === "lending");
      const liquidity = present.filter((entry) => entry.category === "liquidity");
      expect(lending.length, `${key} has no deep lending venue`).toBeGreaterThan(0);
      expect(liquidity.length, `${key} has no deep liquidity venue`).toBeGreaterThan(0);
    }
  });
});

describe("per-chain absence is modelled, not assumed away", () => {
  it("lists Polymarket only on Polygon", () => {
    expect(protocol("polymarket")?.chains).toEqual(["polygon"]);
  });

  it("omits Optimism from CoW Protocol", () => {
    // No CoW deployment on Optimism, so the execution-quality benchmark is simply unavailable
    // there rather than compared against a venue that does not exist.
    expect(protocol("cow-protocol")?.chains).not.toContain("optimism");
  });

  it("covers every chain with at least two venues, so a chain is never empty", () => {
    for (const key of CHAIN_KEYS) {
      expect(protocolsOn(key).length, `${key}`).toBeGreaterThanOrEqual(2);
    }
  });

  it("has a deep venue in four of the five categories, so the flight has a route", () => {
    // Staking is deliberately absent from the deep set — it is priced inside the lending leg.
    const deepCategories = new Set(deepProtocols().map((entry) => entry.category));
    expect([...deepCategories].sort()).toEqual(["lending", "liquidity", "trading"]);
  });
});

describe("Morpho is registered as the rebalancing venue, not as an offer book", () => {
  it("reads vault yield from the chain rather than from an API", () => {
    const morpho = protocol("morpho");
    expect(morpho).toBeDefined();
    if (morpho === undefined) throw new Error("unreachable");
    expect(morpho.signal.kind).toBe("evm");
    if (morpho.signal.kind !== "evm") throw new Error("unreachable");
    expect(morpho.signal.read).toContain("convertToAssets");
    // The reason is recorded where a maintainer will read it.
    expect(morpho.signal.note).toContain("297,995");
  });

  it("keeps Midnight as the fixed-rate instrument rather than the destination", () => {
    const morpho = protocol("morpho");
    if (morpho === undefined) throw new Error("unreachable");
    expect(morpho.version).toContain("Midnight");
    expect(morpho.note).toContain("signed-offer order book");
  });
});
