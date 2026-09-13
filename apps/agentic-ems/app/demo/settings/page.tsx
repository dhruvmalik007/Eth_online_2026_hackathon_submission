"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DemoProvider } from "@/lib/demo/state";
import { useDemo } from "@/lib/demo/state";
import { allocationsFor } from "@/lib/demo/data";
import {
  DEFAULT_AGENT_ID,
  mandateFor,
  saveMandate,
  type AgentMandate,
} from "@/lib/execution/mandates";

export default function SettingsPage() {
  return (
    <DemoProvider>
      <SettingsShell />
    </DemoProvider>
  );
}

function SettingsShell() {
  return (
    <div className="flex min-h-screen flex-col bg-ink">
      <header className="flex items-center justify-between border-b border-edge bg-panel px-4 py-3">
        <div className="flex items-center gap-3">
          <Link href="/demo" className="font-mono text-xs uppercase tracking-[0.2em] text-fg-dim hover:text-amber">
            ← Desk
          </Link>
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-faint">· personal settings</span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
        <SettingsBody />
      </main>
    </div>
  );
}

function SettingsBody() {
  const { state, dispatch } = useDemo();
  const router = useRouter();
  const risk = state.answers?.risk ?? "balanced";
  const alloc = allocationsFor(risk);

  return (
    <div className="space-y-4">
      <section className="border border-edge-2 bg-panel p-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-fg-faint">trader profile</p>
        <div className="mt-3 grid gap-3 font-mono text-xs md:grid-cols-2">
          <p><span className="text-fg-faint">identity · </span><span className="text-fg">{state.email || "demo@agentic-ems.eth"}</span></p>
          <p><span className="text-fg-faint">experience · </span><span className="text-fg">{state.answers?.experience ?? "—"}</span></p>
          <p>
            <span className="text-fg-faint">risk posture · </span>
            <span className="text-amber">{risk}</span>
            {/* Named as a default because that is what it is. Showing a fallback as though the
                trader chose it is how a system default gets mistaken for a decision. */}
            {state.answers === null && <span className="text-fg-faint"> (default)</span>}
          </p>
          <p><span className="text-fg-faint">tools · </span><span className="text-fg">{state.answers?.tools.join(", ") || "—"}</span></p>
        </div>
        {state.answers?.integration && (
          <p className="mt-3 border-t border-edge pt-3 text-sm text-fg-dim">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-faint">integration intent · </span>
            {state.answers.integration}
          </p>
        )}
        {/* The questionnaire is no longer a gate after sign-in; this is where it lives now, so
            skipping it costs nothing and answering it is still one click away. */}
        {state.answers === null && (
          <div className="mt-3 border-t border-edge pt-3">
            <p className="text-sm text-fg-dim">
              No profile yet. The desk runs without one, using a balanced posture.
            </p>
            <button
              type="button"
              onClick={() => {
                dispatch({ type: "set-stage", stage: "questionnaire" });
                router.push("/demo");
              }}
              className="mt-2 border border-edge-2 px-3 py-1 font-mono text-xs uppercase tracking-[0.16em] text-fg-dim hover:text-amber"
            >
              complete trader profile
            </button>
          </div>
        )}
      </section>

      <AgentMandateSection />

      <section className="border border-edge-2 bg-panel p-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-fg-faint">wallet & custody</p>
        <div className="mt-3 space-y-1.5 font-mono text-xs">
          <p className="break-all"><span className="text-fg-faint">embedded wallet · </span><span className="text-fg">{state.wallet?.address ?? "—"}</span></p>
          <p className="break-all"><span className="text-fg-faint">gnosis safe · </span><span className="text-fg">{state.wallet?.safeAddress ?? "—"}</span></p>
          <p><span className="text-fg-faint">threshold · </span><span className="text-fg">2/2 (you + Ledger) · agents propose, never execute</span></p>
          <p><span className="text-fg-faint">policygate · </span><span className="text-fg">per-tx ≤ $50,000 · daily ≤ $100,000</span></p>
        </div>
      </section>

      <section className="border border-edge-2 bg-panel p-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-fg-faint">agent spend caps</p>
        <div className="mt-3 space-y-2">
          {alloc.map(({ strategy, pct, usd }) => (
            <div key={strategy.id} className="flex items-center gap-3">
              <span className="size-2 rounded-full" style={{ background: strategy.color }} />
              <span className="flex-1 text-sm text-fg">{strategy.agentName}</span>
              <span className="font-mono text-xs tabular-nums text-fg-dim">{pct}%</span>
              <span className="w-24 text-right font-mono text-xs tabular-nums text-amber">${usd.toLocaleString("en-US")}</span>
            </div>
          ))}
        </div>
      </section>

      <p className="text-center font-mono text-[10px] text-fg-faint">
        v0.1 demo · settings are read-only in the mockup
      </p>
    </div>
  );
}

/**
 * The agent's spend mandate.
 *
 * Shows the *effective* limit and where it came from, not just a number in a box: a settings screen
 * that renders the fallback as though it were a stored value is how a deployment default gets mistaken
 * for a decision someone made. The durable copy lives in `exec_agent_mandates`; this screen writes to
 * it when the execution service is reachable and says so plainly when it is not.
 */
function AgentMandateSection() {
  const { state, dispatch } = useDemo();
  const current = mandateFor(state.mandates);
  const [draft, setDraft] = React.useState(String(current.maxSpendUsd));
  const [status, setStatus] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const parsed = Number(draft.replace(/[,\s]/g, ""));
  const valid = Number.isFinite(parsed) && parsed > 0;

  async function onSave() {
    if (!valid) return;
    const mandate: AgentMandate = { maxSpendUsd: parsed, approvalRequired: current.approvalRequired };
    dispatch({ type: "set-mandate", agent: DEFAULT_AGENT_ID, mandate });
    setSaving(true);
    const result = await saveMandate(DEFAULT_AGENT_ID, mandate);
    setSaving(false);
    setStatus(result.ok ? `Stored for ${DEFAULT_AGENT_ID}.` : result.detail);
  }

  return (
    <section className="border border-edge-2 bg-panel p-5">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-fg-faint">agent mandate</p>
      <p className="mt-2 text-sm text-fg-dim">
        The most the <span className="font-mono text-fg">{DEFAULT_AGENT_ID}</span> agent may commit in a single
        intent. Kept in the backend so an incident can tighten it without a deploy.
      </p>

      <label className="mt-4 block">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-faint">max spend per intent · USD</span>
        <div className="mt-1 flex items-center gap-2">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            inputMode="numeric"
            className="w-40 border border-edge bg-ink px-2 py-1 font-mono text-sm text-fg outline-none focus:border-amber"
          />
          <button
            type="button"
            onClick={onSave}
            disabled={!valid || saving}
            className="border border-edge-2 px-3 py-1 font-mono text-xs uppercase tracking-[0.16em] text-fg-dim hover:text-amber disabled:opacity-40"
          >
            {saving ? "saving…" : "save"}
          </button>
        </div>
      </label>

      {!valid && <p className="mt-1 text-xs text-down">A mandate of zero would forbid every trade.</p>}

      <p className="mt-3 border-t border-edge pt-3 font-mono text-[11px] text-fg-faint">
        approval · {current.approvalRequired ? "always required" : "only above the limit"}
      </p>
      {state.mandates[DEFAULT_AGENT_ID] === undefined && (
        <p className="mt-1 text-xs text-fg-faint">No mandate stored — showing the deployment default.</p>
      )}
      {status !== null && <p className="mt-2 text-xs text-fg-dim">{status}</p>}
    </section>
  );
}
