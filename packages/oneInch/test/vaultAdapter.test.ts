/**
 * The Morpho vault adapter, tested against a fake chain.
 *
 * The assertions that matter are the negative vocabulary ones: a deposit's only fee line must
 * be a `bound` (so `sumWalletCost` stays honest), a constrained redemption must surface as
 * `insufficient_liquidity` rather than a new code, and the built transaction must settle at the
 * vault the *quote* named rather than one re-chosen at build time.
 */

import { sumWalletCost } from "@ethonline2026/execution-domain";
import { decodeFunctionData } from "viem";
import { describe, expect, it } from "vitest";
import {
  MORPHO_VAULT_ABI,
  MorphoVaultAdapter,
  type Address,
  type VaultReadings,
  type VaultBinding,
  type VaultReader,
  type VaultRequest,
} from "../src/index.js";

const USDC = "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85" as const;
const USDT = "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58" as const;
const GOOD_VAULT = "0xC30ce6A5758786e0F640cC5f881Dd96e9a1C5C59" as const;
const BETTER_VAULT = "0x1111111111111111111111111111111111111111" as const;
const RECIPIENT = "0xCf03Dd0a894Ef79CB5b601A43C4b25E3Ae4c67eD" as const;
const CHAIN_ID = 10;
/**
 * A measured yield, in bps. Every fixture needs one: a vault with no trailing-mean yield is
 * rejected as unrankable (`no_yield_reading`), which is the correct behaviour and means a
 * fixture without it can never quote at all.
 */
const DEFAULT_APY_BPS = 464;

const SHARE_DECIMALS = 18;
/** 1e18 shares is worth 1.05 USDC — a healthy vault, slightly above 1:1. */
const ONE_SHARE_TO_ASSETS = 1_050_000n;

function readings(overrides: Partial<VaultReadings> = {}): VaultReadings {
  return {
    address: GOOD_VAULT,
    asset: USDC,
    shareDecimals: SHARE_DECIMALS,
    totalAssets: 833_152_026_043n,
    totalSupply: 790_000n * 10n ** BigInt(SHARE_DECIMALS),
    oneShareToAssets: ONE_SHARE_TO_ASSETS,
    ...overrides,
  };
}

/** A reader backed by a map, so nothing touches a network. */
function fakeReader(byAddress: Record<string, VaultReadings | null>): VaultReader {
  return {
    async read(address: Address) {
      return byAddress[address.toLowerCase()] ?? null;
    },
  };
}

function adapter(
  options: {
    readonly good?: VaultReadings | null;
    readonly better?: VaultReadings | null;
    readonly goodApyBps?: number;
    readonly betterApyBps?: number;
    readonly redeemable?: boolean;
  } = {},
): MorphoVaultAdapter {
  const bindings: VaultBinding[] = [
    {
      ref: { address: GOOD_VAULT, name: "Gauntlet USDC Prime", asset: USDC },
      smoothedApyBps: options.goodApyBps ?? DEFAULT_APY_BPS,
      redeemable: options.redeemable ?? true,
    },
  ];

  if (options.better !== undefined) {
    bindings.push({
      ref: { address: BETTER_VAULT, name: "Second vault", asset: USDC },
      ...(options.betterApyBps === undefined ? {} : { smoothedApyBps: options.betterApyBps }),
      redeemable: true,
    });
  }

  return new MorphoVaultAdapter({
    vaults: bindings,
    reader: fakeReader({
      [GOOD_VAULT.toLowerCase()]: options.good === undefined ? readings() : options.good,
      [BETTER_VAULT.toLowerCase()]: options.better ?? null,
    }),
  });
}

const deposit = (overrides: Partial<Extract<VaultRequest, { kind: "deposit" }>> = {}) =>
  ({ kind: "deposit", chainId: CHAIN_ID, asset: USDC, assets: 1_000_000n, recipient: RECIPIENT, ...overrides }) as const;

describe("supports", () => {
  it("accepts a deposit in the asset a curated vault holds", () => {
    expect(adapter().supports(deposit())).toBe(true);
  });

  it("refuses an asset no curated vault holds, before quoting", () => {
    // Predictable failure rather than an `unsupported_pair` discovered by quoting.
    expect(adapter().supports(deposit({ asset: USDT }))).toBe(false);
  });

  it("refuses a zero amount", () => {
    expect(adapter().supports(deposit({ assets: 0n }))).toBe(false);
  });

  it("refuses a redemption from a vault that is not curated for this chain", () => {
    expect(adapter().supports({ kind: "withdraw", chainId: CHAIN_ID, vault: USDT, shares: 1n, recipient: RECIPIENT })).toBe(
      false,
    );
  });
});

describe("quote — deposit", () => {
  it("reports a deposit hop and the shares it would mint", async () => {
    const result = await adapter().quote(deposit({ assets: 1_000_000n }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    const hop = result.quote.hops[0];
    expect(hop?.kind).toBe("deposit");
    expect(hop?.protocol).toBe("morpho-vault-v2");
    expect(hop?.chainId).toBe(CHAIN_ID);
    expect(hop?.fromToken).toBe(USDC);
    expect(hop?.toToken).toBe(GOOD_VAULT);
    // (1_000_000 * 1e18) / 1_050_000 — rounded down, a vault's own convention.
    expect(hop?.toAmount).toBe(((1_000_000n * 10n ** 18n) / ONE_SHARE_TO_ASSETS).toString());
  });

  it("prices the leg as a bound and never as a cost", async () => {
    // The property that keeps the headline number honest: `sumWalletCost` sums only `cost`
    // lines, so a share-price tolerance must not appear as money leaving the wallet.
    const result = await adapter().quote(deposit());
    if (!result.ok) throw new Error("unreachable");

    expect(result.quote.feeLines.every((line) => line.tier === "bound")).toBe(true);
    expect(sumWalletCost(result.quote.feeLines)).toBe(0);
  });

  it("uses the configured tolerance rather than deriving one from the share premium", async () => {
    // A vault 5% above 1:1 is a healthy vault, not one with 500 bps of slippage.
    const configured = new MorphoVaultAdapter({
      vaults: [{ ref: { address: GOOD_VAULT, name: "V", asset: USDC }, redeemable: true, smoothedApyBps: 464 }],
      reader: fakeReader({ [GOOD_VAULT.toLowerCase()]: readings() }),
      acceptedSharePriceDriftBps: 25,
    });

    const result = await configured.quote(deposit());
    if (!result.ok) throw new Error("unreachable");
    expect(result.quote.feeLines[0]?.bps).toBe(25);
  });

  it("chooses the better-yielding vault when two qualify", async () => {
    const result = await adapter({
      goodApyBps: 464,
      better: readings({ address: BETTER_VAULT }),
      betterApyBps: 520,
    }).quote(deposit());

    if (!result.ok) throw new Error("unreachable");
    expect(result.quote.hops[0]?.toToken).toBe(BETTER_VAULT);
  });

  it("honours an explicitly pinned vault", async () => {
    const result = await adapter({ goodApyBps: 464, better: readings({ address: BETTER_VAULT }), betterApyBps: 520 }).quote(
      deposit({ vault: GOOD_VAULT }),
    );

    if (!result.ok) throw new Error("unreachable");
    expect(result.quote.hops[0]?.toToken).toBe(GOOD_VAULT);
  });

  it("fails as insufficient_liquidity when the only vault is empty", async () => {
    const result = await adapter({ good: readings({ totalAssets: 0n }) }).quote(deposit());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("insufficient_liquidity");
    expect(result.detail).toContain("empty");
  });

  it("fails as unsupported_pair when the vault holds a different stablecoin", async () => {
    // A USDT vault is not a worse USDC vault, it is not a USDC vault.
    const result = await adapter({ good: readings({ asset: USDT }) }).quote(deposit());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("unsupported_pair");
  });

  it("fails as no_route when the vault has no measured yield", async () => {
    // It cannot be ranked, so it is not a destination yet — distinct from being unfit. Built
    // explicitly rather than through the helper, because every helper fixture carries a yield
    // and this is the one case that must not.
    const unmeasured = new MorphoVaultAdapter({
      vaults: [{ ref: { address: GOOD_VAULT, name: "Unmeasured", asset: USDC }, redeemable: true }],
      reader: fakeReader({ [GOOD_VAULT.toLowerCase()]: readings() }),
    });

    const result = await unmeasured.quote(deposit());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("no_route");
  });

  it("fails as insufficient_liquidity when the deposit rounds to zero shares", async () => {
    const result = await adapter({ good: readings({ oneShareToAssets: 10n ** 30n }) }).quote(
      deposit({ assets: 1n }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("insufficient_liquidity");
  });

  it("carries the vault in raw, so build cannot re-choose it", async () => {
    const result = await adapter({ goodApyBps: 464 }).quote(deposit());
    if (!result.ok) throw new Error("unreachable");
    expect((result.quote.raw as { vault: string }).vault).toBe(GOOD_VAULT);
  });
});

describe("quote — withdraw", () => {
  const withdraw = (shares: bigint) =>
    ({ kind: "withdraw", chainId: CHAIN_ID, vault: GOOD_VAULT, shares, recipient: RECIPIENT }) as const;

  it("reports a withdraw hop and the assets it would return", async () => {
    const result = await adapter({ goodApyBps: 464 }).quote(withdraw(10n ** 18n));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    const hop = result.quote.hops[0];
    expect(hop?.kind).toBe("withdraw");
    expect(hop?.fromToken).toBe(GOOD_VAULT);
    expect(hop?.toToken).toBe(USDC);
    // (1e18 * 1_050_000) / 1e18 = 1_050_000
    expect(hop?.toAmount).toBe(ONE_SHARE_TO_ASSETS.toString());
  });

  it("defaults the owner to the recipient", async () => {
    const result = await adapter({ goodApyBps: 464 }).quote(withdraw(10n ** 18n));
    if (!result.ok) throw new Error("unreachable");
    expect((result.quote.raw as { owner: string }).owner).toBe(RECIPIENT);
  });

  it("fails as insufficient_liquidity when the redemption exceeds the vault's supply", async () => {
    // A redemption larger than the whole vault cannot settle, and the port already has a word
    // for "there is not enough liquidity" — extending the enum here would be the mistake this
    // adapter exists to disprove.
    const result = await adapter({ goodApyBps: 464 }).quote(withdraw(10n ** 30n));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("insufficient_liquidity");
    expect(result.detail).toContain("total supply");
  });

  it("fails as unsupported_pair for an uncurated vault", async () => {
    const result = await adapter().quote({ kind: "withdraw", chainId: CHAIN_ID, vault: USDT, shares: 1n, recipient: RECIPIENT });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("unsupported_pair");
  });
});

describe("build", () => {
  it("encodes deposit(assets, recipient) against the vault the quote named", async () => {
    const instance = adapter({ goodApyBps: 464 });
    const result = await instance.quote(deposit({ assets: 1_000_000n }));
    if (!result.ok) throw new Error("unreachable");

    const tx = await instance.build(result.quote, { sender: RECIPIENT });
    expect(tx.to).toBe(GOOD_VAULT);
    expect(tx.value).toBe("0");
    expect(tx.chainId).toBe(CHAIN_ID);

    const decoded = decodeFunctionData({ abi: MORPHO_VAULT_ABI, data: tx.data as `0x${string}` });
    expect(decoded.functionName).toBe("deposit");
    expect(decoded.args).toEqual([1_000_000n, RECIPIENT]);
  });

  it("encodes redeem(shares, recipient, owner)", async () => {
    const instance = adapter({ goodApyBps: 464 });
    const result = await instance.quote({
      kind: "withdraw",
      chainId: CHAIN_ID,
      vault: GOOD_VAULT,
      shares: 10n ** 18n,
      recipient: RECIPIENT,
    });
    if (!result.ok) throw new Error("unreachable");

    const tx = await instance.build(result.quote, { sender: RECIPIENT });
    const decoded = decodeFunctionData({ abi: MORPHO_VAULT_ABI, data: tx.data as `0x${string}` });
    expect(decoded.functionName).toBe("redeem");
    expect(decoded.args).toEqual([10n ** 18n, RECIPIENT, RECIPIENT]);
  });

  it("refuses to build from an envelope it did not produce", async () => {
    const instance = adapter();
    const result = await instance.quote(deposit());
    if (!result.ok) throw new Error("unreachable");

    // Strip `raw`, which is what a hand-written or truncated envelope looks like.
    const stripped = { ...result.quote, raw: undefined };
    await expect(instance.build(stripped, { sender: RECIPIENT })).rejects.toThrow(/no `raw` payload/);
  });
});
