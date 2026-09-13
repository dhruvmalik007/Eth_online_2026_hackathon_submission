"use client";

import * as React from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { useDemo } from "@/lib/demo/state";
import type { RiskProfile } from "@/lib/demo/data";

const EXPERIENCE = ["Under 2 years", "2–5 years", "5–15 years", "15+ years"];
const RISK_OPTIONS: { value: RiskProfile; label: string; hint: string }[] = [
  {
    value: "conservative",
    label: "Capital preservation",
    hint: "Stablecoin lending and staking dominate. Minimal drawdown tolerance.",
  },
  {
    value: "balanced",
    label: "Balanced carry",
    hint: "Core carry plus measured basis and LP exposure. Typical desk profile.",
  },
  {
    value: "yieldmax",
    label: "Yield-maximizing",
    hint: "Full spectrum: perps basis and concentrated LP get real weight.",
  },
];
const TOOLS = ["Bloomberg Terminal", "OpenBB", "Tradeweb", "MarketAxess", "Excel / Python", "None of these"];

const STEPS = ["Experience", "Risk posture", "Tooling", "Integration"];

export function QuestionnaireStage() {
  const { state, dispatch } = useDemo();
  const [step, setStep] = React.useState(0);
  const [experience, setExperience] = React.useState<string | null>(null);
  const [risk, setRisk] = React.useState<RiskProfile | null>(null);
  const [tools, setTools] = React.useState<string[]>([]);
  const [integration, setIntegration] = React.useState("");
  const [minting, setMinting] = React.useState(false);

  const canNext =
    (step === 0 && experience) || (step === 1 && risk) || step === 2 || step === 3;

  const finish = () => {
    dispatch({
      type: "set-answers",
      answers: {
        experience: experience ?? "2–5 years",
        risk: risk ?? "balanced",
        tools,
        integration,
      },
    });
    setMinting(true);
    setTimeout(() => dispatch({ type: "set-stage", stage: "chat" }), 2600);
  };

  if (minting) {
    return (
      <div className="flex flex-1 items-center justify-center px-4">
        <div className="w-full max-w-md border border-edge-2 bg-panel p-8 text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber">
            Provisioning your workspace
          </p>
          <div className="mt-6 space-y-3 text-left font-mono text-xs">
            {[
              { t: "✓ Trader profile saved", c: "text-up" },
              { t: "✓ Embedded wallet generated", c: "text-up" },
              { t: "✓ Desk agent context loaded (TimesFM-3, The Graph)", c: "text-up" },
              { t: "→ Entering desk chat…", c: "text-amber" },
            ].map((l, i) => (
              <p key={i} className={l.c} style={{ animation: "hero-line 0.4s ease-out both", animationDelay: `${i * 0.5}s` }}>
                {l.t}
              </p>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg border border-edge-2 bg-panel">
        <div className="flex items-center justify-between border-b border-edge px-6 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-fg-faint">
            Trader onboarding · {STEPS[step]}
          </p>
          <div className="flex gap-1.5">
            {STEPS.map((s, i) => (
              <span
                key={s}
                className={`h-1 w-8 ${i < step ? "bg-up" : i === step ? "bg-amber" : "bg-edge-2"}`}
              />
            ))}
          </div>
        </div>

        <div className="p-6">
          {step === 0 && (
            <>
              <h2 className="text-lg font-semibold">What is your fixed-income experience?</h2>
              <p className="mt-1 text-sm text-fg-dim">This calibrates how much the desk explains before it acts.</p>
              <div className="mt-5 space-y-2">
                {EXPERIENCE.map((e) => (
                  <button
                    key={e}
                    onClick={() => setExperience(e)}
                    className={`flex w-full items-center justify-between border px-4 py-3 text-left text-sm hover:border-amber/60 ${
                      experience === e ? "border-amber bg-amber/5 text-amber" : "border-edge-2 text-fg"
                    }`}
                  >
                    {e}
                    {experience === e && <Check className="size-4" />}
                  </button>
                ))}
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <h2 className="text-lg font-semibold">What kind of fixed-income trader are you?</h2>
              <p className="mt-1 text-sm text-fg-dim">
                This directly shapes your strategy allocation — you&apos;ll see it in the simulation.
              </p>
              <div className="mt-5 space-y-2">
                {RISK_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    onClick={() => setRisk(o.value)}
                    className={`flex w-full flex-col items-start border px-4 py-3 text-left hover:border-amber/60 ${
                      risk === o.value ? "border-amber bg-amber/5" : "border-edge-2"
                    }`}
                  >
                    <span className={`text-sm font-medium ${risk === o.value ? "text-amber" : "text-fg"}`}>
                      {o.label}
                    </span>
                    <span className="mt-0.5 text-xs text-fg-dim">{o.hint}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h2 className="text-lg font-semibold">Which tools have you traded with before?</h2>
              <p className="mt-1 text-sm text-fg-dim">The desk mirrors the vocabulary of the tools you know.</p>
              <div className="mt-5 grid grid-cols-2 gap-2">
                {TOOLS.map((t) => {
                  const on = tools.includes(t);
                  return (
                    <button
                      key={t}
                      onClick={() =>
                        setTools((prev) => (on ? prev.filter((x) => x !== t) : [...prev, t]))
                      }
                      className={`flex items-center gap-2 border px-3 py-2.5 text-left text-xs hover:border-amber/60 ${
                        on ? "border-amber bg-amber/5 text-amber" : "border-edge-2 text-fg-dim"
                      }`}
                    >
                      <span
                        className={`flex size-4 items-center justify-center border ${
                          on ? "border-amber bg-amber text-on-amber" : "border-edge-2"
                        }`}
                      >
                        {on && <Check className="size-3" />}
                      </span>
                      {t}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <h2 className="text-lg font-semibold">How will you integrate the EMS?</h2>
              <p className="mt-1 text-sm text-fg-dim">
                Optional — describe how this fits into your workflow. Helps the desk tune its reporting.
              </p>
              <textarea
                value={integration}
                onChange={(e) => setIntegration(e.target.value)}
                rows={5}
                placeholder="e.g. Replaces my Bloomberg fixed-income watchlist; I want TWAP execution reports via email and a weekly attribution summary."
                className="mt-5 w-full resize-none border border-edge-2 bg-ink p-3 text-sm text-fg placeholder:text-fg-faint focus:border-amber/60 focus:outline-none"
              />
            </>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-edge px-6 py-4">
          <button
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim hover:text-fg disabled:opacity-30"
          >
            <ChevronLeft className="size-3.5" /> Back
          </button>
          <p className="hidden font-mono text-[10px] text-fg-faint sm:inline">
            Signed in as {state.email || "demo@agentic-ems.eth"}
          </p>
          {step < 3 ? (
            <button
              onClick={() => setStep((s) => s + 1)}
              disabled={!canNext}
              className="flex items-center gap-1 bg-amber px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-on-amber hover:opacity-90 disabled:opacity-40"
            >
              Next <ChevronRight className="size-3.5" />
            </button>
          ) : (
            <button
              onClick={finish}
              className="bg-amber px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-on-amber hover:opacity-90"
            >
              Enter desk
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
