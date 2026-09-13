/**
 * Address-book-sourced LayerZero constants, with provenance.
 *
 * ## Where these come from
 *
 * [`LayerZero-Labs/lz-address-book`](https://github.com/LayerZero-Labs/lz-address-book)
 * — "All LayerZero V2 addresses in pure Solidity… auto-generated… across 320+ EVM
 * blockchain networks", regenerated **every 6 hours** by GitHub Actions, and each
 * generated file carries an `LZ_ADDRESSES_DATA_HASH` for provenance.
 *
 * ## Why these are mirrored rather than imported
 *
 * The address book is a **Foundry/Solidity** library (`forge install`), not an npm
 * package, so there is no module to import from TypeScript. Its values are
 * compile-time Solidity constants on the other side of a language boundary.
 *
 * Mirroring is therefore the honest option, and the mitigations are:
 *
 * 1. **Every value cites its source.** {@link ENDPOINT_V2_ADDRESS} is not recalled
 *    from memory — it is the exact value the address book asserts in its own test.
 * 2. **A test pins the two representations together.** `addressBook.test.ts`
 *    checks these EIDs against the ones in `test-scenarios.json`, so a drift
 *    between the two files fails rather than silently misrouting a message.
 * 3. **Regeneration is a known follow-up.** A build step could read
 *    `src/generated/LZAddresses.sol` and emit this file; until then, a 6-hourly
 *    upstream refresh is a manual sync.
 *
 * ## What the address book offers that this file does not yet carry
 *
 * `LZAddressContext` also exposes `getExecutor()`, `getSendUln302()`,
 * `getReceiveUln302()` and `getDVNByName("LayerZero Labs")` — the components of the
 * fee this file prices as a single number. Splitting the DVN and executor shares
 * apart would let a quote show *why* a pathway is expensive, which is a natural
 * next step now that a real fee is being read.
 */

/**
 * LayerZero V2 `EndpointV2` — identical on every chain it supports.
 *
 * Verified against the address book's own assertion in `test/examples/MyOFT.t.sol`:
 *
 * ```solidity
 * assertEq(endpoint, 0x1a44076050125825900e736c501f859c50fE728c);
 * ```
 */
export const ENDPOINT_V2_ADDRESS = "0x1a44076050125825900e736c501f859c50fE728c" as const;

/**
 * Chain identifiers, from the address book's "Common Chain Identifiers" table.
 *
 * The native `chainId` is LayerZero's own index (`setChainByChainId`), and `eid`
 * is what a message actually addresses — the two are unrelated numbers, which is
 * why both are carried.
 */
export const ADDRESS_BOOK_CHAINS: Readonly<
  Record<string, { readonly name: string; readonly eid: number; readonly chainId: number }>
> = {
  "ethereum-mainnet": { name: "ethereum-mainnet", eid: 30101, chainId: 1 },
  "arbitrum-mainnet": { name: "arbitrum-mainnet", eid: 30110, chainId: 42161 },
  "base-mainnet": { name: "base-mainnet", eid: 30184, chainId: 8453 },
  "optimism-mainnet": { name: "optimism-mainnet", eid: 30111, chainId: 10 },
  "polygon-mainnet": { name: "polygon-mainnet", eid: 30109, chainId: 137 },
};

/** The address book's name for a chain, or `undefined` if it has none. */
export function addressBookNameForChainId(chainId: number): string | undefined {
  return Object.values(ADDRESS_BOOK_CHAINS).find((chain) => chain.chainId === chainId)?.name;
}
