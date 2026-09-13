/**
 * The registry's own tests.
 *
 * These are cheap and they cover the failure that would be most expensive: a wrong or
 * malformed address in the registry is invisible until a transaction settles somewhere
 * nobody controls. Everything here runs offline.
 */

import { describe, expect, it } from "vitest";
import {
  CHAINS,
  CHAIN_KEYS,
  chainById,
  chainKeyById,
  isAddress,
  isPinned,
  requireAddress,
  unresolved,
  unresolvedAddresses,
  viemChain,
} from "../src/index.js";

interface Found {
  /** The path to the *pinned object*, e.g. `optimism.morpho.blue`. */
  readonly path: string;
  readonly address: string;
  readonly source: string;
}

/**
 * Walk a structure and collect every value carrying an address and a source.
 *
 * A walker rather than a hand-written list of assertions, on purpose: it covers every
 * address in the registry including ones added later, so a new chain cannot be
 * introduced without its addresses being checked.
 *
 * The recorded path names the pinned object rather than its `.address` field, because the
 * walk stops at the object — so a suffix like `morpho.blue` is the key a caller compares
 * on, not `morpho.blue.address`.
 */
function collectAddresses(value: unknown, path: string, found: Found[] = []): Found[] {
  if (value === null || typeof value !== "object") return found;

  if (isPinned(value as never)) {
    const candidate = value as { address: string; source: string };
    found.push({ path, address: candidate.address, source: candidate.source });
    return found;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectAddresses(item, `${path}[${index}]`, found));
    return found;
  }
  for (const [key, nested] of Object.entries(value)) {
    collectAddresses(nested, path === "" ? key : `${path}.${key}`, found);
  }
  return found;
}

const ALL = collectAddresses(CHAINS, "");

/** `optimism.morpho.blue` → `morpho.blue`, so chains can be compared. */
function pathWithoutChain(path: string): string {
  return path.replace(/^[a-z]+\./, "");
}

/** The chain key a walker path belongs to. */
function chainOf(path: string): string {
  return path.split(".")[0] ?? "";
}

/**
 * Paths that are legitimately identical on every chain.
 *
 * Aqua, its canonical router and Permit2 are deployed deterministically — the `0x1111…`
 * prefix is the protocol's own statement that they share an address everywhere. Nothing
 * else should match across every chain, and the realistic accident this guards against is
 * a value copy-pasted between chain blocks during a hand edit.
 */
/**
 * Paths whose address is the same on every chain.
 *
 * Aave V3 belongs here for the same reason Aqua does: V3 is deployed deterministically from the same
 * init code, so the Pool and its Addresses Provider are cross-chain constants. Listing them makes the
 * coincidence declared rather than tolerated — the assertion below fails on an *undeclared* shared
 * address, so a mistaken copy-paste between chains cannot pass unnoticed.
 */
const DETERMINISTIC_PATHS = [
  "permit2",
  "aqua",
  "aquaSwapVmRouter",
  "aave.pool",
  "aave.addressesProvider",
];

describe("the matrix is restricted to the chains the domain can express", () => {
  it("is exactly Optimism and Polygon", () => {
    // `@ethonline2026/execution-domain`'s CHAIN_KEYS is ["base", "polygon", "optimism"], and
    // every leg, step, plan and record carries a ChainKey from it. A chain outside that set
    // has no way to be described, so the registry is the intersection rather than a superset
    // nothing downstream can address.
    expect([...CHAIN_KEYS]).toEqual(["optimism", "polygon"]);
  });

  it("keeps every chain id distinct", () => {
    const ids = CHAIN_KEYS.map((key) => CHAINS[key].chainId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(CHAINS.optimism.chainId).toBe(10);
    expect(CHAINS.polygon.chainId).toBe(137);
  });
});

describe("every pinned address", () => {
  it("is well-formed", () => {
    expect(ALL.length).toBeGreaterThan(0);
    const malformed = ALL.filter((entry) => !isAddress(entry.address));
    expect(malformed, `malformed addresses: ${JSON.stringify(malformed, null, 2)}`).toEqual([]);
  });

  it("cites a source, so it can be re-verified rather than trusted", () => {
    // The source is the whole point of the type. An entry without one would be
    // indistinguishable from a recalled value, which is what this registry exists to avoid.
    const unsourced = ALL.filter((entry) => entry.source.trim().length === 0);
    expect(unsourced).toEqual([]);
  });

  it("matches across every chain only where the protocol deploys deterministically", () => {
    // Only a path present on *every* chain can be a cross-chain duplicate: a value that
    // exists on one chain alone has one address by construction and is not evidence of
    // anything.
    const byPath = new Map<string, { chains: Set<string>; addresses: Set<string> }>();
    for (const entry of ALL) {
      const suffix = pathWithoutChain(entry.path);
      const bucket = byPath.get(suffix) ?? { chains: new Set<string>(), addresses: new Set<string>() };
      bucket.chains.add(chainOf(entry.path));
      bucket.addresses.add(entry.address.toLowerCase());
      byPath.set(suffix, bucket);
    }

    const identicalEverywhere = [...byPath.entries()]
      .filter(([, bucket]) => bucket.chains.size === CHAIN_KEYS.length && bucket.addresses.size === 1)
      .map(([suffix]) => suffix);

    const unexpected = identicalEverywhere.filter((suffix) => !DETERMINISTIC_PATHS.includes(suffix));
    expect(
      unexpected,
      `these paths are identical on every chain, which is only correct for deterministic deployments (${DETERMINISTIC_PATHS.join(", ")})`,
    ).toEqual([]);
  });
});

describe("deterministic deployments", () => {
  it("places Aqua, the canonical router and Permit2 at the same address on every chain", () => {
    for (const suffix of ["aqua", "aquaSwapVmRouter", "permit2"] as const) {
      const addresses = new Set(CHAIN_KEYS.map((key) => CHAINS[key][suffix].address.toLowerCase()));
      expect(addresses.size, `${suffix} must be at one address across chains`).toBe(1);
    }
  });

  it("uses a distinct Uniswap v4 PoolManager per chain", () => {
    // Uniswap's own docs warn explicitly against assuming cross-chain sameness here.
    const managers = CHAIN_KEYS.map((key) => CHAINS[key].uniswapV4.poolManager.address.toLowerCase());
    expect(new Set(managers).size).toBe(CHAIN_KEYS.length);
  });

  it("points every curated vault at that chain's native USDC", () => {
    // The mistake this catches is the one `validateVault` exists for, caught one step earlier
    // and without a network call. Polygon makes it concrete: the API lists vaults against
    // both native USDC and bridged USDC.e.
    for (const key of CHAIN_KEYS) {
      const usdc = CHAINS[key].tokens.usdc.address.toLowerCase();
      for (const vault of CHAINS[key].morpho.vaults) {
        expect(vault.asset.toLowerCase(), `${key} vault ${vault.name}`).toBe(usdc);
      }
    }
  });

  it("curates only vaults that held assets when they were checked", () => {
    // A zero-asset vault is the most common thing the Morpho API returns, so it is filtered at
    // curation time as well as verified at read time.
    for (const key of CHAIN_KEYS) {
      const empty = CHAINS[key].morpho.vaults.filter((vault) => vault.observedTotalAssetsUsdc <= 0);
      expect(empty, `${key} has a vault curated with no observed assets`).toEqual([]);
    }
  });

  it("gives every chain at least one vault, so the flight always has a destination", () => {
    for (const key of CHAIN_KEYS) {
      expect(CHAINS[key].morpho.vaults.length, `${key} has no curated vault`).toBeGreaterThan(0);
    }
  });
});

describe("chain lookup", () => {
  it("round-trips by chain id", () => {
    for (const key of CHAIN_KEYS) {
      expect(chainById(CHAINS[key].chainId)?.key).toBe(key);
      expect(chainKeyById(CHAINS[key].chainId)).toBe(key);
    }
  });

  it("returns undefined for a chain outside the matrix rather than guessing", () => {
    // Ethereum is a real chain with real addresses we verified — and it is still not in this
    // matrix, because the domain cannot express it. Returning undefined is the honest answer.
    expect(chainById(1)).toBeUndefined();
    expect(chainById(999_999)).toBeUndefined();
  });
});

describe("viemChain", () => {
  it("declares no default RPC", () => {
    // Deliberate: a baked-in default would silently send a fork scenario to a public endpoint
    // that rate-limits or serves stale state. The RPC comes from the environment, named by
    // `rpcEnvKey`.
    for (const key of CHAIN_KEYS) {
      expect(viemChain(CHAINS[key]).rpcUrls.default.http).toEqual([]);
    }
  });
});

describe("unresolved values", () => {
  it("is empty: every registered address is pinned to a source", () => {
    // This was four entries — the Aave V3 pools and providers on both chains — until they were read
    // from the Address Book and verified on-chain. Written as an equality so *adding* a placeholder
    // fails here, at the registry, rather than surfacing as a throw inside a leg.
    expect(unresolvedAddresses()).toEqual([]);
  });

  it("still refuses to hand out an address for an unresolved value", () => {
    // Constructed rather than read from the registry, because nothing there is unresolved any more —
    // asserted just above. The guard has to keep working for the next placeholder someone adds.
    const placeholder = unresolved("example: https://example.invalid/address-book");

    expect(() => requireAddress(placeholder, "optimism.aave.pool")).toThrow(/is unresolved/);
  });

  it("puts the Aave V3 pool at the same address on every chain", () => {
    // A property of the deployment, not of this file: V3 is deployed deterministically, so the Pool is
    // a cross-chain constant. Asserted because a fat-fingered copy between chains would otherwise read
    // as correct — the entries look identical either way.
    const pools = CHAIN_KEYS.map((key) => {
      const { aave } = CHAINS[key];
      if (aave.version !== "v3") throw new Error(`expected Aave v3 on ${key}`);
      return requireAddress(aave.pool, `${key}.aave.pool`);
    });

    expect(new Set(pools).size).toBe(1);
  });

  it("hands out the address for a resolved value", () => {
    expect(requireAddress(CHAINS.optimism.aqua, "optimism.aqua")).toBe(
      "0x1111113ccf1426a8e30e2bff5e005d929bf6a90a",
    );
  });
});

describe("version reality per chain", () => {
  it("models Aave V3 on both chains, since V4 is Ethereum-only", () => {
    expect(CHAINS.optimism.aave.version).toBe("v3");
    expect(CHAINS.polygon.aave.version).toBe("v3");
  });

  it("omits Morpho Midnight on both chains, because it is not deployed there", () => {
    // There is no MidnightBundlesV1 on Optimism or Polygon, so an `undefined` here is a fact
    // about the venue rather than a gap to fill.
    expect(CHAINS.optimism.morpho.midnight).toBeUndefined();
    expect(CHAINS.polygon.morpho.midnight).toBeUndefined();
  });
});
