/**
 * The chain registry — everything the Aqua/SwapVM layer needs to know about a chain,
 * in one place, with provenance.
 *
 * ## Why this is two chains and not four
 *
 * The package targets **Optimism and Polygon only**, because those are the only two
 * chains that can be expressed in `@ethonline2026/execution-domain`. That package's
 * `CHAIN_KEYS` is `["base", "polygon", "optimism"]`, and its `IntentLeg`,
 * `ExecutionStep`, `ExecutionPlan` and `ExecutionRecord` all carry a `ChainKey`. So a
 * leg on Ethereum or Arbitrum has no way to be described: the types cannot hold it, and
 * widening that union is a change to the shared domain rather than to this package.
 *
 * Rather than carry entries nothing downstream can address, the matrix is exactly the
 * intersection. Ethereum and Arbitrum *were* verified during this work — see
 * `docs/reference-verified-addresses.md` — and re-adding them is a matter of extending
 * `CHAIN_KEYS` once the domain can express them.
 *
 * `packages/bridges` already covers large-order 1inch routing across the wider chain
 * set, so a two-chain Aqua integration is a complement to it, not a replacement.
 *
 * ## What is pinned here, and how each value was established
 *
 * Nothing in this file is recalled from memory. Each entry falls into one of three
 * provenance classes, and the class is visible in the type:
 *
 * 1. **Deterministic deployments** — Aqua and the AquaSwapVMRouter are deployed at the
 *    *same address on every supported chain by design* (that is the point of their
 *    `0x1111…` vanity prefix), as is Permit2. One value, both chains.
 * 2. **Per-chain deployments** — Uniswap v4, Morpho and the ERC-20s differ per chain.
 *    Uniswap's own docs warn explicitly that "integrators should no longer assume that
 *    they are deployed to the same addresses across chains", so these are stated per
 *    chain and asserted at the fork block.
 * 3. **Unresolved** — a value we need and have not verified. `Unresolved` exists so this
 *    is a *typed* state rather than a placeholder that looks real. The Aave V3 pools are
 *    the only such values, and they carry the exact source to fill them from.
 */

import type { Address, MaybePinned, Pinned } from "./address.js";
import { pinned, unresolved } from "./address.js";

/**
 * The active matrix.
 *
 * Optimism and Polygon: the intersection of this package's chains with
 * `execution-domain`'s `CHAIN_KEYS`.
 */
export const CHAIN_KEYS = ["optimism", "polygon"] as const;
export type ChainKey = (typeof CHAIN_KEYS)[number];

/** ERC-20s the strategies touch. Named for their role, not their symbol. */
export interface TokenDeployment {
  /** The stablecoin the flight lands in, and the vault asset. Native, not bridged. */
  readonly usdc: Pinned;
  /** The volatile leg. Wrapped native, because SwapVM settles WETH without unwrapping. */
  readonly weth: Pinned;
}

/**
 * A curated Morpho vault.
 *
 * Curated rather than discovered at runtime, because `VaultV2Factory` deploys vaults and
 * the Morpho API lists thousands — including test deployments, zero-asset vaults, and
 * vaults whose reported APY is three hundred thousand percent. A destination a strategy
 * can flee *into* has to be chosen and then verified on-chain, not picked by a query.
 *
 * `observed*` fields are the state at discovery time, recorded so a reader can see the
 * basis for the choice. They are **not** used at runtime and are expected to go stale;
 * the live values are read from the vault.
 */
export interface MorphoVaultRef {
  readonly address: Address;
  readonly name: string;
  /** The vault's `asset()`. Asserted on-chain before the vault is used. */
  readonly asset: Address;
  /** Assets under management when this entry was curated, in whole USDC. */
  readonly observedTotalAssetsUsdc: number;
  /** Reported APY when curated, in percent. A signal, never a promise. */
  readonly observedApyPct: number;
  readonly source: string;
}

export interface MorphoDeployment {
  /** Deploys a vault. **Not** a destination for funds. */
  readonly vaultV2Factory: Pinned;
  /** Resolves vaults and markets on-chain. */
  readonly morphoRegistry: Pinned;
  /** Adapter letting a V2 vault allocate into a V1 vault. */
  readonly marketV1AdapterV2Factory: Pinned;
  /** Morpho Blue — the variable-rate market. */
  readonly blue: Pinned;
  /**
   * Morpho Midnight — the fixed-rate, fixed-term venue.
   *
   * Absent on both chains in this matrix: there is no `MidnightBundlesV1` deployment on
   * Optimism or Polygon (only Ethereum and Base). Kept as an optional field so its
   * absence is a *fact about the venue* rather than an unresolved gap, and so adding it
   * back is one field rather than a redesign.
   */
  readonly midnight?: Pinned;
  /** The curated destination(s). Ranked at runtime by smoothed yield. */
  readonly vaults: readonly MorphoVaultRef[];
}

/** Aave V4 — Ethereum-only, so not present in this matrix. */
export interface AaveV4Deployment {
  readonly version: "v4";
  readonly coreHub: Pinned;
  readonly primeHub: Pinned;
  readonly plusHub: Pinned;
  readonly takerPositionManager: Pinned;
  readonly lidoESpoke: Pinned;
  readonly etherfiESpoke: Pinned;
}

/**
 * Aave V3 — the variable-rate pool.
 *
 * The **Pool and its Addresses Provider sit at the same address on every chain**, which is not a
 * coincidence to memorise but a property of the deployment: V3 is deployed deterministically from the
 * same init code, so the Pool is a cross-chain constant in the way Aqua and the SwapVM router are. It
 * is still recorded per chain, because it is that chain's deployment — and a test asserts the two
 * agree, which turns a fat-fingered copy into a failure rather than a wrong call.
 *
 * The oracle and the data provider differ per chain and are genuinely per-chain data.
 */
export interface AaveV3Deployment {
  readonly version: "v3";
  readonly pool: MaybePinned;
  readonly addressesProvider: MaybePinned;
  readonly oracle: MaybePinned;
  /** Reads reserve data in one call — what a yield signal wants rather than looping `getReserveData`. */
  readonly uiPoolDataProvider: MaybePinned;
}

export type AaveDeployment = AaveV4Deployment | AaveV3Deployment;

export interface ChainDeployment {
  readonly key: ChainKey;
  readonly chainId: number;
  readonly name: string;
  readonly explorer: string;
  /** Env var holding the RPC to fork this chain from. */
  readonly rpcEnvKey: string;
  /** Env var holding the block to pin the fork to. Evidence records this. */
  readonly forkBlockEnvKey: string;
  readonly nativeCurrency: { readonly name: string; readonly symbol: string; readonly decimals: number };
  readonly tokens: TokenDeployment;
  /** Same address on every chain — that is the design of the protocol. */
  readonly permit2: Pinned;
  /** Same address on every chain. */
  readonly aqua: Pinned;
  /** The canonical router, as a reference for our own redeployment's constructor. */
  readonly aquaSwapVmRouter: Pinned;
  readonly uniswapV4: { readonly poolManager: Pinned; readonly positionManager: Pinned };
  readonly morpho: MorphoDeployment;
  readonly aave: AaveDeployment;
}

// ─── Deterministic deployments ───────────────────────────────────────────────
// One value, every chain. From the protocols' own deployments tables and confirmed by
// their SDKs, which ship the same constants.

const AQUA_SOURCE =
  "1inch/aqua README > Deployments, and @1inch/aqua-sdk AQUA_CONTRACT_ADDRESSES (identical on every supported chain)";
const AQUA_ROUTER_SOURCE =
  "1inch/swap-vm README > Deployment, and @1inch/swap-vm-sdk AQUA_SWAP_VM_CONTRACT_ADDRESSES (identical on every supported chain)";
const PERMIT2_SOURCE = "Uniswap deployments.json Permit2 (identical on every supported chain)";

const AQUA: Pinned = pinned("0x1111113ccf1426a8e30e2bff5e005d929bf6a90a", AQUA_SOURCE);
const AQUA_SWAP_VM_ROUTER: Pinned = pinned(
  "0x111111338c5091e8440b67b168bae16a668ac0de",
  AQUA_ROUTER_SOURCE,
);
const PERMIT2: Pinned = pinned("0x000000000022D473030F116dDEE9F6B43aC78BA3", PERMIT2_SOURCE);

// ─── Per-chain token addresses ───────────────────────────────────────────────
// WETH symbol and decimals were read on-chain on both chains before being pinned here,
// so these are verified values rather than recalled ones. The fork suite re-asserts
// them, which is what would catch a chain-level upgrade.

const WETH_SOURCE = "Verified on-chain: symbol() == 'WETH', decimals() == 18";

const USDC_OPTIMISM = pinned(
  "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
  "Circle native USDC; corroborated by the Morpho API returning this as the asset of every Optimism USDC vault",
  { erc20Symbol: "USDC", erc20Decimals: 6 },
);
const USDC_POLYGON = pinned(
  "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  "Circle native USDC on Polygon. NOT 0x2791…4174, which is bridged USDC.e — the Morpho API lists vaults against both, so the distinction is load-bearing",
  { erc20Symbol: "USDC", erc20Decimals: 6 },
);

const WETH_OPTIMISM = pinned("0x4200000000000000000000000000000000000006", WETH_SOURCE, {
  erc20Symbol: "WETH",
  erc20Decimals: 18,
});
const WETH_POLYGON = pinned("0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", WETH_SOURCE, {
  erc20Symbol: "WETH",
  erc20Decimals: 18,
});

const UNISWAP_V4_SOURCE = "Uniswap v4 Deployments (developers.uniswap.org/docs/protocols/v4/deployments)";
const UNISWAP_V4_ASSERT = { codeExists: true, note: "Uniswap v4 PoolManager" } as const;

const MORPHO_INFRA_SOURCE =
  "Morpho docs > Developers > Contracts > Addresses (docs.morpho.org/developers/contracts/addresses)";

const VAULT_SOURCE = "Morpho API (blue-api.morpho.org/graphql) vaults query, filtered and then asserted on-chain";

export const CHAINS: Readonly<Record<ChainKey, ChainDeployment>> = {
  optimism: {
    key: "optimism",
    chainId: 10,
    name: "OP Mainnet",
    explorer: "https://optimistic.etherscan.io",
    rpcEnvKey: "OPTIMISM_RPC_URL",
    forkBlockEnvKey: "OPTIMISM_FORK_BLOCK",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    tokens: { usdc: USDC_OPTIMISM, weth: WETH_OPTIMISM },
    permit2: PERMIT2,
    aqua: AQUA,
    aquaSwapVmRouter: AQUA_SWAP_VM_ROUTER,
    uniswapV4: {
      poolManager: pinned("0x9a13f98cb987694c9f086b1f5eb990eea8264ec3", UNISWAP_V4_SOURCE, UNISWAP_V4_ASSERT),
      positionManager: pinned("0x3c3ea4b57a46241e54610e5f022e5c45859a1017", UNISWAP_V4_SOURCE, UNISWAP_V4_ASSERT),
    },
    morpho: {
      vaultV2Factory: pinned("0x6128b680b277Bf4Df80DFE9D8c55A498660870ef", MORPHO_INFRA_SOURCE),
      morphoRegistry: pinned("0xD1346be260cd22Eab9E6163010b0D5CbfAAAD32b", MORPHO_INFRA_SOURCE),
      marketV1AdapterV2Factory: pinned("0x71B299bDb52b6396429cd1E11c418324502CB434", MORPHO_INFRA_SOURCE),
      blue: pinned("0xce95AfbB8EA029495c66020883F87aaE8864AF92", MORPHO_INFRA_SOURCE),
      // No `midnight`: there is no MidnightBundlesV1 deployment on Optimism.
      vaults: [
        {
          address: "0xC30ce6A5758786e0F640cC5f881Dd96e9a1C5C59",
          name: "Gauntlet USDC Prime",
          asset: USDC_OPTIMISM.address,
          observedTotalAssetsUsdc: 833_460,
          observedApyPct: 4.64,
          source: VAULT_SOURCE,
        },
      ],
    },
    aave: {
      version: "v3",
      // Identical to Polygon's: deterministic deployment, not a copy-paste error.
      pool: pinned("0x794a61358D6845594F94dc1DB02A252b5b4814aD", "Aave Address Book JSON API: https://assets.aave.com/address-book/releases/latest/modules/AaveV3Optimism.json > POOL; code present on-chain, verified by `pnpm run smoke`"),
      addressesProvider: pinned(
        "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb",
        "Aave Address Book JSON API: https://assets.aave.com/address-book/releases/latest/modules/AaveV3Optimism.json > POOL_ADDRESSES_PROVIDER; code present on-chain, verified by `pnpm run smoke`",
      ),
      oracle: pinned("0xD81eb3728a631871a7eBBaD631b5f424909f0c77", "Aave Address Book JSON API: https://assets.aave.com/address-book/releases/latest/modules/AaveV3Optimism.json > ORACLE; code present on-chain, verified by `pnpm run smoke`"),
      uiPoolDataProvider: pinned(
        "0x68100bD5345eA474D93577127C11F39FF8463e93",
        "Aave Address Book JSON API: https://assets.aave.com/address-book/releases/latest/modules/AaveV3Optimism.json > UI_POOL_DATA_PROVIDER; code present on-chain, verified by `pnpm run smoke`",
      ),
    },
  },

  polygon: {
    key: "polygon",
    chainId: 137,
    name: "Polygon",
    explorer: "https://polygonscan.com",
    rpcEnvKey: "POLYGON_RPC_URL",
    forkBlockEnvKey: "POLYGON_FORK_BLOCK",
    nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
    tokens: { usdc: USDC_POLYGON, weth: WETH_POLYGON },
    permit2: PERMIT2,
    aqua: AQUA,
    aquaSwapVmRouter: AQUA_SWAP_VM_ROUTER,
    uniswapV4: {
      poolManager: pinned("0x67366782805870060151383f4bbff9dab53e5cd6", UNISWAP_V4_SOURCE, UNISWAP_V4_ASSERT),
      positionManager: pinned("0x1ec2ebf4f37e7363fdfe3551602425af0b3ceef9", UNISWAP_V4_SOURCE, UNISWAP_V4_ASSERT),
    },
    morpho: {
      vaultV2Factory: pinned("0xC11a53eE9B1eCc7a068D8e40F8F17926584F97Cf", MORPHO_INFRA_SOURCE),
      morphoRegistry: pinned("0xb70a43821d2707fA9d0EDd9511CC499F468Ba564", MORPHO_INFRA_SOURCE),
      marketV1AdapterV2Factory: pinned("0xc0006f52B38625C283dd2f972dD9B779A5851Dd0", MORPHO_INFRA_SOURCE),
      blue: pinned("0x1bF0c2541F820E775182832f06c0B7Fc27A25f67", MORPHO_INFRA_SOURCE),
      // No `midnight`: no MidnightBundlesV1 deployment on Polygon.
      vaults: [
        {
          address: "0x781FB7F6d845E3bE129289833b04d43Aa8558c42",
          name: "Compound USDC",
          asset: USDC_POLYGON.address,
          observedTotalAssetsUsdc: 930_856,
          observedApyPct: 2.87,
          source: VAULT_SOURCE,
        },
      ],
    },
    aave: {
      version: "v3",
      // Identical to Optimism's, and asserted so by the registry tests.
      pool: pinned("0x794a61358D6845594F94dc1DB02A252b5b4814aD", "Aave Address Book JSON API: https://assets.aave.com/address-book/releases/latest/modules/AaveV3Polygon.json > POOL; code present on-chain, verified by `pnpm run smoke`"),
      addressesProvider: pinned(
        "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb",
        "Aave Address Book JSON API: https://assets.aave.com/address-book/releases/latest/modules/AaveV3Polygon.json > POOL_ADDRESSES_PROVIDER; code present on-chain, verified by `pnpm run smoke`",
      ),
      oracle: pinned("0xb023e699F5a33916Ea823A16485e259257cA8Bd1", "Aave Address Book JSON API: https://assets.aave.com/address-book/releases/latest/modules/AaveV3Polygon.json > ORACLE; code present on-chain, verified by `pnpm run smoke`"),
      uiPoolDataProvider: pinned(
        "0x66E1aBdb06e7363a618D65a910c540dfED23754f",
        "Aave Address Book JSON API: https://assets.aave.com/address-book/releases/latest/modules/AaveV3Polygon.json > UI_POOL_DATA_PROVIDER; code present on-chain, verified by `pnpm run smoke`",
      ),
    },
  },
};

/** Look up a chain, failing loudly on a typo rather than returning `undefined`. */
export function chain(key: ChainKey): ChainDeployment {
  return CHAINS[key];
}

/** Look up by EVM chain id — the form that arrives from an RPC or a quote. */
export function chainById(chainId: number): ChainDeployment | undefined {
  return CHAIN_KEYS.map((key) => CHAINS[key]).find((entry) => entry.chainId === chainId);
}

export function chainKeyById(chainId: number): ChainKey | undefined {
  return chainById(chainId)?.key;
}

/**
 * A viem `Chain`, built from the registry rather than imported.
 *
 * `packages/arc` does the same and for the same reason: importing `viem/chains` would give
 * us a second source of truth for `chainId` and the default RPC, which can drift from the
 * registry the fork harness actually uses. One source.
 */
export function viemChain(deployment: ChainDeployment): {
  readonly id: number;
  readonly name: string;
  readonly nativeCurrency: ChainDeployment["nativeCurrency"];
  readonly rpcUrls: { readonly default: { readonly http: readonly string[] } };
} {
  return {
    id: deployment.chainId,
    name: deployment.name,
    nativeCurrency: deployment.nativeCurrency,
    // Deliberately empty: the RPC comes from the environment (`deployment.rpcEnvKey`), and
    // a baked-in default would silently send a fork scenario to a public endpoint that
    // rate-limits or lies.
    rpcUrls: { default: { http: [] } },
  };
}

/**
 * Every unresolved value in the registry, with the chain it belongs to.
 *
 * Exists so the gap is *enumerable* rather than discovered one thrown error at a time —
 * the registry test asserts this set, so filling a value is a deliberate act that changes
 * a test rather than a silent edit.
 */
export function unresolvedAddresses(): readonly { readonly chain: ChainKey; readonly what: string }[] {
  const found: { chain: ChainKey; what: string }[] = [];
  for (const key of CHAIN_KEYS) {
    const { aave } = CHAINS[key];
    if (aave.version !== "v3") continue;
    if (!("address" in aave.pool)) found.push({ chain: key, what: `${key}.aave.pool` });
    if (!("address" in aave.addressesProvider)) found.push({ chain: key, what: `${key}.aave.addressesProvider` });
  }
  return found;
}
