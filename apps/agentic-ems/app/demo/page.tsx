"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { DemoProvider, useDemo } from "@/lib/demo/state";
import { usePrivyConfigured, PrivyAppProvider } from "@/components/privy-provider";
import { SsoStage } from "@/components/demo/SsoStage";
import { BalanceChip } from "@/components/demo/BalanceChip";
import { SimulationToggle } from "@/components/demo/SimulationToggle";

/**
 * The demo is a stage machine: exactly one stage renders at a time. They used to
 * be imported eagerly, which meant the initial compile and bundle contained every
 * stage, every widget and recharts — twice — before the visitor saw anything.
 *
 * Each stage is now loaded on demand. `SsoStage` stays eager because it is the
 * first thing a visitor sees (and it is small; the Privy SDK behind it is the
 * real weight, and that is required for the primary flow).
 */
const StageFallback = () => (
  <div className="flex flex-1 items-center justify-center px-4 py-12">
    <div className="w-full max-w-lg space-y-3" aria-busy>
      <div className="h-24 animate-pulse border border-edge-2 bg-panel-2" />
      <div className="h-40 animate-pulse border border-edge-2 bg-panel-2" />
    </div>
  </div>
);

const QuestionnaireStage = dynamic(
  () => import("@/components/demo/QuestionnaireStage").then((m) => m.QuestionnaireStage),
  { loading: StageFallback },
);
const ChatStage = dynamic(
  () => import("@/components/demo/ChatStage").then((m) => m.ChatStage),
  { loading: StageFallback },
);
const WalletCanvasStage = dynamic(
  () => import("@/components/demo/WalletCanvasStage").then((m) => m.WalletCanvasStage),
  { loading: StageFallback },
);
const SimulationStage = dynamic(
  () => import("@/components/demo/SimulationStage").then((m) => m.SimulationStage),
  { loading: StageFallback },
);
const ApprovalsStage = dynamic(
  () => import("@/components/demo/ApprovalsStage").then((m) => m.ApprovalsStage),
  { loading: StageFallback },
);
const ExecutingStage = dynamic(
  () => import("@/components/demo/ExecutingStage").then((m) => m.ExecutingStage),
  { loading: StageFallback },
);

const STAGE_LABEL: Record<string, string> = {
  sso: "Sign in",
  questionnaire: "Trader profile",
  chat: "Desk agent",
  "wallet-onboarding": "Wallet onboarding",
  simulation: "Simulation",
  approvals: "Approvals",
  executing: "Execution",
};

/**
 * Signed-in identity + sign-out. Split so `usePrivy` is only ever called when
 * a PrivyProvider is actually mounted — otherwise it throws and takes the page
 * down with it.
 */
function SessionChip() {
  const configured = usePrivyConfigured();
  if (!configured) return null;
  return <SessionChipInner />;
}

function SessionChipInner() {
  const { dispatch } = useDemo();
  const { ready, authenticated, user, logout } = usePrivy();

  if (!ready || !authenticated || !user) return null;

  const email = user.email?.address ?? "";
  const account = user.smartWallet?.address ?? user.wallet?.address ?? "";

  return (
    <div className="hidden items-center gap-2 md:flex">
      <div className="leading-tight">
        <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-fg-faint">
          {account ? "smart account" : "signed in"}
        </p>
        <p className="font-mono text-[10px] text-fg-dim" title={email}>
          {account ? `${account.slice(0, 6)}…${account.slice(-4)}` : email}
        </p>
      </div>
      <button
        onClick={async () => {
          await logout();
          dispatch({ type: "sign-out" });
        }}
        className="border border-edge-2 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-fg-dim hover:border-amber/60 hover:text-amber"
      >
        Sign out
      </button>
    </div>
  );
}

export default function DemoPage() {
  return (
    <PrivyAppProvider>
      <DemoProvider>
        <DemoShell />
      </DemoProvider>
    </PrivyAppProvider>
  );
}

function DemoShell() {
  const { state, dispatch } = useDemo();

  return (
    <div className="flex min-h-screen flex-col bg-ink">
      <header className="flex items-center justify-between border-b border-edge bg-panel px-4 py-3">
        <div className="flex items-center gap-3">
          <Link href="/" className="font-mono text-xs uppercase tracking-[0.2em] text-fg-dim hover:text-amber">
            ← Agentic EMS
          </Link>
          <span className="hidden font-mono text-[10px] uppercase tracking-[0.16em] text-fg-faint sm:inline">
            · demo v0.1 · {STAGE_LABEL[state.stage] ?? state.stage}
          </span>
          <Link
            href="/demo/dashboard"
            className="border border-edge-2 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-fg-dim hover:border-amber/60 hover:text-amber"
          >
            Portfolio
          </Link>
          <Link
            href="/demo/settings"
            className="border border-edge-2 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-fg-dim hover:border-amber/60 hover:text-amber"
          >
            Settings
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <SessionChip />
          <BalanceChip />
          <button
            onClick={() => dispatch({ type: "restart" })}
            className="border border-edge-2 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint hover:border-amber/60 hover:text-amber"
          >
            Restart demo
          </button>
        </div>
      </header>

      <main className="flex flex-1 flex-col">
        {state.stage === "sso" && <SsoStage />}
        {state.stage === "questionnaire" && <QuestionnaireStage />}
        {state.stage === "chat" && <ChatStage />}
        {state.stage === "wallet-onboarding" && <WalletCanvasStage />}
        {state.stage === "simulation" && <SimulationStage />}
        {state.stage === "approvals" && <ApprovalsStage />}
        {state.stage === "executing" && <ExecutingStage />}
      </main>

      {/*
        Rendered at the shell level rather than inside a stage, so the desk's
        live/simulated state stays visible and switchable no matter which stage is
        on screen — the stages themselves carry no marker.
      */}
      <SimulationToggle />
    </div>
  );
}
