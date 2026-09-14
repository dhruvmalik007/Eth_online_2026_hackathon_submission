"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DemoProvider } from "@/lib/demo/state";
import { useDemo } from "@/lib/demo/state";
import { allocationsFor } from "@/lib/demo/data";
import { useNav } from "@/lib/portfolio/context";
import { formatAllocUsd } from "@/lib/portfolio/nav";
import {
  DEFAULT_AGENT_ID,
  fetchMandate,
  mandateFor,
  saveMandate,
  executionBaseUrl,
  type AgentMandate,
} from "@/lib/execution/mandates";
import { fetchIndexerHealth, indexerBaseUrl } from "@/lib/indexer/client";
import { AquaFlightPanel, Slider } from "@ethonline2026/ux-workflow";
import { fetchAquaEnablement, AQUA_CHAINS, type AquaAssessment } from "@/lib/execution/aqua";

/**
 * The slider's range.
 *
 * A control, not a recommendation. The upper bound sits well above the deployment's own default on
 * purpose: if the slider could not exceed it, an operator would read the ceiling as a policy and
 * never discover the limit is theirs to set.
 */
const MANDATE_MIN = 1_000;
const MANDATE_MAX = 1_000_000;
const MANDATE_STEP = 1_000;
import { LoadLiquiditySheet } from "@/components/demo/LoadLiquiditySheet";

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
  const { nav } = useNav();
  const alloc = allocationsFor(risk, nav.pricedUsd);

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

      <AquaSection />

      <ServiceStatusSection />

      <section className="border border-edge-2 bg-panel p-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-fg-faint">wallet & custody</p>
        <div className="mt-3 space-y-1.5 font-mono text-xs">
          <AddressRow label="embedded wallet" address={state.wallet?.address} />
          <AddressRow label="gnosis safe" address={state.wallet?.safeAddress} />
          <p><span className="text-fg-faint">custody model · </span><span className="text-fg">agents propose, never execute</span></p>
          <PolicySection />
        </div>
      </section>

      <LiquiditySection />

      <section className="border border-edge-2 bg-panel p-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-fg-faint">agent spend caps</p>
        <div className="mt-3 space-y-2">
          {alloc.map(({ strategy, pct, usd }) => (
            <div key={strategy.id} className="flex items-center gap-3">
              <span className="size-2 rounded-full" style={{ background: strategy.color }} />
              <span className="flex-1 text-sm text-fg">{strategy.agentName}</span>
              <span className="font-mono text-xs tabular-nums text-fg-dim">{pct}%</span>
              <span className="w-24 text-right font-mono text-xs tabular-nums text-amber">{formatAllocUsd(usd)}</span>
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
 * An address the operator needs to be able to copy verbatim.
 *
 * Select-and-drag is how a long hex string gets miscopied by one character, and a wrong address in
 * a funding flow is money sent to nobody. So the copy is a button, and its confirmation is the
 * button's own label — the one place a transient state is clearer than a toast.
 */
function AddressRow({ label, address }: { label: string; address: string | undefined }) {
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  if (address === undefined || address.length === 0) {
    return (
      <p>
        <span className="text-fg-faint">{label} · </span>
        <span className="text-fg-dim">not connected</span>
      </p>
    );
  }

  return (
    <div className="flex items-start gap-2">
      <span className="min-w-0 flex-1 break-all">
        <span className="text-fg-faint">{label} · </span>
        <span className="text-fg">{address}</span>
      </span>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard
            .writeText(address)
            .then(() => setCopied(true))
            .catch(() => setCopied(false));
        }}
        className="shrink-0 border border-edge-2 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-dim hover:border-amber/60 hover:text-amber"
      >
        {copied ? "copied" : "copy"}
      </button>
    </div>
  );
}

/**
 * The 1inch Aqua/SwapVM venue, read from the service rather than asserted here.
 *
 * `AquaFlightPanel` is the incumbent surface for this and is used unchanged — it already encodes the
 * rules that matter (an explicit enabled badge, a negative delta shown as negative, consent rendered
 * as withheld when the mandate withholds it). All this adds is the fetches that give it true inputs.
 *
 * There are two numbers and their roles are different, so both are shown separately rather than
 * folded into one: `efficiencyBps` is what the caller *measured*, and `minEfficiencyBps` is the
 * threshold the deployment will *act* on. The assessment is meaningless without the pair — 12 bps is
 * a recommendation or a shrug depending entirely on where the line sits.
 */
function AquaSection() {
  const [chain, setChain] = React.useState<string>(AQUA_CHAINS[0]);
  const [efficiency, setEfficiency] = React.useState(25);
  const [enabled, setEnabled] = React.useState(false);
  const [result, setResult] = React.useState<
    { state: "loading" } | { state: "off"; detail: string } | { state: "unavailable"; detail: string } | { state: "ok"; assessment: AquaAssessment; thresholds: { minEfficiencyBps: number; agentEnablement: boolean; agentMinEfficiencyBps: number } }
  >({ state: "loading" });

  React.useEffect(() => {
    let cancelled = false;
    setResult({ state: "loading" });
    void (async () => {
      const read = await fetchAquaEnablement(chain, { efficiencyBps: efficiency });
      if (cancelled) return;
      setResult(read.ok ? { state: "ok", assessment: read.assessment, thresholds: read.thresholds } : { state: read.kind, detail: read.detail });
    })();
    return () => {
      cancelled = true;
    };
  }, [chain, efficiency]);

  return (
    <section className="border border-edge-2 bg-panel p-5">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-fg-faint">1inch aqua · swapvm venue</p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-faint">chain</span>
          <select
            value={chain}
            onChange={(event) => setChain(event.target.value)}
            className="border border-edge bg-ink px-2 py-1 font-mono text-xs text-fg outline-none focus:border-amber"
          >
            {AQUA_CHAINS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <label className="flex min-w-[16rem] flex-1 items-center gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-faint">measured delta</span>
          <Slider
            value={[efficiency]}
            onValueChange={(next) => setEfficiency(next[0] ?? 0)}
            min={-50}
            max={150}
            step={1}
            className="w-40"
          />
          <span className="w-20 font-mono text-xs tabular-nums text-amber">{efficiency > 0 ? "+" : ""}{efficiency} bps</span>
        </label>
      </div>

      {result.state === "loading" && <p className="mt-3 font-mono text-xs text-fg-faint">assessing…</p>}

      {result.state === "off" && (
        <p className="mt-3 text-sm text-fg-dim">
          The venue is off on this deployment. {result.detail}
        </p>
      )}

      {result.state === "unavailable" && (
        <p className="mt-3 break-words text-sm text-fg-dim">The assessment is unavailable — {result.detail}</p>
      )}

      {result.state === "ok" && (
        <>
          <p className="mt-3 font-mono text-[11px] text-fg-faint">
            threshold · {result.thresholds.minEfficiencyBps} bps
            {result.thresholds.agentEnablement ? ` · agents may enable above ${result.thresholds.agentMinEfficiencyBps} bps` : " · agents may never enable this venue"}
          </p>
          <AquaFlightPanel
            className="mt-3 border-0 bg-transparent p-0"
            assessment={result.assessment}
            stage="approval"
            enabled={enabled}
            // Withheld rather than absent when the mandate keeps consent: a control that silently
            // does nothing is worse than one that says who may act.
            {...(result.assessment.consentGranter === "user"
              ? { onConsent: (next: boolean) => setEnabled(next) }
              : {})}
            agentMayAct={result.thresholds.agentEnablement}
          />
        </>
      )}
    </section>
  );
}

/**
 * The limits that actually apply, read from the service that enforces them.
 *
 * This replaces two invented figures — a "2/2 (you + Ledger)" threshold and a
 * "per-tx ≤ $50,000 · daily ≤ $100,000" policy — neither of which existed anywhere in the system.
 * A custody panel is the one place a made-up number is dangerous rather than merely sloppy: it is
 * read as a guarantee about what the system will refuse to do.
 *
 * So it shows the effective limit *and* where it came from, because a deployment default mistaken
 * for a chosen mandate is the same error in the other direction.
 */
function PolicySection() {
  const [policy, setPolicy] = React.useState<
    { state: "loading" } | { state: "unavailable"; detail: string } | { state: "ok"; maxSpendUsd: number; approvalRequired: boolean; source: string }
  >({ state: "loading" });

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await fetchMandate(DEFAULT_AGENT_ID);
      if (cancelled) return;
      if (!result.ok) {
        setPolicy({ state: "unavailable", detail: result.detail ?? "the service did not say why" });
        return;
      }
      setPolicy({
        state: "ok",
        // `effective` is the value the service enforces; it is not the same field as `stored`,
        // and showing `stored` here would report "no mandate chosen" whenever the deployment
        // default is doing the work.
        maxSpendUsd: result.effective.maxSpendUsd,
        approvalRequired: result.effective.approvalRequired,
        source: result.source,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (policy.state === "loading") {
    return <p><span className="text-fg-faint">policygate · </span><span className="text-fg-faint">reading…</span></p>;
  }
  if (policy.state === "unavailable") {
    // Named, not guessed. An unavailable limit is not a zero limit, and rendering either a number
    // or an empty slot here would misstate what the system enforces.
    return (
      <p className="break-all">
        <span className="text-fg-faint">policygate · </span>
        <span className="text-fg-dim">unavailable — {policy.detail}</span>
      </p>
    );
  }
  return (
    <>
      <p>
        <span className="text-fg-faint">policygate · </span>
        <span className="text-fg">per-intent ≤ ${policy.maxSpendUsd.toLocaleString("en-US")}</span>
        <span className="text-fg-faint"> · source {policy.source}</span>
      </p>
      <p>
        <span className="text-fg-faint">approval · </span>
        <span className="text-fg">{policy.approvalRequired ? "always required" : "only above the limit"}</span>
      </p>
    </>
  );
}

/**
 * Funding the desk's own wallet.
 *
 * The desk cannot fund itself, so this section exists to say where the tokens have to come from and
 * to hand over the exact instruction. It is a handoff, not a deposit flow: the app holds no
 * funding keys and broadcasts nothing.
 *
 * A modal rather than an inline form because this is an occasional, single-purpose errand with a
 * copy-and-leave shape, and leaving it inline would put a wallet address on the settings page
 * permanently — the one piece of this screen nobody needs to read twice.
 */
function LiquiditySection() {
  const { state } = useDemo();
  const [open, setOpen] = React.useState(false);

  return (
    <section className="border border-edge-2 bg-panel p-5">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-fg-faint">load liquidity</p>
      <p className="mt-2 text-sm text-fg-dim">
        Put tokens into the desk wallet so a live run has something to move. The desk cannot fund
        itself — the settlement signer holds no gas on any mainnet chain.
      </p>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 border border-edge-2 px-3 py-1 font-mono text-xs uppercase tracking-[0.16em] text-fg-dim hover:text-amber"
      >
        load liquidity
      </button>
      <LoadLiquiditySheet
        open={open}
        onOpenChange={setOpen}
        address={state.wallet?.address}
      />
    </section>
  );
}

/**
 * What the deployed services actually report about themselves.
 *
 * The point is not the panel — it is that a misconfigured URL is *visible* rather than silent. A
 * public variable that never reached the bundle renders as `undefined` and looks exactly like a
 * service that is down, and the two need different fixes. So each row names which of the three it
 * is: reachable, refusing, or never configured.
 */
function ServiceStatusSection() {
  const [rows, setRows] = React.useState<{ label: string; detail: string }[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next: { label: string; detail: string }[] = [];

      const indexer = indexerBaseUrl();
      if (indexer === undefined) {
        next.push({ label: "indexer", detail: "not configured (NEXT_PUBLIC_INDEXER_URL)" });
      } else {
        try {
          const health = await fetchIndexerHealth();
          next.push({
            label: "indexer",
            detail:
              health.degraded.length === 0
                ? "ok"
                : `degraded · ${health.degraded.join(", ")}`,
          });
        } catch (error) {
          next.push({ label: "indexer", detail: (error as Error).message });
        }
      }

      const execution = executionBaseUrl();
      if (execution === undefined) {
        next.push({ label: "execution", detail: "not configured (NEXT_PUBLIC_EXECUTION_URL)" });
      } else {
        try {
          const response = await fetch(`${execution}/health`, { cache: "no-store" });
          const body = (await response.json()) as { status?: string; database?: string };
          next.push({
            label: "execution",
            detail: `${body.status ?? response.status} · database ${body.database ?? "unknown"}`,
          });
        } catch (error) {
          next.push({ label: "execution", detail: (error as Error).message });
        }
      }

      if (!cancelled) {
        setRows(next);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="border border-edge-2 bg-panel p-5">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-fg-faint">service status</p>
      {loading ? (
        <p className="mt-2 font-mono text-xs text-fg-faint">checking…</p>
      ) : (
        <div className="mt-3 space-y-1.5 font-mono text-xs">
          {rows.map((row) => (
            <p key={row.label} className="break-all">
              <span className="text-fg-faint">{row.label} · </span>
              <span className={row.detail.startsWith("not configured") ? "text-fg-dim" : "text-fg"}>
                {row.detail}
              </span>
            </p>
          ))}
        </div>
      )}
    </section>
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
        {/* A slider beside the number, not instead of it. The slider is how the limit is reasoned
            about — the size of the permission, felt as a position on a scale — and the input is how
            an exact figure is entered. Either alone is worse at one of those jobs.

            The range is a *control*, not a claim about what is safe: it deliberately runs past the
            deployment's own default so raising the limit is a visible act rather than a value the
            operator has to discover is impossible to change. */}
        <div className="mt-2 flex items-center gap-3">
          <Slider
            value={[Math.min(Math.max(valid ? parsed : current.maxSpendUsd, MANDATE_MIN), MANDATE_MAX)]}
            onValueChange={(next) => setDraft(String(next[0] ?? MANDATE_MIN))}
            min={MANDATE_MIN}
            max={MANDATE_MAX}
            step={MANDATE_STEP}
            aria-label="Maximum spend per intent in USD"
            className="w-48"
          />
          <span className="font-mono text-[10px] tabular-nums text-fg-faint">
            ${MANDATE_MIN.toLocaleString("en-US")}
          </span>
          <span className="flex-1" />
          <span className="font-mono text-[10px] tabular-nums text-fg-faint">
            ${MANDATE_MAX.toLocaleString("en-US")}
          </span>
        </div>
        <div className="mt-2 flex items-center gap-2">
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
