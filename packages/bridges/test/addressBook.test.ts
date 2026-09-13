/**
 * Pins the address-book-derived constants to the scenario file.
 *
 * These are two hand-maintained representations of the same facts, in different
 * languages' idioms, on opposite sides of a boundary the compiler cannot check.
 * A drift between them would not fail loudly on its own — it would **misroute a
 * message to the wrong endpoint id**, which looks like a fee problem rather than
 * a configuration one. So it is checked here.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ADDRESS_BOOK_CHAINS, ENDPOINT_V2_ADDRESS, addressBookNameForChainId } from "../src/index.js";

interface ScenarioChain {
  readonly chainId: number;
  readonly lzEid: number;
  readonly network?: string;
}

describe("address-book constants", () => {
  it("carries the endpoint value the address book itself asserts", () => {
    // `lz-address-book` test/examples/MyOFT.t.sol:
    //   assertEq(endpoint, 0x1a44076050125825900e736c501f859c50fE728c);
    expect(ENDPOINT_V2_ADDRESS).toBe("0x1a44076050125825900e736c501f859c50fE728c");
  });

  it("agrees with test-scenarios.json on every mainnet LayerZero EID", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const file = JSON.parse(readFileSync(join(root, "test-scenarios.json"), "utf8")) as {
      chains: Record<string, ScenarioChain>;
    };

    const mainnet = Object.values(file.chains).filter((chain) => chain.network === "mainnet");
    // A guard on the guard: if the scenario file lost its mainnet entries this
    // test would pass vacuously.
    expect(mainnet.length).toBeGreaterThan(0);

    for (const chain of mainnet) {
      const name = addressBookNameForChainId(chain.chainId);
      expect(name, `chainId ${chain.chainId} is absent from the address book`).toBeDefined();
      expect(ADDRESS_BOOK_CHAINS[name ?? ""]?.eid, `EID for ${name ?? chain.chainId}`).toBe(
        chain.lzEid,
      );
    }
  });

  it("maps the chains the tests actually send from", () => {
    expect(addressBookNameForChainId(137)).toBe("polygon-mainnet");
    expect(addressBookNameForChainId(8453)).toBe("base-mainnet");
    // Arc Testnet has no LayerZero deployment, so it must NOT resolve.
    expect(addressBookNameForChainId(0)).toBeUndefined();
  });
});
