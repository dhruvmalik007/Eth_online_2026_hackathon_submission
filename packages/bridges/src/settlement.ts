/**
 * Settlement venues: where a signing intent's legs actually execute.
 *
 * ## Why this file exists separately from `addressBook.ts`
 *
 * `addressBook.ts` carries LayerZero's *bridging* constants (EndpointV2, EIDs). This
 * carries the addresses a **Safe leg** targets: the token being moved, the contract
 * being called, and the spender being approved. Those are a different concern with a
 * different failure mode — a wrong bridge EID misroutes a message, a wrong venue
 * address sends real value to the wrong contract.
 *
 * ## The rule this file follows
 *
 * Every address cites the exact source it was read from, and every one was then
 * confirmed to have live bytecode on Sepolia. Nothing here is recalled from memory.
 * `addressBook.ts` established the provenance convention for LayerZero; it matters
 * more here, so an address that cannot be re-verified should not be in the file.
 *
 * ## Settling on Sepolia means three different "USDCs"
 *
 * Sepolia has several tokens all called USDC, and they are **not interchangeable**.
 * This is the single sharpest trap in the settlement path, so each is carried
 * separately rather than under one `usdc` key:
 *
 * | key | used by |
 * |---|---|
 * | {@link SETTLEMENT_TOKENS.usdc} | Aave's Sepolia Pool — the only one it accepts |
 * | {@link SETTLEMENT_TOKENS.usdcCircle} | CCTP transfers (`packages/bridges`) |
 * | {@link SETTLEMENT_TOKENS.usdcStargate} | Stargate/LayerZero pool bridging |
 *
 * Building a leg with the wrong one reverts, and all three are 6-decimal, so only
 * the address distinguishes them.
 */
import type { Address } from "viem";

/** Where intents settle. Sepolia — the deployed Safe and the verified signature live here. */
export const SETTLEMENT_CHAIN_ID = 11155111 as const;
export const SETTLEMENT_CHAIN_LABEL = "sepolia" as const;

/** A verified address plus the exact source it came from. */
export interface SourcedAddress {
  readonly address: Address;
  /** Where this was read from — a URL, or a repo path the repo already asserts. */
  readonly source: string;
  readonly note?: string;
}

/** Tokens available on the settlement chain. See the module doc on why all three USDCs exist. */
export const SETTLEMENT_TOKENS = {
  /** Aave's Sepolia test-USDC — the asset Aave's Sepolia Pool accepts. */
  usdc: {
    address: "0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8",
    source: "https://raw.githubusercontent.com/bgd-labs/aave-address-book/main/src/AaveV3Sepolia.sol",
    note: "USDC_UNDERLYING in AaveV3SepoliaAssets. NOT the same token as usdcCircle or usdcStargate.",
  },
  /** Circle's CCTP test-USDC — what the `packages/bridges` scenarios already use. */
  usdcCircle: {
    address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    source: "packages/bridges/test-scenarios.json",
    note: "The CCTP/bridge USDC. Aave's Sepolia Pool does not accept this one.",
  },
  /** Stargate's Sepolia USDC — the pool's own token, needed to bridge via Stargate. */
  usdcStargate: {
    address: "0x2F6F07CDcf3588944Bf4C42aC74ff24bF56e7590",
    source: "https://testnet.stargate-api.com/v1/metadata?version=v2",
    note: "A third USDC. Stargate's pool token, distinct from both of the above.",
  },
  weth: {
    address: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
    source: "https://sepolia.etherscan.io/address/0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
    note: "Canonical WETH9 on Sepolia; corroborated by Ethplorer and GeckoTerminal.",
  },
} as const satisfies Record<string, SourcedAddress>;

/** Matches the `protocol` field on a v01 `ReadjustmentAction`, plus bridging. */
export type SettlementProtocol =
  | "aave-v3"
  | "morpho"
  | "uniswap-v4"
  | "layerzero-stargate"
  | "lido"
  | "eigenlayer";

export type SettlementAction = "SUPPLY_CAPITAL" | "WITHDRAW_LIQUIDITY" | "DEPOSIT_LSD" | "BRIDGE";

/**
 * Whether a leg can be broadcast for real, or is only valid as a simulation.
 *
 * This exists because of Lido. Its Sepolia deployment is deprecated and in-protocol
 * withdrawals are paused indefinitely, so a round trip cannot complete there — but a
 * deposit leg is still a perfectly good thing to *simulate* against forked mainnet
 * state. Encoding that as a property of the venue means the decision is recorded and
 * enforced, rather than living in someone's memory as "we know Lido doesn't really
 * work on Sepolia".
 */
export type SettlementMode = "live" | "simulation";

export interface SettlementVenue {
  readonly protocol: SettlementProtocol;
  /** The contract an intent calls. */
  readonly target: SourcedAddress;
  /** The token whose allowance must be granted before a supply/swap/bridge. */
  readonly token?: SourcedAddress;
  /** Who needs the allowance — usually the target, sometimes a pool or router. */
  readonly spender?: SourcedAddress;
  /** Actions this venue can honestly service. */
  readonly actions: readonly SettlementAction[];
  readonly mode: SettlementMode;
  /** Required when `mode` is `simulation`: why it cannot be broadcast. */
  readonly modeReason?: string;
  /** Any additional addresses an encoder needs. */
  readonly auxiliary?: Readonly<Record<string, SourcedAddress>>;
}

const AAVE_BOOK =
  "https://raw.githubusercontent.com/bgd-labs/aave-address-book/main/src/AaveV3Sepolia.sol";
const UNISWAP_DEPLOYMENTS = "https://developers.uniswap.org/docs/protocols/v4/deployments";
const MORPHO_ADDRESSES = "https://docs.morpho.org/developers/contracts/addresses/";
const STARGATE_METADATA = "https://testnet.stargate-api.com/v1/metadata?version=v2";
const LIDO_SEPOLIA =
  "https://raw.githubusercontent.com/lidofinance/docs/main/docs/deployed-contracts/sepolia.md";

/**
 * The venues an intent may target.
 *
 * Only protocols whose Sepolia deployment was verified against a primary source
 * appear here. See {@link UNVERIFIED_PROTOCOLS} for the rest.
 */
export const SETTLEMENT_VENUES: Readonly<Record<string, SettlementVenue>> = {
  "aave-v3": {
    protocol: "aave-v3",
    mode: "live",
    target: {
      address: "0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951",
      source: AAVE_BOOK,
      note: "AaveV3Sepolia.POOL — `supply(asset, amount, onBehalfOf, referralCode)`.",
    },
    token: SETTLEMENT_TOKENS.usdc,
    spender: {
      address: "0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951",
      source: AAVE_BOOK,
      note: "The Pool pulls the deposit, so the Pool is the spender.",
    },
    actions: ["SUPPLY_CAPITAL", "WITHDRAW_LIQUIDITY"],
    auxiliary: {
      addressesProvider: {
        address: "0x012bAC54348C0E635dCAc9D5FB99f06F24136C9A",
        source: AAVE_BOOK,
        note: "Read the Pool from here rather than trusting a hardcoded proxy.",
      },
      aUsdc: {
        address: "0x16dA4541aD1807f4443d92D26044C1147406EB80",
        source: AAVE_BOOK,
        note: "USDC_A_TOKEN — the receipt a withdraw redeems.",
      },
    },
  },
  morpho: {
    protocol: "morpho",
    mode: "live",
    target: {
      address: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
      source: MORPHO_ADDRESSES,
      note: "Morpho Blue's canonical, deterministic address — the same on Sepolia, Base and Ethereum.",
    },
    actions: ["SUPPLY_CAPITAL", "WITHDRAW_LIQUIDITY"],
    /*
     * Morpho's docs also list a Sepolia-specific deployment at 0xd011EE…. Both are
     * real, which is a trap: the address this registry carries must be the one an
     * agent actually emits, and agents emit the canonical one.
     *
     * Corrected after `production-pipeline.ts` flagged the canonical address as
     * "unmapped". Two independent RPCs then reported 15,623 bytes of runtime code at
     * it on Sepolia — the identical size Morpho's own docs attest for Base Sepolia,
     * which is what deterministic deployment across chains produces. So the fault was
     * this file, not the agent.
     */
    auxiliary: {
      sepoliaStandaloneDeployment: {
        address: "0xd011EE229E7459ba1ddd22631eF7bF528d424A14",
        source: MORPHO_ADDRESSES,
        note: "A second, docs-listed Sepolia deployment. Valid, but not what agents address.",
      },
    },
  },
  "uniswap-v4": {
    protocol: "uniswap-v4",
    mode: "live",
    target: {
      address: "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543",
      source: UNISWAP_DEPLOYMENTS,
      note: "PoolManager on Sepolia. LP positions go through PositionManager, not here.",
    },
    token: SETTLEMENT_TOKENS.weth,
    spender: {
      address: "0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4",
      source: UNISWAP_DEPLOYMENTS,
      note: "PositionManager — it pulls both sides of the position.",
    },
    actions: ["SUPPLY_CAPITAL", "WITHDRAW_LIQUIDITY"],
    auxiliary: {
      positionManager: {
        address: "0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4",
        source: UNISWAP_DEPLOYMENTS,
      },
      universalRouter: {
        address: "0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b",
        source: UNISWAP_DEPLOYMENTS,
      },
      permit2: {
        address: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
        source: UNISWAP_DEPLOYMENTS,
        note: "Shared canonical Permit2, same address on every chain.",
      },
    },
  },
  /**
   * Note on what LayerZero is, since the naming misleads: LayerZero is a *messaging*
   * layer, not a set of protocol integrations. There is no "Aave OApp" to look up.
   * Its OApps are applications built on top of it, and for a stablecoin bridge that
   * application is **Stargate**, whose pool is the contract a bridge leg calls.
   *
   * So a cross-chain leg targets Stargate's pool for the token being moved; the
   * LayerZero `EndpointV2` in `addressBook.ts` is what the *pool* talks to, not
   * something an intent calls directly.
   */
  "layerzero-stargate": {
    protocol: "layerzero-stargate",
    mode: "live",
    target: {
      address: "0x4985b8fcEA3659FD801a5b857dA1D00e985863F0",
      source: STARGATE_METADATA,
      note: "Stargate V2 USDC pool on Sepolia — the OApp a bridge leg calls. eid 40161.",
    },
    token: SETTLEMENT_TOKENS.usdcStargate,
    spender: {
      address: "0x4985b8fcEA3659FD801a5b857dA1D00e985863F0",
      source: STARGATE_METADATA,
      note: "The pool pulls the deposit, so the pool is the spender.",
    },
    actions: ["BRIDGE"],
    auxiliary: {
      usdtPool: {
        address: "0x9D819CcAE96d41d8F775bD1259311041248fF980",
        source: STARGATE_METADATA,
      },
      ethPool: {
        address: "0x9Cc7e185162Aa5D1425ee924D97a87A0a34A0706",
        source: STARGATE_METADATA,
      },
      endpointV2: {
        address: "0x1a44076050125825900e736c501f859c50fE728c",
        source: "packages/bridges/src/addressBook.ts",
        note: "Identical on every chain; the pool's transport, not a leg target.",
      },
    },
  },
  /**
   * Lido, marked simulation-only.
   *
   * Depositing is genuinely simple — `stETH.submit(referral)` is a single payable
   * call with no approval and no routing, so this was never the hard part.
   *
   * What makes it non-live on Sepolia is the *environment*: Lido's own docs mark the
   * Sepolia deployment **fully deprecated** (Hoodi is the supported testnet) and note
   * that in-protocol withdrawals are **paused indefinitely**. A deposit would work
   * while the withdrawal that a rebalance depends on would not, so a "live" Lido leg
   * here would be a round trip that cannot complete.
   *
   * Simulating the deposit against forked mainnet state is the honest alternative, and
   * that is what `mode: "simulation"` means to the caller.
   */
  lido: {
    protocol: "lido",
    mode: "simulation",
    modeReason:
      "Lido's Sepolia deployment is deprecated and in-protocol withdrawals are paused indefinitely; use Hoodi for a live path, or fork-execute against mainnet.",
    target: {
      address: "0x3e3FE7dBc6B4C189E7128855dD526361c49b40Af",
      source: LIDO_SEPOLIA,
      note: "Lido and stETH token (proxy). `submit(referral)` is payable, so no approval leg is needed.",
    },
    actions: ["DEPOSIT_LSD", "WITHDRAW_LIQUIDITY"],
    auxiliary: {
      locator: {
        address: "0x8f6254332f69557A72b0DA2D5F0Bc07d4CA991E7",
        source: LIDO_SEPOLIA,
        note: "Resolve the current stETH/WithdrawalQueue from here rather than pinning them.",
      },
      wstETH: {
        address: "0xB82381A3fBD3FaFA77B3a7bE693342618240067b",
        source: LIDO_SEPOLIA,
        note: "Wrapping stETH is a plain ERC-20 call and needs no venue state.",
      },
      withdrawalQueue: {
        address: "0x1583C7b3f4C3B008720E6BcE5726336b0aB25fdd",
        source: LIDO_SEPOLIA,
        note: "ERC721 withdrawal requests — paused on Sepolia, which is why mode is simulation.",
      },
    },
  },
};

/**
 * Protocols the graph can recommend but this file will **not** resolve.
 *
 * EigenLayer restaking is deliberately out of scope. It is not a single call: it
 * involves an operator/delegation model, strategy contracts, and share accounting
 * that rebases — realistically a project in its own right. Approximating it would
 * produce an intent that looks executable and is not, which is worse than refusing.
 *
 * The reason is carried rather than the protocol being silently omitted, so a
 * `ReadjustmentAction` naming it fails with a specific message to show a user.
 */
export const UNVERIFIED_PROTOCOLS: Readonly<Record<string, string>> = {
  eigenlayer:
    "Restaking needs an operator/delegation model and share accounting; out of scope rather than approximated.",
  "rocket-pool": "Rocket Pool has no verified Sepolia deployment. It is Ethereum-mainnet only.",
};

/**
 * Look up the venue a decision should execute against.
 *
 * @returns the venue, or `null` when the protocol has no verified Sepolia deployment.
 *   The caller must treat `null` as "cannot build this leg" and say so — see
 *   {@link UNVERIFIED_PROTOCOLS}. Note that a non-null venue may still be
 *   `mode: "simulation"`, which the caller must honour rather than broadcast.
 */
export function resolveSettlementVenue(protocol: string): SettlementVenue | null {
  const key = protocol.trim().toLowerCase();
  return SETTLEMENT_VENUES[key] ?? null;
}
