/**
 * The adapter, exercised entirely against fakes.
 *
 * Every dependency is injected, so this runs offline — which is the point of the design rather
 * than a side effect. The assertions worth having are the ones about what the adapter refuses to
 * do: quote a leg it has no numeric intent for, call a failure a success, or report a partial run
 * as complete.
 */

import { describe, expect, it } from "vitest";
import {
  MissingIntentError,
  OneInchAquaAdapter,
  type AquaFillEncoder,
  type AquaQuotePort,
  type AquaSwapIntent,
  type TxSender,
} from "../src/index.js";
import { CHAINS } from "../src/index.js";
import type { ExecutionStep, IntentLeg } from "@ethonline2026/execution-domain";

const USDC = "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85" as const;
const WETH = "0x4200000000000000000000000000000000000006" as const;
const ROUTER = "0x111111338c5091E8440b67B168bAe16a668AC0De" as const;
const TAKER = "0xCf03Dd0a894Ef79CB5b601A43C4b25E3Ae4c67eD" as const;

const ONE_WETH = 10n ** 18n;
const BAND = 3_400n * 10n ** 6n;

function leg(overrides: Partial<IntentLeg> = {}): IntentLeg {
  return {
    id: "leg-1",
    kind: "swap",
    protocol: "1inch-aqua",
    // The identity mapping this package's chain restriction bought.
    chain: "optimism",
    amountUsd: 3_400,
    token: "WETH",
    sourceChain: "optimism",
    intent: "Convert 1 WETH into at least 3,400 USDC",
    resolvable: true,
    ...overrides,
  };
}

function intent(overrides: Partial<AquaSwapIntent> = {}): AquaSwapIntent {
  return {
    tokenIn: WETH,
    tokenOut: USDC,
    amountIn: ONE_WETH,
    minOut: BAND,
    decision: {
      action: "FLIGHT_TO_STABLE",
      reason: "vol_breach",
      detail: "Realised volatility breached the cap.",
      steps: ["swapvm-take", "vault-deposit"],
      vault: { chosen: null, rejected: [] },
    },
    ...overrides,
  };
}

/** A quote port that answers with a fixed output, or fails. */
function quotePort(outcome: { ok: true } | { ok: false; reason: string } = { ok: true }): AquaQuotePort {
  return {
    async quote() {
      return outcome.ok
        ? { ok: true, amountOut: BAND, band: BAND, expiresAt: new Date(Date.now() + 60_000) }
        : { ok: false, reason: outcome.reason, detail: "injected failure" };
    },
  };
}

const encoder: AquaFillEncoder = {
  encodeFill(input) {
    return { to: input.router, data: "0xdeadbeef" as const, value: "0" };
  },
};

function sender(
  behaviour: "succeed" | "fail" = "succeed",
  onSend?: () => void,
): TxSender {
  return {
    async send() {
      onSend?.();
      if (behaviour === "fail") throw new Error("injected send failure");
      return { hash: "0xabc", explorerUrl: "https://example.test/tx/0xabc" };
    },
  };
}

function adapter(
  options: {
    readonly quote?: AquaQuotePort;
    readonly sender?: TxSender;
  } = {},
): OneInchAquaAdapter {
  return new OneInchAquaAdapter({
    chain: CHAINS.optimism,
    router: ROUTER,
    quotePort: options.quote ?? quotePort(),
    encoder,
    sender: options.sender ?? sender(),
    taker: TAKER,
    order: { maker: "0x0", traits: 0n, data: "0x" },
  });
}

/** Let the adapters' fire-and-forget submit loop drain. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("quote", () => {
  it("prices a leg it has an intent for", async () => {
    const instance = adapter().withIntent("leg-1", intent());
    const quotes = await instance.quote([leg()]);

    expect(quotes).toHaveLength(1);
    expect(quotes[0]?.legId).toBe("leg-1");
    expect(quotes[0]?.provider).toBe("oneinch");
    expect(quotes[0]?.venue).toContain("SwapVM · Aqua");
  });

  it("prices the band as a bound, never as a cost", async () => {
    // The domain's rule: `sumWalletCost` sums only `cost` lines, so a worst-acceptable-rate must
    // not appear as money leaving the wallet.
    const instance = adapter().withIntent("leg-1", intent());
    const [quote] = await instance.quote([leg()]);
    expect(quote?.fees.every((fee) => fee.tier === "bound")).toBe(true);
  });

  it("skips a leg it has no numeric intent for, rather than inferring one", async () => {
    // A USD notional cannot be turned into a token amount without a price, and inventing one at
    // the last step before a signature is how a wrong amount gets approved.
    const quotes = await adapter().quote([leg()]);
    expect(quotes).toEqual([]);
  });

  it("carries an unquotable leg's reason instead of dropping it", async () => {
    const instance = adapter({ quote: quotePort({ ok: false, reason: "insufficient_liquidity" }) }).withIntent(
      "leg-1",
      intent(),
    );
    const [quote] = await instance.quote([leg()]);

    expect(quote?.fees[0]?.label).toContain("Not quotable");
    expect(quote?.fees[0]?.label).toContain("insufficient_liquidity");
    expect(quote?.fees[0]?.note).toBe("injected failure");
  });
});

describe("buildPlan", () => {
  it("builds one swap step per quotable leg, carrying the encoded fill", async () => {
    const instance = adapter().withIntent("leg-1", intent());
    const quotes = await instance.quote([leg()]);
    const plan = await instance.buildPlan([leg()], quotes, "batch");

    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]?.kind).toBe("swap");
    expect(plan.steps[0]?.tx.to).toBe(ROUTER);
    expect(plan.steps[0]?.tx.data).toBe("0xdeadbeef");
    expect(plan.steps[0]?.state).toBe("queued");
  });

  it("states the amounts and the reason in the signable sentence", async () => {
    // The sentence is what an owner reads before approving, so it must name the amounts rather
    // than the protocol.
    const instance = adapter().withIntent("leg-1", intent());
    const quotes = await instance.quote([leg()]);
    const plan = await instance.buildPlan([leg()], quotes, "batch");

    const sentence = plan.steps[0]?.intent ?? "";
    expect(sentence).toContain(ONE_WETH.toString());
    expect(sentence).toContain(BAND.toString());
    expect(sentence).toContain("vol_breach");
  });

  it("sums only cost-tier fees into the headline", async () => {
    const instance = adapter().withIntent("leg-1", intent());
    const quotes = await instance.quote([leg()]);
    const plan = await instance.buildPlan([leg()], quotes, "batch");

    expect(plan.totals.costUsd).toBe(0);
    expect(plan.totals.notionalUsd).toBe(3_400);
  });

  it("maps the mode onto a signing provider", async () => {
    const instance = adapter().withIntent("leg-1", intent());
    const quotes = await instance.quote([leg()]);

    expect((await instance.buildPlan([leg()], quotes, "batch")).signing).toBe("safe-batch");
    expect((await instance.buildPlan([leg()], quotes, "per-leg")).signing).toBe("per-leg");
  });

  it("reports a leg with no quote as no step, so the gap is visible", async () => {
    const instance = adapter().withIntent("leg-1", intent());
    const plan = await instance.buildPlan([leg()], [], "batch");
    expect(plan.steps).toEqual([]);
    expect(plan.legs).toHaveLength(1);
  });
});

describe("submit", () => {
  it("reports signing then confirmed, and returns a disposer", async () => {
    const instance = adapter().withIntent("leg-1", intent());
    const quotes = await instance.quote([leg()]);
    const plan = await instance.buildPlan([leg()], quotes, "batch");

    const seen: ExecutionStep[] = [];
    const stop = instance.submit(plan, (step) => seen.push(step));
    await settle();

    expect(seen.map((step) => step.state)).toEqual(["signing", "confirmed"]);
    expect(seen[1]?.tracking?.srcTxHash).toBe("0xabc");
    expect(typeof stop).toBe("function");
    stop();
  });

  it("reports a failed send as a failed step rather than throwing", async () => {
    // A trace truncated at the first bad leg is worse than a complete one: the operator cannot
    // see which of the remaining legs were attempted.
    const instance = adapter({ sender: sender("fail") }).withIntent("leg-1", intent());
    const quotes = await instance.quote([leg()]);
    const plan = await instance.buildPlan([leg()], quotes, "batch");

    const seen: ExecutionStep[] = [];
    instance.submit(plan, (step) => seen.push(step));
    await settle();

    expect(seen.at(-1)?.state).toBe("failed");
    expect(seen.at(-1)?.error).toContain("injected send failure");
  });

  it("honours the disposer before sending", async () => {
    let sends = 0;
    const instance = adapter({ sender: sender("succeed", () => (sends += 1)) }).withIntent("leg-1", intent());
    const quotes = await instance.quote([leg()]);
    const plan = await instance.buildPlan([leg()], quotes, "batch");

    const stop = instance.submit(plan, () => {});
    stop();
    await settle();

    expect(sends).toBe(0);
  });
});

describe("toRecord", () => {
  it("calls a fully confirmed run complete", async () => {
    const instance = adapter().withIntent("leg-1", intent());
    const quotes = await instance.quote([leg()]);
    const plan = await instance.buildPlan([leg()], quotes, "batch");

    const seen: ExecutionStep[] = [];
    instance.submit(plan, (step) => seen.push(step));
    await settle();

    const record = instance.toRecord(plan, [seen.at(-1) as ExecutionStep]);
    expect(record.status).toBe("complete");
    expect(record.confirmedCount).toBe(1);
    expect(record.links[0]?.hash).toBe("0xabc");
    // The identity mapping the chain restriction bought: no translation table anywhere.
    expect(record.legs[0]?.chain).toBe("optimism");
  });

  it("calls a partly failed run partial, not complete", async () => {
    const instance = adapter().withIntent("leg-1", intent());
    const quotes = await instance.quote([leg()]);
    const plan = await instance.buildPlan([leg()], quotes, "batch");

    const record = instance.toRecord(plan, [
      { ...(plan.steps[0] as ExecutionStep), state: "confirmed" },
      { ...(plan.steps[0] as ExecutionStep), id: "b", state: "failed" },
    ]);

    expect(record.status).toBe("partial");
    expect(record.stepCount).toBe(2);
    expect(record.confirmedCount).toBe(1);
  });
});

describe("quoteEnvelope", () => {
  it("returns the port-shaped outcome", async () => {
    const instance = adapter().withIntent("leg-1", intent());
    const result = await instance.quoteEnvelope(leg());

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.amountOut).toBe(BAND);
  });

  it("refuses a leg with no intent rather than returning a fabricated quote", async () => {
    await expect(adapter().quoteEnvelope(leg())).rejects.toBeInstanceOf(MissingIntentError);
  });
});
