"use client";

/**
 * Wallet sessions — the operator view of the WalletConnect bridge.
 *
 * A dapp's Connect modal gives the user a `wc:` URI; they paste it here and this app becomes the
 * wallet. This page exists so the mechanism is inspectable rather than magic: it shows which account
 * is offered, which dapps are connected, and what is waiting for approval.
 *
 * Approving forwards the request to the execution service, which holds the key and applies the
 * policy gate. Nothing is signed in the browser.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createWalletBridge,
  type SessionSummary,
  type WalletBridge,
  type WalletRequest,
} from "@/lib/walletconnect/bridge";
import { parsePairingUri } from "@/lib/walletconnect/protocol";

const EXECUTION_URL = (process.env.NEXT_PUBLIC_EXECUTION_URL ?? "").replace(/\/$/, "");

export default function WalletSessionPage(): React.JSX.Element {
  const [address, setAddress] = useState<string | null>(null);
  const [uri, setUri] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sessions, setSessions] = useState<readonly SessionSummary[]>([]);
  const [requests, setRequests] = useState<readonly WalletRequest[]>([]);
  const [userId, setUserId] = useState("did:privy:demo");
  const bridgeRef = useRef<WalletBridge | null>(null);
  const projectId = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID ?? "";

  // The account offered to a dapp is the execution service's signer — the same address that does our
  // own executions, so a position opened here and one opened from the chat are the same position.
  useEffect(() => {
    if (EXECUTION_URL.length === 0) return;
    let cancelled = false;
    void fetch(`${EXECUTION_URL}/health`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : undefined))
      .then((body: unknown) => {
        if (cancelled || body === undefined) return;
        const signer = (body as { signer?: { address?: string } }).signer;
        if (signer?.address !== undefined) setAddress(signer.address);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const ensureBridge = useCallback(async (): Promise<WalletBridge | null> => {
    if (bridgeRef.current !== null) return bridgeRef.current;
    if (address === null) {
      setError("No signer is configured on the execution service, so there is no account to offer.");
      return null;
    }
    const bridge = await createWalletBridge({ projectId, address, appUrl: window.location.origin });
    bridgeRef.current = bridge;
    bridge.subscribe(() => {
      setSessions(bridge.sessions());
      setRequests(bridge.requests());
    });
    return bridge;
  }, [address, projectId]);

  const onPair = useCallback(async (): Promise<void> => {
    setError(null);
    setNotice(null);
    const parsed = parsePairingUri(uri);
    if (!parsed.ok) {
      setError(parsed.reason);
      return;
    }
    if (projectId.length === 0) {
      setError("NEXT_PUBLIC_REOWN_PROJECT_ID is not set, so the relay cannot be reached.");
      return;
    }
    try {
      const bridge = await ensureBridge();
      if (bridge === null) return;
      await bridge.pair(parsed.uri);
      setUri("");
      setNotice("Paired. The dapp should now show the account below.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Pairing failed.");
    }
  }, [ensureBridge, projectId, uri]);

  const onApprove = useCallback(async (request: WalletRequest): Promise<void> => {
    const bridge = bridgeRef.current;
    if (bridge === null) return;
    setError(null);
    try {
      const response = await fetch(`${EXECUTION_URL}/wallet/sign`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": userId },
        body: JSON.stringify({ method: request.method, chainId: request.chainId, params: request.params }),
      });
      const body = (await response.json()) as { result?: unknown; error?: { message?: string } };
      if (!response.ok) {
        setError(body.error?.message ?? `Signing failed (${response.status}).`);
        return;
      }
      await bridge.approve(request.topic, request.id, body.result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Signing failed.");
    }
  }, [userId]);

  const onReject = useCallback(async (request: WalletRequest): Promise<void> => {
    const bridge = bridgeRef.current;
    if (bridge === null) return;
    await bridge.reject(request.topic, request.id, "Rejected in Agentic EMS.");
  }, []);

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
      <header>
        <h1 className="text-xl font-semibold">Wallet sessions</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Connect this wallet to a dapp by pasting the WalletConnect URI from its Connect modal.
        </p>
      </header>

      <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
        <dt className="text-neutral-400">Account</dt>
        <dd className="font-mono break-all">{address ?? "not configured"}</dd>
        <dt className="text-neutral-400">Identity</dt>
        <dd>
          <input value={userId} onChange={(event) => setUserId(event.target.value)} aria-label="User id" className="w-full rounded border border-neutral-700 bg-transparent px-2 py-1 font-mono text-xs" />
        </dd>
        <dt className="text-neutral-400">Relay</dt>
        <dd>{projectId.length > 0 ? "project configured" : "NEXT_PUBLIC_REOWN_PROJECT_ID missing"}</dd>
      </dl>

      <div className="flex gap-2">
        <input
          value={uri}
          onChange={(event) => setUri(event.target.value)}
          placeholder="wc:…@2?relay-protocol=irn&symKey=…"
          aria-label="WalletConnect URI"
          className="flex-1 rounded border border-neutral-700 bg-transparent px-3 py-2 font-mono text-xs"
        />
        <button onClick={() => void onPair()} className="rounded border border-neutral-600 px-4 py-2 text-sm">
          Connect
        </button>
      </div>

      {error !== null && <p className="text-sm text-red-400">{error}</p>}
      {notice !== null && <p className="text-sm text-emerald-400">{notice}</p>}

      <section>
        <h2 className="text-sm font-medium text-neutral-300">Connected dapps</h2>
        {sessions.length === 0 ? (
          <p className="mt-1 text-sm text-neutral-500">None yet.</p>
        ) : (
          <ul className="mt-1 flex flex-col gap-1 text-sm">
            {sessions.map((session) => (
              <li key={session.topic} className="font-mono text-xs">
                {session.name} · {session.url}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-sm font-medium text-neutral-300">Waiting for approval</h2>
        {requests.length === 0 ? (
          <p className="mt-1 text-sm text-neutral-500">Nothing pending.</p>
        ) : (
          <ul className="mt-1 flex flex-col gap-3">
            {requests.map((request) => (
              <li key={request.id} className="rounded border border-neutral-700 p-3 text-sm">
                <p>{request.summary}</p>
                <p className="mt-1 font-mono text-xs text-neutral-500">{request.method}</p>
                <div className="mt-2 flex gap-2">
                  <button onClick={() => void onApprove(request)} className="rounded border border-neutral-600 px-3 py-1 text-xs">
                    Approve
                  </button>
                  <button onClick={() => void onReject(request)} className="rounded border border-neutral-700 px-3 py-1 text-xs text-neutral-400">
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
