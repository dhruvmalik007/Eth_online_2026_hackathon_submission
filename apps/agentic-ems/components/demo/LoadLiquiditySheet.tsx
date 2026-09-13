"use client";

import * as React from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@ethonline2026/ux-workflow";
import { CHAIN_META } from "@/lib/execution/chains";

/**
 * Funding the desk's own wallet.
 *
 * The desk cannot fund itself: the settlement signer holds no gas on any mainnet chain, and the
 * embedded wallet starts empty. So the honest shape of this screen is a **handoff** — it tells the
 * operator where the money has to arrive and how much, and then gets out of the way. It holds no
 * keys and sends nothing.
 *
 * There is deliberately no balance read. The app has no chain RPC configured, so a figure here
 * would be invented, and an invented balance on a funding screen is the worst possible place for
 * one: the operator would load against a number that was never real. What the screen *can* be
 * certain of it states exactly, and what it cannot, it does not claim.
 */

/** The tokens the desk's flows can actually spend. */
export const LOADABLE_TOKENS = [
  {
    symbol: "pUSDC",
    name: "Polymarket USD",
    address: "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB",
    decimals: 6,
    chain: "polygon" as const,
    note: "Redeemable 1:1 for USDC at the Polymarket contract.",
  },
] as const;

export type LoadableToken = (typeof LOADABLE_TOKENS)[number];

export interface LoadLiquiditySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The desk's embedded wallet — the account that must receive the tokens. */
  address: string | undefined;
}

export function LoadLiquiditySheet({ open, onOpenChange, address }: LoadLiquiditySheetProps) {
  const [token, setToken] = React.useState<LoadableToken>(LOADABLE_TOKENS[0]);
  const [amount, setAmount] = React.useState("");
  const [copied, setCopied] = React.useState<"address" | "calldata" | null>(null);

  const chain = CHAIN_META[token.chain];
  const parsed = Number(amount.replace(/[,\s]/g, ""));
  const valid = Number.isFinite(parsed) && parsed > 0;
  // Kept as a string of digits: the port and every contract call take base units as text, so a
  // float would round a value that is exact.
  const baseUnits = valid ? BigInt(Math.round(parsed * 10 ** token.decimals)).toString() : "";

  React.useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy(value: string, which: "address" | "calldata") {
    if (value === "") return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
    } catch {
      // Clipboard access needs a secure context and can be denied. Silence would look like a
      // successful copy, so the button simply does not confirm.
      setCopied(null);
    }
  }

  // ERC-20 `transfer(to, amount)` — the exact calldata the operator's own tooling would produce.
  const calldata =
    valid && address
      ? `0xa9059cbb${address.slice(2).toLowerCase().padStart(64, "0")}${BigInt(baseUnits).toString(16).padStart(64, "0")}`
      : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogTitle className="font-mono text-sm uppercase tracking-[0.16em] text-fg">
          Load liquidity
        </DialogTitle>
        <DialogDescription className="text-xs text-fg-dim">
          Send {token.symbol} on {chain.label} to the desk wallet. This screen holds no keys and
          broadcasts nothing — it tells you where the tokens have to land.
        </DialogDescription>

        <div className="mt-4 space-y-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-faint">
              destination · {chain.label} ({chain.chainId})
            </p>
            {address ? (
              <div className="mt-1 flex items-start gap-2">
                <code className="min-w-0 flex-1 break-all border border-edge bg-ink px-2 py-1.5 font-mono text-[11px] text-fg">
                  {address}
                </code>
                <button
                  type="button"
                  onClick={() => void copy(address, "address")}
                  className="shrink-0 border border-edge-2 px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-dim hover:border-amber/60 hover:text-amber"
                >
                  {copied === "address" ? "copied" : "copy"}
                </button>
              </div>
            ) : (
              // Not an error state to style around: until sign-in there is genuinely no wallet, and
              // naming that is more use than a disabled box.
              <p className="mt-1 border border-edge bg-ink px-2 py-1.5 text-xs text-fg-dim">
                No wallet yet — sign in on the desk and the address appears here.
              </p>
            )}
          </div>

          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-faint">token</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {LOADABLE_TOKENS.map((option) => (
                <button
                  key={option.symbol}
                  type="button"
                  onClick={() => setToken(option)}
                  aria-pressed={option.symbol === token.symbol}
                  className={
                    option.symbol === token.symbol
                      ? "border border-amber bg-amber/10 px-3 py-1 font-mono text-xs text-amber"
                      : "border border-edge-2 px-3 py-1 font-mono text-xs text-fg-dim hover:text-amber"
                  }
                >
                  {option.symbol}
                </button>
              ))}
            </div>
            <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-fg-faint">
              {token.name} · {token.address} · {token.decimals} decimals
            </p>
            <p className="mt-1 text-xs text-fg-dim">{token.note}</p>
          </div>

          <div>
            <label className="block">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-faint">
                amount · {token.symbol}
              </span>
              <input
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                className="mt-1 w-40 border border-edge bg-ink px-2 py-1 font-mono text-sm text-fg outline-none placeholder:text-fg-faint focus:border-amber"
              />
            </label>
            {valid ? (
              <p className="mt-1.5 font-mono text-[11px] tabular-nums text-fg-dim">
                base units · {baseUnits}
              </p>
            ) : (
              <p className="mt-1.5 text-xs text-fg-faint">
                Enter an amount to see the exact value your tooling should send.
              </p>
            )}
          </div>

          {calldata !== "" && (
            <div>
              <div className="flex items-center justify-between gap-2">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-faint">
                  erc-20 transfer calldata
                </p>
                <button
                  type="button"
                  onClick={() => void copy(calldata, "calldata")}
                  className="border border-edge-2 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-dim hover:border-amber/60 hover:text-amber"
                >
                  {copied === "calldata" ? "copied" : "copy"}
                </button>
              </div>
              <code className="mt-1 block break-all border border-edge bg-ink px-2 py-1.5 font-mono text-[10px] leading-relaxed text-fg-dim">
                {calldata}
              </code>
            </div>
          )}

          <div className="border-t border-edge pt-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-faint">
              if you hold this in a safe
            </p>
            <code className="mt-1 block break-all border border-edge bg-ink px-2 py-1.5 font-mono text-[10px] leading-relaxed text-fg-dim">
              send_erc20 {address ?? "<desk wallet>"} {token.address} {baseUnits || "<base units>"}
            </code>
          </div>
        </div>

        <div className="mt-4 flex justify-end border-t border-edge pt-4">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="border border-edge-2 px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-dim hover:border-amber/60 hover:text-amber"
          >
            Close
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
