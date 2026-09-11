/**
 * LOW-LEVEL CCTP V2 primitives (burn → Iris attestation → mint native USDC).
 *
 * Flow per Circle Docs (developers.circle.com/cctp/references/technical-guide):
 *   1. depositForBurn on the source TokenMessengerV2 — burns USDC, emits MessageSent.
 *   2. Poll Circle's Iris attestation service for the signed message.
 *   3. receiveMessage on the destination MessageV2 — mints native USDC.
 *
 * Speed: Fast Transfer = lower minFinalityThreshold + maxFee (0–13 bps, seconds).
 *        Standard        = higher threshold, ~13–19 min, near-free.
 */
import { createPublicClient, createWalletClient, http, parseAbi, type Address, type PublicClient, type WalletClient } from "viem";
import { ARC_TOKEN_MESSENGER_V2, irisBaseUrl, type ArcNetwork } from "./chains.js";

const TOKEN_MESSENGER_V2_ABI = parseAbi([
  "function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint256 minFinalityThreshold) external returns (uint64 nonce)",
]);

const MESSAGE_V2_ABI = parseAbi([
  "function receiveMessage(bytes calldata message, bytes calldata attestation) external",
]);

const ERC20_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

export interface CctpOptions {
  /** EOA that signs the burn (agent wallet). */
  account: Address;
  /** RPC for the SOURCE chain (where USDC is burned). */
  sourceRpcUrl: string;
  /** Source chain USDC address. */
  sourceUsdc: Address;
  /** Source chain CCTP V2 TokenMessenger. */
  sourceTokenMessengerV2: Address;
  /** Source USDC decimals — 6 on most spokes, 18 on Arc (config-driven). */
  sourceUsdcDecimals?: number;
  /** True when the SOURCE chain is Arc — forces minFinalityThreshold 2000
   *  (arc-node#110: threshold 1000 attests never progress past pending on Arc). */
  sourceIsArc?: boolean;
  /** Iris attestation base URL (default: per-network — sandbox for testnet). */
  irisApiUrl?: string;
  network: ArcNetwork;
}

export interface BurnParams {
  /** Human USDC amount (converted to raw using sourceUsdcDecimals). */
  amountUsdc: number;
  destinationDomain: number;
  mintRecipient: Address; // 32-byte-padded recipient on destination
  /** Fast Transfer: small maxFee + minFinalityThreshold=1000. Standard: 0 + 2000.
   *  ⚠️ Arc-sourced burns force 2000 regardless (arc-node#110). */
  speed: "fast" | "standard";
  maxFee?: bigint;
  destinationCaller?: Address; // address(0) = permissionless receive
}

export interface AttestedMessage {
  message: string; // hex payload for receiveMessage
  attestation: string; // hex signature
  eventNonce: string;
}

export class CctpV2 {
  private readonly walletClient: WalletClient;
  private readonly publicClient: PublicClient;
  private readonly irisBase: string;
  private readonly sourceChain = { id: 0, name: "cctp-source", nativeCurrency: { name: "Native", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [""] } } } as const;

  constructor(private readonly opts: CctpOptions) {
    // NOTE: the SOURCE chain client is built from opts.sourceRpcUrl (spoke side).
    const sourceChain = { ...this.sourceChain, rpcUrls: { default: { http: [opts.sourceRpcUrl] } } };
    this.walletClient = createWalletClient({ account: opts.account, chain: this.sourceChain, transport: http(opts.sourceRpcUrl) });
    this.publicClient = createPublicClient({ chain: this.sourceChain, transport: http(opts.sourceRpcUrl) });
    this.irisBase = (opts.irisApiUrl ?? irisBaseUrl(opts.network)).replace(/\/$/, "");
  }

  /** Approve the source TokenMessengerV2 to pull USDC (idempotent). */
  async approve(amount: bigint): Promise<void> {
    const current = await this.publicClient.readContract({
      address: this.opts.sourceUsdc,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [this.opts.account, this.opts.sourceTokenMessengerV2],
    });
    if (current >= amount) return;
    const hash = await this.walletClient.writeContract({
      account: this.opts.account,
      address: this.opts.sourceUsdc,
      abi: ERC20_ABI,
      chain: this.sourceChain,
      functionName: "approve",
      args: [this.opts.sourceTokenMessengerV2, amount],
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
  }

  /** Step 1 — burn USDC on the source chain. Returns the message hash to poll. */
  async depositForBurn(p: BurnParams): Promise<{ txHash: string; messageHash: `0x${string}` }> {
    const decimals = this.opts.sourceUsdcDecimals ?? 6;
    const amountRaw = BigInt(Math.round(p.amountUsdc * 10 ** decimals));
    // Arc-sourced burns REQUIRE threshold 2000 (arc-node#110) — 1000 attests never progress.
    const sourceIsArc =
      this.opts.sourceIsArc ??
      this.opts.sourceTokenMessengerV2.toLowerCase() === ARC_TOKEN_MESSENGER_V2.toLowerCase();
    const minFinalityThreshold = BigInt(
      sourceIsArc ? 2000 : p.speed === "fast" ? 1000 : 2000,
    );
    const maxFee =
      p.maxFee ?? (p.speed === "fast" && !sourceIsArc ? (amountRaw * 13n) / 100_000n : 0n);
    const recipientBytes32 = padAddress(p.mintRecipient);
    const destCaller = padAddress(p.destinationCaller ?? "0x0000000000000000000000000000000000000000");

    await this.approve(amountRaw);

    const hash = await this.walletClient.writeContract({
      account: this.opts.account,
      address: this.opts.sourceTokenMessengerV2,
      abi: TOKEN_MESSENGER_V2_ABI,
      chain: this.sourceChain,
      functionName: "depositForBurn",
      args: [amountRaw, p.destinationDomain, recipientBytes32, this.opts.sourceUsdc, destCaller, maxFee, minFinalityThreshold],
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });

    // MessageSent(bytes) emitted by the Message transmitter on the burn tx.
    const log = receipt.logs.find((l) => l.topics[0]?.startsWith("0x") && receipt.logs.length > 0);
    const messageHash = (log?.topics[1] ?? log?.topics[0] ?? "0x0") as `0x${string}`;
    return { txHash: hash, messageHash };
  }

  /** Step 2 — poll Iris until the burn attestation is ready (time-boxed). */
  async waitForAttestation(messageHash: string, timeoutMs = 240_000): Promise<AttestedMessage> {
    const url = `${this.irisBase}/v2/messages/${this.opts.sourceTokenMessengerV2}?transactionHash=${messageHash}`;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (res.ok) {
        const body = (await res.json()) as { messages?: Array<{ message: string; attestation: string; eventNonce: string; status?: string }> };
        const msg = body.messages?.[0];
        if (msg && msg.attestation && msg.attestation !== "PENDING") {
          return { message: msg.message, attestation: msg.attestation, eventNonce: msg.eventNonce };
        }
      }
      await new Promise((r) => setTimeout(r, 5_000));
    }
    throw new Error(`CCTP attestation not ready within ${timeoutMs}ms (messageHash=${messageHash})`);
  }

  /** Step 3 — mint native USDC on the destination chain (permissionless receive). */
  async receiveMessage(
    destinationRpcUrl: string,
    destinationMessageV2: Address,
    attested: AttestedMessage,
    /** Destination chain object (viem) — required for writeContract typing. */
    destinationChain?: { id: number; name: string; nativeCurrency: { name: string; symbol: string; decimals: number }; rpcUrls: { default: { http: string[] } } },
  ): Promise<string> {
    const destChain =
      destinationChain ??
      ({ id: 0, name: "cctp-destination", nativeCurrency: { name: "Native", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [destinationRpcUrl] } } } as const);
    const destPublic = createPublicClient({ transport: http(destinationRpcUrl) });
    const destWallet = createWalletClient({
      account: this.opts.account,
      chain: destChain,
      transport: http(destinationRpcUrl),
    });
    const hash = await destWallet.writeContract({
      address: destinationMessageV2,
      abi: MESSAGE_V2_ABI,
      functionName: "receiveMessage",
      args: [attested.message as `0x${string}`, attested.attestation as `0x${string}`],
    });
    await destPublic.waitForTransactionReceipt({ hash });
    return hash;
  }

  /** Destination-side USDC balance check (post-mint verification). */
  async balanceOf(token: Address, owner: Address, rpcUrl: string): Promise<bigint> {
    const c = createPublicClient({ transport: http(rpcUrl) });
    return c.readContract({ address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [owner] });
  }
}

/** Left-pad a 20-byte address to bytes32 for CCTP recipients. */
function padAddress(addr: Address): `0x${string}` {
  return (`0x${addr.replace(/^0x/, "").padStart(64, "0")}` as `0x${string}`);
}

