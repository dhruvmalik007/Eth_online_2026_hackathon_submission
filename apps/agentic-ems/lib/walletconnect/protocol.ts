/**
 * The rules a WalletConnect session runs under, as pure functions.
 *
 * Kept separate from the SDK wiring so they can be tested without a relay connection, and so the
 * server can apply the same rules to the request it is asked to sign — the client shows the user
 * what will happen; the server decides whether it does.
 */

/** The only chain this bridge speaks. Sending a request for another chain is a refusal, not a switch. */
export const ALLOWED_CHAIN_ID = 137;

/**
 * Methods we will handle. `eth_sign` is absent deliberately, not by oversight — see
 * {@link refusalFor}.
 */
export const ALLOWED_METHODS = [
  "eth_accounts",
  "eth_requestAccounts",
  "eth_chainId",
  "eth_sendTransaction",
  "personal_sign",
  "eth_signTypedData_v4",
] as const;

export type AllowedMethod = (typeof ALLOWED_METHODS)[number];

/**
 * Why a method is refused, or null when it is allowed.
 *
 * The two refusals that matter are not "unsupported": `eth_sign` signs a pre-hashed blob, so what
 * the user approves and what they are shown can differ — a signature they cannot read. And
 * `eth_signTransaction` hands back a signed transaction the dapp can broadcast later, outside the
 * moment of approval. Both are the shapes a drainer prefers, so they are named in the refusal.
 */
export function refusalFor(method: string): string | null {
  if (method === "eth_sign") {
    return "Blind signing is refused. eth_sign signs bytes that cannot be shown as what they do.";
  }
  if (method === "eth_signTransaction") {
    return "Pre-signed transactions are refused. Submit the transaction and approve it at the moment it runs.";
  }
  if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") {
    return "Only Polygon is enabled for this session.";
  }
  return (ALLOWED_METHODS as readonly string[]).includes(method) ? null : `Unsupported method: ${method}.`;
}

export type PairingResult = { readonly ok: true; readonly uri: string } | { readonly ok: false; readonly reason: string };

/**
 * Validate a `wc:` URI a user pasted from a dapp's Connect modal.
 *
 * Validated rather than forwarded: a malformed URI produces an SDK error whose message does not
 * tell the user that the problem was the paste, and an empty box is the most likely mistake.
 */
export function parsePairingUri(value: string): PairingResult {
  const uri = value.trim();
  if (uri.length === 0) return { ok: false, reason: "Paste the WalletConnect URI from the dapp first." };
  if (!uri.startsWith("wc:")) return { ok: false, reason: "That does not look like a WalletConnect URI — it should start with wc:." };
  if (!uri.includes("@2")) return { ok: false, reason: "That is a WalletConnect v1 URI. This app speaks v2." };
  if (!uri.includes("?")) return { ok: false, reason: "The URI is missing its query string — copy it again from the dapp." };
  return { ok: true, uri };
}

/**
 * The namespace we approve a session with.
 *
 * Typed concretely rather than as an open record: WalletKit validates the namespace it is handed,
 * and a broad type would let a malformed one reach the relay before anything noticed.
 */
export interface Eip155Namespace {
  chains: string[];
  accounts: string[];
  methods: string[];
  events: string[];
}

export function buildNamespaces(chainId: number, address: string): Record<string, Eip155Namespace> {
  return {
    eip155: {
      chains: [`eip155:${chainId}`],
      accounts: [`eip155:${chainId}:${address}`],
      methods: [...ALLOWED_METHODS],
      events: ["chainChanged", "accountsChanged"],
    },
  };
}
