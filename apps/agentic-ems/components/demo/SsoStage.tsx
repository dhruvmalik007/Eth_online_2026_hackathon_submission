"use client";

import * as React from "react";
import { Mail } from "lucide-react";
import { useLogin, usePrivy } from "@privy-io/react-auth";
import { useDemo } from "@/lib/demo/state";
import { usePrivyConfigured } from "@/components/privy-provider";
import { identityFromUser } from "@/lib/privy/identity";

type Phase = "idle" | "provisioning" | "error";

/** How long to wait for Privy to materialise the smart account after login. */
const SMART_ACCOUNT_TIMEOUT_MS = 25_000;

/** Closing the modal is not an error — just return to idle. */
function describeLoginError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/exit|cancel|closed|dismiss/i.test(raw)) return "";
  return raw || "Sign-in failed.";
}

export function SsoStage() {
  const configured = usePrivyConfigured();
  if (!configured) return <SsoUnconfigured />;
  return <SsoStageInner />;
}

/** Rendered when NEXT_PUBLIC_PRIVY_APP_ID is absent, so the rest of the site still works. */
function SsoUnconfigured() {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-md border border-down/50 bg-panel p-8">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-down">
          Sign-in not configured
        </p>
        <h1 className="mt-2 text-xl font-semibold">Privy credentials missing</h1>
        <p className="mt-2 text-sm text-fg-dim">
          Set <code className="font-mono text-fg">NEXT_PUBLIC_PRIVY_APP_ID</code> in{" "}
          <code className="font-mono text-fg">apps/agentic-ems/.env.local</code> and restart the dev
          server. The App ID is public — never add the App Secret here.
        </p>
      </div>
    </div>
  );
}

function SsoStageInner() {
  const { dispatch } = useDemo();
  const { ready, authenticated, user, logout } = usePrivy();
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [email, setEmail] = React.useState("");
  const [waitExpired, setWaitExpired] = React.useState(false);

  const { login } = useLogin({
    onComplete: () => {
      setError(null);
      setWaitExpired(false);
      setPhase("provisioning");
    },
    onError: (err) => {
      const message = describeLoginError(err);
      if (!message) {
        setPhase("idle");
        return;
      }
      setError(message);
      setPhase("error");
    },
  });

  // A returning session (or a just-completed login) needs provisioning too.
  React.useEffect(() => {
    if (ready && authenticated && phase === "idle") {
      setWaitExpired(false);
      setPhase("provisioning");
    }
  }, [ready, authenticated, phase]);

  // Hand off to the desk once both wallets exist. Privy creates the embedded
  // EOA first and the smart account shortly after, so this waits for the latter.
  React.useEffect(() => {
    if (phase !== "provisioning" || !user) return;
    const identity = identityFromUser(user);
    if (!identity.embeddedAddress || !identity.smartAccountAddress) return;

    dispatch({ type: "set-email", email: identity.email });
    dispatch({
      type: "set-wallet",
      wallet: {
        address: identity.embeddedAddress,
        safeAddress: identity.smartAccountAddress,
        privyUserId: identity.userId,
        smartWalletType: identity.smartWalletType,
      },
    });
    // Straight to the desk. The trader-profile questionnaire is no longer the gate after
    // sign-in: it still exists as the `questionnaire` stage, but standing between a fresh
    // sign-in and the first screen made every visitor pay for a form before seeing anything.
    // Unanswered is safe rather than a broken state — downstream reads default through
    // `state.answers?.risk ?? "balanced"`, and Settings still collects it.
    dispatch({ type: "set-stage", stage: "chat" });
  }, [phase, user, dispatch]);

  // Surface a useful message if the smart account never arrives — the usual
  // cause is the dashboard not having smart wallets enabled for these networks.
  React.useEffect(() => {
    if (phase !== "provisioning") return;
    const timer = setTimeout(() => setWaitExpired(true), SMART_ACCOUNT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  const identity = user ? identityFromUser(user) : null;
  const hasEmbedded = Boolean(identity?.embeddedAddress);
  const hasSmartAccount = Boolean(identity?.smartAccountAddress);
  const busy = phase === "provisioning" || !ready;

  /** Opens Privy's email flow, pre-filled, straight to the one-time code step. */
  const startEmail = () => {
    const address = email.trim();
    if (!address.includes("@")) return;
    setError(null);
    void login({ loginMethods: ["email"], prefill: { type: "email", value: address } });
  };

  const reset = async () => {
    await logout();
    dispatch({ type: "sign-out" });
    setPhase("idle");
    setError(null);
    setWaitExpired(false);
  };

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="border border-edge-2 bg-panel p-8">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-fg-faint">
            Agentic EMS · v0.1
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Sign in to your desk</h1>
          <p className="mt-2 text-sm text-fg-dim">
            Your identity and embedded wallet are provisioned the moment you sign in. No seed phrase,
            no extensions.
          </p>

          {phase === "idle" && (
            <>
              <form
                className="mt-6"
                onSubmit={(e) => {
                  e.preventDefault();
                  startEmail();
                }}
              >
                <label
                  htmlFor="sso-email"
                  className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-faint"
                >
                  Email address
                </label>
                <div className="mt-1.5 flex items-center border border-edge-2 bg-ink focus-within:border-amber/60">
                  <Mail className="ml-3 size-4 text-fg-faint" />
                  <input
                    id="sso-email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@fund.com"
                    className="w-full bg-transparent px-3 py-3 text-sm text-fg placeholder:text-fg-faint focus:outline-none"
                  />
                </div>
                <button
                  type="submit"
                  disabled={!email.includes("@") || busy}
                  className="mt-3 w-full bg-amber py-3 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-on-amber hover:opacity-90 disabled:opacity-40"
                >
                  Send login code
                </button>
              </form>
              <p className="mt-4 font-mono text-[10px] leading-relaxed text-fg-faint">
                We&apos;ll email you a one-time code — no password, no seed phrase. Signing in
                creates your personal smart account: a Safe controlled by the embedded wallet inside
                this app. You approve every transaction; agents can only propose.
              </p>
            </>
          )}

          {phase === "provisioning" && (
            <div className="mt-8 pb-4">
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-amber">
                Provisioning your account…
              </p>
              <div className="mt-4 space-y-2 font-mono text-[11px]">
                <p className={hasEmbedded ? "text-up" : "text-amber"}>
                  {hasEmbedded ? "✓" : "→"} Embedded wallet
                  {identity?.embeddedAddress ? (
                    <span className="ml-2 break-all text-fg-dim">{identity.embeddedAddress}</span>
                  ) : null}
                </p>
                <p className={hasSmartAccount ? "text-up" : "text-amber"}>
                  {hasSmartAccount ? "✓" : "→"} Smart account (Safe)
                  {identity?.smartAccountAddress ? (
                    <span className="ml-2 break-all text-fg-dim">{identity.smartAccountAddress}</span>
                  ) : null}
                </p>
              </div>
              {!hasSmartAccount && !waitExpired && (
                <p className="mt-4 font-mono text-[10px] text-fg-faint">
                  Creating your smart account… this can take a few seconds.
                </p>
              )}
              {waitExpired && !hasSmartAccount && (
                <div className="mt-4 border border-down/50 bg-down/5 p-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-down">
                    {hasEmbedded ? "Smart account not provisioned" : "Embedded wallet not created"}
                  </p>
                  {/* Which of the two is missing decides which dashboard page is wrong, and they are
                      different pages. Asserting "Privy created your embedded wallet" without checking
                      sends the reader to fix Smart wallets when the embedded wallet never existed —
                      and a Safe is owned by the embedded signer, so that setting alone cannot help. */}
                  {hasEmbedded ? (
                    <p className="mt-1.5 text-[11px] leading-relaxed text-fg-dim">
                      Your embedded wallet exists, but no smart account was created for it. Enable{" "}
                      <span className="text-fg">Smart wallets → type “Safe”</span> with Base, Polygon and
                      Optimism networks in the Privy dashboard, then retry.
                    </p>
                  ) : (
                    <p className="mt-1.5 text-[11px] leading-relaxed text-fg-dim">
                      No embedded wallet was created, so there is no signer for a smart account to be
                      owned by. Turn on wallet creation at login under{" "}
                      <span className="text-fg">Configuration → Embedded wallets</span> in the Privy
                      dashboard, then retry. Smart wallets is a separate setting, and enabling it alone
                      cannot create the account.
                    </p>
                  )}
                  <button
                    onClick={reset}
                    className="mt-3 border border-edge-2 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-dim hover:border-amber/60 hover:text-amber"
                  >
                    Sign out and retry
                  </button>
                </div>
              )}
            </div>
          )}

          {phase === "error" && (
            <div className="mt-8 pb-4">
              <div className="border border-down/50 bg-down/5 p-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-down">
                  Sign-in failed
                </p>
                <p className="mt-1.5 break-words text-[11px] leading-relaxed text-fg-dim">{error}</p>
                <p className="mt-2 text-[10px] leading-relaxed text-fg-faint">
                  Check that Email is enabled as a login method, and that this origin is in the
                  allowed domains, in the Privy dashboard.
                </p>
              </div>
              <button
                onClick={() => setPhase("idle")}
                className="mt-3 w-full bg-amber py-3 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-on-amber hover:opacity-90"
              >
                Try again
              </button>
            </div>
          )}
        </div>

        {phase === "provisioning" && !waitExpired && (
          <p className="mt-4 text-center font-mono text-[11px] text-fg-faint">
            Finalising your smart account…
          </p>
        )}
      </div>
    </div>
  );
}
