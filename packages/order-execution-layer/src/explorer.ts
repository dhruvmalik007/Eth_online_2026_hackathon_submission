/**
 * Where a transfer can be verified.
 *
 * ## Why this is not a chain map
 *
 * A cross-chain transfer has two hashes on two chains, and the chain explorer only shows the half
 * that happened locally. A LI.FI route is brokered by LI.FI, so the place that knows whether it
 * *completed* is LI.FI; a LayerZero message is delivered by the endpoint, so the place that knows is
 * LayerZero Scan. Linking only the source chain produced a link that looked correct, went to a real
 * transaction, and could not answer the question the user actually had — "did my bridge arrive?".
 *
 * So the provider decides the primary link when the provider publishes a scan, and the chain explorer
 * is the fallback rather than the rule.
 *
 * ## Why it returns undefined instead of a best guess
 *
 * A guessed URL is worse than no URL: it resolves, it 404s or lands on an unrelated transaction, and
 * it costs the reader the time to find that out. When no honest link can be built, this says so.
 */
import { SOURCE_IDS, type SourceId } from "./port.js";

export interface ScanTarget {
  /** What the link is, for a label next to it ("LI.FI scan", "Etherscan"). */
  readonly label: string;
  readonly url: string;
}

/** A transaction, and everything known about where it landed. */
export interface TransactionReference {
  readonly txHash: string;
  /** The chain the transaction was broadcast on. */
  readonly chainId?: number;
  /** Who brokered it — decides the primary link. */
  readonly source?: SourceId | string;
  /** The hash on the far side, when the provider reports one. */
  readonly deliveredTxHash?: string;
  /** The destination chain of the delivered leg, when known. */
  readonly destinationChainId?: number;
  /** CCTP's message hash, for the Circle attestation endpoint. */
  readonly messageHash?: string;
}

export interface TransactionLinks {
  /** Open this one. The provider's own scan when it has one, otherwise the chain explorer. */
  readonly primary: ScanTarget;
  /** The provider's scan, when the provider publishes one. */
  readonly provider?: ScanTarget;
  /** The source-chain transaction. */
  readonly sourceChain?: ScanTarget;
  /** The delivered transaction on the destination chain. */
  readonly destination?: ScanTarget;
  /** Circle's attestation endpoint for a CCTP message. JSON, not a UI — carried as-is. */
  readonly attestation?: ScanTarget;
}

/** Base explorer per chain. Only chains this repo actually settles on. */
const CHAIN_EXPLORERS: Readonly<Record<number, { readonly label: string; readonly base: string }>> = {
  1: { label: "Etherscan", base: "https://etherscan.io" },
  11155111: { label: "Etherscan (Sepolia)", base: "https://sepolia.etherscan.io" },
  10: { label: "OPscan", base: "https://optimistic.etherscan.io" },
  11155420: { label: "OPscan (Sepolia)", base: "https://sepolia-optimism.etherscan.io" },
  42161: { label: "Arbiscan", base: "https://arbiscan.io" },
  421614: { label: "Arbiscan (Sepolia)", base: "https://sepolia.arbiscan.io" },
  137: { label: "Polygonscan", base: "https://polygonscan.com" },
  80002: { label: "Polygonscan (Amoy)", base: "https://amoy.polygonscan.com" },
  8453: { label: "Basescan", base: "https://basescan.org" },
  84532: { label: "Basescan (Sepolia)", base: "https://sepolia.basescan.org" },
  43114: { label: "Snowtrace", base: "https://snowtrace.io" },
  56: { label: "BscScan", base: "https://bscscan.com" },
  5042: { label: "ArcScan", base: "https://arc-scan.org" },
  5042002: { label: "ArcScan (Testnet)", base: "https://testnet.arc-scan.org" },
};

/**
 * Providers that publish their own scan.
 *
 * `circle-cctp` is deliberately absent: Circle has no public transaction scan, and inventing one
 * would produce a link that 404s. Its source-chain explorer plus the attestation endpoint is what
 * honestly exists.
 */
const PROVIDER_SCANS: Partial<Record<SourceId, { readonly label: string; readonly url: (h: string) => string }>> = {
  lifi: { label: "LI.FI scan", url: (h) => `https://scan.li.fi/tx/${h}` },
  layerzero: { label: "LayerZero Scan", url: (h) => `https://layerzeroscan.com/tx/${h}` },
};

/** The chain's explorer, or `undefined` for a chain we do not know. */
export function chainExplorer(chainId: number): ScanTarget | undefined {
  const found = CHAIN_EXPLORERS[chainId];
  return found === undefined ? undefined : { label: found.label, url: `${found.base}/tx/` };
}

function chainTarget(chainId: number, hash: string): ScanTarget | undefined {
  const found = CHAIN_EXPLORERS[chainId];
  if (found === undefined) return undefined;
  return { label: found.label, url: `${found.base}/tx/${hash}` };
}

/** A provider's scan link, when the provider publishes one. */
export function providerScan(source: string, txHash: string): ScanTarget | undefined {
  const found = (PROVIDER_SCANS as Record<string, { label: string; url: (h: string) => string } | undefined>)[
    source.trim().toLowerCase()
  ];
  return found === undefined ? undefined : { label: found.label, url: found.url(txHash) };
}

/** Whether a `source` string is one this build knows. */
export function isKnownSource(source: string): source is SourceId {
  return (SOURCE_IDS as readonly string[]).includes(source);
}

/**
 * Every link that can honestly be built for one transfer.
 *
 * @returns `undefined` when no link can be built — never a placeholder.
 */
export function transactionLinks(reference: TransactionReference): TransactionLinks | undefined {
  const hash = reference.txHash.trim();
  if (hash.length === 0) return undefined;

  const source = reference.source?.trim().toLowerCase();
  const provider = source === undefined ? undefined : providerScan(source, hash);
  const sourceChain =
    reference.chainId === undefined ? undefined : chainTarget(reference.chainId, hash);
  const destination =
    reference.deliveredTxHash !== undefined && reference.destinationChainId !== undefined
      ? chainTarget(reference.destinationChainId, reference.deliveredTxHash)
      : undefined;
  const attestation =
    reference.messageHash === undefined
      ? undefined
      : {
          label: "Circle attestation",
          url: `https://iris-api.circle.com/v2/messages?transactionHash=${hash}`,
        };

  // The provider's scan answers "did it arrive?"; the chain explorer only answers "did it send?".
  const primary = provider ?? sourceChain;
  if (primary === undefined) return undefined;

  return {
    primary,
    ...(provider === undefined ? {} : { provider }),
    ...(sourceChain === undefined ? {} : { sourceChain }),
    ...(destination === undefined ? {} : { destination }),
    ...(attestation === undefined ? {} : { attestation }),
  };
}
