"use client";

import * as React from "react";
import { Check, ShieldCheck, Usb } from "lucide-react";
import { useDemo } from "@/lib/demo/state";
import { useNav } from "@/lib/portfolio/context";
import { formatUsd } from "@/lib/portfolio/nav";

type Step = "ledger" | "safe" | "policy" | "done";

const STEPS: { id: Step; title: string; blurb: string }[] = [
  { id: "ledger", title: "Connect Ledger device", blurb: "Hardware owner signs every agent proposal. Clear Signing on-device." },
  { id: "safe", title: "Smart account (Safe)", blurb: "Provisioned by Privy on sign-in, controlled by your embedded wallet. Agents can propose — never execute." },
  { id: "policy", title: "Configure PolicyGate", blurb: "Deterministic caps enforced before any device prompt. Mirrors packages/custody." },
];

/**
 * Demo-only fallbacks, used when someone reaches this screen without having
 * signed in (e.g. session storage cleared). These are NEVER written over a real
 * Privy account — see `finish()`.
 */
const EOA = "0x7Fd2Ae3B94C4f6C11E8b3D9a0F5c2A1d4E9b76C3";
const SAFE = "0x1C9a4F2bE7D0638c5Ae21B4f0D8a7E3C9f6B2d51";

export function WalletCanvasStage() {
  const { state, dispatch } = useDemo();
  const { nav } = useNav();
  const [step, setStep] = React.useState<Step>("ledger");
  const [progress, setProgress] = React.useState(0);
  const [confirmed, setConfirmed] = React.useState(false);

  React.useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    let interval: ReturnType<typeof setInterval> | undefined;
    const advance = (to: Step, at: number) => timers.push(setTimeout(() => setStep(to), at));

    if (step === "ledger") {
      setProgress(0);
      interval = setInterval(() => setProgress((p) => Math.min(100, p + 4)), 90);
      timers.push(setTimeout(() => setConfirmed(true), 2200));
      timers.push(setTimeout(() => { setConfirmed(false); setStep("safe"); }, 3600));
    } else if (step === "safe") {
      setProgress(0);
      interval = setInterval(() => setProgress((p) => Math.min(100, p + 5)), 130);
      advance("policy", 2400);
    } else if (step === "policy") {
      setProgress(0);
      interval = setInterval(() => setProgress((p) => Math.min(100, p + 6)), 110);
      advance("done", 2000);
    }
    return () => {
      if (interval) clearInterval(interval);
      timers.forEach(clearTimeout);
    };
  }, [step]);

  const address = state.wallet?.address ?? EOA;
  const safeAddress = state.wallet?.safeAddress ?? SAFE;

  /**
   * Leave the canvas for the desk. Only seeds the demo fallback addresses when
   * there is no real account — a signed-in user's Privy EOA + smart account must
   * never be overwritten by constants.
   */
  const finish = () => {
    if (!state.wallet) {
      dispatch({ type: "set-wallet", wallet: { address: EOA, safeAddress: SAFE } });
    }
    dispatch({ type: "set-stage", stage: "chat" });
  };

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-xl">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber">
          /wallet · generative onboarding canvas
        </p>

        <div className="mt-4 space-y-3">
          {STEPS.map((s, i) => {
            const order = STEPS.findIndex((x) => x.id === step);
            const stateCls =
              s.id === step ? "current" : order > i || step === "done" ? "done" : "todo";
            return (
              <div
                key={s.id}
                className={`border bg-panel p-5 transition-all ${
                  stateCls === "current"
                    ? "border-amber/60 shadow-[0_0_32px_-12px] shadow-amber/40"
                    : stateCls === "done"
                      ? "border-up/40"
                      : "border-edge-2 opacity-50"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span
                      className={`flex size-7 items-center justify-center border font-mono text-[11px] ${
                        stateCls === "done"
                          ? "border-up/50 text-up"
                          : stateCls === "current"
                            ? "border-amber text-amber"
                            : "border-edge-2 text-fg-faint"
                      }`}
                    >
                      {stateCls === "done" ? <Check className="size-4" /> : i + 1}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-fg">{s.title}</p>
                      <p className="text-xs text-fg-dim">{s.blurb}</p>
                    </div>
                  </div>
                  {stateCls === "current" && (
                    <Usb className="size-4 animate-pulse text-amber" aria-hidden />
                  )}
                </div>

                {stateCls === "current" && s.id === "ledger" && (
                  <div className="mt-4 border border-edge-2 bg-ink p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-16 items-center justify-center rounded border border-edge-2 bg-panel-2">
                        <span className={`font-mono text-[9px] tracking-widest ${confirmed ? "text-up" : "text-amber"}`}>
                          {confirmed ? "✓ SIGN" : "●●●"}
                        </span>
                      </div>
                      <div className="flex-1">
                        <p className="font-mono text-[11px] text-fg">
                          {confirmed ? "Signature confirmed on device" : "Review address on your Ledger…"}
                        </p>
                        <div className="mt-2 h-1 w-full bg-edge">
                          <div className="h-1 bg-amber transition-all" style={{ width: `${progress}%` }} />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {stateCls === "current" && s.id === "safe" && (
                  <div className="mt-4 border border-edge-2 bg-ink p-4 font-mono text-[11px]">
                    <p className="text-fg-dim">deploying Safe v1.4.1…</p>
                    <div className="mt-2 h-1 w-full bg-edge">
                      <div className="h-1 bg-amber transition-all" style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                )}

                {stateCls === "current" && s.id === "policy" && (
                  <div className="mt-4 border border-edge-2 bg-ink p-4 font-mono text-[11px]">
                    <p className="text-fg-dim">attaching PolicyGate…</p>
                    <div className="mt-2 h-1 w-full bg-edge">
                      <div className="h-1 bg-amber transition-all" style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                )}

                {stateCls === "done" && s.id === "safe" && (
                  <p className="mt-3 break-all font-mono text-[11px] text-fg-dim">
                    Safe: <span className="text-fg">{safeAddress}</span> · owners: {address.slice(0, 10)}… +
                    Ledger · threshold 2/2
                  </p>
                )}
                {stateCls === "done" && s.id === "policy" && (
                  <p className="mt-3 font-mono text-[11px] text-fg-dim">
                    per-tx cap $50,000 · daily cap $100,000 · recipients: strategy agents only
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {step === "done" ? (
          <div className="mt-4 border border-up/50 bg-up/5 p-5 text-center shadow-[0_0_48px_-12px] shadow-up/40">
            <ShieldCheck className="mx-auto size-6 text-up" />
            <p className="mt-2 text-sm text-fg">Wallet onboarded</p>
            <p className="mt-1 font-mono text-3xl font-semibold tabular-nums text-up">
              {formatUsd(nav.pricedUsd)}
              <span className="ml-2 text-sm font-normal text-fg-dim">USDC</span>
            </p>
            <p className="mt-1 font-mono text-[10px] text-fg-faint">
              funded · {safeAddress} · policy-gated · agents propose, you approve
            </p>
            <button
              onClick={finish}
              className="mt-4 bg-amber px-5 py-2.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-on-amber hover:opacity-90"
            >
              Back to desk
            </button>
          </div>
        ) : (
          <div className="mt-4 flex items-center justify-between">
            <p className="font-mono text-[10px] text-fg-faint">demo: sequence auto-advances</p>
            <button
              onClick={finish}
              className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-dim hover:text-amber"
            >
              Skip →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
