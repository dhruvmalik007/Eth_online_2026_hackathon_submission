/**
 * The wallet side of WalletConnect.
 *
 * Agentic EMS acts as the wallet: a dapp's Connect modal shows a `wc:` URI, the user pastes it here,
 * and we answer the requests it sends. This module owns the session; it does not own the key. A
 * request is handed to the execution service, which applies the policy gate and signs — the browser
 * can ask for a signature and can never obtain one it was not granted.
 */
import { ALLOWED_CHAIN_ID, buildNamespaces, refusalFor } from "./protocol";

export interface SessionSummary {
  readonly topic: string;
  readonly name: string;
  readonly url: string;
}

export interface WalletRequest {
  readonly id: number;
  readonly topic: string;
  readonly method: string;
  /** Human label for the request, so the user approves something they can read. */
  readonly summary: string;
  readonly chainId: string;
  /** The raw params, forwarded verbatim to the service that signs. */
  readonly params: unknown;
}

export interface WalletBridge {
  pair(uri: string): Promise<void>;
  sessions(): readonly SessionSummary[];
  requests(): readonly WalletRequest[];
  subscribe(listener: () => void): () => void;
  approve(topic: string, id: number, result: unknown): Promise<void>;
  reject(topic: string, id: number, message: string): Promise<void>;
}

export interface WalletBridgeOptions {
  readonly projectId: string;
  readonly address: string;
  readonly chainId?: number;
  readonly appUrl: string;
}

const METADATA = {
  name: "Agentic EMS",
  description: "Execution management for on-chain fixed income.",
  url: "https://github.com/dhruvmalik007/Eth_online_2026_hackathon_submission",
  icons: [] as string[],
};

/** A one-line description of a request, so approval is informed rather than a tap. */
function describeRequest(method: string, params: unknown): string {
  if (method === "eth_sendTransaction") {
    const first = Array.isArray(params) ? (params[0] as { to?: string; value?: string } | undefined) : undefined;
    const to = first?.to ?? "unknown";
    const value = first?.value;
    return value === undefined ? `Send a transaction to ${to}` : `Send ${value} wei to ${to}`;
  }
  if (method === "personal_sign") return "Sign a message";
  if (method === "eth_signTypedData_v4") return "Sign typed data";
  return method;
}

export async function createWalletBridge(options: WalletBridgeOptions): Promise<WalletBridge> {
  const chainId = options.chainId ?? ALLOWED_CHAIN_ID;
  const { Core } = await import("@walletconnect/core");
  const { WalletKit } = await import("@reown/walletkit");

  const core = new Core({ projectId: options.projectId });
  const kit = await WalletKit.init({ core, metadata: METADATA });

  const listeners = new Set<() => void>();
  const pending = new Map<number, WalletRequest>();
  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  // The proposal is approved with our namespace, so the dapp is told up front which methods and
  // which chain this session covers rather than discovering it one refusal at a time.
  kit.on("session_proposal", async (proposal) => {
    await kit.approveSession({
      id: proposal.id,
      namespaces: buildNamespaces(chainId, options.address),
    });
    notify();
  });

  kit.on("session_request", (event) => {
    const { topic, id, params } = event;
    const method = params.request.method;
    const refusal = refusalFor(method);
    if (refusal !== null) {
      void kit.respondSessionRequest({
        topic,
        response: { id, jsonrpc: "2.0", error: { code: 4001, message: refusal } },
      });
      return;
    }
    pending.set(id, {
      id,
      topic,
      method,
      summary: describeRequest(method, params.request.params),
      chainId: params.chainId,
      params: params.request.params,
    });
    notify();
  });

  kit.on("session_delete", () => notify());

  return {
    async pair(uri: string): Promise<void> {
      await kit.pair({ uri });
      notify();
    },
    sessions(): readonly SessionSummary[] {
      return Object.values(kit.getActiveSessions()).map((session) => ({
        topic: session.topic,
        name: session.peer.metadata?.name ?? "Unknown dapp",
        url: session.peer.metadata?.url ?? "",
      }));
    },
    requests(): readonly WalletRequest[] {
      return [...pending.values()];
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async approve(topic: string, id: number, result: unknown): Promise<void> {
      pending.delete(id);
      await kit.respondSessionRequest({ topic, response: { id, jsonrpc: "2.0", result } });
      notify();
    },
    async reject(topic: string, id: number, message: string): Promise<void> {
      pending.delete(id);
      await kit.respondSessionRequest({
        topic,
        response: { id, jsonrpc: "2.0", error: { code: 4001, message } },
      });
      notify();
    },
  };
}
